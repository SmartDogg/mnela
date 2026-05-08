import { type ParseContext, type ParsedDocument, type Parser } from '../parser.js';

export const pdfParser: Parser = {
  name: 'pdf',
  canParse(ctx: ParseContext): boolean {
    if (ctx.mimeType === 'application/pdf') return true;
    return ctx.extension === '.pdf';
  },
  async parse(buf: Buffer, ctx: ParseContext): Promise<ParsedDocument[]> {
    // pdf-parse imports its CommonJS test fixture at top-level when accessed via
    // its package main; using the implementation file avoids that side-effect.
    // pdf-parse imports its CommonJS test fixture at top-level when accessed via
    // the package main; using the implementation file directly avoids that.
    const mod = await import('pdf-parse/lib/pdf-parse.js');
    const result = await mod.default(buf);
    const text = result.text.trim();
    return [
      {
        source: ctx.origin,
        title: stripExt(ctx.filename),
        rawText: text,
        type: 'doc',
        metadata: {
          originalFilename: ctx.filename,
          originalMime: ctx.mimeType,
          pageCount: result.numpages,
          pdfInfo: result.info,
          // OCR via Claude vision for scanned PDFs lands in Phase 5.
          textExtraction: text.length > 0 ? 'native' : 'empty',
        },
      },
    ];
  },
};

function stripExt(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}
