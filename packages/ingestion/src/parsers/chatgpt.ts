import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  type ParseContext,
  type ParsedAttachment,
  type ParsedDocument,
  type Parser,
} from '../parser.js';
import { readZipEntries, readZipEntriesFromFile, type ZipEntry } from '../zip.js';

interface ChatGPTConversation {
  id?: string;
  conversation_id?: string;
  title?: string;
  create_time?: number;
  update_time?: number;
  /**
   * New ChatGPT exports carry project / custom-GPT linkage on the
   * conversation: `conversation_template_id` for "projects"-style chats,
   * `gizmo_id` for custom GPTs. Either becomes a project Entity via the
   * worker's emitGraphEventsForDocument (`projectName` + `projectUuid` in
   * metadata are the shared shape with the Claude parser).
   */
  conversation_template_id?: string;
  gizmo_id?: string;
  default_model_slug?: string;
  mapping: Record<string, ChatGPTNode>;
}

interface ChatGPTNode {
  id: string;
  parent?: string | null;
  children?: string[];
  message?: {
    id: string;
    author?: { role?: string; name?: string | null };
    create_time?: number;
    content?: ChatGPTContent;
    metadata?: Record<string, unknown>;
  } | null;
}

interface ChatGPTContent {
  content_type?: string;
  parts?: unknown[];
  text?: string;
}

interface ImageAssetPointer {
  content_type?: string;
  asset_pointer?: string;
  size_bytes?: number;
  width?: number;
  height?: number;
}

/**
 * ChatGPT data export ZIP — top-level `conversations.json` is an array of
 * conversations, each with a `mapping` of message nodes linked by parent.
 * One ParsedDocument per conversation; image asset_pointers in `parts` are
 * matched against ZIP entries (typically `dalle-generations/file-XXX-...`)
 * and surfaced as ParsedAttachments + an inline `[image: name]` marker so
 * the resulting rawText still mentions them by context.
 *
 * Audio (`voice/`, `audio_asset_pointer`) is intentionally skipped — see
 * the design discussion preceding ADR-0048.
 */
export const chatgptParser: Parser = {
  name: 'chatgpt',
  canParse(): boolean {
    return false; // Registry-driven; see registry.ts.
  },
  async parse(buf: Buffer, ctx: ParseContext): Promise<ParsedDocument[]> {
    // Bare conversations.json (no ZIP) path: no attachments, no projects.
    if (!ctx.inputPath && (ctx.extension === '.json' || ctx.mimeType === 'application/json')) {
      const parsed: unknown = JSON.parse(buf.toString('utf-8'));
      const conversations: ChatGPTConversation[] = Array.isArray(parsed)
        ? (parsed as ChatGPTConversation[])
        : [];
      return conversations.map((conv) => renderConversation(conv, ctx, [], []));
    }

    const entries = await loadZipEntries(buf, ctx);
    const conversations = await loadConversationsFromZip(entries);

    // Index ZIP entries by trailing file-XXX id so each asset_pointer is an
    // O(1) lookup across the whole conversation list. Entries appear in a few
    // shapes:
    //   dalle-generations/file-OvD09kxbV9F8fhRsB0Mt2NJ0-foo.png
    //   file-OvD09kxbV9F8fhRsB0Mt2NJ0-bar.jpeg          (root)
    //   attachments/file-XXXXX-name.pdf                  (user uploads)
    const filesByAssetId = indexByAssetId(entries);

    const docs: ParsedDocument[] = [];
    await fs.mkdir(ctx.workdir, { recursive: true });

    for (const conv of conversations) {
      const refs = collectAssetReferences(conv);
      const attachments: ParsedAttachment[] = [];
      const inlineMarkers = new Map<string, string>(); // assetId -> filename

      for (const ref of refs) {
        const entry = filesByAssetId.get(ref.assetId);
        if (!entry) continue;
        const baseName = path.basename(entry.fileName);
        const safe = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const destPath = path.join(ctx.workdir, `${ref.assetId}-${safe}`);
        await entry.streamTo(destPath);
        attachments.push({
          filename: baseName,
          mimeType: ref.mimeType || guessMime(baseName),
          tempPath: destPath,
          size: entry.size,
          metadata: {
            assetPointer: ref.assetPointer,
            assetId: ref.assetId,
            sourceZipEntry: entry.fileName,
            width: ref.width,
            height: ref.height,
          },
        });
        inlineMarkers.set(ref.assetId, baseName);
      }

      docs.push(renderConversation(conv, ctx, attachments, refs, inlineMarkers));
    }

    return docs;
  },
};

async function loadZipEntries(buf: Buffer, ctx: ParseContext): Promise<ZipEntry[]> {
  if (ctx.inputPath) return readZipEntriesFromFile(ctx.inputPath);
  return readZipEntries(buf);
}

async function loadConversationsFromZip(entries: ZipEntry[]): Promise<ChatGPTConversation[]> {
  const target = entries.find((e) => e.fileName.toLowerCase().endsWith('conversations.json'));
  if (!target) return [];
  const data = await target.read();
  const parsed: unknown = JSON.parse(data.toString('utf-8'));
  return Array.isArray(parsed) ? (parsed as ChatGPTConversation[]) : [];
}

interface AssetReference {
  /** The `file-XXXX...` id (without `file-service://` prefix). */
  assetId: string;
  assetPointer: string;
  mimeType?: string;
  width?: number;
  height?: number;
}

