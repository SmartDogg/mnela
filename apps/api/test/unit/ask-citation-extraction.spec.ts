import { describe, expect, it } from 'vitest';

import { extractCitationsFromTool } from '../../src/modules/search/ask.service.js';

const DOC_A = 'c' + 'a'.repeat(24);
const DOC_B = 'c' + 'b'.repeat(24);

describe('extractCitationsFromTool', () => {
  it('pulls every hit from mnela_find_similar.documents', () => {
    const cites = extractCitationsFromTool(
      'mnela_find_similar',
      { text: 'postgres fts' },
      {
        documents: [
          { id: DOC_A, title: 'Postgres FTS', snippet: 'tsvector beats vector for v1', score: 0.9 },
          { id: DOC_B, title: 'Migration plan', score: 0.5 },
        ],
      },
    );
    expect(cites).toEqual([
      { docId: DOC_A, title: 'Postgres FTS', snippet: 'tsvector beats vector for v1' },
      { docId: DOC_B, title: 'Migration plan', snippet: 'Migration plan' },
    ]);
  });

  it('accepts mnela_search.documents and trims long snippets to 200 chars', () => {
    const long = 'a'.repeat(500);
    const cites = extractCitationsFromTool(
      'mnela_search',
      { query: 'x' },
      { documents: [{ id: DOC_A, title: 'X', snippet: long, score: 0.7 }] },
    );
    expect(cites).toHaveLength(1);
    expect(cites[0]!.snippet).toHaveLength(200);
  });

  it('turns mnela_get_document into a single citation using cleanText when available', () => {
    const cites = extractCitationsFromTool(
      'mnela_get_document',
      { id: DOC_A },
      {
        id: DOC_A,
        title: 'Decision log',
        cleanText: 'we decided FTS first',
        rawText: 'we decided FTS first (raw)',
      },
    );
    expect(cites).toEqual([
      { docId: DOC_A, title: 'Decision log', snippet: 'we decided FTS first' },
    ]);
  });

  it('falls back to rawText for mnela_get_document if cleanText is absent', () => {
    const cites = extractCitationsFromTool(
      'mnela_get_document',
      { id: DOC_A },
      { id: DOC_A, title: 'Raw only', rawText: 'raw body here' },
    );
    expect(cites[0]!.snippet).toBe('raw body here');
  });

  it('uses tool input.documentId when mnela_get_chunks output omits it', () => {
    const cites = extractCitationsFromTool(
      'mnela_get_chunks',
      { documentId: DOC_A },
      { chunks: [{ id: 'c1', chunkIndex: 0, text: 'chunk one body', tokenCount: 3 }] },
    );
    expect(cites).toEqual([{ docId: DOC_A, title: null, snippet: 'chunk one body' }]);
  });

  it('returns no citations for unknown tools', () => {
    expect(extractCitationsFromTool('mnela_add_entities', {}, { added: [] })).toEqual([]);
  });

  it('handles missing or malformed output safely', () => {
    expect(extractCitationsFromTool('mnela_find_similar', {}, null)).toEqual([]);
    expect(extractCitationsFromTool('mnela_find_similar', {}, { documents: 'oops' })).toEqual([]);
    expect(
      extractCitationsFromTool('mnela_find_similar', {}, { documents: [{ score: 1 }] }),
    ).toEqual([]);
  });
});
