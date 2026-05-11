import { describe, expect, it } from 'vitest';

import { CitationParser, type CitationOut } from '../../src/modules/search/citation-parser.js';

const VALID_DOC = 'c' + 'a'.repeat(24);

function feedChunks(chunks: string[]): { text: string; cites: CitationOut[] } {
  let text = '';
  const cites: CitationOut[] = [];
  const parser = new CitationParser({
    onText: (d) => {
      text += d;
    },
    onCitation: (c) => {
      cites.push(c);
    },
  });
  for (const chunk of chunks) parser.feed(chunk);
  parser.end();
  return { text, cites };
}

describe('CitationParser', () => {
  it('tag fully inside one chunk', () => {
    const out = feedChunks([
      `the user prefers <cite doc-id="${VALID_DOC}">strict typing</cite> over loose`,
    ]);
    expect(out.text).toBe('the user prefers [1] over loose');
    expect(out.cites).toEqual([{ ord: 1, docId: VALID_DOC, snippet: 'strict typing' }]);
  });

  it('opening tag split across two chunks', () => {
    const out = feedChunks([`before <cit`, `e doc-id="${VALID_DOC}">snippet</cite> after`]);
    expect(out.text).toBe('before [1] after');
    expect(out.cites).toHaveLength(1);
    expect(out.cites[0]?.docId).toBe(VALID_DOC);
  });

  it('doc-id attribute split across chunks', () => {
    const out = feedChunks([
      `<cite doc-id="${VALID_DOC.slice(0, 10)}`,
      `${VALID_DOC.slice(10)}">snippet</cite>`,
    ]);
    expect(out.cites).toHaveLength(1);
    expect(out.cites[0]?.docId).toBe(VALID_DOC);
  });

  it('closing tag split across chunks', () => {
    const out = feedChunks([`<cite doc-id="${VALID_DOC}">hello</ci`, `te> done`]);
    expect(out.text).toBe('[1] done');
    expect(out.cites).toHaveLength(1);
  });

  it('multiple cites assigned sequential ords', () => {
    const out = feedChunks([
      `<cite doc-id="${VALID_DOC}">a</cite> and <cite doc-id="${VALID_DOC}">b</cite>`,
    ]);
    expect(out.text).toBe('[1] and [2]');
    expect(out.cites.map((c) => c.ord)).toEqual([1, 2]);
  });

  it('invalid doc-id is dropped', () => {
    const out = feedChunks(['before <cite doc-id="not-a-cuid">snippet</cite> after']);
    expect(out.text).toBe('before  after');
    expect(out.cites).toHaveLength(0);
  });

  it('empty snippet is dropped', () => {
    const out = feedChunks([`<cite doc-id="${VALID_DOC}"></cite>`]);
    expect(out.text).toBe('');
    expect(out.cites).toHaveLength(0);
  });

  it('unclosed tag at end-of-stream is dropped without throwing', () => {
    const out = feedChunks([`<cite doc-id="${VALID_DOC}">never closes`]);
    expect(out.cites).toHaveLength(0);
  });

  it('snippet longer than 200 chars is truncated with ellipsis', () => {
    const longSnippet = 'x'.repeat(300);
    const out = feedChunks([`<cite doc-id="${VALID_DOC}">${longSnippet}</cite>`]);
    expect(out.cites[0]?.snippet.length).toBe(200);
    expect(out.cites[0]?.snippet.endsWith('…')).toBe(true);
  });

  it('non-cite tag rolls back to literal text', () => {
    const out = feedChunks(['visit <a href="http://example.com">link</a>']);
    expect(out.text).toBe('visit <a href="http://example.com">link</a>');
    expect(out.cites).toHaveLength(0);
  });

  it('character-by-character feed produces same output as bulk feed', () => {
    const text = `prelude <cite doc-id="${VALID_DOC}">quote</cite> coda`;
    const bulk = feedChunks([text]);
    const drip = feedChunks(text.split(''));
    expect(drip.text).toBe(bulk.text);
    expect(drip.cites).toEqual(bulk.cites);
  });
});
