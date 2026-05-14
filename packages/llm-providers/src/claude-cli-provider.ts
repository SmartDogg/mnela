/**
 * ClaudeCliProvider — adapts the legacy @mnela/claude-runner subprocess to
 * the LLMProvider surface.
 *
 * Why subprocess instead of in-process tool loop: this is the path that
 * works with a Claude Max subscription (no API key, OAuth-bound to the
 * Claude Code CLI). MCP tools are loaded via the CLI's --mcp-config flag
 * (claude itself spawns the stdio MCP host), so we don't run an agent
 * loop here — Claude does the multi-turn reasoning internally.
 *
 * What we map:
 *   - `streamClaude` stream_event frames → `token` frames
 *   - tool_use blocks in stream_event → `tool_call` (best-effort surfacing
 *     for the chat UI timeline; the CLI handles their execution itself)
 *   - rate_limit / auth retries → `error` frame
 *   - final `result` frame → `done` with usage
 *
 * NOTE: we deliberately ignore `req.tools` here because the CLI's tool set
 * comes from its mcp-config, not from this surface. The router only sends
 * tools when targeting non-CLI providers.
 */

import {
  type ClaudeFrame,
  claudeAvailable,
  claudeTest,
  runClaude,
  streamClaude,
  type StreamHandle,
} from '@mnela/claude-runner';

import {
  BUILTIN_CLAUDE_CLI_ID,
  type LLMProvider,
  type ProviderConfig,
  type ProviderFrame,
  type ProviderRequest,
  type ProviderTestResult,
} from './types.js';

/**
 * Filesystem + binary configuration the subprocess needs. The caller
 * (api/orchestrator) constructs this from its existing env loader so we
 * don't duplicate env parsing in the package.
 */
export interface ClaudeCliRuntime {
  bin: string;
  mcpConfig: string;
  addDirs: string[];
  /** Per-call timeout (defaults differ between api and orchestrator). */
  timeoutMs: number;
  /** Forwarded to the subprocess via spawn `env`. */
  envForward: NodeJS.ProcessEnv;
}

export class ClaudeCliProvider implements LLMProvider {
  readonly config: ProviderConfig;
  readonly supportsTools = true;
  readonly supportsVision = true;

  constructor(
    private readonly runtime: ClaudeCliRuntime,
    name = 'Claude Code (built-in)',
  ) {
    this.config = {
      id: BUILTIN_CLAUDE_CLI_ID,
      name,
      kind: 'claude_cli',
      model: '',
      builtin: true,
    };
  }

