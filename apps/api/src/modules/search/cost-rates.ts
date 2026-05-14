/**
 * Per-model USD rate table. Values are dollars per 1 million tokens.
 * Numbers come from public Anthropic + OpenAI pricing pages — bump in
 * a follow-up commit when a vendor updates.
 *
 * `lookupCost(model, tokensIn, tokensOut)` returns the USD cost as a
 * float (with cent-and-microcent precision) or `null` when the model
 * isn't in the table (caller persists null → admin widget shows the
 * row as "unpriced" rather than counting it in the weekly total).
 *
 * Keys are matched case-insensitively against the model id we
 * persisted on Message.model — usually the provider's canonical id
 * with no prefix (e.g. `claude-opus-4-7`, `gpt-4o-mini`).
 */

interface Rate {
  /** USD per 1M input tokens. */
  inPer1M: number;
  /** USD per 1M output tokens. */
  outPer1M: number;
}

const RATES: Record<string, Rate> = {
  // Anthropic — claude.com/pricing as of 2026-01.
  'claude-opus-4-7': { inPer1M: 15, outPer1M: 75 },
  'claude-opus-4-6': { inPer1M: 15, outPer1M: 75 },
  'claude-sonnet-4-6': { inPer1M: 3, outPer1M: 15 },
  'claude-haiku-4-5': { inPer1M: 0.8, outPer1M: 4 },
  'claude-haiku-4-5-20251001': { inPer1M: 0.8, outPer1M: 4 },

  // OpenAI — openai.com/api/pricing as of 2026-01.
  'gpt-4o': { inPer1M: 2.5, outPer1M: 10 },
  'gpt-4o-mini': { inPer1M: 0.15, outPer1M: 0.6 },
  'gpt-4.1': { inPer1M: 2, outPer1M: 8 },
  'gpt-4.1-mini': { inPer1M: 0.4, outPer1M: 1.6 },

  // DeepSeek — deepseek.com/pricing as of 2026-01.
  'deepseek-chat': { inPer1M: 0.27, outPer1M: 1.1 },
  'deepseek-reasoner': { inPer1M: 0.55, outPer1M: 2.19 },
};

export function lookupCost(
  model: string | null | undefined,
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): number | null {
  if (!model) return null;
  if (typeof tokensIn !== 'number' && typeof tokensOut !== 'number') return null;
  const rate = RATES[model.toLowerCase()];
  if (!rate) return null;
  const usdIn = ((tokensIn ?? 0) * rate.inPer1M) / 1_000_000;
  const usdOut = ((tokensOut ?? 0) * rate.outPer1M) / 1_000_000;
  // 6 decimal places — keeps a single-token Haiku call from rounding
  // to zero ($8e-7) but stays well within the Decimal(10,6) column.
  return Math.round((usdIn + usdOut) * 1_000_000) / 1_000_000;
}

export function listKnownModels(): string[] {
  return Object.keys(RATES);
}
