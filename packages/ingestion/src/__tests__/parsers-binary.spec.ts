import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type ParseContext } from '../parser.js';
import { audioParser } from '../parsers/audio.js';
import { imageParser } from '../parsers/image.js';

let workdir: string;

beforeEach(async () => {
  workdir = await fs.mkdtemp(path.join(tmpdir(), 'mnela-test-'));
});

afterEach(async () => {
  await fs.rm(workdir, { recursive: true, force: true });
});

const ctx = (overrides: Partial<ParseContext>): ParseContext => ({
  mimeType: 'application/octet-stream',
  extension: '',
  filename: 'file',
  origin: 'manual_upload',
  workdir,
  ...overrides,
});

describe('binary attachment parsers', () => {
  describe('image', () => {
    it('matches by mime and ext', () => {
      expect(imageParser.canParse(ctx({ mimeType: 'image/png', extension: '.png' }))).toBe(true);
      expect(imageParser.canParse(ctx({ extension: '.heic' }))).toBe(true);
      expect(imageParser.canParse(ctx({ extension: '.txt' }))).toBe(false);
    });

    it('writes the file out and produces a stub Document with sharp metadata', async () => {
      const png = await sharp({
        create: { width: 8, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .png()
        .toBuffer();

      const docs = await imageParser.parse(
        png,
        ctx({ mimeType: 'image/png', extension: '.png', filename: 'tiny.png' }),
      );
      expect(docs).toHaveLength(1);
      expect(docs[0]?.title).toBe('tiny');
      expect(docs[0]?.rawText).toBe('');
      expect(docs[0]?.type).toBe('image');
      expect(docs[0]?.metadata?.['width']).toBe(8);
      expect(docs[0]?.metadata?.['height']).toBe(4);
      expect(docs[0]?.attachments).toHaveLength(1);
      const att = docs[0]?.attachments?.[0];
      expect(att?.filename).toBe('tiny.png');
      const stat = await fs.stat(att?.tempPath ?? '');
      expect(stat.size).toBe(png.length);
    });
  });

  describe('audio', () => {
    it('matches by mime and ext', () => {
      expect(audioParser.canParse(ctx({ mimeType: 'audio/mpeg', extension: '.mp3' }))).toBe(true);
      expect(audioParser.canParse(ctx({ extension: '.wav' }))).toBe(true);
      expect(audioParser.canParse(ctx({ extension: '.png' }))).toBe(false);
    });

    it('persists raw bytes and returns Document+Attachment', async () => {
      const buf = Buffer.from('FAKEAUDIO');
      const docs = await audioParser.parse(
        buf,
        ctx({ mimeType: 'audio/mpeg', extension: '.mp3', filename: 'voice.mp3' }),
      );
      expect(docs[0]?.title).toBe('voice');
      expect(docs[0]?.rawText).toBe('');
      expect(docs[0]?.type).toBe('audio');
      const att = docs[0]?.attachments?.[0];
      expect(att?.size).toBe(buf.length);
      const written = await fs.readFile(att?.tempPath ?? '');
      expect(written.equals(buf)).toBe(true);
    });
  });
});