  async *stream(req: ProviderRequest): AsyncGenerator<ProviderFrame> {
    const prompt = buildPrompt(req);
    yield { type: 'start' };

    const handle: StreamHandle = streamClaude({
      prompt,
      mcpConfig: this.runtime.mcpConfig,
      addDirs: this.runtime.addDirs,
      bin: this.runtime.bin,
      timeoutMs: req.timeoutMs ?? this.runtime.timeoutMs,
      outputFormat: 'stream-json',
      ...(req.signal ? { signal: req.signal } : {}),
      env: this.runtime.envForward,
    });

    let aborted = false;
    let errorEmitted = false;
    let finalText = '';

    const propagate = (): void => {
      aborted = true;
      handle.abort();
    };
    if (req.signal) {
      if (req.signal.aborted) propagate();
      else req.signal.addEventListener('abort', propagate, { once: true });
    }

    try {
      for await (const frame of handle.frames) {
        if (aborted) break;

        // Rate-limit retries from the CLI surface as `api_retry` system frames
        // — fail fast (we don't burn the user's session waiting).
        if (
          frame.type === 'system' &&
          (frame as { subtype?: string }).subtype === 'api_retry' &&
          (frame as { error?: string }).error === 'rate_limit'
        ) {
          errorEmitted = true;
          handle.abort();
          yield { type: 'error', reason: 'rate-limit' };
          break;
        }

        if (frame.type === 'stream_event') {
          const event = (frame as { event?: { delta?: { text?: string; type?: string } } }).event;
          const delta = event?.delta;
          // Plain text delta — the common case.
          const text = typeof delta?.text === 'string' ? delta.text : null;
          if (text && text.length > 0) {
            finalText += text;
            yield { type: 'token', delta: text };
          }
          // Surface tool_use / tool_result blocks so the chat UI can render a
          // timeline. The CLI runs the tools itself; we only relay metadata.
          for (const tool of extractToolEvents(frame)) {
            yield tool;
          }
        }
      }

      const finalized = await handle.finalize();
      // Fallback: stream-json sometimes emits only the `result` frame for
      // short answers — drain its text via `result.result`.
      if (!errorEmitted && finalText.length === 0 && finalized.result?.result) {
        finalText = finalized.result.result;
        yield { type: 'token', delta: finalText };
      }

      if (errorEmitted) return;

      if (finalized.rateLimitHit) {
        const frame: ProviderFrame = {
          type: 'error',
          reason: 'rate-limit',
        };
        if (finalized.rateLimitHit.resetAt) frame.resetAt = finalized.rateLimitHit.resetAt;
        yield frame;
        return;
      }
      if (finalized.authError) {
        yield { type: 'error', reason: 'auth', message: finalized.authError };
        return;
      }
      if (aborted || req.signal?.aborted) {
        yield { type: 'error', reason: 'aborted' };
        return;
      }
      if (finalized.exitCode !== 0) {
        yield {
          type: 'error',
          reason: finalized.timedOut ? 'timeout' : 'generic',
          message: finalized.timedOut
            ? 'claude subprocess timed out'
            : `claude exited ${finalized.exitCode}`,
        };
        return;
      }

      const inputTokens = readUsage(finalized.result?.usage, 'input_tokens');
      const outputTokens = readUsage(finalized.result?.usage, 'output_tokens');
      const usage: { inputTokens?: number; outputTokens?: number } = {};
      if (inputTokens !== null) usage.inputTokens = inputTokens;
      if (outputTokens !== null) usage.outputTokens = outputTokens;
      const done: ProviderFrame = { type: 'done', text: finalText };
      if (typeof finalized.result?.duration_ms === 'number') {
        done.durationMs = finalized.result.duration_ms;
      }
      if (Object.keys(usage).length > 0) done.usage = usage;
      yield done;
    } finally {
      if (req.signal) req.signal.removeEventListener('abort', propagate);
    }
  }

