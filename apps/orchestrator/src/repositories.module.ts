import {
  AttachmentRepository,
  DocumentEntityRepository,
  DocumentRepository,
  EdgeRepository,
  EntityRepository,
  InboxRepository,
  JobRepository,
  PrismaService,
  SystemConfigRepository,
} from '@mnela/db';
import { Global, Module, type Provider } from '@nestjs/common';

type RepoCtor = new (provider: () => ReturnType<PrismaService['active']>) => unknown;

const REPO_CLASSES = [
  DocumentRepository,
  DocumentEntityRepository,
  EntityRepository,
  EdgeRepository,
  InboxRepository,
  JobRepository,
  AttachmentRepository,
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
