import { describe, expect, it } from 'vitest';

import { detectAuthError, detectRateLimit, pickResultFrame } from '../detect.js';
import type { ClaudeApiRetryFrame, ClaudeFrame, ClaudeResultFrame } from '../types.js';

const apiRetry = (error: string): ClaudeApiRetryFrame => ({
  type: 'system',
  subtype: 'api_retry',
  error,
  error_status: 429,
  attempt: 1,
  max_retries: 0,
  retry_delay_ms: 0,
});

const result = (text: string, opts: Partial<ClaudeResultFrame> = {}): ClaudeResultFrame => ({
  type: 'result',
  session_id: 's',
  result: text,
  ...opts,
});

describe('detectRateLimit', () => {
  it('catches an api_retry rate_limit frame', () => {
    const hit = detectRateLimit([apiRetry('rate_limit')], '');
    expect(hit?.source).toBe('api_retry_frame');
  });

  it('catches the rate-limit marker in the result text', () => {
    const hit = detectRateLimit([], "You've hit your session limit · resets 3:45pm");
    expect(hit?.source).toBe('result_text');
    expect(hit?.resetAt).not.toBeNull();
  });

  it('returns null when neither matches', () => {
    expect(detectRateLimit([apiRetry('server_error')], 'all good')).toBeNull();
  });

  it('strips long raw text to a snippet', () => {
    const long = 'x'.repeat(500) + " You've hit your weekly limit · resets Mon 12:00am";
    const hit = detectRateLimit([], long);
    expect(hit?.raw.length).toBeLessThanOrEqual(240);
  });
});

describe('detectAuthError', () => {
  it('detects authentication_failed via api_retry frame', () => {
    expect(detectAuthError([apiRetry('authentication_failed')], '', '')).toBe('invalid-key');
  });

  it('detects oauth_org_not_allowed via api_retry frame', () => {
    expect(detectAuthError([apiRetry('oauth_org_not_allowed')], '', '')).toBe('oauth-revoked');
  });

  it('detects "Please run /login" in stderr', () => {
    expect(detectAuthError([], '', 'Not logged in · Please run /login')).toBe('not-logged-in');
  });

  it('detects "Invalid API key" in result text', () => {
    expect(detectAuthError([], 'Invalid API key · Fix external API key', '')).toBe('invalid-key');
  });

  it('returns null when nothing matches', () => {
    expect(detectAuthError([], '', '')).toBeNull();
  });
});

describe('pickResultFrame', () => {
  it('returns the last result frame', () => {
    const r1 = result('first');
    const r2 = result('second');
    const frames: ClaudeFrame[] = [r1, { type: 'stream_event', event: {} }, r2];
    expect(pickResultFrame(frames)).toBe(r2);
  });

  it('returns null when there is no result frame', () => {
    expect(pickResultFrame([{ type: 'system', subtype: 'init' }])).toBeNull();
  });
});
