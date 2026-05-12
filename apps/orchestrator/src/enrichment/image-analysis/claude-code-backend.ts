import { runClaude } from '@mnela/claude-runner';

import { loadEnv, mcpConfigPath, vaultDir } from '../../env.js';
import {
  IMAGE_ANALYSIS_OUTPUT_INSTRUCTION,
  type ImageAnalysisBackend,
  type ImageAnalysisBackendResult,
  type ImageAnalysisInput,
  parseImageAnalysisOutput,
} from './backend.js';

/**
 * Claude-Code backend — reuses the same subprocess + MCP wiring that text
 * enrichment goes through (so it shares the ADR-0027 single Claude slot).
 * Claude Code reads the image file from disk and emits structured JSON.
 */
export const claudeCodeImageBackend: ImageAnalysisBackend = {
  name: 'claude-code',
  async analyze(input: ImageAnalysisInput): Promise<ImageAnalysisBackendResult> {
    const env = loadEnv();
    const prompt = buildPrompt(input);
    const result = await runClaude({
      prompt,
      mcpConfig: mcpConfigPath(env),
      addDirs: [vaultDir(env)],
      bin: env.MNELA_CLAUDE_BIN,
      timeoutMs: env.MNELA_CLAUDE_TIMEOUT_MS,
      outputFormat: 'stream-json',
      env: {
        DATABASE_URL: env.DATABASE_URL,
        REDIS_URL: env.REDIS_URL,
        MNELA_DATA_DIR: env.MNELA_DATA_DIR,
        MNELA_LOG_LEVEL: env.MNELA_LOG_LEVEL,
      },
    });

    if (result.rateLimitHit) {
      return { status: 'unavailable', reason: 'rate-limit' };
    }
    if (result.authError) {
      return { status: 'unavailable', reason: result.authError };
    }
    if (result.exitCode !== 0 || result.timedOut) {
      return {
        status: 'failed',
        reason: result.timedOut ? 'timeout' : `exit ${result.exitCode}`,
      };
    }

    const parsed = parseImageAnalysisOutput(result.result?.result ?? '');
    if (!parsed) {
      return { status: 'failed', reason: 'unstructured-output' };
    }
    return { status: 'ok', output: parsed };
  },
};

function buildPrompt(input: ImageAnalysisInput): string {
  return [
    `You are analyzing an image attachment for the Mnela knowledge graph.`,
    ``,
    `Read the image at this path:`,
    `  ${input.attachmentPath}`,
    `MIME type: ${input.mimeType}`,
    `Companion Document id (for trace only — DO NOT call any MCP tool, just emit JSON):`,
    `  ${input.documentId}`,
    ``,
    `Describe what you see. Extract people, organizations, products, technologies, concepts and any other entities visible. Be conservative: only include an entity if you are reasonably confident it is genuinely depicted (vs. coincidentally pattern-matched).`,
    ``,
    IMAGE_ANALYSIS_OUTPUT_INSTRUCTION,
  ].join('\n');
}
