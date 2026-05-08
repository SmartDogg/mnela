import { promises as fs } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import { type ParseContext, type ParsedDocument, type Parser } from '../parser.js';

const IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
]);

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif']);

/**
 * Phase-2 behaviour (without Claude vision): pass the file through as an
 * Attachment plus a stub Document(status='raw'). The Document has no rawText
 * (so FTS body is empty), but title is searchable. Phase 5 re-enrichment
 * adds description/OCR via Claude vision.
 */
export const imageParser: Parser = {
  name: 'image',
  canParse(ctx: ParseContext): boolean {
    if (IMAGE_MIMES.has(ctx.mimeType)) return true;
    return IMAGE_EXTS.has(ctx.extension);
  },
  async parse(buf: Buffer, ctx: ParseContext): Promise<ParsedDocument[]> {
    let metadata: Record<string, unknown> = {
      originalFilename: ctx.filename,
      originalMime: ctx.mimeType,
    };
    try {
      const meta = await sharp(buf).metadata();
      metadata = {
        ...metadata,
        width: meta.width,
        height: meta.height,
        format: meta.format,
        hasAlpha: meta.hasAlpha,
      };
    } catch {
      // sharp may not understand HEIC without libheif; metadata stays minimal.
    }

    await fs.mkdir(ctx.workdir, { recursive: true });
    const tempPath = path.join(ctx.workdir, ctx.filename);
    await fs.writeFile(tempPath, buf);

    return [
      {
        source: ctx.origin,
        title: stripExt(ctx.filename),
        rawText: '',
        type: 'image',
        metadata,
        attachments: [
          {
            filename: ctx.filename,
            mimeType: ctx.mimeType,
            tempPath,
            size: buf.length,
            metadata,
          },
        ],
      },
    ];
  },
};

function stripExt(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}
