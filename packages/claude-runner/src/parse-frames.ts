import type { ClaudeFrame } from './types.js';

export function parseFrame(line: string): ClaudeFrame | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj: unknown = JSON.parse(trimmed);
    if (
      typeof obj === 'object' &&
      obj !== null &&
      typeof (obj as { type?: unknown }).type === 'string'
    ) {
      return obj as ClaudeFrame;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseStream(stdout: string): ClaudeFrame[] {
  const out: ClaudeFrame[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const frame = parseFrame(line);
    if (frame) out.push(frame);
  }
  return out;
}

/**
 * `--output-format json` produces a single object (not NDJSON). Wrap it in a
 * one-element array shaped like a result frame so the rest of the pipeline
 * works uniformly.
 */
export function parseSingleJson(stdout: string): ClaudeFrame[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try {
    const obj: unknown = JSON.parse(trimmed);
    if (typeof obj === 'object' && obj !== null) {
      const withType = obj as Record<string, unknown>;
      if (typeof withType['type'] !== 'string') withType['type'] = 'result';
      return [withType as unknown as ClaudeFrame];
    }
    return [];
  } catch {
    return [];
  }
}
