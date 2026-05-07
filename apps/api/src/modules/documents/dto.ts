import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const DocumentStatusEnum = z.enum(['raw', 'parsed', 'enriching', 'enriched', 'failed', 'archived']);

const SourceTypeEnum = z.enum([
  'chatgpt_export',
  'claude_export',
  'obsidian_vault',
  'manual_upload',
  'api_ingest',
  'telegram',
  'voice_note',
  'email',
  'web_clip',
]);

export const ListDocumentsQuerySchema = z.object({
  status: DocumentStatusEnum.optional(),
  source: SourceTypeEnum.optional(),
  type: z.string().optional(),
  projectSlug: z.string().optional(),
  q: z.string().optional(),
  archived: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export class ListDocumentsQuery extends createZodDto(ListDocumentsQuerySchema) {}

export const UpdateDocumentSchema = z
  .object({
    type: z.string().nullable().optional(),
    projects: z.array(z.string().min(1)).optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must include at least one field',
  });

export class UpdateDocumentDto extends createZodDto(UpdateDocumentSchema) {}

export const RelatedQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
});

export class RelatedQuery extends createZodDto(RelatedQuerySchema) {}
