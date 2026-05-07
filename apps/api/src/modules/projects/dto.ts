import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const SlugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/, 'slug must be kebab-case lowercase');

export const CreateProjectSchema = z.object({
  slug: SlugSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
  contextMd: z.string().max(100_000).nullable().optional(),
});

export class CreateProjectDto extends createZodDto(CreateProjectSchema) {}

export const UpdateProjectSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: z.enum(['active', 'paused', 'archived']).optional(),
    contextMd: z.string().max(100_000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must include at least one field',
  });

export class UpdateProjectDto extends createZodDto(UpdateProjectSchema) {}

export const ListProjectsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export class ListProjectsQuery extends createZodDto(ListProjectsQuerySchema) {}
