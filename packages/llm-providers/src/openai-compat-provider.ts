/**
 * OpenAiCompatibleProvider — any backend speaking OpenAI's chat/completions
 * surface. Configured by:
 *   - `baseUrl`     — e.g. https://api.openai.com/v1, https://api.deepseek.com/v1,
 *                     https://generativelanguage.googleapis.com/v1beta/openai
 *                     https://openrouter.ai/api/v1, http://localhost:11434/v1 (Ollama)
 *   - `apiKey`      — bearer token; empty for local Ollama if no auth proxy
 *   - `model`       — backend-specific id (gpt-4o-mini, deepseek-chat,
 *                     llama3.1, …)
 *   - `extra.headers` — optional dictionary merged into request headers
 *
 * Streaming follows the OpenAI SSE format (`data: {...}\n\n`, terminated
 * with `data: [DONE]`). Tool calls arrive incrementally in `choices[].delta
 * .tool_calls[]` slots; we accumulate per index and emit a `tool_call`
 * frame when the model signals `finish_reason=tool_calls`.
 *
 * Vision: passes a single `image_url` block alongside the text content of
 * the last user message. Works against OpenAI vision models, OpenRouter's
 * vision-capable routes, Ollama LLaVA, etc. Backends that don't accept
 * image content simply ignore it.
 */

import { promises as fs } from 'node:fs';

import type {
  LLMProvider,
  ProviderConfig,
  ProviderFrame,
  ProviderRequest,
  ProviderTestResult,
  ProviderTool,
} from './types.js';

const DEFAULT_MAX_TOKENS = 4096;

type OaiMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string | OaiContentPart[] }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: {
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

type OaiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface OaiToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface OaiBody {
  model: string;
  messages: OaiMessage[];
  max_tokens: number;
  stream?: boolean;
  tools?: OaiToolDef[];
  tool_choice?: 'auto' | 'none';
}

export class OpenAiCompatibleProvider implements LLMProvider {
  readonly supportsTools = true;
  readonly supportsVision = true;

  constructor(readonly config: ProviderConfig) {
    if (!config.baseUrl) {
      throw new Error('OpenAiCompatibleProvider requires baseUrl in config');
    }
    if (!config.model) {
      throw new Error('OpenAiCompatibleProvider requires model in config');
    }
  }

  async *stream(req: ProviderRequest): AsyncGenerator<ProviderFrame> {
    const t0 = Date.now();
    let body: OaiBody;
    try {
      body = await buildBody(this.config, req);
    } catch (err) {
      yield {
        type: 'error',
        reason: 'generic',
        message: err instanceof Error ? err.message : String(err),
      };
      return;
    }
    body.stream = true;

    yield { type: 'start', model: body.model };

    const url = joinUrl(this.config.baseUrl!, 'chat/completions');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    if (this.config.apiKey) headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    const extra = (this.config.extra?.['headers'] ?? {}) as Record<string, string>;
    Object.assign(headers, extra);

    const ac = new AbortController();
    const onAbort = (): void => ac.abort();
    if (req.signal) {
      if (req.signal.aborted) onAbort();
      else req.signal.addEventListener('abort', onAbort, { once: true });
    }
    const timeout = setTimeout(() => ac.abort(), req.timeoutMs ?? 180_000);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if (req.signal?.aborted) {
        yield { type: 'error', reason: 'aborted' };
      } else {
        yield {
          type: 'error',
          reason: 'unavailable',
          message: err instanceof Error ? err.message : String(err),
        };
      }
      if (req.signal) req.signal.removeEventListener('abort', onAbort);
      return;
    }

    if (!res.ok) {
      clearTimeout(timeout);
      const errText = await res.text().catch(() => '');
      yield mapStatusError(res.status, errText);
      if (req.signal) req.signal.removeEventListener('abort', onAbort);
      return;
    }

    if (!res.body) {
      clearTimeout(timeout);
      yield { type: 'error', reason: 'generic', message: 'no response body' };
      return;
    }

    let buffer = '';
    const pendingCalls = new Map<number, { id: string; name: string; args: string }>();
    let usage: { input_tokens?: number; output_tokens?: number } | undefined;
    let finishReason: string | null = null;
    let finalText = '';

    try {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE: events separated by `\n\n`; each `data: <json>`. `[DONE]` ends.
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, sep).trim();
          buffer = buffer.slice(sep + 2);
          if (!raw.startsWith('data:')) continue;
          const payload = raw.slice(5).trim();
          if (payload === '[DONE]') {
            break;
          }
          let chunk: {
            choices?: {
              index?: number;
              delta?: {
                content?: string | null;
                tool_calls?: {
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }[];
              };
              finish_reason?: string | null;
            }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue;
          }
          const choice = chunk.choices?.[0];
          const delta = choice?.delta;
          if (typeof delta?.content === 'string' && delta.content.length > 0) {
            finalText += delta.content;
            yield { type: 'token', delta: delta.content };
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const acc = pendingCalls.get(tc.index) ?? { id: '', name: '', args: '' };
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name = tc.function.name;
              if (tc.function?.arguments) acc.args += tc.function.arguments;
              pendingCalls.set(tc.index, acc);
            }
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (chunk.usage) {
            usage = {
              input_tokens: chunk.usage.prompt_tokens,
              output_tokens: chunk.usage.completion_tokens,
            };
          }
        }
      }
    } catch (err) {
      clearTimeout(timeout);
      if (req.signal?.aborted) {
        yield { type: 'error', reason: 'aborted' };
      } else {
        yield {
          type: 'error',
          reason: 'generic',
          message: err instanceof Error ? err.message : String(err),
        };
      }
      if (req.signal) req.signal.removeEventListener('abort', onAbort);
      return;
    }
    clearTimeout(timeout);
    if (req.signal) req.signal.removeEventListener('abort', onAbort);

    if (finishReason === 'tool_calls' && pendingCalls.size > 0) {
      // Emit a tool_call frame per accumulated call. Agent loop picks them up.
      for (const [, call] of pendingCalls) {
        let input: unknown = {};
        if (call.args.length > 0) {
          try {
            input = JSON.parse(call.args);
          } catch {
            input = { _raw: call.args };
          }
        }
        yield { type: 'tool_call', id: call.id, name: call.name, input };
      }
    }

    const done: ProviderFrame = { type: 'done', durationMs: Date.now() - t0 };
    if (finalText) done.text = finalText;
    const u: { inputTokens?: number; outputTokens?: number } = {};
    if (typeof usage?.input_tokens === 'number') u.inputTokens = usage.input_tokens;
    if (typeof usage?.output_tokens === 'number') u.outputTokens = usage.output_tokens;
    if (Object.keys(u).length > 0) done.usage = u;
    yield done;
  }

  async test(): Promise<ProviderTestResult> {
    const t0 = Date.now();
    try {
      const url = joinUrl(this.config.baseUrl!, 'chat/completions');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.config.apiKey) headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'reply with the single word: ok' }],
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return {
          ok: false,
          latencyMs: Date.now() - t0,
          error: `HTTP ${res.status}${txt ? `: ${txt.slice(0, 200)}` : ''}`,
        };
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = json.choices?.[0]?.message?.content ?? '';
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

