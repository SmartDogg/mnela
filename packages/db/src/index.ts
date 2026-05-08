export { PrismaClient, Prisma } from '@prisma/client';

export * from './repositories/index.js';
export { PrismaService, type ActivePrisma } from './prisma.service.js';
export { PrismaModule } from './prisma.module.js';
export { RepositoriesModule } from './repositories.module.js';
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
  DailyNote,
  InboxItem,
  Job,
  AuditLog,
  SystemConfig,
  AuthToken,
  AdminUser,
} from '@prisma/client';
