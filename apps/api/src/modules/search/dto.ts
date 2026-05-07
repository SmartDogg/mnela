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

export const SearchSchema = z.object({
  query: z.string().min(1).max(500),
  mode: z.enum(['fts', 'fuzzy', 'hybrid']).default('hybrid'),
  filters: z
    .object({
      status: DocumentStatusEnum.optional(),
      source: SourceTypeEnum.optional(),
      type: z.string().optional(),
      projectSlug: z.string().optional(),
    })
    .optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export class SearchDto extends createZodDto(SearchSchema) {}
