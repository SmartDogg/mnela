import TurndownService from 'turndown';

import { type ParseContext, type ParsedDocument, type Parser } from '../parser.js';

const HTML_MIMES = new Set(['text/html', 'application/xhtml+xml']);

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

export const htmlParser: Parser = {
  name: 'html',
  canParse(ctx: ParseContext): boolean {
    if (HTML_MIMES.has(ctx.mimeType)) return true;
    return ctx.extension === '.html' || ctx.extension === '.htm';
  },
  async parse(buf: Buffer, ctx: ParseContext): Promise<ParsedDocument[]> {
    const html = buf.toString('utf-8');
    const title = extractTitle(html) ?? stripExt(ctx.filename);
    const md = turndown.turndown(html);
    return [
      {
        source: ctx.origin,
        title,
        rawText: md,
        type: 'note',
        metadata: { originalFilename: ctx.filename, originalMime: ctx.mimeType },
      },
    ];
  },
};

function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  if (!match) return undefined;
  const t = match[1]?.trim();
  return t && t.length > 0 ? t : undefined;
}

function stripExt(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}
