import { completeProvider } from '@mnela/llm-providers';
import { Injectable, Logger } from '@nestjs/common';

import { OrchestratorProvidersService } from '../providers/providers.service.js';
import { type SuggestionCandidate, buildHeuristicName } from './detector.js';

export interface SuggestionName {
  name: string;
  description: string;
  /** True iff the result came from a successful LLM call. */
  fromLlm: boolean;
}

/**
 * One-shot Haiku-class naming call for a suggestion candidate. We:
 *   1. Bound the input ruthlessly (top-N entity names + ≤ 5 sample titles)
 *   2. Ask the model for a short JSON object with `name` and `description`
 *   3. Fall back to the heuristic name on any parse error / provider failure
 *
 * The caller is responsible for gating this on
 * `projects.suggestions.enabled`. The naming service is happy to be invoked
 * standalone (e.g. from /projects/:slug "Refresh name" later).
 */
@Injectable()
export class SuggestionNamer {
  private readonly logger = new Logger(SuggestionNamer.name);

  constructor(private readonly providers: OrchestratorProvidersService) {}

  async nameCandidate(candidate: SuggestionCandidate): Promise<SuggestionName> {
    const fallback = buildHeuristicName(candidate);
    let provider;
    try {
      provider = await this.providers.resolveForFeature('projectSuggest');
    } catch (err) {
      this.logger.warn(
        `provider resolve failed for project-suggest: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ...fallback, fromLlm: false };
    }

    const prompt = buildPrompt(candidate);
    try {
      const { text, final } = await completeProvider(provider, {
        messages: [
          {
            role: 'system',
            content:
              'You name proposed knowledge-base projects. Reply with a single compact JSON object: ' +
              '{"name": "<3-6 words>", "description": "<1 paragraph, ≤ 280 chars>"}. No prose outside JSON.',
          },
          { role: 'user', content: prompt },
        ],
        maxTokens: 400,
        timeoutMs: 60_000,
      });
      if (final.type === 'error') {
        this.logger.debug(`naming error: ${final.reason} ${final.message ?? ''}`);
        return { ...fallback, fromLlm: false };
      }
      const parsed = extractJson(text);
      if (!parsed) {
        return { ...fallback, fromLlm: false };
      }
      const name = sanitizeName(parsed.name) ?? fallback.name;
      const description = sanitizeDescription(parsed.description) ?? fallback.description;
      return { name, description, fromLlm: true };
    } catch (err) {
      this.logger.warn(`naming call threw: ${err instanceof Error ? err.message : String(err)}`);
      return { ...fallback, fromLlm: false };
    }
  }
}

function buildPrompt(candidate: SuggestionCandidate): string {
  const entities = candidate.topEntityNames.slice(0, 6).join(', ');
  const titles = candidate.sampleTitles
    .slice(0, 5)
    .map((t) => `- ${t}`)
    .join('\n');
  const origin =
    candidate.kind === 'batch'
      ? `These ${candidate.docCount} documents arrived in the same import batch.`
      : `These ${candidate.docCount} documents share top entities across the user's whole knowledge base.`;
  return [
    origin,
    `Top entities: ${entities || '(none)'}.`,
    'Sample document titles:',
    titles || '(no titles)',
    '',
    'Propose a name (3–6 words) and a one-paragraph description (≤ 280 chars).',
    'JSON only.',
  ].join('\n');
}

interface RawName {
  name?: unknown;
  description?: unknown;
}

function extractJson(text: string): RawName | null {
  const trimmed = text.trim();
  // Direct parse first.
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === 'object') return obj as RawName;
  } catch {
    // fall through to substring search
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(trimmed.slice(start, end + 1));
    if (obj && typeof obj === 'object') return obj as RawName;
  } catch {
    return null;
  }
  return null;
}

function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[\r\n]+/g, ' ').trim();
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, 120);
}

function sanitizeDescription(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, 400);
}
