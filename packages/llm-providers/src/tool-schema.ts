/**
 * Minimal Zod → JSON Schema converter scoped to the shapes that
 * `@mnela/mcp-tools` actually emits (objects with string / number / boolean
 * / array fields, nullable + optional, enums via z.union of literals,
 * z.record for the few free-form maps). We do NOT pull in
 * `zod-to-json-schema` because the runtime introspection in that package
 * has shifting drafts and we only need a tight subset.
 *
 * Output shape targets the OpenAI function-calling schema (also a subset
 * of Anthropic's tool input_schema) — Draft 2020-12 features (e.g.
 * `prefixItems`) are NOT emitted.
 */

import type { ZodTypeAny } from 'zod';

import type { ProviderTool } from './types.js';

interface ZDef {
  typeName: string;
  type?: unknown;
  innerType?: unknown;
  schema?: unknown;
  checks?: { kind: string; value?: unknown }[];
  values?: unknown[];
  options?: unknown[];
  shape?: () => Record<string, unknown>;
  valueType?: unknown;
  keyType?: unknown;
  unknownKeys?: 'strict' | 'passthrough' | 'strip';
  catchall?: unknown;
  description?: string;
}

function defOf(schema: unknown): ZDef | null {
  if (!schema || typeof schema !== 'object') return null;
  const d = (schema as { _def?: unknown })._def;
  return (d as ZDef | undefined) ?? null;
}

/**
 * Convert one zod schema into a JSON Schema fragment. Recursion is bounded
 * by zod's own structural depth — the mcp-tools schemas are at most 3 deep.
 */
export function zodToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  return convert(schema as unknown);
}

function convert(node: unknown): Record<string, unknown> {
  const def = defOf(node);
  if (!def) return { type: 'object' };

  const description = typeof def.description === 'string' ? def.description : undefined;
  const base = (out: Record<string, unknown>): Record<string, unknown> =>
    description ? { description, ...out } : out;

  switch (def.typeName) {
    case 'ZodString': {
      const out: Record<string, unknown> = { type: 'string' };
      for (const c of def.checks ?? []) {
        if (c.kind === 'min' && typeof c.value === 'number') out['minLength'] = c.value;
        if (c.kind === 'max' && typeof c.value === 'number') out['maxLength'] = c.value;
        if (c.kind === 'regex' && c.value instanceof RegExp) out['pattern'] = c.value.source;
        if (c.kind === 'uuid') out['format'] = 'uuid';
        if (c.kind === 'url') out['format'] = 'uri';
      }
      return base(out);
    }
    case 'ZodNumber': {
      const out: Record<string, unknown> = { type: 'number' };
      let int = false;
      for (const c of def.checks ?? []) {
        if (c.kind === 'int') int = true;
        if (c.kind === 'min' && typeof c.value === 'number') out['minimum'] = c.value;
        if (c.kind === 'max' && typeof c.value === 'number') out['maximum'] = c.value;
      }
      if (int) out['type'] = 'integer';
      return base(out);
    }
    case 'ZodBoolean':
      return base({ type: 'boolean' });
    case 'ZodLiteral':
      // Anthropic/OpenAI accept const via enum-of-one.
      return base({ enum: [def['value' as keyof ZDef] as unknown] });
    case 'ZodNull':
      return base({ type: 'null' });
    case 'ZodEnum':
      return base({ type: 'string', enum: [...(def.values ?? [])] });
    case 'ZodNativeEnum': {
      const values = Object.values((def['values' as keyof ZDef] as Record<string, unknown>) ?? {});
      return base({ type: 'string', enum: values });
    }
    case 'ZodArray': {
      const items = convert(def.type);
      return base({ type: 'array', items });
    }
    case 'ZodObject': {
      const shape = (def.shape as (() => Record<string, unknown>) | undefined)?.() ?? {};
      const properties: Record<string, Record<string, unknown>> = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(shape)) {
        const childDef = defOf(child);
        const isOptional = childDef?.typeName === 'ZodOptional';
        const isDefault = childDef?.typeName === 'ZodDefault';
        properties[key] = convert(child);
        if (!isOptional && !isDefault) required.push(key);
      }
      const out: Record<string, unknown> = {
        type: 'object',
        properties,
      };
      if (required.length > 0) out['required'] = required;
      if (def.unknownKeys !== 'passthrough') out['additionalProperties'] = false;
      return base(out);
    }
    case 'ZodOptional':
    case 'ZodDefault':
    case 'ZodNullable':
    case 'ZodReadonly':
    case 'ZodBranded':
    case 'ZodEffects':
      return convert(def.innerType ?? def.schema);
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const opts = (def.options ?? []) as unknown[];
      // Literal-only unions collapse to a single enum.
      const literals: unknown[] = [];
      let allLiteral = true;
      for (const o of opts) {
        const od = defOf(o);
        if (od?.typeName === 'ZodLiteral') {
          literals.push((od as ZDef & { value?: unknown })['value' as keyof ZDef]);
        } else {
          allLiteral = false;
          break;
        }
      }
      if (allLiteral && literals.length > 0) {
        return base({ enum: literals });
      }
      return base({ anyOf: opts.map((o) => convert(o)) });
    }
    case 'ZodRecord': {
      const valueSchema = def.valueType ? convert(def.valueType) : { type: 'object' };
      return base({ type: 'object', additionalProperties: valueSchema });
    }
    case 'ZodTuple':
      // OpenAI doesn't support prefixItems — degrade to array of any.
      return base({ type: 'array' });
    case 'ZodUnknown':
    case 'ZodAny':
      return base({});
    default:
      return base({});
  }
}

/**
 * Convert a `@mnela/mcp-tools` ToolDefinition into the provider-agnostic
 * `ProviderTool` shape. Filters to the input schema only; output schema
 * stays server-side for validation.
 */
export function toolDefinitionToProviderTool(tool: {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
}): ProviderTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.inputSchema),
  };
}
