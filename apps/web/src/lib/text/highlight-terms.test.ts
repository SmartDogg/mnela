import { describe, expect, it } from 'vitest';

import { collectMatchSnippets, splitOnMatches, tokenizeQuery } from './highlight-terms';

describe('tokenizeQuery', () => {
  it('lowercases, dedupes, splits on whitespace', () => {
    expect(tokenizeQuery('React react Hooks')).toEqual(['react', 'hooks']);
  });

  it('drops tokens shorter than 2 chars', () => {
    expect(tokenizeQuery('a в long')).toEqual(['long']);
  });

  it('strips surrounding quotes', () => {
    expect(tokenizeQuery('"quoted" \'term\'')).toEqual(['quoted', 'term']);
  });

  it('returns empty for empty input', () => {
    expect(tokenizeQuery('')).toEqual([]);
  });
});

describe('splitOnMatches', () => {
  it('wraps token matches case-insensitively', () => {
    const parts = splitOnMatches('React and react are the same', ['react']);
    expect(parts).toEqual([
      { text: 'React', marked: true },
      { text: ' and ', marked: false },
      { text: 'react', marked: true },
      { text: ' are the same', marked: false },
    ]);
  });

  it('returns single fragment when no tokens', () => {
    expect(splitOnMatches('untouched text', [])).toEqual([
      { text: 'untouched text', marked: false },
    ]);
  });

  it('escapes regex metacharacters in tokens', () => {
    const parts = splitOnMatches('foo.bar baz', ['foo.bar']);
    expect(parts).toEqual([
      { text: 'foo.bar', marked: true },
      { text: ' baz', marked: false },
    ]);
  });
});

describe('collectMatchSnippets', () => {
  it('returns up to maxSnippets non-overlapping windows', () => {
    const body =
      'A '.repeat(50) + 'token here ' + 'B '.repeat(50) + 'token again ' + 'C '.repeat(50);
    const snippets = collectMatchSnippets(body, ['token'], { maxSnippets: 4, radius: 20 });
    expect(snippets.length).toBeGreaterThan(0);
    expect(snippets.length).toBeLessThanOrEqual(4);
    const first = snippets[0];
    if (!first) throw new Error('expected at least one snippet');
    expect(first.text).toContain('token');
  });

  it('returns empty array for no tokens', () => {
    expect(collectMatchSnippets('any body', [], {})).toEqual([]);
  });

  it('returns empty array when no match', () => {
    expect(collectMatchSnippets('no match here', ['absent'])).toEqual([]);
  });
});
