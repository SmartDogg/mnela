import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const LoginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(1024),
});

export class LoginDto extends createZodDto(LoginSchema) {}

// /auth/bootstrap: first-time admin creation. 12-char min mirrors
// ADMIN_INITIAL_PASSWORD's env schema so the Setup Wizard and env-bootstrap
// paths apply the same minimum.
export const BootstrapSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(12).max(1024),
});

export class BootstrapDto extends createZodDto(BootstrapSchema) {}

export const CreateTokenSchema = z.object({
  name: z.string().min(1).max(100),
  scope: z.enum(['admin', 'mcp', 'read_only']),
  expiresInDays: z.number().int().positive().max(3650).optional(),
});

export class CreateTokenDto extends createZodDto(CreateTokenSchema) {}

// PATCH /auth/password — same 12-char floor as BootstrapSchema.
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(12).max(1024),
});

export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}
