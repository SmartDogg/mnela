import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SetConfigSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z0-9._-]+$/, 'config key must be alphanumeric with . _ -'),
  value: z.unknown(),
});

export class SetConfigDto extends createZodDto(SetConfigSchema) {}
