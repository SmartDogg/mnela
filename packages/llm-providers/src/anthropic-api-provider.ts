/**
 * AnthropicApiProvider — talks to api.anthropic.com via @anthropic-ai/sdk.
 *
 * The SDK is loaded dynamically so the build still works when the optional
 * dep is missing (the claude_cli provider is the zero-dependency default).
 * Once a user installs the SDK and adds an Anthropic API provider in the
 * admin UI, calls go straight here.
 *
 * Streaming: we use the SDK's `.messages.stream(...)` async iterator and
 * emit `token` per text delta, `tool_call` per finalised tool_use block,
 * and a `done` with usage at the end. The agent loop (see ./agent-loop)
 * runs the tools and feeds results back.
 */

import { promises as fs } from 'node:fs';

import type {
  LLMProvider,
  ProviderConfig,
  ProviderFrame,
  ProviderRequest,
  ProviderTestResult,
} from './types.js';

interface AnthropicSdkLike {
  messages: {
    stream(args: AnthropicCreateArgs): AnthropicMessageStream;
    create(args: AnthropicCreateArgs): Promise<AnthropicMessage>;
  };
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

interface AnthropicCreateArgs {
  model: string;
  max_tokens: number;
  system?: string;
  messages: { role: 'user' | 'assistant'; content: string | AnthropicContentBlock[] }[];
  tools?: { name: string; description: string; input_schema: Record<string, unknown> }[];
  tool_choice?: { type: 'auto' | 'any' | 'none' };
  metadata?: Record<string, unknown>;
}

interface AnthropicMessage {
  id?: string;
  model?: string;
  content: AnthropicContentBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface AnthropicMessageStream extends AsyncIterable<AnthropicStreamEvent> {
  finalMessage(): Promise<AnthropicMessage>;
}

type AnthropicStreamEvent =
  | { type: 'message_start'; message: { id?: string; model?: string } }
  | {
      type: 'content_block_start';
      index: number;
      content_block: AnthropicContentBlock & { id?: string; name?: string };
    }
  | {
      type: 'content_block_delta';
      index: number;
      delta: { type: string; text?: string; partial_json?: string };
    }
  | { type: 'content_block_stop'; index: number }
  | {
      type: 'message_delta';
      usage?: { output_tokens?: number };
    }
  | { type: 'message_stop' };

const DEFAULT_MAX_TOKENS = 4096;

export class AnthropicApiProvider implements LLMProvider {
  readonly supportsTools = true;
  readonly supportsVision = true;

  constructor(readonly config: ProviderConfig) {
    if (!config.apiKey) {
      throw new Error('AnthropicApiProvider requires apiKey in config');
    }
    if (!config.model) {
      throw new Error('AnthropicApiProvider requires model in config');
    }
  }

  async *stream(req: ProviderRequest): AsyncGenerator<ProviderFrame> {
    const t0 = Date.now();
    let client: AnthropicSdkLike;
    try {
      client = await loadAnthropic(this.config.apiKey!);
    } catch (err) {
      yield {
        type: 'error',
        reason: 'unavailable',
        message: err instanceof Error ? err.message : String(err),
      };
      return;
    }

    let args: AnthropicCreateArgs;
    try {
      args = await buildArgs(this.config, req);
    } catch (err) {
      yield {
        type: 'error',
        reason: 'generic',
        message: err instanceof Error ? err.message : String(err),
      };
      return;
    }

    yield { type: 'start', model: args.model };

    // For non-tool calls we use a single-shot `.create()` (cheaper) — pure
    // chat-completion path. Tools require the streaming API to surface
    // tool_use blocks frame-by-frame.
    if (!args.tools || args.tools.length === 0) {
      try {
        const msg = await client.messages.create(args);
        const text = collectText(msg.content);
        if (text.length > 0) yield { type: 'token', delta: text };
        const done = makeDone(t0, msg.usage, text);
        yield done;
      } catch (err) {
        yield mapError(err);
      }
      return;
    }

    let aborted = false;
    const onAbort = (): void => {
      aborted = true;
    };
    if (req.signal) {
      if (req.signal.aborted) onAbort();
      else req.signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const stream = client.messages.stream(args);
      // Accumulate partial tool inputs by block index — Anthropic streams JSON
      // bit-by-bit via `input_json_delta`. We finalise on content_block_stop.
      const partial = new Map<number, { id: string; name: string; raw: string }>();

      for await (const event of stream) {
        if (aborted) break;
        if (event.type === 'content_block_start') {
          const cb = event.content_block;
          if (cb.type === 'tool_use' && cb.id && cb.name) {
            partial.set(event.index, { id: cb.id, name: cb.name, raw: '' });
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta' && typeof event.delta.text === 'string') {
            const text = event.delta.text;
            if (text.length > 0) yield { type: 'token', delta: text };
          } else if (
            event.delta.type === 'input_json_delta' &&
            typeof event.delta.partial_json === 'string'
          ) {
            const acc = partial.get(event.index);
            if (acc) acc.raw += event.delta.partial_json;
          }
        } else if (event.type === 'content_block_stop') {
          const acc = partial.get(event.index);
          if (acc) {
            let input: unknown = {};
            if (acc.raw.length > 0) {
              try {
                input = JSON.parse(acc.raw);
              } catch {
                input = { _raw: acc.raw };
              }
            }
            partial.delete(event.index);
            yield { type: 'tool_call', id: acc.id, name: acc.name, input };
          }
        }
      }

      const final = await stream.finalMessage();
      yield makeDone(t0, final.usage);
    } catch (err) {
      if (req.signal?.aborted) {
        yield { type: 'error', reason: 'aborted' };
      } else {
        yield mapError(err);
      }
    } finally {
      if (req.signal) req.signal.removeEventListener('abort', onAbort);
    }
  }

