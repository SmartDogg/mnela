import Papa from 'papaparse';

import { type ParseContext, type ParsedDocument, type Parser } from '../parser.js';

const CSV_MIMES = new Set(['text/csv', 'application/csv']);

export const csvParser: Parser = {
  name: 'csv',
  canParse(ctx: ParseContext): boolean {
    if (CSV_MIMES.has(ctx.mimeType)) return true;
    return ctx.extension === '.csv';
  },
  async parse(buf: Buffer, ctx: ParseContext): Promise<ParsedDocument[]> {
    const raw = buf.toString('utf-8');
    const result = Papa.parse<string[]>(raw, { skipEmptyLines: true });
    const rows = result.data;
    const columnCount = rows[0]?.length ?? 0;
    return [
      {
        source: ctx.origin,
        title: stripExt(ctx.filename),
        rawText: raw,
        type: 'data',
        metadata: {
          originalFilename: ctx.filename,
          originalMime: ctx.mimeType,
          rowCount: rows.length,
          columnCount,
          // First row preserved as headers hint, even if it's data — caller decides.
          headerRow: rows[0],
        },
      },
    ];
  },
};

function stripExt(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}
