/**
 * Typed SystemConfig registry — single source of truth for every runtime-
 * tunable setting. Defaults are coded in TS; the `SystemConfig` table only
 * holds *overrides*. The admin UI (apps/web/.../admin/system) renders one
 * control per spec from `/system/config`.
 *
 * Lives in `@mnela/core` (not `apps/api`) because three apps consume it:
 *   - api validates writes and serves /system/config to the admin UI
 *   - orchestrator reads enrichment.* at boot + per job
 *   - worker reads worker.* at boot + per enqueue
 * Sharing one source prevents drift between defaults and limits.
 */

export type ConfigType = 'bytes' | 'int' | 'bool' | 'enum' | 'string';

export interface ConfigSpecBase {
  key: string;
  group: 'imports' | 'parsers' | 'enrichment' | 'vision' | 'whisper' | 'claude' | 'worker';
  description: string;
  /** True if changing this requires an app restart to take effect. */
  requiresRestart?: boolean;
}

export interface BytesConfigSpec extends ConfigSpecBase {
  type: 'bytes';
  default: number;
  min?: number;
  /** Null = no hard upper bound; service-layer guards still apply. */
  max?: number | null;
  /** Display-only presets shown as quick-pick buttons in the UI. */
  presets?: number[];
}

export interface IntConfigSpec extends ConfigSpecBase {
  type: 'int';
  default: number;
  min?: number;
  max?: number;
}

export interface BoolConfigSpec extends ConfigSpecBase {
  type: 'bool';
  default: boolean;
}

export interface EnumConfigSpec extends ConfigSpecBase {
  type: 'enum';
  default: string;
  options: readonly string[];
}

export interface StringConfigSpec extends ConfigSpecBase {
  type: 'string';
  default: string;
  /** Optional regex pattern shown to the UI; not enforced server-side beyond `RegExp(pattern).test()`. */
  pattern?: string;
}

export type ConfigSpec =
  | BytesConfigSpec
  | IntConfigSpec
  | BoolConfigSpec
  | EnumConfigSpec
  | StringConfigSpec;

const GiB = (n: number): number => n * 1024 * 1024 * 1024;