  async test(): Promise<ProviderTestResult> {
    const t0 = Date.now();
    try {
      const client = await loadAnthropic(this.config.apiKey!);
      const msg = await client.messages.create({
        model: this.config.model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'reply with the single word: ok' }],
      });
      const text = collectText(msg.content);
      return {
        ok: text.toLowerCase().includes('ok'),
        latencyMs: Date.now() - t0,
        version: this.config.model,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

async function loadAnthropic(apiKey: string): Promise<AnthropicSdkLike> {
  // Dynamic import via Function() so tsc never tries to resolve the dep at
  // build time — it's optional. If the user has not installed it the
  // require error surfaces with a clear remediation.
  const importer = new Function('return import("@anthropic-ai/sdk")') as () => Promise<{
    default?: unknown;
  }>;
  let mod: { default?: unknown };
  try {
    mod = await importer();
  } catch {
    throw new Error(
      'Anthropic provider selected but @anthropic-ai/sdk is not installed. Run `pnpm add -w @anthropic-ai/sdk` to enable.',
    );
  }
  const Ctor = (mod.default ?? mod) as new (opts: { apiKey: string }) => AnthropicSdkLike;
  return new Ctor({ apiKey });
}

async function buildArgs(
  config: ProviderConfig,
  req: ProviderRequest,
): Promise<AnthropicCreateArgs> {
  const model = req.model ?? config.model;
  const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;

  // Anthropic's API takes system as a top-level field. Collect every
  // role='system' message, join with blank lines.
  const sys: string[] = [];
  const turns: AnthropicCreateArgs['messages'] = [];
  // Anthropic correlates tool_use → tool_result via the tool_use_id inside
  // a user-role content array. Collect pending tool messages per assistant
  // turn so we can emit a matching user turn.
  let pendingTools: { id: string; output: string }[] = [];

  for (const m of req.messages) {
    if (m.role === 'system') {
      sys.push(m.content);
      continue;
    }
    if (m.role === 'tool') {
      pendingTools.push({ id: m.toolUseId ?? '', output: m.content });
      continue;
    }
    if (pendingTools.length > 0) {
      // Flush as a single user turn carrying tool_result blocks.
      const content = pendingTools.map((t) => ({
        type: 'tool_result' as const,
        tool_use_id: t.id,
        content: t.output,
      })) as unknown as AnthropicContentBlock[];
      turns.push({ role: 'user', content });
      pendingTools = [];
    }
    if (m.role === 'user') {
      // First user turn may carry the image.
      if (req.image && turns.length === 0) {
        const data = await fs.readFile(req.image.path);
        turns.push({
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: req.image.mimeType,
                data: data.toString('base64'),
              },
            },
            { type: 'text', text: m.content },
          ] as unknown as AnthropicContentBlock[],
        });
      } else {
        turns.push({ role: 'user', content: m.content });
      }
    } else if (m.role === 'assistant') {
      turns.push({ role: 'assistant', content: m.content });
    }
  }
  if (pendingTools.length > 0) {
    const content = pendingTools.map((t) => ({
      type: 'tool_result' as const,
      tool_use_id: t.id,
      content: t.output,
    })) as unknown as AnthropicContentBlock[];
    turns.push({ role: 'user', content });
  }

  const args: AnthropicCreateArgs = {
    model,
    max_tokens: maxTokens,
    messages: turns,
  };
  if (sys.length > 0) args.system = sys.join('\n\n');
  if (req.tools && req.tools.length > 0) {
    args.tools = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
    args.tool_choice = { type: 'auto' };
  }
  return args;
}

function collectText(content: AnthropicContentBlock[]): string {
  const parts: string[] = [];
  for (const c of content) if (c.type === 'text') parts.push(c.text);
  return parts.join('');
}

function makeDone(
  startedAt: number,
  usage: { input_tokens?: number; output_tokens?: number } | undefined,
  fallbackText = '',
): ProviderFrame {
  const out: ProviderFrame = { type: 'done', durationMs: Date.now() - startedAt };
  const u: { inputTokens?: number; outputTokens?: number } = {};
  if (typeof usage?.input_tokens === 'number') u.inputTokens = usage.input_tokens;
  if (typeof usage?.output_tokens === 'number') u.outputTokens = usage.output_tokens;
  if (Object.keys(u).length > 0) out.usage = u;
  if (fallbackText) out.text = fallbackText;
  return out;
}

function mapError(err: unknown): ProviderFrame {
  const message = err instanceof Error ? err.message : String(err);
  const status =
    (err as { status?: number; statusCode?: number }).status ??
    (err as { statusCode?: number }).statusCode;
  if (status === 401 || /authentication|invalid api key/i.test(message)) {
    return { type: 'error', reason: 'auth', message };
  }
  if (status === 429 || /rate limit/i.test(message)) {
    return { type: 'error', reason: 'rate-limit', message };
  }
  return { type: 'error', reason: 'generic', message };
}
