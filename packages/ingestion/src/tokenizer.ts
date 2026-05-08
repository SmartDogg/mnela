import { encode } from 'gpt-tokenizer';

/**
 * Per ADR-0005: gpt-tokenizer with the default cl100k_base encoding.
 * Counts won't match Claude's tokenizer 1:1 but are accurate enough
 * for chunk-size targeting (we don't bill on these counts).
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}
