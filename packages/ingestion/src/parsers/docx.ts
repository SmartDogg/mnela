import mammoth from 'mammoth';
import TurndownService from 'turndown';

import { type ParseContext, type ParsedDocument, type Parser } from '../parser.js';

const DOCX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

export const docxParser: Parser = {
  name: 'docx',
  canParse(ctx: ParseContext): boolean {
    if (DOCX_MIMES.has(ctx.mimeType)) return true;
    return ctx.extension === '.docx' || ctx.extension === '.doc';
  },
  async parse(buf: Buffer, ctx: ParseContext): Promise<ParsedDocument[]> {
    const result = await mammoth.convertToHtml({ buffer: buf });
    const markdown = turndown.turndown(result.value);
    return [
      {
        source: ctx.origin,
        title: stripExt(ctx.filename),
        rawText: markdown,
        type: 'doc',
        metadata: {
          originalFilename: ctx.filename,
          originalMime: ctx.mimeType,
          mammothMessages: result.messages.length > 0 ? result.messages : undefined,
        },
      },
    ];
  },
};

function stripExt(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}