export const CONFIG_REGISTRY: Record<string, ConfigSpec> = {
  // ---- Imports ----
  'imports.maxBytes': {
    key: 'imports.maxBytes',
    type: 'bytes',
    group: 'imports',
    description:
      'Maximum upload size for /imports. Files larger than this are rejected before the worker picks them up. No hard ceiling — set as high as your disk allows.',
    default: GiB(5),
    min: 1024 * 1024,
    max: null,
    presets: [GiB(1), GiB(2), GiB(5), GiB(10), GiB(50), GiB(100)],
  },

  // ---- Parsers ----
  'chatgpt.extractAttachments': {
    key: 'chatgpt.extractAttachments',
    type: 'bool',
    group: 'parsers',
    description:
      'Match `file-service://file-XXX` asset pointers in ChatGPT conversations against files inside the ZIP and persist them as Attachments + image Documents.',
    default: true,
  },
  'chatgpt.linkProjects': {
    key: 'chatgpt.linkProjects',
    type: 'bool',
    group: 'parsers',
    description:
      'Promote ChatGPT `conversation_template_id` / `gizmo_id` to project Entities with a `belongs_to` edge to each conversation.',
    default: true,
  },
  'claude.extractBinaryAttachments': {
    key: 'claude.extractBinaryAttachments',
    type: 'bool',
    group: 'parsers',
    description:
      'Pull non-text attachments (images, PDFs, binaries) from inside Claude.ai export ZIPs as separate Attachment rows.',
    default: true,
  },

  // ---- Enrichment (text) ----
  'enrichment.parallelism': {
    key: 'enrichment.parallelism',
    type: 'int',
    group: 'enrichment',
    description:
      'How many enrichment jobs the orchestrator runs in parallel. Default 1 is safe for Claude Max (one subprocess at a time). Raise it only if you have headroom — multiple parallel `claude` subprocesses each count against your Anthropic quota and can trip rate-limits faster. Effective only after orchestrator restart.',
    default: 1,
    min: 1,
    max: 32,
    requiresRestart: true,
  },
  'enrichment.useSlot': {
    key: 'enrichment.useSlot',
    type: 'bool',
    group: 'enrichment',
    description:
      'ADR-0027 single-slot mutex: when enabled, enrichment yields to "Ask Brain" if it holds the shared Claude slot, and Ask yields back. Disable only if you run a setup where enrichment should not pause for chat (e.g. dedicated API key or a separate Claude session). Re-queues yielded jobs with a 30s delay.',
    default: true,
  },
  'enrichment.respectRateLimit': {
    key: 'enrichment.respectRateLimit',
    type: 'bool',
    group: 'enrichment',
    description:
      'Honor the per-session rate-limit pause: when Claude reports a rate-limit hit, the whole enrichment queue pauses until the reset window. Disabling lets jobs keep retrying immediately — useful if you are on a non-Claude backend with its own throttling.',
    default: true,
  },
  'enrichment.attempts': {
    key: 'enrichment.attempts',
    type: 'int',
    group: 'enrichment',
    description:
      'BullMQ retry attempts for enrich_document jobs. After this many consecutive failures the job moves to "failed" and stops retrying.',
    default: 3,
    min: 1,
    max: 10,
  },
  'enrichment.backoffMs': {
    key: 'enrichment.backoffMs',
    type: 'int',
    group: 'enrichment',
    description:
      'Initial exponential-backoff delay between retries for enrich_document jobs, in milliseconds. Each subsequent retry doubles this.',
    default: 1000,
    min: 100,
    max: 60_000,
  },
  'enrichment.imageAttempts': {
    key: 'enrichment.imageAttempts',
    type: 'int',
    group: 'enrichment',
    description:
      'BullMQ retry attempts for analyze_attachment (image vision) jobs. Separate from text-enrichment because image jobs include disk I/O on top of Claude calls.',
    default: 3,
    min: 1,
    max: 10,
  },
  'enrichment.imageBackoffMs': {
    key: 'enrichment.imageBackoffMs',
    type: 'int',
    group: 'enrichment',
    description:
      'Initial exponential-backoff delay between retries for analyze_attachment jobs, in milliseconds.',
    default: 2000,
    min: 100,
    max: 60_000,
  },

  // ---- Worker (ingestion + transcription) ----
  'worker.ingestion.concurrency': {
    key: 'worker.ingestion.concurrency',
    type: 'int',
    group: 'worker',
    description:
      'Parallel ingestion jobs the worker runs. Default 2 keeps memory predictable for multi-GB ChatGPT account exports (~1 GB peak per job). Raise on a beefier host; lower if the worker OOMs on large parses. Effective only after worker restart.',
    default: 2,
    min: 1,
    max: 16,
    requiresRestart: true,
  },
  'worker.transcription.concurrency': {
    key: 'worker.transcription.concurrency',
    type: 'int',
    group: 'worker',
    description:
      'Parallel transcription jobs the worker runs. Default 1 is recommended — whisper.cpp pegs CPU and parallel transcriptions thrash. Effective only after worker restart.',
    default: 1,
    min: 1,
    max: 8,
    requiresRestart: true,
  },
  'worker.transcription.attempts': {
    key: 'worker.transcription.attempts',
    type: 'int',
    group: 'worker',
    description:
      'BullMQ retry attempts for transcribe_audio jobs (transient whisper.cpp / network errors).',
    default: 3,
    min: 1,
    max: 10,
  },
  'worker.transcription.backoffMs': {
    key: 'worker.transcription.backoffMs',
    type: 'int',
    group: 'worker',
    description:
      'Initial exponential-backoff delay between retries for transcribe_audio jobs, in milliseconds.',
    default: 1000,
    min: 100,
    max: 60_000,
  },

  // ---- Vision (image analysis) ----
  'attachments.imageAnalysisEnabled': {
    key: 'attachments.imageAnalysisEnabled',
    type: 'bool',
    group: 'vision',
    description:
      'Run vision analysis on every image attachment after ingestion to populate description + extracted entities.',
    default: true,
  },
  'attachments.imageAnalysisBackend': {
    key: 'attachments.imageAnalysisBackend',
    type: 'enum',
    group: 'vision',
    description:
      'Which Claude entry point to use. `claude-code` reuses the Claude Code CLI (same ADR-0027 slot as text enrichment, no extra credentials). `anthropic-api` calls the SDK directly — faster + cheaper but needs `ANTHROPIC_API_KEY`.',
    default: 'claude-code',
    options: ['claude-code', 'anthropic-api'],
  },
  'attachments.imageAnalysisModel': {
    key: 'attachments.imageAnalysisModel',
    type: 'enum',
    group: 'vision',
    description:
      'Model id passed to the chosen backend. Sonnet is the default cost/quality balance; Opus is best at detailed scenes; Haiku is fastest.',
    default: 'sonnet',
    options: ['opus', 'sonnet', 'haiku'],
  },
};