async function buildBody(config: ProviderConfig, req: ProviderRequest): Promise<OaiBody> {
  const model = req.model ?? config.model;
  const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;
  const messages: OaiMessage[] = [];

  let imageAttached = false;
  for (const m of req.messages) {
    if (m.role === 'system') {
      messages.push({ role: 'system', content: m.content });
    } else if (m.role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: m.toolUseId ?? '',
        content: m.content,
      });
    } else if (m.role === 'assistant') {
      messages.push({ role: 'assistant', content: m.content });
    } else if (m.role === 'user') {
      if (req.image && !imageAttached) {
        const data = await fs.readFile(req.image.path);
        const dataUrl = `data:${req.image.mimeType};base64,${data.toString('base64')}`;
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: m.content },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        });
        imageAttached = true;
      } else {
        messages.push({ role: 'user', content: m.content });
      }
    }
  }

  const body: OaiBody = { model, messages, max_tokens: maxTokens };
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools.map(toFunctionDef);
    body.tool_choice = 'auto';
  }
  return body;
}

function toFunctionDef(tool: ProviderTool): OaiToolDef {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function joinUrl(base: string, suffix: string): string {
  const b = base.replace(/\/+$/, '');
  const s = suffix.replace(/^\/+/, '');
  return `${b}/${s}`;
}

function mapStatusError(status: number, body: string): ProviderFrame {
  if (status === 401 || status === 403) {
    return { type: 'error', reason: 'auth', message: body.slice(0, 200) };
  }
  if (status === 429) {
    return { type: 'error', reason: 'rate-limit', message: body.slice(0, 200) };
  }
  return { type: 'error', reason: 'generic', message: `HTTP ${status}: ${body.slice(0, 200)}` };
}