function collectAssetReferences(conv: ChatGPTConversation): AssetReference[] {
  const out: AssetReference[] = [];
  const seen = new Set<string>();
  for (const node of Object.values(conv.mapping ?? {})) {
    const parts = node.message?.content?.parts ?? [];
    for (const p of parts) {
      if (typeof p !== 'object' || p === null) continue;
      const obj = p as ImageAssetPointer;
      const pointer = obj.asset_pointer;
      if (typeof pointer !== 'string') continue;
      const id = extractAssetId(pointer);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        assetId: id,
        assetPointer: pointer,
        mimeType: pointer.startsWith('file-service://') ? undefined : pointer.split(':')[0],
        width: obj.width,
        height: obj.height,
      });
    }
  }
  return out;
}

function extractAssetId(pointer: string): string | null {
  // file-service://file-OvD09kxbV9F8fhRsB0Mt2NJ0
  const m = pointer.match(/file-([A-Za-z0-9]+)/);
  return m ? `file-${m[1]}` : null;
}

function indexByAssetId(entries: ZipEntry[]): Map<string, ZipEntry> {
  const map = new Map<string, ZipEntry>();
  for (const entry of entries) {
    const base = path.basename(entry.fileName);
    const m = base.match(/^(file-[A-Za-z0-9]+)/);
    const fileId = m?.[1];
    if (!fileId) continue;
    // First occurrence wins; dalle-generations/ tends to appear earlier in
    // the listing than the root mirror copies, but either is fine.
    if (!map.has(fileId)) map.set(fileId, entry);
  }
  return map;
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
    case '.txt':
      return 'text/plain';
    case '.md':
      return 'text/markdown';
    default:
      return 'application/octet-stream';
  }
}

function renderConversation(
  conv: ChatGPTConversation,
  ctx: ParseContext,
  attachments: ParsedAttachment[],
  refs: AssetReference[],
  inlineMarkers = new Map<string, string>(),
): ParsedDocument {
  const sourceId = conv.id ?? conv.conversation_id ?? '';
  const lines: string[] = [];
  const ordered = orderMessages(conv.mapping);
  for (const node of ordered) {
    const m = node.message;
    if (!m) continue;
    const role = m.author?.role ?? 'unknown';
    if (role === 'system' || role === 'tool') continue;
    const { text, imageMarkers } = extractContent(m.content, inlineMarkers);
    if (!text && imageMarkers.length === 0) continue;
    const ts =
      typeof m.create_time === 'number' ? new Date(m.create_time * 1000).toISOString() : '';
    lines.push(`## ${role}${ts ? ` · ${ts}` : ''}`);
    lines.push('');
    if (text) lines.push(text);
    for (const marker of imageMarkers) {
      lines.push(`[image: ${marker}]`);
    }
    lines.push('');
  }
  const title = conv.title?.trim() || `chatgpt-${sourceId.slice(0, 8) || 'untitled'}`;

  // Project linkage — pick the first non-empty hint. The worker's
  // emitGraphEventsForDocument keys off `projectName`; `projectUuid` is a
  // stable id that lets multiple imports converge on the same Entity.
  const projectUuid = conv.conversation_template_id ?? conv.gizmo_id;
  const projectName = projectUuid
    ? conv.conversation_template_id
      ? `ChatGPT Project ${projectUuid.slice(0, 8)}`
      : `Custom GPT ${projectUuid.slice(0, 8)}`
    : undefined;

  return {
    source: 'chatgpt_export',
    sourceId,
    title,
    rawText: lines.join('\n').trim(),
    type: 'chat',
    metadata: {
      originalFilename: ctx.filename,
      conversationId: sourceId,
      createTime: conv.create_time,
      updateTime: conv.update_time,
      messageCount: ordered.filter((n) => n.message).length,
      attachmentCount: attachments.length,
      assetRefCount: refs.length,
      ...(projectUuid ? { projectUuid, projectName } : {}),
      ...(conv.gizmo_id ? { gizmoId: conv.gizmo_id } : {}),
      ...(conv.default_model_slug ? { modelSlug: conv.default_model_slug } : {}),
    },
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

function orderMessages(mapping: Record<string, ChatGPTNode>): ChatGPTNode[] {
  if (!mapping) return [];
  const root = Object.values(mapping).find((n) => !n.parent || mapping[n.parent] === undefined);
  if (!root) return Object.values(mapping);
  const out: ChatGPTNode[] = [];
  const walk = (id: string): void => {
    const node = mapping[id];
    if (!node) return;
    out.push(node);
    for (const childId of node.children ?? []) walk(childId);
  };
  walk(root.id);
  return out;
}

function extractContent(
  content: ChatGPTContent | undefined,
  inlineMarkers: Map<string, string>,
): { text: string; imageMarkers: string[] } {
  if (!content) return { text: '', imageMarkers: [] };

  const textParts: string[] = [];
  const imageMarkers: string[] = [];

  if (Array.isArray(content.parts)) {
    for (const p of content.parts) {
      if (typeof p === 'string') {
        if (p.trim()) textParts.push(p);
        continue;
      }
      if (typeof p === 'object' && p !== null) {
        const obj = p as ImageAssetPointer;
        if (typeof obj.asset_pointer === 'string') {
          const id = extractAssetId(obj.asset_pointer);
          if (id) {
            imageMarkers.push(inlineMarkers.get(id) ?? id);
          }
          continue;
        }
        // Other structured content (multimodal_text, code-interp results, ...)
        // is ignored — preserving the text-first contract of the parser.
      }
    }
  } else if (typeof content.text === 'string') {
    textParts.push(content.text);
  }

  return { text: textParts.join('\n').trim(), imageMarkers };
}
