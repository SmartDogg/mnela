import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ListConversationsSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export class ListConversationsQuery extends createZodDto(ListConversationsSchema) {}

export const PatchConversationSchema = z.object({
  title: z.string().min(1).max(200),
});

export class PatchConversationDto extends createZodDto(PatchConversationSchema) {}
