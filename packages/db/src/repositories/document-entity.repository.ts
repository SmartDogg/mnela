import type { DocumentEntity } from '@prisma/client';

import type { PrismaProvider } from './types.js';

export class DocumentEntityRepository {
  constructor(private readonly getPrisma: PrismaProvider) {}

  upsert(
    documentId: string,
    entityId: string,
    mentions = 1,
    context?: string,
  ): Promise<DocumentEntity> {
    return this.getPrisma().documentEntity.upsert({
      where: { documentId_entityId: { documentId, entityId } },
      create: { documentId, entityId, mentions, context: context ?? null },
      update: { mentions: { increment: mentions } },
    });
  }

  listByDocument(documentId: string): Promise<DocumentEntity[]> {
    return this.getPrisma().documentEntity.findMany({ where: { documentId } });
  }

  listByEntity(entityId: string): Promise<DocumentEntity[]> {
    return this.getPrisma().documentEntity.findMany({ where: { entityId } });
  }
}
