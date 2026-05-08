import type { z } from 'zod';

import type { McpToolContext } from './context.js';
import { ADD_ENTITIES_TOOL, addEntities } from './tools/add-entities.js';
import { ADD_LINKS_TOOL, addLinks } from './tools/add-links.js';
import { FIND_SIMILAR_TOOL, findSimilar } from './tools/find-similar.js';
import { GET_DOCUMENT_TOOL, getDocument } from './tools/get-document.js';

export type ToolScope = 'admin' | 'mcp' | 'read_only';

export interface ToolDefinition<I, O> {
  name: string;
  description: string;
  scope: ToolScope;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  handler: (input: I, ctx: McpToolContext) => Promise<O>;
}

function defineTool<I, O>(
  meta: {
    name: string;
    description: string;
    scope: ToolScope;
    inputSchema: z.ZodType<I>;
    outputSchema: z.ZodType<O>;
  },
  handler: (input: I, ctx: McpToolContext) => Promise<O>,
): ToolDefinition<I, O> {
  return { ...meta, handler };
}

export const PHASE_5_TOOLS: readonly ToolDefinition<unknown, unknown>[] = [
  defineTool(GET_DOCUMENT_TOOL, getDocument) as ToolDefinition<unknown, unknown>,
  defineTool(FIND_SIMILAR_TOOL, findSimilar) as ToolDefinition<unknown, unknown>,
  defineTool(ADD_ENTITIES_TOOL, addEntities) as ToolDefinition<unknown, unknown>,
  defineTool(ADD_LINKS_TOOL, addLinks) as ToolDefinition<unknown, unknown>,
];

export function findTool(name: string): ToolDefinition<unknown, unknown> | undefined {
  return PHASE_5_TOOLS.find((t) => t.name === name);
}

export async function invokeTool(
  name: string,
  rawInput: unknown,
  ctx: McpToolContext,
): Promise<unknown> {
  const tool = findTool(name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(`${name}: input validation failed: ${parsed.error.message}`);
  }
  const output = await tool.handler(parsed.data, ctx);
  return tool.outputSchema.parse(output);
}
