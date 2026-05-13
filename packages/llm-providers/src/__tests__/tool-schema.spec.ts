import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { zodToJsonSchema } from '../tool-schema.js';

describe('zodToJsonSchema', () => {
  it('converts a simple object', () => {
    const schema = z.object({
      query: z.string().min(1).max(100),
      limit: z.number().int().min(1).max(50).default(10),
    });
    const json = zodToJsonSchema(schema) as {
      type: string;
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
    expect(json.type).toBe('object');
    expect(json.properties['query']).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 100,
    });
    expect(json.properties['limit']).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 50,
    });
    // `limit` has a default so it's not required.
    expect(json.required).toEqual(['query']);
  });

  it('handles enums and unions of literals', () => {
    const a = zodToJsonSchema(z.enum(['fts', 'fuzzy', 'hybrid'])) as Record<string, unknown>;
    expect(a).toEqual({ type: 'string', enum: ['fts', 'fuzzy', 'hybrid'] });
    const b = zodToJsonSchema(z.union([z.literal('a'), z.literal('b')])) as Record<string, unknown>;
    expect(b).toEqual({ enum: ['a', 'b'] });
  });

  it('unwraps optional/default/nullable', () => {
    const schema = z.object({
      a: z.string().optional(),
      b: z.number().default(5),
      c: z.string().nullable(),
    });
    const json = zodToJsonSchema(schema) as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
    expect(json.properties['a']).toEqual({ type: 'string' });
    expect(json.properties['b']).toEqual({ type: 'number' });
    expect(json.properties['c']).toEqual({ type: 'string' });
    // `c` is nullable but still required (the wrapping is structural; the
    // model can pass null because we don't enforce non-null at JSON-Schema
    // layer here — that's enforced server-side by zod parse).
    expect(json.required.sort()).toEqual(['c']);
  });

  it('handles arrays', () => {
    const json = zodToJsonSchema(z.array(z.string())) as Record<string, unknown>;
    expect(json).toEqual({ type: 'array', items: { type: 'string' } });
  });
});
