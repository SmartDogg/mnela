import { describe, expect, it } from 'vitest';

import { chunkText } from '../chunker.js';
import { countTokens } from '../tokenizer.js';

describe('chunker', () => {
  it('returns no chunks for empty input', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('returns a single chunk when text fits in maxTokens', () => {
    const text = 'Hello world. '.repeat(20);
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.index).toBe(0);
    expect(chunks[0]?.text).toBe(text);
  });

  it('splits long text with overlap and produces increasing indices', () => {
    const long = 'lorem ipsum dolor sit amet. '.repeat(800); // ~5k+ tokens
    const chunks = chunkText(long, {
      targetTokens: 600,
      overlapTokens: 100,
      maxTokens: 700,
      minTokens: 500,
    });
    expect(chunks.length).toBeGreaterThan(2);
    chunks.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.tokenCount).toBeLessThanOrEqual(700);
      // The last chunk may be a tail remainder; all others should hit ~target.
      if (i < chunks.length - 1) {
        expect(c.tokenCount).toBeGreaterThanOrEqual(500);
      }
    });
  });

  it('rejects overlap >= target', () => {
    expect(() => chunkText('x', { targetTokens: 100, overlapTokens: 100 })).toThrow();
  });

  it('countTokens scales with text length', () => {
    expect(countTokens('')).toBe(0);
    const oneLine = 'NestJS is a TypeScript framework.';
    const ten = oneLine.repeat(10);
    expect(countTokens(ten)).toBeGreaterThan(countTokens(oneLine));
  });

  it('chunks produced cover the entire input (token-count >= total)', () => {
    const long = 'Alpha bravo charlie delta echo foxtrot golf hotel. '.repeat(400);
    const chunks = chunkText(long, {
      targetTokens: 500,
      overlapTokens: 80,
      maxTokens: 600,
      minTokens: 400,
    });
    const totalTokens = countTokens(long);
    const sum = chunks.reduce((s, c) => s + c.tokenCount, 0);
    // overlap ⇒ sum >= totalTokens (each token covered, some twice)
    expect(sum).toBeGreaterThanOrEqual(totalTokens);
  });
});
