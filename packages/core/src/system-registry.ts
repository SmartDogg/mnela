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

/**
 * UI-level grouping used by /admin/system cards. `providers` and `storage`
 * are new with ADR-0049; the older `imports | parsers | …` bucket survives
 * for backwards compatibility but is now subordinate to `section`.
 */
export type ConfigSection =
  | 'providers'
  | 'ingestion'
  | 'enrichment'
  | 'storage'
  | 'projects'
  | 'telegram'
  | 'advanced';

export interface ConfigSpecBase {
  key: string;
  group:
    | 'imports'
    | 'parsers'
    | 'enrichment'
    | 'vision'
    | 'whisper'
    | 'claude'
    | 'worker'
    | 'providers'
    | 'projects'
    | 'telegram';
  /**
   * Top-level card the key renders under in /admin/system. Defaults are
   * derived from `group` so existing specs keep working without explicit
   * sections.
   */
  section?: ConfigSection;
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
    section: 'ingestion',
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
    section: 'ingestion',
    description:
      'Match `file-service://file-XXX` asset pointers in ChatGPT conversations against files inside the ZIP and persist them as Attachments + image Documents.',
    default: true,
  },
  'chatgpt.linkProjects': {
    key: 'chatgpt.linkProjects',
    type: 'bool',
    group: 'parsers',
    section: 'ingestion',
    description:
      'Promote ChatGPT `conversation_template_id` / `gizmo_id` to project Entities with a `belongs_to` edge to each conversation.',
    default: true,
  },
  'claude.extractBinaryAttachments': {
    key: 'claude.extractBinaryAttachments',
    type: 'bool',
    group: 'parsers',
    section: 'ingestion',
    description:
      'Pull non-text attachments (images, PDFs, binaries) from inside Claude.ai export ZIPs as separate Attachment rows.',
    default: true,
  },

  // ---- Enrichment (text) ----
  'enrichment.parallelism': {
    key: 'enrichment.parallelism',
    type: 'int',
    group: 'enrichment',
    section: 'enrichment',
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
    section: 'enrichment',
    description:
      'ADR-0027 single-slot mutex: when enabled, enrichment yields to "Ask Brain" if it holds the shared Claude slot, and Ask yields back. Disable only if you run a setup where enrichment should not pause for chat (e.g. dedicated API key or a separate Claude session). Re-queues yielded jobs with a 30s delay.',
    default: true,
  },
  'enrichment.respectRateLimit': {
    key: 'enrichment.respectRateLimit',
    type: 'bool',
    group: 'enrichment',
    section: 'enrichment',
    description:
      'Honor the per-session rate-limit pause: when Claude reports a rate-limit hit, the whole enrichment queue pauses until the reset window. Disabling lets jobs keep retrying immediately — useful if you are on a non-Claude backend with its own throttling.',
    default: true,
  },
  'enrichment.attempts': {
    key: 'enrichment.attempts',
    type: 'int',
    group: 'enrichment',
    section: 'enrichment',
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
    section: 'enrichment',
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
    section: 'enrichment',
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
    section: 'enrichment',
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
    section: 'advanced',
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
    section: 'advanced',
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
    section: 'advanced',
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
    section: 'advanced',
    description:
      'Initial exponential-backoff delay between retries for transcribe_audio jobs, in milliseconds.',
    default: 1000,
    min: 100,
    max: 60_000,
  },

  // ---- Whisper transcription (ADR-0045) ----
  // User-facing knobs surfaced under `/admin/system → Enrichment`.
  // Deploy-level wiring (`WHISPER_URL`, `WHISPER_TIMEOUT_MS`) stays in
  // env — those are infrastructure, not preferences.
  'transcription.enabled': {
    key: 'transcription.enabled',
    type: 'bool',
    group: 'whisper',
    section: 'enrichment',
    description:
      'Run voice / audio uploads through whisper.cpp. Worker re-reads this on every ingest, so toggling takes effect on the next message — no restart. When off, audio Documents stay status="raw" with empty rawText and no transcribe_audio job is enqueued.',
    default: false,
  },
  'transcription.model': {
    key: 'transcription.model',
    type: 'enum',
    group: 'whisper',
    section: 'enrichment',
    description:
      'whisper.cpp model size — tiny ≈75 MB (fastest, weakest), base ≈140 MB (recommended), small ≈466 MB, medium ≈1.5 GB (slowest, best). Changing this is informational at the worker side (the actual binary the whisper container loads is baked at image build time); rebuild via `docker compose ... build whisper` after switching to actually load the new model.',
    default: 'base',
    options: ['tiny', 'base', 'small', 'medium'],
    requiresRestart: true,
  },
  'transcription.language': {
    key: 'transcription.language',
    type: 'enum',
    group: 'whisper',
    section: 'enrichment',
    description:
      'ISO-639-1 hint passed to whisper. "auto" lets the model detect per file (slower; useful for mixed-language vaults). Defaults to "ru" because the typical Mnela owner ships Russian voice notes.',
    default: 'ru',
    options: ['auto', 'ru', 'en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'uk', 'tr', 'ar', 'ja', 'zh'],
  },

  // ---- Vision (image analysis) ----
  'attachments.imageAnalysisEnabled': {
    key: 'attachments.imageAnalysisEnabled',
    type: 'bool',
    group: 'vision',
    section: 'enrichment',
    description:
      'Run vision analysis on every image attachment after ingestion to populate description + extracted entities.',
    default: true,
  },

  // ---- AI providers (ADR-0049) ----
  // Per-feature provider routing. The value is a provider id from the
  // LlmProvider table OR the sentinel `builtin:claude-cli` (always
  // available — the OOTB native Claude Code subprocess path).
  'providers.default': {
    key: 'providers.default',
    type: 'string',
    group: 'providers',
    section: 'providers',
    description:
      'Default LLM provider id used when a feature-specific override is unset. Use the built-in sentinel `builtin:claude-cli` to route through the local Claude Code subprocess.',
    default: 'builtin:claude-cli',
  },
  'providers.ask': {
    key: 'providers.ask',
    type: 'string',
    group: 'providers',
    section: 'providers',
    description:
      'Provider override for Ask Brain (/ask). Empty string falls back to providers.default.',
    default: '',
  },
  'providers.enrichment': {
    key: 'providers.enrichment',
    type: 'string',
    group: 'providers',
    section: 'providers',
    description:
      'Provider override for document enrichment + project-context refresh. Empty string falls back to providers.default.',
    default: '',
  },
  'providers.vision': {
    key: 'providers.vision',
    type: 'string',
    group: 'providers',
    section: 'providers',
    description:
      'Provider override for image attachment vision analysis. Empty string falls back to providers.default.',
    default: '',
  },
  'providers.projectContext': {
    key: 'providers.projectContext',
    type: 'string',
    group: 'providers',
    section: 'providers',
    description:
      'Provider override for project-context refresh jobs. Empty string falls back to providers.enrichment then providers.default.',
    default: '',
  },

  // ---- Projects (ADR-0051) ----
  // Master gates for the auto-suggested-projects pipeline. When the
  // suggestion gate is off, the detector job exits before reading
  // documents and the Haiku naming call is never made — zero tokens, zero
  // analytical SQL. When the autoSummary gate is off, the project detail
  // page falls back to a heuristic header (top entities + doc count) and
  // skips the Haiku summary refresh.
  'projects.suggestions.enabled': {
    key: 'projects.suggestions.enabled',
    type: 'bool',
    group: 'projects',
    section: 'projects',
    description:
      'Master gate for auto-project suggestions (ADR-0051). When off, the project_suggest detector and its single-Haiku naming call never run — no token use, no detection SQL. /projects/new shows a fallback empty state. Default ON.',
    default: true,
  },
  'projects.autoSummary.enabled': {
    key: 'projects.autoSummary.enabled',
    type: 'bool',
    group: 'projects',
    section: 'projects',
    description:
      'Gate for the LLM-generated project summary shown on /projects/[slug]. When off, the header falls back to top-entities + doc count without any LLM call. Default ON.',
    default: true,
  },

  // ---- Telegram bot (ADR-0053) ----
  // Master gate for the Telegram-bot integration. The bot process polls
  // its enabled-state at boot and on every `telegram:reload` pub/sub
  // event, so flipping this on/off in /admin/system is sufficient — no
  // process restart required. Token, transport, and whitelist live in
  // the TelegramBot / TelegramAllowedUser tables (set via the Telegram
  // card UI, not via this registry).
  'telegram.enabled': {
    key: 'telegram.enabled',
    type: 'bool',
    group: 'telegram',
    section: 'telegram',
    description:
      'Master gate for the Telegram bot (ADR-0053). When off, the apps/tg-bot process exits its polling loop and ignores incoming updates. The bot token, transport, and whitelist are kept (and visible) but inert. Default OFF — you must configure a token + whitelist before turning this on.',
    default: false,
  },
  'telegram.bundleWindowMs': {
    key: 'telegram.bundleWindowMs',
    type: 'int',
    group: 'telegram',
    section: 'telegram',
    description:
      'Debounce window (ms) used to bundle multi-modal Telegram messages — voice + photo + text sent in sequence — into one conversational turn. Each new message resets the timer; when it elapses, the accumulated items are merged into a single /search/ask call. Lower = snappier replies but risks splitting a multi-part thought; higher = longer wait before the bot answers.',
    default: 4000,
    min: 500,
    max: 30_000,
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
