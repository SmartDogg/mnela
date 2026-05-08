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

// Window strings accepted by all /jobs/stats/* endpoints. Kept short and explicit
// so the query layer can map each to a fixed millisecond span without parsing.
export const StatsSinceEnum = z.enum(['15m', '1h', '6h', '24h', '7d']);
export type StatsSince = z.infer<typeof StatsSinceEnum>;

export const SINCE_MS: Record<StatsSince, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export const ThroughputBucketEnum = z.enum(['minute', 'hour']);
export type ThroughputBucket = z.infer<typeof ThroughputBucketEnum>;

export const ThroughputQuerySchema = z.object({
  bucket: ThroughputBucketEnum.optional(),
  since: StatsSinceEnum.optional(),
});
export class ThroughputQuery extends createZodDto(ThroughputQuerySchema) {}

export const SinceQuerySchema = z.object({
  since: StatsSinceEnum.optional(),
});
export class SinceQuery extends createZodDto(SinceQuerySchema) {}