/**
 * Validate a candidate value against a spec. Returns the *coerced* value
 * (e.g., string -> number for `int`/`bytes`) or throws with a human message.
 */
export function validateConfigValue(spec: ConfigSpec, raw: unknown): unknown {
  switch (spec.type) {
    case 'bytes':
    case 'int': {
      const num =
        typeof raw === 'number'
          ? raw
          : typeof raw === 'string' && raw.trim() !== ''
            ? Number(raw)
            : NaN;
      if (!Number.isFinite(num) || !Number.isInteger(num)) {
        throw new Error(`${spec.key}: must be an integer`);
      }
      if (spec.min !== undefined && num < spec.min) {
        throw new Error(`${spec.key}: ${num} < min ${spec.min}`);
      }
      if (spec.type === 'int' && spec.max !== undefined && num > spec.max) {
        throw new Error(`${spec.key}: ${num} > max ${spec.max}`);
      }
      if (spec.type === 'bytes' && spec.max != null && num > spec.max) {
        throw new Error(`${spec.key}: ${num} > max ${spec.max}`);
      }
      return num;
    }
    case 'bool': {
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 1) return true;
      if (raw === 'false' || raw === 0) return false;
      throw new Error(`${spec.key}: must be a boolean`);
    }
    case 'enum': {
      if (typeof raw !== 'string' || !spec.options.includes(raw)) {
        throw new Error(`${spec.key}: must be one of ${spec.options.join(', ')}`);
      }
      return raw;
    }
    case 'string': {
      if (typeof raw !== 'string') {
        throw new Error(`${spec.key}: must be a string`);
      }
      if (spec.pattern && !new RegExp(spec.pattern).test(raw)) {
        throw new Error(`${spec.key}: does not match ${spec.pattern}`);
      }
      return raw;
    }
  }
}

/** Resolve the value for a key: DB override if valid, otherwise the default. */
export function resolveConfigValue(spec: ConfigSpec, override: unknown): unknown {
  if (override === undefined || override === null) return spec.default;
  try {
    return validateConfigValue(spec, override);
  } catch {
    // A stale/invalid override never crashes a service — fall back to default
    // and let the UI surface the inconsistency separately.
    return spec.default;
  }
}

/**
 * Read a registry-backed value via a thin repo handle, returning the
 * resolved (override-or-default) value. Shared by api/orchestrator/worker
 * so that every service reads the same source of truth. The `repo` parameter
 * is intentionally structural (just `{ get(key) }`) so callers can pass
 * SystemConfigRepository from @mnela/db without this package taking a
 * runtime dep on it.
 */
export async function readRegistryValue<T = unknown>(
  repo: { get: (key: string) => Promise<{ value: unknown } | null> },
  key: string,
  envFallback?: T,
): Promise<T> {
  const spec = CONFIG_REGISTRY[key];
  if (!spec) {
    if (envFallback !== undefined) return envFallback;
    throw new Error(`Unknown config key: ${key}`);
  }
  const row = await repo.get(key).catch(() => null);
  if (row && row.value !== undefined && row.value !== null) {
    return resolveConfigValue(spec, row.value) as T;
  }
  // No DB override → prefer the caller-supplied env fallback (for first-boot
  // back-compat with legacy MNELA_* variables), then the spec default.
  if (envFallback !== undefined) return envFallback;
  return spec.default as T;
}
