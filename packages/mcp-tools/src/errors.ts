import type { ToolScope } from './registry.js';

export class McpScopeError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly required: ToolScope,
    public readonly actual: ToolScope,
  ) {
    super(`${toolName}: scope insufficient — required '${required}', got '${actual}'`);
    this.name = 'McpScopeError';
  }
}

export class McpInputError extends Error {
  constructor(toolName: string, detail: string) {
    super(`${toolName}: input validation failed: ${detail}`);
    this.name = 'McpInputError';
  }
}

export class McpUnknownToolError extends Error {
  constructor(toolName: string) {
    super(`unknown tool: ${toolName}`);
    this.name = 'McpUnknownToolError';
  }
}
