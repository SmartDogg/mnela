import { All, Controller, Logger, Req, Res } from '@nestjs/common';
import { McpInputError, McpScopeError, McpUnknownToolError, runTool } from '@mnela/mcp-tools';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { ToolsService } from '../tools/tools.service.js';

@Controller('mcp')
export class TransportController {
  private readonly logger = new Logger(TransportController.name);

  constructor(private readonly tools: ToolsService) {}

  @All()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const principal = req.principal;
    if (!principal) {
      res.status(500).json({ error: 'principal missing — auth middleware misconfigured' });
      return;
    }

    const ctx = this.tools.buildContext(principal);
    const principalLabel = principal.name ?? principal.id;

    const server = new McpServer(
      { name: 'mnela', version: '0.0.0' },
      { capabilities: { tools: {} } },
    );

    for (const tool of this.tools.getToolList()) {
      const inputShape = (tool.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: inputShape },
        async (args: unknown) => {
          const start = Date.now();
          try {
            const output = await runTool(tool, args, ctx);
            this.logger.log(
              `tool=${tool.name} principal=${principalLabel} ok ms=${Date.now() - start}`,
            );
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(output) }],
              structuredContent: output as Record<string, unknown>,
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const kind =
              err instanceof McpScopeError
                ? 'scope_denied'
                : err instanceof McpInputError
                  ? 'input_error'
                  : err instanceof McpUnknownToolError
                    ? 'unknown_tool'
                    : 'handler_error';
            this.logger.warn(
              `tool=${tool.name} principal=${principalLabel} fail kind=${kind} ms=${Date.now() - start}`,
            );
            return {
              isError: true,
              content: [{ type: 'text' as const, text: message }],
            };
          }
        },
      );
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on('close', () => {
      void server.close().catch(() => undefined);
      void transport.close().catch(() => undefined);
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      this.logger.error(err instanceof Error ? err.stack : String(err));
      if (!res.headersSent) {
        res.status(500).json({ error: 'mcp transport failure' });
      }
    }
  }
}
