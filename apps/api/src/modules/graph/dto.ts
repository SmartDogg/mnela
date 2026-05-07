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

export const GraphQuerySchema = z.object({
  center: z.string().min(1),
  depth: z.coerce.number().int().min(1).max(4).optional(),
  types: z.union([EntityTypeEnum, z.array(EntityTypeEnum)]).optional(),
  maxNodes: z.coerce.number().int().positive().max(500).optional(),
});

export class GraphQuery extends createZodDto(GraphQuerySchema) {}

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

export const MergeEntitiesSchema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
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
