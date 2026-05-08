import matter from 'gray-matter';

import { type ParseContext, type ParsedDocument, type Parser } from '../parser.js';

const MD_MIMES = new Set(['text/markdown', 'text/x-markdown']);

export const mdParser: Parser = {
  name: 'md',
  canParse(ctx: ParseContext): boolean {
    if (MD_MIMES.has(ctx.mimeType)) return true;
    return ctx.extension === '.md' || ctx.extension === '.markdown';
  },
  async parse(buf: Buffer, ctx: ParseContext): Promise<ParsedDocument[]> {
    const raw = buf.toString('utf-8');
    const { data, content } = matter(raw);
    const fmTitle = pickTitle(data);
    return [
      {
        source: ctx.origin,
        title: fmTitle ?? stripExt(ctx.filename),
        // Preserve [[wikilinks]] verbatim — the rawText is the literal markdown body.
        rawText: content,
        type: 'note',
        metadata: {
          originalFilename: ctx.filename,
          originalMime: ctx.mimeType,
          frontmatter: Object.keys(data).length > 0 ? data : undefined,
        },
      },
    ];
  },
};

function pickTitle(data: Record<string, unknown>): string | undefined {
  for (const k of ['title', 'name', 'heading']) {
    const v = data[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

function stripExt(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}
