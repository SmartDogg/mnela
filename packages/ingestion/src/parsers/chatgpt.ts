import { type ParseContext, type ParsedDocument, type Parser } from '../parser.js';
import { readZipEntries } from '../zip.js';

interface ChatGPTConversation {
  id?: string;
  conversation_id?: string;
  title?: string;
  create_time?: number;
  update_time?: number;
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
    content?: { content_type?: string; parts?: unknown[]; text?: string };
    metadata?: Record<string, unknown>;
  } | null;
}

/**
 * ChatGPT data export ZIP — top-level `conversations.json` is an array of
 * conversations, each with a `mapping` of message nodes linked by parent.
 * One ParsedDocument per conversation, transcript rendered chronologically.
 */
export const chatgptParser: Parser = {
  name: 'chatgpt',
  canParse(): boolean {
    // Selected by registry after peek-detection of conversations.json
    // (canParse signature can't access bytes); registry calls this directly.
    return false;
  },
  async parse(buf: Buffer, ctx: ParseContext): Promise<ParsedDocument[]> {
    const conversations = await loadConversations(buf, ctx);
    return conversations.map((conv) => renderConversation(conv, ctx));
  },
};

async function loadConversations(buf: Buffer, ctx: ParseContext): Promise<ChatGPTConversation[]> {
  if (ctx.extension === '.json' || ctx.mimeType === 'application/json') {
    const parsed: unknown = JSON.parse(buf.toString('utf-8'));
    if (Array.isArray(parsed)) return parsed as ChatGPTConversation[];
    return [];
  }
  // Otherwise it's the ZIP — find conversations.json inside.
  const entries = await readZipEntries(buf);
  const target = entries.find((e) => e.fileName.toLowerCase().endsWith('conversations.json'));
  if (!target) return [];
  const data = await target.read();
  const parsed: unknown = JSON.parse(data.toString('utf-8'));
  return Array.isArray(parsed) ? (parsed as ChatGPTConversation[]) : [];
}

function renderConversation(conv: ChatGPTConversation, ctx: ParseContext): ParsedDocument {
  const sourceId = conv.id ?? conv.conversation_id ?? '';
  const lines: string[] = [];
  const ordered = orderMessages(conv.mapping);
  for (const node of ordered) {
    const m = node.message;
    if (!m) continue;
    const role = m.author?.role ?? 'unknown';
    if (role === 'system' || role === 'tool') continue;
    const text = m.content ? extractText(m.content) : '';
    if (!text) continue;
    const ts =
      typeof m.create_time === 'number' ? new Date(m.create_time * 1000).toISOString() : '';
    lines.push(`## ${role}${ts ? ` · ${ts}` : ''}`);
    lines.push('');
    lines.push(text);
    lines.push('');
  }
  const title = conv.title?.trim() || `chatgpt-${sourceId.slice(0, 8) || 'untitled'}`;
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
    },
  };
}

function orderMessages(mapping: Record<string, ChatGPTNode>): ChatGPTNode[] {
  // Find the root (no parent or parent missing in the map).
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

function extractText(content: { parts?: unknown[]; text?: unknown }): string {
  if (Array.isArray(content.parts)) {
    return content.parts
      .filter((p): p is string => typeof p === 'string')
      .join('\n')
      .trim();
  }
  if (typeof content.text === 'string') return content.text.trim();
  return '';
}
