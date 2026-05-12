import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  type ParseContext,
  type ParsedAttachment,
  type ParsedDocument,
  type Parser,
} from '../parser.js';
import { readZipEntries, readZipEntriesFromFile, type ZipEntry } from '../zip.js';

/**
 * Claude.ai data-export ZIP. Layout (verified against a real export):
 *
 *   users.json                       — array of user records (skipped, no value)
 *   memories.json                    — Claude's "memory" (one Document)
 *   projects/<uuid>.json             — { uuid, name, description, prompt_template, docs: [...] }
 *   design_chats/<uuid>.json         — { uuid, title, project, messages: [...] }
 *   conversations.json               — array of conversations (top-level chats)
 *
 * One ParsedDocument per chat, per project (description + prompt_template),
 * per project doc, plus one for memories.json.
 */

// Claude.ai ships two distinct chat schemas in the same archive:
//   • design_chats/<uuid>.json — { title, messages: [{ role, content: {...} }] }
//   • conversations.json       — [{ name, chat_messages: [{ sender, text,
//                                   content: [{ type:'text', text }] }] }]
// We accept both shapes here. `messages` ?? `chat_messages`, `title` ?? `name`,
// and per-message: `role` ?? `sender`, plus a text-block walker that handles
// `text` (string), `content` (object — old schema), and `content` (array of
// Anthropic-API content blocks — new schema).
interface ClaudeChat {
  uuid: string;
  title?: string;
  name?: string;
  project?: { uuid?: string; name?: string };
  created_at?: string;
  updated_at?: string;
  messages?: ClaudeMessage[];
  chat_messages?: ClaudeMessage[];
}

interface ClaudeMessage {
  uuid?: string;
  role?: string;
  sender?: string;
  text?: string;
  content?: ClaudeMessageContent | ContentBlock[] | string;
  attachments?: { id?: string; name?: string; type?: string; content?: string }[];
  files?: { file_name?: string; extracted_content?: string }[];
  created_at?: string;
}

interface ContentBlock {
  type?: string;
  text?: string;
}

interface ClaudeMessageContent {
  role?: string;
  content?: string | unknown;
  contentBlocks?: ContentBlock[];
  attachments?: { id?: string; name?: string; type?: string; content?: string }[];
  timestamp?: string;
}

interface ClaudeProject {
  uuid: string;
  name?: string;
  description?: string;
  prompt_template?: string;
  created_at?: string;
  updated_at?: string;
  docs?: { uuid: string; filename?: string; content?: string; created_at?: string }[];
}

interface ClaudeMemoriesFile {
  memories?: { id?: string; content?: string; created_at?: string }[];
}

export const claudeParser: Parser = {
  name: 'claude',
  canParse(): boolean {
    // Selected by registry after peek-detection of users.json + design_chats/.
    return false;
  },
  async parse(buf: Buffer, ctx: ParseContext): Promise<ParsedDocument[]> {
    const entries = ctx.inputPath
      ? await readZipEntriesFromFile(ctx.inputPath)
      : await readZipEntries(buf);

    // Build a filename → entry map for binary attachments. Claude.ai ships
    // attachments next to the JSON, often under `attachments/<chatUuid>/<name>`
    // or `files/<id>-<name>`. Match by trailing basename plus the chat uuid
    // when available so we don't accidentally cross-link.
    const binaryIndex = indexBinaryEntries(entries);
    await fs.mkdir(ctx.workdir, { recursive: true });

    const docs: ParsedDocument[] = [];
    docs.push(...(await parseChats(entries, ctx, 'design_chats/', binaryIndex)));
    docs.push(...(await parseChats(entries, ctx, 'conversations.json', binaryIndex)));
    docs.push(...(await parseProjects(entries, ctx)));
    docs.push(...(await parseMemories(entries, ctx)));

    return docs;
  },
};

const BINARY_EXT_RE = /\.(png|jpe?g|webp|gif|heic|heif|pdf|mp3|mp4|wav|m4a|zip|csv|xlsx?|docx?)$/i;

