import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const KIND = z.enum(['claude_cli', 'anthropic_api', 'openai_compat']);

export const CreateProviderSchema = z
  .object({
    name: z.string().min(1).max(100),
    kind: KIND,
    model: z.string().min(0).max(200).default(''),
    baseUrl: z.string().url().optional(),
    apiKey: z.string().min(1).optional(),
    extra: z.record(z.unknown()).optional(),
  })
  .refine((v) => v.kind !== 'openai_compat' || (v.baseUrl && v.baseUrl.length > 0), {
    message: 'baseUrl is required for openai_compat providers',
    path: ['baseUrl'],
  })
  .refine((v) => v.kind === 'claude_cli' || v.model.length > 0, {
    message: 'model is required for API-backed providers',
    path: ['model'],
  });
export class CreateProviderDto extends createZodDto(CreateProviderSchema) {}

export const UpdateProviderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  model: z.string().min(1).max(200).optional(),
  baseUrl: z.string().url().nullable().optional(),
  /** Pass null to clear, omit to keep, pass string to rotate. */
  apiKey: z.union([z.string().min(1), z.null()]).optional(),
  extra: z.union([z.record(z.unknown()), z.null()]).optional(),
});
export class UpdateProviderDto extends createZodDto(UpdateProviderSchema) {}

export const SetDefaultProviderSchema = z.object({
  feature: z.enum(['default', 'ask', 'enrichment', 'vision', 'projectContext']),
  /** Empty string clears the override. */
  providerId: z.string().min(0).max(200),
});
export class SetDefaultProviderDto extends createZodDto(SetDefaultProviderSchema) {}

export const ApplyDefaultEverywhereSchema = z.object({
  providerId: z.string().min(1).max(200),
});
export class ApplyDefaultEverywhereDto extends createZodDto(ApplyDefaultEverywhereSchema) {}
