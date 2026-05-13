import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const TRANSPORT = z.enum(['polling', 'webhook']);

/**
 * Set or rotate the bot token. The plaintext value is encrypted via the
 * shared keystore (`@mnela/llm-providers`) and stored as `tokenEnc`; the
 * last 4 chars are kept in `tokenLast4` for redacted UI display. Pass
 * `token: null` to clear (and disable the bot).
 */
export const UpdateTelegramConfigSchema = z.object({
  enabled: z.boolean().optional(),
  /** Plaintext bot token. Null clears, omit to keep. */
  token: z.union([z.string().min(20).max(200), z.null()]).optional(),
  transport: TRANSPORT.optional(),
  webhookUrl: z.union([z.string().url(), z.null()]).optional(),
  bundleWindowMs: z.number().int().min(500).max(30_000).optional(),
  defaultProjectSlug: z.union([z.string().min(1).max(120), z.null()]).optional(),
});
export class UpdateTelegramConfigDto extends createZodDto(UpdateTelegramConfigSchema) {}

export const UpsertAllowedUserSchema = z.object({
  /** Telegram user_id (64-bit signed integer). Always serialized as a
   * string at this boundary to dodge JSON number precision issues AND
   * the BigInt-on-class shenanigans that zod transforms cause when the
   * DTO is class-shaped (`createZodDto`). The controller converts to
   * BigInt right before the repository call. */
  tgUserId: z.string().regex(/^-?\d+$/, 'tgUserId must be a numeric string'),
  label: z.union([z.string().min(1).max(80), z.null()]).optional(),
});
export class UpsertAllowedUserDto extends createZodDto(UpsertAllowedUserSchema) {}
