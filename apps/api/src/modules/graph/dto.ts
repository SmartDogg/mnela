import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const EntityTypeEnum = z.enum([
  'project',
  'person',
  'organization',
  'technology',
  'concept',
  'product',
  'service',
  'bug',
  'feature',
  'custom',
]);

const LinkStatusEnum = z.enum(['auto_confirmed', 'needs_review', 'manual', 'rejected']);

// Hard caps for the /graph snapshot. Above these the response is truncated
// and `stats.truncated === true`. The /graph page exposes density presets up
// to 1000 + "all", so the server cap must be at least that high. 2000 nodes
// keep react-force-graph-2d snappy on a modern laptop; pushing past that
// blows up canvas paint time more than it helps the user.
export const GRAPH_MAX_NODES = 2000;
export const GRAPH_MAX_EDGES = 5000;

const StringArrayQueryParam = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : [v]))
  .pipe(z.array(z.string().min(1)).min(1));

export const GraphQuerySchema = z.object({
  center: z.string().min(1),
  depth: z.coerce.number().int().min(1).max(4).optional(),
  types: z.union([EntityTypeEnum, z.array(EntityTypeEnum)]).optional(),
  maxNodes: z.coerce.number().int().positive().max(GRAPH_MAX_NODES).optional(),
  // Narrow to entities and edges directly connected to the Project entity
  // (Entity with type='project' and normalizedName === projectSlug). See
  // QUESTIONS.md row 14: project linkage in /graph is via persisted
  // Entity(type=project) rows — Document-side linkage is out of scope for the
  // REST snapshot.
  projectSlug: z.string().min(1).optional(),
  relations: StringArrayQueryParam.optional(),
  confidence: z.coerce.number().min(0).max(1).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export class GraphQuery extends createZodDto(GraphQuerySchema) {}

export const GraphOverviewQuerySchema = z.object({
  // `0` is allowed and means "no client-side cap" — the server still enforces
  // GRAPH_MAX_NODES as a hard ceiling. Default is applied in the service.
  limit: z.coerce.number().int().min(0).max(GRAPH_MAX_NODES).optional(),
  minDegree: z.coerce.number().int().positive().optional(),
  types: z.union([EntityTypeEnum, z.array(EntityTypeEnum)]).optional(),
});

export class GraphOverviewQuery extends createZodDto(GraphOverviewQuerySchema) {}

export const ListEntitiesQuerySchema = z.object({
  q: z.string().optional(),
  type: EntityTypeEnum.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  includeMerged: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .optional(),
});

export class ListEntitiesQuery extends createZodDto(ListEntitiesQuerySchema) {}

export const UpdateEntitySchema = z
  .object({
    name: z.string().min(1).max(300).optional(),
    description: z.string().nullable().optional(),
    aliases: z.array(z.string().min(1)).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must include at least one field',
  });

export class UpdateEntityDto extends createZodDto(UpdateEntitySchema) {}

export const CreateEntitySchema = z.object({
  name: z.string().min(1).max(300),
  type: EntityTypeEnum,
  description: z.string().nullable().optional(),
  aliases: z.array(z.string().min(1)).optional(),
});

export class CreateEntityDto extends createZodDto(CreateEntitySchema) {}

export const MergeEntitiesSchema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  dryRun: z.boolean().optional(),
});

export class MergeEntitiesDto extends createZodDto(MergeEntitiesSchema) {}

export const ListEdgesQuerySchema = z.object({
  fromId: z.string().optional(),
  toId: z.string().optional(),
  status: LinkStatusEnum.optional(),
  relationType: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export class ListEdgesQuery extends createZodDto(ListEdgesQuerySchema) {}

export const UpdateEdgeSchema = z
  .object({
    relationType: z.string().min(1).optional(),
    status: LinkStatusEnum.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must include at least one field',
  });

export class UpdateEdgeDto extends createZodDto(UpdateEdgeSchema) {}
