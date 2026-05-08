import { Global, Module, type Provider } from '@nestjs/common';

import { PrismaService } from './prisma.service.js';
import {
  AdminUserRepository,
  AttachmentRepository,
  AuditLogRepository,
  AuthTokenRepository,
  DailyNoteRepository,
  DecisionRepository,
  DocumentEntityRepository,
  DocumentRepository,
  EdgeRepository,
  EntityRepository,
  InboxRepository,
  JobRepository,
  ProjectRepository,
  SystemConfigRepository,
} from './repositories/index.js';

type RepoCtor = new (provider: () => ReturnType<PrismaService['active']>) => unknown;

const REPO_CLASSES = [
  AdminUserRepository,
  AttachmentRepository,
  AuditLogRepository,
  AuthTokenRepository,
  DailyNoteRepository,
  DecisionRepository,
  DocumentEntityRepository,
  DocumentRepository,
  EdgeRepository,
  EntityRepository,
  InboxRepository,
  JobRepository,
  ProjectRepository,
  SystemConfigRepository,
] as const satisfies readonly RepoCtor[];

const providers: Provider[] = REPO_CLASSES.map((Ctor) => ({
  provide: Ctor,
  useFactory: (prisma: PrismaService): unknown => new Ctor(() => prisma.active()),
  inject: [PrismaService],
}));

@Global()
@Module({
  providers,
  exports: REPO_CLASSES as unknown as Provider[],
})
export class RepositoriesModule {}
