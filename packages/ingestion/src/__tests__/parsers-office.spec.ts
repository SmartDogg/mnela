import { describe, expect, it } from 'vitest';

import { type ParseContext } from '../parser.js';
import { docxParser } from '../parsers/docx.js';
import { pdfParser } from '../parsers/pdf.js';

const ctx = (overrides: Partial<ParseContext>): ParseContext => ({
  mimeType: 'application/octet-stream',
  extension: '',
  filename: 'doc',
  origin: 'manual_upload',
  workdir: '/tmp',
  ...overrides,
});

describe('office parsers', () => {
  describe('docx canParse', () => {
    it('matches docx mime', () => {
      expect(
        docxParser.canParse(
          ctx({
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            extension: '.docx',
          }),
        ),
      ).toBe(true);
    });
    it('matches by extension when mime is wrong', () => {
      expect(docxParser.canParse(ctx({ extension: '.docx' }))).toBe(true);
    });
    it('rejects unrelated', () => {
      expect(docxParser.canParse(ctx({ extension: '.txt' }))).toBe(false);
    });
  });

  describe('pdf canParse', () => {
    it('matches application/pdf', () => {
      expect(pdfParser.canParse(ctx({ mimeType: 'application/pdf', extension: '.pdf' }))).toBe(
        true,
      );
    });
    it('matches by extension when mime is generic', () => {
      expect(
        pdfParser.canParse(ctx({ mimeType: 'application/octet-stream', extension: '.pdf' })),
      ).toBe(true);
    });
    it('rejects unrelated', () => {
      expect(pdfParser.canParse(ctx({ extension: '.docx' }))).toBe(false);
    });
  });

  // Real binary PDF parsing is exercised in the API integration suite (Phase F)
  // against actual files; pdf-parse is mature upstream and unit-testing canParse
  // selectivity is sufficient at this layer.
});
