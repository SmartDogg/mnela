import { scopeAllows } from '@mnela/db';
import type { z } from 'zod';

import type { McpToolContext } from './context.js';
import { McpInputError, McpScopeError, McpUnknownToolError } from './errors.js';
import { ADD_ENTITIES_TOOL, addEntities } from './tools/add-entities.js';
import { ADD_LINKS_TOOL, addLinks } from './tools/add-links.js';
import { ARCHIVE_DOCUMENT_TOOL, archiveDocument } from './tools/archive-document.js';
import { FIND_SIMILAR_TOOL, findSimilar } from './tools/find-similar.js';
import { GET_CHUNKS_TOOL, getChunks } from './tools/get-chunks.js';
import { GET_DAILY_NOTE_TOOL, getDailyNote } from './tools/get-daily-note.js';
import { GET_DECISIONS_TOOL, getDecisions } from './tools/get-decisions.js';
import { GET_DOCUMENT_TOOL, getDocument } from './tools/get-document.js';
import { GET_ENTITY_TOOL, getEntity } from './tools/get-entity.js';
import { GET_PROJECT_CONTEXT_TOOL, getProjectContext } from './tools/get-project-context.js';
import { LIST_PROJECTS_TOOL, listProjects } from './tools/list-projects.js';
import { RECENT_ACTIVITY_TOOL, recentActivity } from './tools/recent-activity.js';
import { SAVE_DECISION_TOOL, saveDecision } from './tools/save-decision.js';
import { SAVE_NOTE_TOOL, saveNote } from './tools/save-note.js';
import { SEARCH_TOOL, search } from './tools/search.js';
import { TRAVERSE_GRAPH_TOOL, traverseGraph } from './tools/traverse-graph.js';
import {
  UPDATE_PROJECT_CONTEXT_TOOL,
  updateProjectContext,
} from './tools/update-project-context.js';

export type ToolScope = 'admin' | 'mcp' | 'read_only';

export interface ToolAuditMeta {
  action: string;
  targetType: string;
  targetIdFrom: 'input' | 'output';
  targetIdPath: string;
}

export interface ToolDefinition<I, O> {
  name: string;
  description: string;
  scope: ToolScope;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  handler: (input: I, ctx: McpToolContext) => Promise<O>;
  audit?: ToolAuditMeta;
}

function defineTool<I, O>(
  meta: {
    name: string;
    description: string;
    scope: ToolScope;
    inputSchema: z.ZodType<I>;
    outputSchema: z.ZodType<O>;
    audit?: ToolAuditMeta;
  },
  handler: (input: I, ctx: McpToolContext) => Promise<O>,
): ToolDefinition<I, O> {
  return { ...meta, handler };
}

// Phase 5 tools (4) + Phase 6 read tools (9) so far. The full registry name is
// retained for backward compat with consumers that imported PHASE_5_TOOLS.
export const PHASE_5_TOOLS: readonly ToolDefinition<unknown, unknown>[] = [
  defineTool(GET_DOCUMENT_TOOL, getDocument) as ToolDefinition<unknown, unknown>,
  defineTool(FIND_SIMILAR_TOOL, findSimilar) as ToolDefinition<unknown, unknown>,
  defineTool(ADD_ENTITIES_TOOL, addEntities) as ToolDefinition<unknown, unknown>,
  defineTool(ADD_LINKS_TOOL, addLinks) as ToolDefinition<unknown, unknown>,
  defineTool(SEARCH_TOOL, search) as ToolDefinition<unknown, unknown>,
  defineTool(GET_CHUNKS_TOOL, getChunks) as ToolDefinition<unknown, unknown>,
  defineTool(LIST_PROJECTS_TOOL, listProjects) as ToolDefinition<unknown, unknown>,
  defineTool(GET_PROJECT_CONTEXT_TOOL, getProjectContext) as ToolDefinition<unknown, unknown>,
  defineTool(GET_DECISIONS_TOOL, getDecisions) as ToolDefinition<unknown, unknown>,
  defineTool(GET_ENTITY_TOOL, getEntity) as ToolDefinition<unknown, unknown>,
  defineTool(TRAVERSE_GRAPH_TOOL, traverseGraph) as ToolDefinition<unknown, unknown>,
  defineTool(GET_DAILY_NOTE_TOOL, getDailyNote) as ToolDefinition<unknown, unknown>,
  defineTool(RECENT_ACTIVITY_TOOL, recentActivity) as ToolDefinition<unknown, unknown>,
  defineTool(SAVE_NOTE_TOOL, saveNote) as ToolDefinition<unknown, unknown>,
  defineTool(SAVE_DECISION_TOOL, saveDecision) as ToolDefinition<unknown, unknown>,
  defineTool(UPDATE_PROJECT_CONTEXT_TOOL, updateProjectContext) as ToolDefinition<unknown, unknown>,
  defineTool(ARCHIVE_DOCUMENT_TOOL, archiveDocument) as ToolDefinition<unknown, unknown>,
];

export function findTool(name: string): ToolDefinition<unknown, unknown> | undefined {
  return PHASE_5_TOOLS.find((t) => t.name === name);
}

function resolveTargetId(audit: ToolAuditMeta, input: unknown, output: unknown): string {
  const source = audit.targetIdFrom === 'input' ? input : output;
  if (!source || typeof source !== 'object') return 'unknown';
  const value = audit.targetIdPath.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, source);
  return typeof value === 'string' ? value : 'unknown';
}

function actorString(ctx: McpToolContext): string {
  const { principal } = ctx;
  return `${principal.kind}:${principal.name ?? principal.id}`;
}

export async function runTool<I, O>(
  tool: ToolDefinition<I, O>,
  rawInput: unknown,
  ctx: McpToolContext,
): Promise<O> {
  if (!scopeAllows(ctx.principal.scope, tool.scope)) {
    throw new McpScopeError(tool.name, tool.scope, ctx.principal.scope);
  }

  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) throw new McpInputError(tool.name, parsed.error.message);

  const audit = tool.audit;
  if (!audit) {
    const output = await tool.handler(parsed.data, ctx);
    return tool.outputSchema.parse(output);
  }

  return ctx.auditTx(async () => {
    const output = await tool.handler(parsed.data, ctx);
    await ctx.audit.create({
      action: audit.action,
      actor: actorString(ctx),
      targetType: audit.targetType,
      targetId: resolveTargetId(audit, parsed.data, output),
    });
    return tool.outputSchema.parse(output);
  });
}

export async function invokeTool(
  name: string,
  rawInput: unknown,
  ctx: McpToolContext,
): Promise<unknown> {
  const tool = findTool(name);
  if (!tool) throw new McpUnknownToolError(name);
  return runTool(tool, rawInput, ctx);
}
