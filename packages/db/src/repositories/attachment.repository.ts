import type { Attachment, Prisma } from '@prisma/client';

import type { PrismaProvider } from './types.js';

export interface CreateAttachmentInput {
  documentId?: string | null;
  filename: string;
  mimeType: string;
  size: number;
  path: string;
  contentHash: string;
  metadata?: Prisma.InputJsonValue;
}

export class AttachmentRepository {
  constructor(private readonly getPrisma: PrismaProvider) {}

  create(input: CreateAttachmentInput): Promise<Attachment> {
    return this.getPrisma().attachment.create({ data: input });
  }

  findById(id: string): Promise<Attachment | null> {
    return this.getPrisma().attachment.findUnique({ where: { id } });
  }

  findByContentHash(contentHash: string): Promise<Attachment[]> {
    return this.getPrisma().attachment.findMany({ where: { contentHash } });
  }

  listForDocument(documentId: string): Promise<Attachment[]> {
    return this.getPrisma().attachment.findMany({
      where: { documentId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
