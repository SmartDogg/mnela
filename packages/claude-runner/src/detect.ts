import { parseRateLimitReset } from './parse-rate-limit.js';
import type { ClaudeAuthError, ClaudeFrame, ClaudeResultFrame, RateLimitHit } from './types.js';

const RATE_LIMIT_TEXT_RE = /You(?:'|’)?ve hit your (session|weekly|opus|sonnet|haiku) limit/i;
const AUTH_NOT_LOGGED_IN_RE =
  /(not logged in|please run\s*\/login|oauth token (revoked|has expired))/i;
const AUTH_INVALID_KEY_RE = /(invalid api key|authentication[_ ]error)/i;
const AUTH_OAUTH_REVOKED_RE = /oauth token revoked/i;

export function detectRateLimit(
  frames: readonly ClaudeFrame[],
  resultText: string,
): RateLimitHit | null {
  for (const f of frames) {
    if (f.type === 'system' && (f as { subtype?: string }).subtype === 'api_retry') {
      const errField = (f as { error?: unknown }).error;
      if (typeof errField === 'string' && errField === 'rate_limit') {
        return {
          resetAt: parseRateLimitReset(resultText),
          raw: 'api_retry frame: rate_limit',
          source: 'api_retry_frame',
        };
      }
    }
  }

  if (RATE_LIMIT_TEXT_RE.test(resultText)) {
    return {
      resetAt: parseRateLimitReset(resultText),
      raw: resultText.slice(0, 240),
      source: 'result_text',
    };
  }

  return null;
}

export function detectAuthError(
  frames: readonly ClaudeFrame[],
  resultText: string,
  stderr: string,
): ClaudeAuthError | null {
  const haystack = `${resultText}\n${stderr}`;

  for (const f of frames) {
    if (f.type === 'system' && (f as { subtype?: string }).subtype === 'api_retry') {
      const errField = (f as { error?: unknown }).error;
      if (typeof errField === 'string') {
        if (errField === 'authentication_failed') return 'invalid-key';
        if (errField === 'oauth_org_not_allowed') return 'oauth-revoked';
      }
    }
  }

  if (AUTH_OAUTH_REVOKED_RE.test(haystack)) return 'oauth-revoked';
  if (AUTH_NOT_LOGGED_IN_RE.test(haystack)) return 'not-logged-in';
  if (AUTH_INVALID_KEY_RE.test(haystack)) return 'invalid-key';
  return null;
}

export function pickResultFrame(frames: readonly ClaudeFrame[]): ClaudeResultFrame | null {
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const f = frames[i];
    if (f && f.type === 'result') return f as ClaudeResultFrame;
  }
  return null;
}
