import type { LLMProvider, ProviderFrame, ProviderRequest } from './types.js';

/**
 * Drain a provider stream into a single text answer. Used by enrichment /
 * vision / project-context (single-turn callers). Returns the full assembled
 * text plus the last `done` or `error` frame so the caller can react to
 * rate-limit / auth / timeout.
 */
export async function completeProvider(
  provider: LLMProvider,
  req: ProviderRequest,
): Promise<{ text: string; final: ProviderFrame }> {
  let text = '';
  let final: ProviderFrame = { type: 'error', reason: 'generic', message: 'no frames emitted' };
  for await (const frame of provider.stream(req)) {
    if (frame.type === 'token') text += frame.delta;
    if (frame.type === 'done') {
      final = frame;
      if (frame.text && text.length === 0) text = frame.text;
    }
    if (frame.type === 'error') {
      final = frame;
      break;
    }
  }
  return { text, final };
}
