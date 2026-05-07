import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateDecisionSchema = z.object({
  projectSlug: z.string().min(1).max(100).optional(),
  title: z.string().min(1).max(300),
  decision: z.string().min(1),
  context: z.string().nullable().optional(),
  consequences: z.string().nullable().optional(),
  status: z.enum(['active', 'superseded', 'reverted']).optional(),
  sourceDocumentId: z.string().nullable().optional(),
});

export class CreateDecisionDto extends createZodDto(CreateDecisionSchema) {}

export const UpdateDecisionSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    decision: z.string().min(1).optional(),
    context: z.string().nullable().optional(),
    consequences: z.string().nullable().optional(),
    status: z.enum(['active', 'superseded', 'reverted']).optional(),
    supersededById: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must include at least one field',
  });

export class UpdateDecisionDto extends createZodDto(UpdateDecisionSchema) {}

export const ListDecisionsQuerySchema = z.object({
  projectSlug: z.string().optional(),
  status: z.enum(['active', 'superseded', 'reverted']).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export class ListDecisionsQuery extends createZodDto(ListDecisionsQuerySchema) {}