function indexBinaryEntries(entries: ZipEntry[]): BinaryIndex {
  const byBaseName = new Map<string, ZipEntry[]>();
  const byPath = new Map<string, ZipEntry>();
  for (const entry of entries) {
    const base = path.basename(entry.fileName);
    if (!BINARY_EXT_RE.test(base)) continue;
    byPath.set(entry.fileName, entry);
    const list = byBaseName.get(base) ?? [];
    list.push(entry);
    byBaseName.set(base, list);
  }
  return { byBaseName, byPath };
}

interface BinaryIndex {
  byBaseName: Map<string, ZipEntry[]>;
  byPath: Map<string, ZipEntry>;
}

function findBinaryEntry(
  index: BinaryIndex,
  name: string,
  chatUuid?: string,
): ZipEntry | undefined {
  // First try an explicit nested path (`attachments/<chatUuid>/<name>`).
  if (chatUuid) {
    for (const prefix of [`attachments/${chatUuid}/`, `files/${chatUuid}/`]) {
      const direct = index.byPath.get(`${prefix}${name}`);
      if (direct) return direct;
    }
  }
  const candidates = index.byBaseName.get(path.basename(name));
  if (!candidates || candidates.length === 0) return undefined;
  if (chatUuid) {
    const scoped = candidates.find((c) => c.fileName.includes(chatUuid));
    if (scoped) return scoped;
  }
  return candidates[0];
}

async function extractBinaryAttachment(
  entry: ZipEntry,
  ctx: ParseContext,
  chatUuid: string | undefined,
): Promise<ParsedAttachment> {
  const baseName = path.basename(entry.fileName);
  const safe = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const destPath = path.join(ctx.workdir, `${chatUuid ?? 'claude'}-${safe}`);
  await entry.streamTo(destPath);
  return {
    filename: baseName,
    mimeType: guessMime(baseName),
    tempPath: destPath,
    size: entry.size,
    metadata: { sourceZipEntry: entry.fileName, chatUuid },
  };
}

function guessMime(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.pdf':
      return 'application/pdf';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.m4a':
      return 'audio/mp4';
    case '.mp4':
      return 'video/mp4';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    default:
      return 'application/octet-stream';
  }
}

async function parseChats(
  entries: ZipEntry[],
  ctx: ParseContext,
  prefix: string,
  binaryIndex: BinaryIndex,
): Promise<ParsedDocument[]> {
  const matches = entries.filter((e) =>
    prefix.endsWith('/')
      ? e.fileName.startsWith(prefix) && e.fileName.endsWith('.json')
      : e.fileName.endsWith(prefix),
  );
  const out: ParsedDocument[] = [];
  for (const entry of matches) {
    const buf = await entry.read();
    const parsed: unknown = JSON.parse(buf.toString('utf-8'));
    const chats: ClaudeChat[] = Array.isArray(parsed)
      ? (parsed as ClaudeChat[])
      : [parsed as ClaudeChat];
    for (const chat of chats) {
      const messages = chat?.messages ?? chat?.chat_messages;
      if (!chat || !Array.isArray(messages)) continue;
      const attachments = await collectChatAttachments(chat, messages, binaryIndex, ctx);
      out.push(renderChat(chat, messages, ctx, attachments));
    }
  }
  return out;
}

/**
 * Walk a chat's message tree and pull out every non-text attachment whose
 * filename matches a binary entry in the ZIP. The text-only attachments are
 * still rendered as `[attachment: name]` markers + their `extracted_content`
 * inline (renderMessageBody hasn't changed), so this only adds binary files
 * — no double-counting.
 */
