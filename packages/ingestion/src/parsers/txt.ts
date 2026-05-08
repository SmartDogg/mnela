import { type ParseContext, type ParsedDocument, type Parser } from '../parser.js';

export const txtParser: Parser = {
  name: 'txt',
  canParse(ctx: ParseContext): boolean {
    if (ctx.mimeType === 'text/plain') return true;
    return ctx.extension === '.txt';
  },
  async parse(buf: Buffer, ctx: ParseContext): Promise<ParsedDocument[]> {
    const rawText = buf.toString('utf-8');
    return [
      {
        source: ctx.origin,
        title: stripExt(ctx.filename),
        rawText,
        type: 'note',
        metadata: { originalFilename: ctx.filename, originalMime: ctx.mimeType },
      },
    ];
  },
};

function stripExt(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}
