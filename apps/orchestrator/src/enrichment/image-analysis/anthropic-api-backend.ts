import { promises as fs } from 'node:fs';

import {
  IMAGE_ANALYSIS_OUTPUT_INSTRUCTION,
  type ImageAnalysisBackend,
  type ImageAnalysisBackendResult,
  type ImageAnalysisInput,
  parseImageAnalysisOutput,
} from './backend.js';

const MODEL_IDS: Record<ImageAnalysisInput['model'], string> = {
  opus: 'claude-opus-4-5',
  sonnet: 'claude-sonnet-4-5',
  haiku: 'claude-haiku-4-5',
};

/**
 * Direct Anthropic API backend. Loads `@anthropic-ai/sdk` dynamically so the
 * build still works when the package isn't installed (the claude-code
 * backend is the zero-dependency default). When the user picks
 * `anthropic-api` in SystemConfig, they must:
 *   1. `pnpm add -F @mnela/orchestrator @anthropic-ai/sdk`
 *   2. set `ANTHROPIC_API_KEY` in the orchestrator env
 *
 * Until the dep is installed this backend short-circuits to `unavailable`
 * with a clear instruction.
 */
export const anthropicApiImageBackend: ImageAnalysisBackend = {
  name: 'anthropic-api',
  async analyze(input: ImageAnalysisInput): Promise<ImageAnalysisBackendResult> {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      return {
        status: 'unavailable',
        reason:
          'attachments.imageAnalysisBackend=anthropic-api requires ANTHROPIC_API_KEY in the orchestrator environment',
      };
    }

    let Anthropic: unknown;
    try {
      // Hide the import behind `Function` so tsc doesn't try to resolve the
      // module at build time — keeps this file compiling when the optional
      // dep is absent (the claude-code backend is zero-deps).
      const importer = new Function('return import("@anthropic-ai/sdk")') as () => Promise<{
        default?: unknown;
      }>;
      const mod = await importer();
      Anthropic = mod.default ?? mod;
    } catch {
      return {
        status: 'unavailable',
        reason:
          'anthropic-api backend selected but @anthropic-ai/sdk is not installed — run `pnpm add -F @mnela/orchestrator @anthropic-ai/sdk` or switch to claude-code in /admin/system',
      };
    }

    const buf = await fs.readFile(input.attachmentPath);
    const base64 = buf.toString('base64');
    const mediaType = sanitizeMediaType(input.mimeType);
    const client = new (Anthropic as new (opts: { apiKey: string }) => {
      messages: {
        create(args: unknown): Promise<{ content: { type: string; text?: string }[] }>;
      };
    })({ apiKey });

    const response = await client.messages.create({
      model: MODEL_IDS[input.model],
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            { type: 'text', text: IMAGE_ANALYSIS_OUTPUT_INSTRUCTION },
          ],
        },
      ],
    });

    const text = response.content
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('\n');

    const parsed = parseImageAnalysisOutput(text);
    if (!parsed) return { status: 'failed', reason: 'unstructured-output' };
    return { status: 'ok', output: parsed };
  },
};

function sanitizeMediaType(mime: string): string {
  // Anthropic vision accepts jpeg/png/gif/webp. Coerce close cousins.
  if (mime === 'image/jpg') return 'image/jpeg';
  return mime;
}
