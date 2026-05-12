import { type ParseContext, type ParsedDocument, type Parser } from '../parser.js';
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
    const docs: ParsedDocument[] = [];

    docs.push(...(await parseChats(entries, ctx, 'design_chats/')));
    docs.push(...(await parseChats(entries, ctx, 'conversations.json')));
    docs.push(...(await parseProjects(entries, ctx)));
    docs.push(...(await parseMemories(entries, ctx)));

    return docs;
  },
};

async function parseChats(
  entries: ZipEntry[],
  ctx: ParseContext,
  prefix: string,
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
      out.push(renderChat(chat, messages, ctx));
    }
  }
  return out;
}

function renderChat(
  chat: ClaudeChat,
  messages: ClaudeMessage[],
  ctx: ParseContext,
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
    },
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
