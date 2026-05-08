import { Global, Module, type Provider } from '@nestjs/common';
import {
  AttachmentRepository,
  DocumentEntityRepository,
  DocumentRepository,
  EntityRepository,
  JobRepository,
  ProjectRepository,
} from '@mnela/db';

import { PrismaService } from './prisma.service.js';

type RepoCtor = new (provider: () => ReturnType<PrismaService['active']>) => unknown;

const REPO_CLASSES = [
  AttachmentRepository,
  DocumentEntityRepository,
  DocumentRepository,
  EntityRepository,
  JobRepository,
  ProjectRepository,
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
