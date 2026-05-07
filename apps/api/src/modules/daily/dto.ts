import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be ISO 8601 YYYY-MM-DD');

export const ListDailyQuerySchema = z.object({
  from: DateString.optional(),
  to: DateString.optional(),
});

export class ListDailyQuery extends createZodDto(ListDailyQuerySchema) {}

export const UpsertDailySchema = z.object({
  contentMd: z.string(),
  mood: z.string().max(100).nullable().optional(),
});

export class UpsertDailyDto extends createZodDto(UpsertDailySchema) {}

export function parseDateOnly(s: string): Date {
  // Treat YYYY-MM-DD as UTC midnight to keep DateOnly semantics consistent.
  const [year, month, day] = s.split('-').map((p) => Number.parseInt(p, 10));
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}
