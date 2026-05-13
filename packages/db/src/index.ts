export { PrismaClient, Prisma } from '@prisma/client';

export * from './repositories/index.js';
export { PrismaService, type ActivePrisma } from './prisma.service.js';
export { PrismaModule } from './prisma.module.js';
export { RepositoriesModule } from './repositories.module.js';
export { type TokenScope, type Principal, SCOPE_HIERARCHY, scopeAllows } from './auth.js';
export type {
  Document,
  DocumentChunk,
  Attachment,
  Entity,
  Edge,
  DocumentEntity,
  DocumentProject,
  Project,
  Decision,
  InboxItem,
  Job,
  AuditLog,
  SystemConfig,
  AuthToken,
  AdminUser,
  LlmProvider,
} from '@prisma/client';
export { LlmProviderKind } from '@prisma/client';
// MessageKind ships in the next prisma generate (migration
// 20260513150100). Re-export for app code that doesn't import @prisma/client
// directly. Once the client regenerates, replace with a plain re-export.
export type MessageKind = 'ephemeral' | 'pinned';
