/**
 * Multi-turn tool-use loop for non-CLI providers.
 *
 * The Claude Code subprocess handles tool use internally — it spawns the
 * MCP stdio host, asks the model to call tools, executes them, feeds
 * results back, all without us doing anything. For AnthropicApiProvider
 * and OpenAiCompatibleProvider we do that work here so /ask and enrichment
 * stay tool-grounded against the same `@mnela/mcp-tools` registry.
 *
 * Flow:
 *
 *   user prompt ──► provider.stream(messages, tools)
 *                       │
 *                       ├── token frames ──► forwarded to caller
 *                       ├── tool_call frame ──► invokeTool(name, input, ctx)
 *                       │                       └─► append tool result to
 *                       │                          messages, re-enter loop
 *                       └── done with no tool_call ──► forward final done
 *
 * We bound the loop at MAX_TURNS so a misbehaving model can't burn through
 * the API budget. The caller's `signal` aborts every in-flight request.
 */

import type { McpToolContext, ToolDefinition } from '@mnela/mcp-tools';
import { invokeTool } from '@mnela/mcp-tools';

import { toolDefinitionToProviderTool } from './tool-schema.js';
import type {
  LLMProvider,
  ProviderFrame,
  ProviderMessage,
  ProviderRequest,
  ProviderTool,
} from './types.js';

const MAX_TURNS = 8;

export interface AgentLoopInput {
  provider: LLMProvider;
  messages: ProviderMessage[];
  toolDefinitions: readonly ToolDefinition<unknown, unknown>[];
  toolContext: McpToolContext;
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxTokens?: number;
  maxTurns?: number;
}

/**
 * Drive a provider through tool turns until it produces a final answer
 * (or hits the turn cap / abort / error). Yields the same ProviderFrame
 * union as a single provider call — the api SSE layer doesn't need to know
 * whether it's reading from a single turn or a multi-turn loop.
 */
export async function* runAgentLoop(input: AgentLoopInput): AsyncGenerator<ProviderFrame> {
  const tools: ProviderTool[] = input.toolDefinitions.map((d) =>
    toolDefinitionToProviderTool({
      name: d.name,
      description: d.description,
      inputSchema: d.inputSchema,
    }),
  );
  const registry = buildToolRegistry(input.toolDefinitions);
  const messages = [...input.messages];

  const maxTurns = input.maxTurns ?? MAX_TURNS;
  let finalText = '';

  for (let turn = 0; turn < maxTurns; turn++) {
    const turnAssistantText: string[] = [];
    const pendingCalls: { id: string; name: string; input: unknown }[] = [];
    let turnEndedWithDone = false;
    let turnError: ProviderFrame | null = null;

    const req: ProviderRequest = {
      messages,
      tools,
    };
    if (input.model) req.model = input.model;
    if (input.signal) req.signal = input.signal;
    if (input.timeoutMs) req.timeoutMs = input.timeoutMs;
    if (input.maxTokens) req.maxTokens = input.maxTokens;

    for await (const frame of input.provider.stream(req)) {
      if (frame.type === 'start') {
        if (turn === 0) yield frame;
        continue;
      }
      if (frame.type === 'token') {
        turnAssistantText.push(frame.delta);
        finalText += frame.delta;
        yield frame;
        continue;
      }
      if (frame.type === 'tool_call') {
        pendingCalls.push({ id: frame.id, name: frame.name, input: frame.input });
        yield frame;
        continue;
      }
      if (frame.type === 'tool_result') {
        // Providers we use don't emit tool_result themselves (the loop runs
        // it), so this is informational. Forward for the chat timeline.
        yield frame;
        continue;
      }
      if (frame.type === 'done') {
        turnEndedWithDone = true;
        if (pendingCalls.length === 0) {
          // No tools requested — we're done. Forward as the final frame.
          const out: ProviderFrame = { type: 'done', text: finalText };
          if (frame.usage) out.usage = frame.usage;
          if (typeof frame.durationMs === 'number') out.durationMs = frame.durationMs;
          yield out;
          return;
        }
        // Otherwise: keep the assistant's text + tool_use blocks, run the
        // tools, append results, loop.
        break;
      }
      if (frame.type === 'error') {
        turnError = frame;
        break;
      }
    }

    if (turnError) {
      yield turnError;
      return;
    }
    if (!turnEndedWithDone) {
      yield {
        type: 'error',
        reason: 'generic',
        message: 'provider stream ended without done or error',
      };
      return;
    }

    // Append the assistant turn (text + the tool_use markers) and a tool
    // message per executed call so the next turn sees them.
    const assistantContent = turnAssistantText.join('').trim();
    if (assistantContent.length > 0 || pendingCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: assistantContent,
      });
    }
    for (const call of pendingCalls) {
      const tool = registry.get(call.name);
      let toolResult: unknown;
      let toolOk = true;
      let toolErr: string | undefined;
      if (!tool) {
        toolOk = false;
        toolErr = `unknown tool: ${call.name}`;
      } else {
        try {
          toolResult = await invokeTool(call.name, call.input, input.toolContext);
        } catch (err) {
          toolOk = false;
          toolErr = err instanceof Error ? err.message : String(err);
        }
      }

      const resultFrame: ProviderFrame = {
        type: 'tool_result',
        id: call.id,
        name: call.name,
        ok: toolOk,
      };
      if (toolOk) {
        resultFrame.output = toolResult;
      } else if (toolErr) {
        resultFrame.error = toolErr;
      }
      yield resultFrame;

      messages.push({
        role: 'tool',
        toolUseId: call.id,
        toolName: call.name,
        content: toolOk ? safeStringify(toolResult) : `error: ${toolErr ?? 'unknown'}`,
      });
    }
  }

  yield {
    type: 'error',
    reason: 'generic',
    message: `agent loop exceeded ${maxTurns} turns without finishing`,
  };
}

/**
 * Build a `name → ToolDefinition` map for fast lookup inside the agent
 * loop. Exposed so the api/orchestrator can construct it once per request
 * and pass it through to AnthropicApi / OpenAiCompat providers when they
 * want to short-circuit registry rebuilds.
 */
export function buildToolRegistry(
  defs: readonly ToolDefinition<unknown, unknown>[],
): ReadonlyMap<string, ToolDefinition<unknown, unknown>> {
  const m = new Map<string, ToolDefinition<unknown, unknown>>();
  for (const d of defs) m.set(d.name, d);
  return m;
}

function safeStringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