async function collectChatAttachments(
  chat: ClaudeChat,
  messages: ClaudeMessage[],
  binaryIndex: BinaryIndex,
  ctx: ParseContext,
): Promise<ParsedAttachment[]> {
  const seen = new Set<string>();
  const out: ParsedAttachment[] = [];
  for (const m of messages) {
    const names: string[] = [];
    if (Array.isArray(m.attachments)) {
      for (const a of m.attachments) if (a.name) names.push(a.name);
    }
    if (Array.isArray(m.files)) {
      for (const f of m.files) if (f.file_name) names.push(f.file_name);
    }
    const innerAtts =
      m.content && !Array.isArray(m.content) && typeof m.content === 'object'
        ? (m.content as ClaudeMessageContent).attachments
        : undefined;
    if (Array.isArray(innerAtts)) {
      for (const a of innerAtts) if (a.name) names.push(a.name);
    }
    for (const name of names) {
      const key = `${chat.uuid}::${name}`;
      if (seen.has(key)) continue;
      const entry = findBinaryEntry(binaryIndex, name, chat.uuid);
      if (!entry) continue;
      seen.add(key);
      out.push(await extractBinaryAttachment(entry, ctx, chat.uuid));
    }
  }
  return out;
}

function renderChat(
  chat: ClaudeChat,
  messages: ClaudeMessage[],
  ctx: ParseContext,
  attachments: ParsedAttachment[] = [],
): ParsedDocument {
  const lines: string[] = [];
  for (const m of messages) {
    const role = m.role ?? m.sender ?? extractInnerRole(m.content) ?? 'unknown';
    const ts = m.created_at ?? extractInnerTimestamp(m.content) ?? '';
    const text = renderMessageBody(m);
    if (!text) continue;
    lines.push(`## ${role}${ts ? ` · ${ts}` : ''}`);
    lines.push('');
    lines.push(text);
    lines.push('');
  }
  const title = chat.title?.trim() || chat.name?.trim() || `claude-chat-${chat.uuid.slice(0, 8)}`;
  return {
    source: 'claude_export',
    sourceId: chat.uuid,
    title,
    rawText: lines.join('\n').trim(),
    type: 'chat',
    metadata: {
      originalFilename: ctx.filename,
      chatUuid: chat.uuid,
      projectUuid: chat.project?.uuid,
      projectName: chat.project?.name,
      createdAt: chat.created_at,
      updatedAt: chat.updated_at,
      messageCount: messages.length,
      attachmentCount: attachments.length,
    },
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

function extractInnerRole(content: ClaudeMessage['content']): string | undefined {
  if (content && !Array.isArray(content) && typeof content === 'object') {
    return (content as ClaudeMessageContent).role;
  }
  return undefined;
}

function extractInnerTimestamp(content: ClaudeMessage['content']): string | undefined {
  if (content && !Array.isArray(content) && typeof content === 'object') {
    return (content as ClaudeMessageContent).timestamp;
  }
  return undefined;
}

function renderMessageBody(m: ClaudeMessage): string {
  const parts: string[] = [];

  // Top-level `text` (conversations.json schema — preferred when present).
  if (typeof m.text === 'string' && m.text.trim()) {
    parts.push(m.text.trim());
  }

  // `content` may be: string | object (old design_chats schema) | array of
  // Anthropic-API content blocks (new conversations.json schema).
  const c = m.content;
  if (typeof c === 'string' && c.trim()) {
    parts.push(c.trim());
  } else if (Array.isArray(c)) {
    for (const block of c) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        // Skip if identical to top-level m.text (deduplicate).
        if (block.text.trim() !== m.text?.trim()) parts.push(block.text.trim());
      }
    }
  } else if (c && typeof c === 'object') {
    const inner = c as ClaudeMessageContent;
    if (typeof inner.content === 'string' && inner.content.trim()) {
      parts.push(inner.content.trim());
    }
    if (Array.isArray(inner.contentBlocks)) {
      for (const block of inner.contentBlocks) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          parts.push(block.text.trim());
        }
      }
    }
    if (Array.isArray(inner.attachments)) {
      for (const att of inner.attachments) {
        const name = att.name ?? att.id ?? 'attachment';
        parts.push(`[attachment: ${name}]`);
        if (typeof att.content === 'string' && att.content.trim()) {
          parts.push(att.content.trim());
        }
      }
    }
  }

  // Top-level attachments (conversations.json schema).
  if (Array.isArray(m.attachments)) {
    for (const att of m.attachments) {
      const name = att.name ?? att.id ?? 'attachment';
      parts.push(`[attachment: ${name}]`);
      if (typeof att.content === 'string' && att.content.trim()) {
        parts.push(att.content.trim());
      }
    }
  }

  // Top-level files with extracted text (conversations.json schema).
  if (Array.isArray(m.files)) {
    for (const f of m.files) {
      const name = f.file_name ?? 'file';
      if (typeof f.extracted_content === 'string' && f.extracted_content.trim()) {
        parts.push(`[file: ${name}]`);
        parts.push(f.extracted_content.trim());
      }
    }
  }

  return parts.join('\n\n').trim();
}

