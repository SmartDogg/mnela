/**
 * Vision-pipeline output shape and parser.
 *
 * The previous per-backend `backend.ts` split has been collapsed: vision now
 * goes through the unified LLMProvider abstraction (ADR-0049). Both built-in
 * Claude CLI and any database-configured Anthropic/OpenAI-compatible
 * provider answer the same JSON schema described by IMAGE_ANALYSIS_OUTPUT_INSTRUCTION.
 */

import type { EntityType } from '@prisma/client';

export interface ImageAnalysisOutput {
  description: string;
  /** Null if no readable text was visible. */
  ocrText: string | null;
  entities: ImageEntity[];
}

export interface ImageEntity {
  name: string;
  type: EntityType;
  confidence: number;
  aliases?: string[];
}

export const IMAGE_ANALYSIS_OUTPUT_INSTRUCTION = `Respond with **exactly one** JSON object — no markdown fence, no preamble — with this shape:

{
  "description": "1-3 paragraphs describing the image content, mood, subjects, and any relevant detail",
  "ocrText": "verbatim text visible in the image, joined by newlines; null when none",
  "entities": [
    { "name": "string", "type": "person|organization|technology|concept|product|service|project|bug|feature|custom", "confidence": 0.0-1.0, "aliases": ["optional"] }
  ]
}

Confidence below 0.5 is dropped server-side. Limit entities to 20. Use \`null\` (not \`""\`) for ocrText when nothing is readable.`;

const STRUCTURED_RE = /\{[\s\S]*"description"[\s\S]*\}/;

export function parseImageAnalysisOutput(raw: string): ImageAnalysisOutput | null {
  const match = STRUCTURED_RE.exec(raw);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const description = typeof obj['description'] === 'string' ? obj['description'].trim() : '';
    if (!description) return null;
    const ocrText =
      typeof obj['ocrText'] === 'string' && obj['ocrText'].trim().length > 0
        ? obj['ocrText']
        : null;
    const entitiesRaw = Array.isArray(obj['entities']) ? obj['entities'] : [];
    const entities: ImageEntity[] = [];
    for (const e of entitiesRaw) {
      if (!e || typeof e !== 'object') continue;
      const ent = e as Record<string, unknown>;
      const name = typeof ent['name'] === 'string' ? ent['name'].trim() : '';
      const type = typeof ent['type'] === 'string' ? (ent['type'] as EntityType) : null;
      const confidence = typeof ent['confidence'] === 'number' ? ent['confidence'] : 0;
      if (!name || !type) continue;
      entities.push({
        name,
        type,
        confidence,
        ...(Array.isArray(ent['aliases'])
          ? { aliases: ent['aliases'].filter((a): a is string => typeof a === 'string') }
          : {}),
      });
    }
    return { description, ocrText, entities };
  } catch {
    return null;
  }
}
