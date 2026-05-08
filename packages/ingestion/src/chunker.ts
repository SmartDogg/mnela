import { encode, decode } from 'gpt-tokenizer';

export interface ChunkOptions {
  targetTokens?: number; // soft target inside [minTokens, maxTokens]
  minTokens?: number;
  maxTokens?: number;
  overlapTokens?: number;
}

export interface Chunk {
  index: number;
  text: string;
  tokenCount: number;
}

const DEFAULTS: Required<ChunkOptions> = {
  targetTokens: 900,
  minTokens: 700,
  maxTokens: 1200,
  overlapTokens: 120,
};

/**
 * Token-aware sliding window chunker (ADR-0005, TZ §3.3).
 *
 * Strategy: encode the whole text to BPE token ids, then walk the array in
 * windows of `targetTokens` with `overlapTokens` overlap. Each window is
 * decoded back to text. This keeps chunk boundaries deterministic and avoids
 * the off-by-token errors of char-counting heuristics.
 *
 * Empty text returns no chunks.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const cfg = { ...DEFAULTS, ...opts };
  if (cfg.overlapTokens >= cfg.targetTokens) {
    throw new Error(
      `chunker: overlapTokens (${cfg.overlapTokens}) must be less than targetTokens (${cfg.targetTokens})`,
    );
  }
  if (cfg.minTokens > cfg.maxTokens) {
    throw new Error(
      `chunker: minTokens (${cfg.minTokens}) must be <= maxTokens (${cfg.maxTokens})`,
    );
  }

  if (!text) return [];
  const tokens = encode(text);
  if (tokens.length === 0) return [];

  // Whole text fits in a single chunk — return it as-is even if below minTokens
  // (a 200-token note shouldn't be artificially padded).
  if (tokens.length <= cfg.maxTokens) {
    return [{ index: 0, text, tokenCount: tokens.length }];
  }

  const chunks: Chunk[] = [];
  const stride = cfg.targetTokens - cfg.overlapTokens;
  let start = 0;
  let index = 0;

  while (start < tokens.length) {
    const end = Math.min(start + cfg.targetTokens, tokens.length);
    const slice = tokens.slice(start, end);
    chunks.push({ index, text: decode(slice), tokenCount: slice.length });
    index += 1;
    if (end === tokens.length) break;
    start += stride;
  }

  return chunks;
}
