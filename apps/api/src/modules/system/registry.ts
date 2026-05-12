/**
 * Typed SystemConfig registry — single source of truth for every runtime-
 * tunable setting. Defaults are coded in TS; the `SystemConfig` table only
 * holds *overrides*. The admin UI (apps/web/.../admin/system) renders one
 * control per spec from `/system/config`.
 *
 * Why a registry instead of free-form JSON: parsers and pipelines need to
 * call `SystemConfigService.get('imports.maxBytes')` without knowing whether
 * the row exists; the spec also lets the UI render a typed control and
 * validate values before write, so a typo can't brick the limit.
 */

export type ConfigType = 'bytes' | 'int' | 'bool' | 'enum' | 'string';

export interface ConfigSpecBase {
  key: string;
  group: 'imports' | 'parsers' | 'enrichment' | 'vision' | 'whisper' | 'claude';
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
  'imports.workerConcurrency': {
    key: 'imports.workerConcurrency',
    type: 'int',
    group: 'imports',
    description: 'Parallel ingestion jobs the worker processes at once.',
    default: 2,
    min: 1,
    max: 16,
    requiresRestart: true,
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
  // Reserved for future tunables; kept here so the UI groups stay non-empty
  // once parsers/vision land.

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
