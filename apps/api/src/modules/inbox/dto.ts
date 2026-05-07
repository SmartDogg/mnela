import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const InboxItemTypeEnum = z.enum([
  'link_suggestion',
  'entity_merge_suggestion',
  'duplicate_detection',
  'enrichment_failed',
  'conflicting_decision',
]);

export const ListInboxQuerySchema = z.object({
  type: InboxItemTypeEnum.optional(),
  status: z.enum(['pending', 'accepted', 'rejected']).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export class ListInboxQuery extends createZodDto(ListInboxQuerySchema) {}

export const EditInboxSchema = z.object({
  payload: z.record(z.unknown()),
});

export class EditInboxDto extends createZodDto(EditInboxSchema) {}
