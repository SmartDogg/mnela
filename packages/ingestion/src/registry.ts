import { type ParseContext, type Parser } from './parser.js';
import { audioParser } from './parsers/audio.js';
import { chatgptParser } from './parsers/chatgpt.js';
import { claudeParser } from './parsers/claude.js';
import { claudeCodeSessionParser } from './parsers/claude-code-session.js';
import { csvParser } from './parsers/csv.js';
import { docxParser } from './parsers/docx.js';
import { htmlParser } from './parsers/html.js';
import { imageParser } from './parsers/image.js';
import { jsonParser } from './parsers/json.js';
import { mdParser } from './parsers/md.js';
import { pdfParser } from './parsers/pdf.js';
import { txtParser } from './parsers/txt.js';
import { readZipEntries } from './zip.js';

const STANDARD_PARSERS: Parser[] = [
  mdParser,
  txtParser,
  htmlParser,
  jsonParser,
  csvParser,
  docxParser,
  pdfParser,
  imageParser,
  audioParser,
];

export interface ResolvedParser {
  parser: Parser;
  matchedBy: 'mime' | 'extension' | 'archive-peek' | 'jsonl-peek' | 'fallback';
}

/**
 * Resolves the parser for an incoming file.
 *
 * Order:
 *   1. Standard parsers (md/txt/html/json/csv/docx/pdf/image/audio) by canParse.
 *   2. ZIP archives — peek entries to disambiguate ChatGPT vs Claude.ai exports.
 *   3. JSONL — peek first line to detect Claude Code session vs generic JSON.
 *   4. Bare `conversations.json` — assume ChatGPT export.
 *   5. Fallback: txtParser (best-effort raw read).
 */
export async function resolveParser(buf: Buffer, ctx: ParseContext): Promise<ResolvedParser> {
  // ZIP archives are checked first — uploads come in as .zip, not as the inner json.
  if (isZip(ctx, buf)) {
    const flavor = await detectZipFlavor(buf);
    if (flavor === 'chatgpt') return { parser: chatgptParser, matchedBy: 'archive-peek' };
    if (flavor === 'claude') return { parser: claudeParser, matchedBy: 'archive-peek' };
  }

  // JSONL goes to the Claude Code session parser before generic JSON wins.
  if (isJsonl(ctx, buf)) {
    return { parser: claudeCodeSessionParser, matchedBy: 'jsonl-peek' };
  }

  // Bare `conversations.json` (extracted from a ChatGPT export) before generic JSON.
  if (looksLikeChatgptConversations(ctx, buf)) {
    return { parser: chatgptParser, matchedBy: 'archive-peek' };
  }

  for (const parser of STANDARD_PARSERS) {
    if (parser.canParse(ctx)) {
      return { parser, matchedBy: 'mime' };
    }
  }

  return { parser: txtParser, matchedBy: 'fallback' };
}

function isZip(ctx: ParseContext, buf: Buffer): boolean {
  if (
    ctx.mimeType === 'application/zip' ||
    ctx.mimeType === 'application/x-zip-compressed' ||
    ctx.extension === '.zip'
  ) {
    return true;
  }
  // Magic bytes "PK\x03\x04"
  return (
    buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
  );
}

async function detectZipFlavor(buf: Buffer): Promise<'chatgpt' | 'claude' | 'unknown'> {
  try {
    const entries = await readZipEntries(buf);
    const names = entries.map((e) => e.fileName);
    const hasChatgpt = names.some((n) => /(^|\/)conversations\.json$/.test(n));
    const hasUserJson = names.some((n) => n === 'user.json' || n === 'chat.html');
    const hasClaudeUsers = names.some((n) => n === 'users.json');
    const hasClaudeChats = names.some(
      (n) => n.startsWith('design_chats/') || n === 'memories.json',
    );

    if (hasClaudeUsers && (hasClaudeChats || hasChatgpt)) return 'claude';
    if (hasChatgpt && hasUserJson) return 'chatgpt';
    // Bare ChatGPT export sometimes ships only conversations.json + chat.html
    if (hasChatgpt && !hasClaudeUsers) return 'chatgpt';
    if (hasClaudeUsers) return 'claude';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function isJsonl(ctx: ParseContext, buf: Buffer): boolean {
  if (ctx.extension === '.jsonl' || ctx.mimeType === 'application/x-ndjson') {
    return true;
  }
  // Heuristic: file looks like one-JSON-per-line and the first line has a sessionId.
  const head = buf.slice(0, 4096).toString('utf-8');
  const firstLine = head.split('\n', 1)[0]?.trim() ?? '';
  if (!firstLine.startsWith('{')) return false;
  try {
    const obj = JSON.parse(firstLine) as Record<string, unknown>;
    return typeof obj['sessionId'] === 'string';
  } catch {
    return false;
  }
}

function looksLikeChatgptConversations(ctx: ParseContext, buf: Buffer): boolean {
  if (ctx.filename.toLowerCase() !== 'conversations.json') return false;
  const head = buf.slice(0, 1024).toString('utf-8').trim();
  return head.startsWith('[');
}