async function parseProjects(entries: ZipEntry[], ctx: ParseContext): Promise<ParsedDocument[]> {
  const matches = entries.filter(
    (e) => e.fileName.startsWith('projects/') && e.fileName.endsWith('.json'),
  );
  const out: ParsedDocument[] = [];
  for (const entry of matches) {
    const buf = await entry.read();
    const project = JSON.parse(buf.toString('utf-8')) as ClaudeProject;
    if (!project?.uuid) continue;

    const overviewParts: string[] = [];
    if (project.description?.trim()) overviewParts.push(project.description.trim());
    if (project.prompt_template?.trim()) {
      overviewParts.push(`### Prompt template\n\n${project.prompt_template.trim()}`);
    }
    if (overviewParts.length > 0) {
      out.push({
        source: 'claude_export',
        sourceId: `${project.uuid}::overview`,
        title: project.name?.trim() || `claude-project-${project.uuid.slice(0, 8)}`,
        rawText: overviewParts.join('\n\n'),
        type: 'project',
        metadata: {
          originalFilename: ctx.filename,
          projectUuid: project.uuid,
          createdAt: project.created_at,
          updatedAt: project.updated_at,
        },
      });
    }

    for (const doc of project.docs ?? []) {
      if (!doc.content?.trim()) continue;
      out.push({
        source: 'claude_export',
        sourceId: `${project.uuid}::${doc.uuid}`,
        title: doc.filename?.trim() || `${project.name ?? 'project'} / ${doc.uuid.slice(0, 8)}`,
        rawText: doc.content.trim(),
        type: 'doc',
        metadata: {
          originalFilename: ctx.filename,
          projectUuid: project.uuid,
          projectName: project.name,
          docUuid: doc.uuid,
          createdAt: doc.created_at,
        },
      });
    }
  }
  return out;
}

async function parseMemories(entries: ZipEntry[], ctx: ParseContext): Promise<ParsedDocument[]> {
  const entry = entries.find((e) => e.fileName === 'memories.json');
  if (!entry) return [];
  const buf = await entry.read();
  const parsed: unknown = JSON.parse(buf.toString('utf-8'));
  const file: ClaudeMemoriesFile = Array.isArray(parsed)
    ? { memories: parsed as ClaudeMemoriesFile['memories'] }
    : (parsed as ClaudeMemoriesFile);
  const memories = file.memories ?? [];
  if (memories.length === 0) return [];

  const lines = memories
    .map((m, i) => {
      const ts = m.created_at ? ` · ${m.created_at}` : '';
      return `### memory ${i + 1}${ts}\n\n${m.content?.trim() ?? ''}`;
    })
    .filter((line) => line.length > 0);

  return [
    {
      source: 'claude_export',
      sourceId: 'memories',
      title: 'Claude memories',
      rawText: lines.join('\n\n'),
      type: 'note',
      metadata: { originalFilename: ctx.filename, memoryCount: memories.length },
    },
  ];
}
