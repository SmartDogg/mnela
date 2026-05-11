/**
 * Splits a query string into highlight tokens.
 * - Lowercased, deduped, whitespace-split, single-quote/double-quote stripped.
 * - Tokens shorter than 2 chars are dropped to avoid `a`/`в` matching every word.
 */
export function tokenizeQuery(query: string): string[] {
  const tokens = new Set<string>();
  for (const raw of query.split(/\s+/)) {
    const clean = raw.replace(/^["']+|["']+$/g, '').toLowerCase();
    if (clean.length >= 2) tokens.add(clean);
  }
  return Array.from(tokens);
}

/**
 * Wraps every case-insensitive token match in `text` with `<mark>` and returns
 * the result as a list of React-friendly fragments. Returned as an array of
 * { text, marked } so the caller can render fragments without
 * `dangerouslySetInnerHTML` (preferred — no sanitize needed). Token boundaries
 * are not stemming-aware; per QUESTIONS #24 this is intentional.
 */
export function splitOnMatches(
  text: string,
  tokens: string[],
): { text: string; marked: boolean }[] {
  if (tokens.length === 0 || !text) return [{ text, marked: false }];
  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'gi');
  const parts: { text: string; marked: boolean }[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const i = match.index ?? 0;
    if (i > lastIndex) parts.push({ text: text.slice(lastIndex, i), marked: false });
    parts.push({ text: match[0], marked: true });
    lastIndex = i + match[0].length;
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex), marked: false });
  return parts;
}

/**
 * Returns up to `maxSnippets` context windows where any token appears, with
 * `radius` characters on each side. Useful for a "matches in this document"
 * pane on /documents/:id.
 */
export function collectMatchSnippets(
  text: string,
  tokens: string[],
  options: { maxSnippets?: number; radius?: number } = {},
): { start: number; end: number; text: string }[] {
  if (tokens.length === 0 || !text) return [];
  const maxSnippets = options.maxSnippets ?? 4;
  const radius = options.radius ?? 80;
  const pattern = new RegExp(tokens.map(escapeRegExp).join('|'), 'gi');
  const snippets: { start: number; end: number; text: string }[] = [];
  let lastEnd = -1;
  for (const match of text.matchAll(pattern)) {
    if (snippets.length >= maxSnippets) break;
    const i = match.index ?? 0;
    const start = Math.max(0, i - radius);
    const end = Math.min(text.length, i + match[0].length + radius);
    if (start < lastEnd) continue; // overlap with previous snippet
    snippets.push({ start, end, text: text.slice(start, end) });
    lastEnd = end;
  }
  return snippets;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
