#!/usr/bin/env node
/**
 * Mnela MCP server (stdio transport).
 *
 * `claude -p ... --mcp-config <file>` spawns this script as a child; we wire
 * `@mnela/mcp-tools` registry to a fresh Prisma client + ioredis connection +
 * a search adapter, then expose them through `@modelcontextprotocol/sdk`.
 *
 * The script lives standalone — no Nest DI — because the parent claude
 * process owns the lifecycle and we want fast cold-start.
 */
import 'reflect-metadata';

import {
  AuditLogRepository,
  DocumentEntityRepository,
  DocumentRepository,
  EdgeRepository,
  EntityRepository,
  InboxRepository,
  type Principal,
} from '@mnela/db';
import { type McpToolContext, PHASE_5_TOOLS, type ToolDefinition } from '@mnela/mcp-tools';
import { publishEvent } from '@mnela/queue';
import { HybridSearchAdapter } from '@mnela/search';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { z } from 'zod';

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  const redisUrl = process.env['REDIS_URL'];
  if (!databaseUrl) throw new Error('mnela-stdio: DATABASE_URL is required');
  if (!redisUrl) throw new Error('mnela-stdio: REDIS_URL is required');

  const prisma = new PrismaClient();
  await prisma.$connect();
  const redis = new Redis(redisUrl, { lazyConnect: true });
  await redis.connect();

  const documents = new DocumentRepository(() => prisma);
  const entities = new EntityRepository(() => prisma);
  const edges = new EdgeRepository(() => prisma);
  const documentEntities = new DocumentEntityRepository(() => prisma);
  const inbox = new InboxRepository(() => prisma);
  const audit = new AuditLogRepository(() => prisma);
  const search = new HybridSearchAdapter(() => prisma);

  const principal: Principal = {
    kind: 'token',
    id: 'system:orchestrator',
    name: 'orchestrator',
    scope: 'mcp',
  };

  const ctx: McpToolContext = {
    documents,
    entities,
    edges,
    documentEntities,
    inbox,
    audit,
    auditTx: (fn) => prisma.$transaction((tx) => fn(tx)),
    principal,
    search: {
      findSimilar: async (text, limit) => {
        const trimmed = text.length > 600 ? text.slice(0, 600) : text;
        const result = await search.search({ query: trimmed, page: 1, limit });
        return result.hits.map((h) => {
          const out: { documentId: string; title: string; snippet?: string; score: number } = {
            documentId: h.documentId,
            title: h.title,
            score: h.score,
          };
          if (h.snippet) out.snippet = h.snippet;
          return out;
        });
      },
    },
    events: {
      graphNodeAdded: (entity) =>
        publishEvent(redis, { type: 'graph.node_added', payload: { entity } }).then(
          () => undefined,
        ),
      graphEdgeAdded: (edge) =>
        publishEvent(redis, { type: 'graph.edge_added', payload: { edge } }).then(() => undefined),
      inboxItemAdded: (item) =>
        publishEvent(redis, { type: 'inbox.item_added', payload: item }).then(() => undefined),
    },
  };

  const server = new McpServer(
    { name: 'mnela', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );

  for (const tool of PHASE_5_TOOLS) {
    registerToolOnServer(server, tool, ctx);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async (): Promise<void> => {
    await server.close().catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

function registerToolOnServer(
  server: McpServer,
  tool: ToolDefinition<unknown, unknown>,
  ctx: McpToolContext,
): void {
  const inputShape = (tool.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: inputShape,
    },
    async (args: unknown) => {
      try {
        const validated = tool.inputSchema.parse(args);
        const output = await tool.handler(validated, ctx);
        const text = JSON.stringify(output);
        return {
          content: [{ type: 'text' as const, text }],
          structuredContent: output as Record<string, unknown>,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: message }],
        };
      }
    },
  );
}

main().catch((err) => {
  // stdout is reserved for MCP frames — never log to it.
  process.stderr.write(
    `mnela stdio-host failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
