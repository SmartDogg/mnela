/**
 * Provider-agnostic types for the Mnela LLM abstraction (ADR-0049).
 *
 * Every feature in Mnela that talks to an LLM (Ask Brain, document
 * enrichment, project-context refresh, image vision) goes through this
 * surface. Three implementations live next door:
 *
 *   - ClaudeCliProvider     — wraps @mnela/claude-runner subprocess + MCP
 *   - AnthropicApiProvider  — native @anthropic-ai/sdk with tool use
 *   - OpenAiCompatibleProvider — chat/completions + function calling
 *                                (OpenAI / DeepSeek / Grok / Gemini-via-
 *                                OpenRouter / Ollama / LM Studio)
 *
 * The non-CLI providers run their own multi-turn tool-use loop in-process
 * (see ./agent-loop) so the same MCP tools the Claude Code subprocess uses
 * (`mnela_find_similar`, `mnela_get_chunks`, …) work uniformly across every
 * backend without depending on the MCP HTTP server.
 */

import type { McpToolContext, ToolDefinition } from '@mnela/mcp-tools';

/** Provider implementation kind. */
export type ProviderKind = 'claude_cli' | 'anthropic_api' | 'openai_compat';

/**
 * Static descriptor of a provider instance — what the registry resolves and
 * the UI shows. Not a Prisma row directly: `claude_cli` is virtual (built-in)
 * and never persisted; database-backed providers carry their decrypted
 * config here.
 */
export interface ProviderConfig {
  /**
   * Stable id. Database rows use cuid; the built-in subprocess provider uses
   * the sentinel `builtin:claude-cli`.
   */
  id: string;
  name: string;
  kind: ProviderKind;
  /** Default model id passed to the backend. Empty for claude_cli (the CLI picks). */
  model: string;
  /** OpenAI-compatible only. */
  baseUrl?: string;
  /** Plaintext key (decrypted by the keystore before the provider sees it). */
  apiKey?: string;
  /** Free-form extras (extra HTTP headers, OpenAI org id, etc.). */
  extra?: Record<string, unknown>;
  /** True for the built-in `builtin:claude-cli` row — never editable. */
  builtin?: boolean;
}

/** A tool the model can call (mirrors `@mnela/mcp-tools` definitions). */
export interface ProviderTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's input. */
  inputSchema: Record<string, unknown>;
}

export type ProviderMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ProviderMessage {
  role: ProviderMessageRole;
  content: string;
  /**
   * On role='tool', identifies which tool_use call this result corresponds
   * to (Anthropic + OpenAI both correlate by id).
   */
  toolUseId?: string;
  /** On role='tool', the tool that produced the result (for logging only). */
  toolName?: string;
}

/**
 * Image input for vision (single-turn). Used by the vision flow which never
 * goes through the agent loop — the model gets one user turn and emits JSON.
 */
export interface ProviderImageInput {
  /** Absolute path to the image on disk. */
  path: string;
  /** MIME type, e.g. image/png. */
  mimeType: string;
}

/**
 * Request shape passed to a provider. The provider decides what to do with
 * `tools`: claude_cli loads them via MCP config at subprocess spawn time;
 * anthropic_api / openai_compat surface them as tool definitions and run a
 * multi-turn agent loop until the model emits a final answer.
 */
export interface ProviderRequest {
  /** Conversation history. `system` messages are prepended once. */
  messages: ProviderMessage[];
  /** Available tools (already converted to JSON Schema by the caller). */
  tools?: ProviderTool[];
  /** Override the provider's default model. */
  model?: string;
  /** Max output tokens per turn (provider clamps). */
  maxTokens?: number;
  /** Abort the in-flight call. */
  signal?: AbortSignal;
  /** Hard timeout per turn (ms). */
  timeoutMs?: number;
  /**
   * Single image attached to the last user message — used by the vision
   * pipeline. Providers that don't support vision return an error frame.
   */
  image?: ProviderImageInput;
  /**
   * Required only when `tools` is set — the agent-loop calls
   * `invokeTool(name, input, ctx)` with this context. Forwarded by the
   * caller from the api/orchestrator's already-built mcp context.
   */
  toolContext?: McpToolContext;
  /**
   * Required only when `tools` is set — looks up the ToolDefinition by name
   * so the agent loop can route a model tool_call to the right handler.
   * (Decoupled from `tools` so the JSON Schema list shipped to the model
   * can be filtered/curated separately from execution.)
   */
  toolRegistry?: ReadonlyMap<string, ToolDefinition<unknown, unknown>>;
}

