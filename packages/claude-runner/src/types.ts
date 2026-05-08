/**
 * Stream-json frames emitted by `claude -p ... --output-format stream-json --verbose`.
 * Schema reverse-engineered from the public docs and Anthropic's published examples
 * (ADR-0026). Optional fields are loosely typed because the CLI is under-documented.
 */
export interface ClaudeSystemInitFrame {
  type: 'system';
  subtype: 'init';
  session_id?: string;
  tools?: unknown;
  plugins?: unknown;
  plugin_errors?: { plugin: string; type: string; message: string }[];
}

export interface ClaudeApiRetryFrame {
  type: 'system';
  subtype: 'api_retry';
  /**
   * Documented categories: `authentication_failed`, `oauth_org_not_allowed`,
   * `billing_error`, `rate_limit`, `invalid_request`, `server_error`,
   * `max_output_tokens`, `unknown`.
   */
  error: string;
  error_status: number | null;
  attempt: number;
  max_retries: number;
  retry_delay_ms: number;
  uuid?: string;
  session_id?: string;
}

export interface ClaudeStreamEventFrame {
  type: 'stream_event';
  event: {
    type?: string;
    delta?: { type: string; text?: string };
  };
}

export interface ClaudeResultFrame {
  type: 'result';
  session_id: string;
  total_cost_usd?: number;
  result?: string;
  is_error?: boolean;
  num_turns?: number;
  duration_ms?: number;
  structured_output?: unknown;
  usage?: Record<string, unknown>;
}

export interface ClaudeUnknownFrame {
  type: string;
  subtype?: string;
  [key: string]: unknown;
}

export type ClaudeFrame =
  | ClaudeSystemInitFrame
  | ClaudeApiRetryFrame
  | ClaudeStreamEventFrame
  | ClaudeResultFrame
  | ClaudeUnknownFrame;

export type ClaudeAuthError = 'not-logged-in' | 'invalid-key' | 'oauth-revoked';

export interface RateLimitHit {
  resetAt: Date | null;
  raw: string;
  source: 'api_retry_frame' | 'result_text';
}

export interface RunOptions {
  prompt: string;
  addDirs?: string[];
  mcpConfig?: string;
  outputFormat?: 'json' | 'stream-json';
  timeoutMs?: number;
  signal?: AbortSignal;
  bin?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /**
   * Extra CLI flags passed verbatim. Useful for `--bare`,
   * `--no-session-persistence`, `--include-partial-messages`, etc.
   */
  extraArgs?: string[];
}

export interface RunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  frames: ClaudeFrame[];
  result: ClaudeResultFrame | null;
  rateLimitHit: RateLimitHit | null;
  authError: ClaudeAuthError | null;
  timedOut: boolean;
}