  async test(): Promise<ProviderTestResult> {
    const start = Date.now();
    const present = await claudeAvailable(this.runtime.bin);
    if (!present) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: 'claude binary not found in PATH',
      };
    }
    const result = await claudeTest(this.runtime.bin);
    // Claude Code subprocess owns its own MCP tool loop; tool-use is
    // always supported. Declare it statically so the admin badge knows.
    const out: ProviderTestResult = { ok: result.ok, latencyMs: result.latencyMs, toolUse: true };
    if (result.version) out.version = result.version;
    if (result.error) out.error = result.error;
    return out;
  }

  /**
   * Convenience for callers that want a non-streaming result (used by
   * enrichment which only needs the final structured JSON). Avoids the
   * cost of agent-loop drift by going straight through `runClaude`.
   */
  async run(req: { prompt: string; signal?: AbortSignal; timeoutMs?: number }): Promise<{
    text: string;
    final: ProviderFrame;
  }> {
    const opts: Parameters<typeof runClaude>[0] = {
      prompt: req.prompt,
      mcpConfig: this.runtime.mcpConfig,
      addDirs: this.runtime.addDirs,
      bin: this.runtime.bin,
      timeoutMs: req.timeoutMs ?? this.runtime.timeoutMs,
      outputFormat: 'stream-json',
      env: this.runtime.envForward,
    };
    if (req.signal) opts.signal = req.signal;
    const result = await runClaude(opts);
    if (result.rateLimitHit) {
      const frame: ProviderFrame = { type: 'error', reason: 'rate-limit' };
      if (result.rateLimitHit.resetAt) frame.resetAt = result.rateLimitHit.resetAt;
      return { text: '', final: frame };
    }
    if (result.authError) {
      return { text: '', final: { type: 'error', reason: 'auth', message: result.authError } };
    }
    if (result.exitCode !== 0 || result.timedOut) {
      return {
        text: '',
        final: {
          type: 'error',
          reason: result.timedOut ? 'timeout' : 'generic',
          message: result.timedOut ? 'timeout' : `exit ${result.exitCode}`,
        },
      };
    }
    const text = result.result?.result ?? '';
    const inputTokens = readUsage(result.result?.usage, 'input_tokens');
    const outputTokens = readUsage(result.result?.usage, 'output_tokens');
    const usage: { inputTokens?: number; outputTokens?: number } = {};
    if (inputTokens !== null) usage.inputTokens = inputTokens;
    if (outputTokens !== null) usage.outputTokens = outputTokens;
    const done: ProviderFrame = { type: 'done', text };
    if (typeof result.result?.duration_ms === 'number') done.durationMs = result.result.duration_ms;
    if (Object.keys(usage).length > 0) done.usage = usage;
    return { text, final: done };
  }
}

function readUsage(usage: Record<string, unknown> | undefined, key: string): number | null {
  if (!usage) return null;
  const v = usage[key];
  return typeof v === 'number' ? v : null;
}

/**
 * The CLI's prompt is a single string. Collapse the system+user messages
 * into the legacy single-prompt shape so the agent loop (when targeting
 * a non-CLI provider) and the CLI both see the same logical input.
 *
 * The CLI handles system instructions via its CLAUDE.md template + `-p`
 * prompt; we prepend system text inline so users (or test code) that pass
 * a multi-message conversation still see all of it routed through the CLI.
 */
function buildPrompt(req: ProviderRequest): string {
  const lines: string[] = [];
  for (const m of req.messages) {
    if (m.role === 'system') lines.push(m.content);
    else if (m.role === 'user') lines.push(m.content);
    else if (m.role === 'assistant') lines.push(`Assistant: ${m.content}`);
    // tool messages are skipped — the CLI loops tools internally.
  }
  if (req.image) {
    lines.push('');
    lines.push(`(Read the image at: ${req.image.path}, mime ${req.image.mimeType})`);
  }
  return lines.join('\n\n');
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input?: unknown;
}
interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: unknown;
  is_error?: boolean;
}

/**
 * The CLI's stream-json includes Anthropic-style content_block_start events
 * with `tool_use` blocks. Pluck them so the chat-panel timeline can render
 * "🔎 mnela_find_similar(...)" lines. Best-effort: schema varies, so we
 * defensively type-guard each field.
 */
function extractToolEvents(frame: ClaudeFrame): ProviderFrame[] {
  if (frame.type !== 'stream_event') return [];
  const event = (frame as { event?: { type?: string; content_block?: unknown } }).event;
  if (!event) return [];
  if (event.type !== 'content_block_start') return [];

  const block = event.content_block;
  if (!block || typeof block !== 'object') return [];

  const b = block as Partial<ToolUseBlock> & Partial<ToolResultBlock> & { type?: string };
  if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
    return [{ type: 'tool_call', id: b.id, name: b.name, input: b.input ?? {} }];
  }
  if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
    const out: ProviderFrame = {
      type: 'tool_result',
      id: b.tool_use_id,
      // Name is not on the result block — left blank; the chat-panel
      // correlates by id with the prior tool_call frame.
      name: '',
      ok: b.is_error !== true,
    };
    if (b.content !== undefined) out.output = b.content;
    return [out];
  }
  return [];
}