/**
 * Streaming frames yielded by every provider. The api SSE endpoint maps
 * these 1:1 onto chat-panel events; enrichment / vision just collect the
 * final text.
 *
 * Why a union here instead of named methods (stream vs complete vs tools):
 * a single iterator lets the api forward frames straight to SSE while
 * enrichment/vision can simply drain it and pick the final result.
 */
export type ProviderFrame =
  /** Provider has started — opaque session id for logging. */
  | { type: 'start'; sessionId?: string; model?: string }
  /** A text delta — appended to the assistant's current message. */
  | { type: 'token'; delta: string }
  /** Model emitted a tool call (turn boundary inside agent loop). */
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  /** Tool result fed back to the model (visible in chat timeline). */
  | { type: 'tool_result'; id: string; name: string; ok: boolean; output?: unknown; error?: string }
  /** Model finished — `usage` is best-effort. */
  | {
      type: 'done';
      usage?: { inputTokens?: number; outputTokens?: number };
      durationMs?: number;
      /** Final assembled text. Convenience for non-streaming callers. */
      text?: string;
    }
  /** Recoverable / fatal error — caller decides whether to retry. */
  | {
      type: 'error';
      reason: ProviderErrorReason;
      message?: string;
      /** Present only when reason === 'rate-limit' and the provider parsed a reset window. */
      resetAt?: Date;
    };

export type ProviderErrorReason =
  | 'rate-limit'
  | 'auth'
  | 'no-binary'
  | 'unavailable'
  | 'timeout'
  | 'aborted'
  | 'generic';

/**
 * Provider contract — single method, one async iterable of frames per call.
 *
 * `complete()` is a convenience built on top of `stream()` for callers that
 * want the final text in one shot (vision, project-context). Default
 * implementation lives in ./base.
 */
export interface LLMProvider {
  readonly config: ProviderConfig;
  /** Whether the provider can handle tool definitions. claude_cli + anthropic_api: always yes. openai_compat: depends on model. */
  readonly supportsTools: boolean;
  /** Whether the provider accepts image inputs. */
  readonly supportsVision: boolean;

  /**
   * Run one request and yield frames. Implementations MUST emit `start`
   * first and `done` or `error` last; tokens/tool events go in between.
   */
  stream(req: ProviderRequest): AsyncIterable<ProviderFrame>;

  /** Light health probe. `ok:false` keeps the provider usable but flagged in UI. */
  test(): Promise<ProviderTestResult>;
}

export interface ProviderTestResult {
  ok: boolean;
  /** Optional version string from the backend (`claude --version`, OpenAI model list, …). */
  version?: string;
  /** Best-effort latency for the probe call. */
  latencyMs: number;
  /** Why the probe failed — short human-readable. */
  error?: string;
  /**
   * Did the probe see a tool_call frame in response to a dummy tool
   * definition? Used to badge "no citations" on providers/models that
   * skip the agent loop (some older OpenAI-compatible models, local
   * llama.cpp endpoints, etc). `true` = tools work, `false` = no tool
   * frame emitted, `undefined` = not probed (claude_cli skips for speed).
   */
  toolUse?: boolean;
}

/** Map kind → human label for UI rendering. */
export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  claude_cli: 'Claude Code (CLI)',
  anthropic_api: 'Anthropic API',
  openai_compat: 'OpenAI-compatible',
};

/** Sentinel id for the always-on built-in provider. */
export const BUILTIN_CLAUDE_CLI_ID = 'builtin:claude-cli' as const;
