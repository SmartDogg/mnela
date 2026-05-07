import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const LoginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(1024),
});

export class LoginDto extends createZodDto(LoginSchema) {}

export const CreateTokenSchema = z.object({
  name: z.string().min(1).max(100),
  scope: z.enum(['admin', 'mcp', 'read_only']),
  expiresInDays: z.number().int().positive().max(3650).optional(),
});

export class CreateTokenDto extends createZodDto(CreateTokenSchema) {}
