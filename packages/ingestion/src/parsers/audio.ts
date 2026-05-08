import { promises as fs } from 'node:fs';
import path from 'node:path';

import { type ParseContext, type ParsedDocument, type Parser } from '../parser.js';

const AUDIO_MIMES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/ogg',
  'audio/x-wav',
  'audio/x-m4a',
  'audio/mp4',
]);

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']);

/**
 * Phase-2 behaviour (without whisper): pass the file through as an Attachment
 * plus a stub Document(status='raw'). When whisper is wired up in Phase 9, the
 * worker will recognize this and enqueue a transcription follow-up.
 */
export const audioParser: Parser = {
  name: 'audio',
  canParse(ctx: ParseContext): boolean {
    if (AUDIO_MIMES.has(ctx.mimeType)) return true;
    return AUDIO_EXTS.has(ctx.extension);
  },
  async parse(buf: Buffer, ctx: ParseContext): Promise<ParsedDocument[]> {
    await fs.mkdir(ctx.workdir, { recursive: true });
    const tempPath = path.join(ctx.workdir, ctx.filename);
    await fs.writeFile(tempPath, buf);

    return [
      {
        source: ctx.origin,
        title: stripExt(ctx.filename),
        rawText: '',
        type: 'audio',
        metadata: {
          originalFilename: ctx.filename,
          originalMime: ctx.mimeType,
          size: buf.length,
        },
        attachments: [
          {
            filename: ctx.filename,
            mimeType: ctx.mimeType,
            tempPath,
            size: buf.length,
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
