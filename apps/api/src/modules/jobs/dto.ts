import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const JobStatusEnum = z.enum(['queued', 'running', 'paused', 'completed', 'failed', 'cancelled']);

const JobTypeEnum = z.enum([
  'ingest_file',
  'parse_document',
  'enrich_document',
  'refresh_project_context',
  'rebuild_index',
  'export_vault',
]);

export const ListJobsQuerySchema = z.object({
  status: JobStatusEnum.optional(),
  type: JobTypeEnum.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export class ListJobsQuery extends createZodDto(ListJobsQuerySchema) {}
