import { describe, expect, it } from 'vitest';

import { type ParseContext } from '../parser.js';
import { csvParser } from '../parsers/csv.js';
import { htmlParser } from '../parsers/html.js';
import { jsonParser } from '../parsers/json.js';
import { mdParser } from '../parsers/md.js';
import { txtParser } from '../parsers/txt.js';

const ctx = (overrides: Partial<ParseContext>): ParseContext => ({
  mimeType: 'text/plain',
  extension: '.txt',
  filename: 'sample.txt',
  origin: 'manual_upload',
  workdir: '/tmp',
  ...overrides,
});

describe('text-family parsers', () => {
  describe('txt', () => {
    it('matches text/plain and .txt', () => {
      expect(txtParser.canParse(ctx({}))).toBe(true);
      expect(txtParser.canParse(ctx({ mimeType: 'application/pdf', extension: '.pdf' }))).toBe(
        false,
      );
    });
    it('reads buffer as utf8 and uses filename as title', async () => {
      const docs = await txtParser.parse(Buffer.from('hello мир'), ctx({ filename: 'note.txt' }));
      expect(docs).toHaveLength(1);
      expect(docs[0]?.title).toBe('note');
      expect(docs[0]?.rawText).toBe('hello мир');
    });
  });

  describe('md', () => {
    it('matches markdown mimes and .md/.markdown', () => {
      expect(mdParser.canParse(ctx({ mimeType: 'text/markdown', extension: '.md' }))).toBe(true);
      expect(mdParser.canParse(ctx({ mimeType: 'text/x-markdown', extension: '.markdown' }))).toBe(
        true,
      );
      expect(mdParser.canParse(ctx({ mimeType: 'text/plain', extension: '.txt' }))).toBe(false);
    });
    it('extracts frontmatter title and preserves [[wikilinks]]', async () => {
      const buf = Buffer.from('---\ntitle: My Note\n---\nLink to [[Other]]\n');
      const docs = await mdParser.parse(buf, ctx({ filename: 'note.md', extension: '.md' }));
      expect(docs[0]?.title).toBe('My Note');
      expect(docs[0]?.rawText).toContain('[[Other]]');
      const fm = docs[0]?.metadata?.['frontmatter'] as Record<string, unknown>;
      expect(fm?.['title']).toBe('My Note');
    });
    it('falls back to filename when no frontmatter title', async () => {
      const docs = await mdParser.parse(
        Buffer.from('# Hi'),
        ctx({ filename: 'plain.md', extension: '.md' }),
      );
      expect(docs[0]?.title).toBe('plain');
    });
  });

  describe('html', () => {
    it('matches html mimes and .html/.htm', () => {
      expect(htmlParser.canParse(ctx({ mimeType: 'text/html', extension: '.html' }))).toBe(true);
      expect(
        htmlParser.canParse(ctx({ mimeType: 'application/xhtml+xml', extension: '.htm' })),
      ).toBe(true);
    });
    it('converts to markdown and extracts <title>', async () => {
      const html =
        '<html><head><title>Hello</title></head><body><h1>Hi</h1><p>World</p></body></html>';
      const docs = await htmlParser.parse(
        Buffer.from(html),
        ctx({ filename: 'page.html', extension: '.html' }),
      );
      expect(docs[0]?.title).toBe('Hello');
      expect(docs[0]?.rawText).toContain('# Hi');
      expect(docs[0]?.rawText).toContain('World');
    });
  });

  describe('json', () => {
    it('attaches array length when JSON is an array', async () => {
      const buf = Buffer.from('[1,2,3]');
      const docs = await jsonParser.parse(
        buf,
        ctx({ mimeType: 'application/json', extension: '.json', filename: 'arr.json' }),
      );
      expect(docs[0]?.metadata?.['isArray']).toBe(true);
      expect(docs[0]?.metadata?.['arrayLength']).toBe(3);
    });
    it('attaches top-level keys for object JSON', async () => {
      const buf = Buffer.from('{"a":1,"b":2}');
      const docs = await jsonParser.parse(
        buf,
        ctx({ mimeType: 'application/json', extension: '.json', filename: 'obj.json' }),
      );
      expect(docs[0]?.metadata?.['topLevelKeys']).toEqual(['a', 'b']);
    });
    it('keeps raw on malformed JSON', async () => {
      const buf = Buffer.from('not json');
      const docs = await jsonParser.parse(
        buf,
        ctx({ mimeType: 'application/json', extension: '.json', filename: 'bad.json' }),
      );
      expect(docs[0]?.rawText).toBe('not json');
    });
  });

  describe('csv', () => {
    it('counts rows and columns', async () => {
      const buf = Buffer.from('a,b,c\n1,2,3\n4,5,6\n');
      const docs = await csvParser.parse(
        buf,
        ctx({ mimeType: 'text/csv', extension: '.csv', filename: 'data.csv' }),
      );
      expect(docs[0]?.metadata?.['rowCount']).toBe(3);
      expect(docs[0]?.metadata?.['columnCount']).toBe(3);
      expect(docs[0]?.metadata?.['headerRow']).toEqual(['a', 'b', 'c']);
    });
  });
});
