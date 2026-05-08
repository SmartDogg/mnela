import { type ParseContext, type ParsedDocument, type Parser } from '../parser.js';

const JSON_MIMES = new Set(['application/json', 'application/x-ndjson', 'text/json']);

export const jsonParser: Parser = {
  name: 'json',
  canParse(ctx: ParseContext): boolean {
    if (JSON_MIMES.has(ctx.mimeType)) return true;
    return ctx.extension === '.json';
  },
  async parse(buf: Buffer, ctx: ParseContext): Promise<ParsedDocument[]> {
    const raw = buf.toString('utf-8');
    let topLevelKeys: string[] | undefined;
    let isArray = false;
    let arrayLength: number | undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        isArray = true;
        arrayLength = parsed.length;
      } else if (parsed && typeof parsed === 'object') {
        topLevelKeys = Object.keys(parsed);
      }
    } catch {
      // not strict JSON — keep raw, no metadata enrichment
    }
    return [
      {
        source: ctx.origin,
        title: stripExt(ctx.filename),
        rawText: raw,
        type: 'data',
        metadata: {
          originalFilename: ctx.filename,
          originalMime: ctx.mimeType,
          isArray,
          arrayLength,
          topLevelKeys,
        },
      },
    ];
  },
};

function stripExt(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}
