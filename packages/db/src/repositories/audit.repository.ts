import type { AuditLog, Prisma } from '@prisma/client';

import type { PrismaProvider } from './types.js';

export interface CreateAuditLogInput {
  action: string;
  actor: string;
  targetType: string;
  targetId: string;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  metadata?: Prisma.InputJsonValue | null;
}

export class AuditLogRepository {
  constructor(private readonly getPrisma: PrismaProvider) {}

  create(input: CreateAuditLogInput): Promise<AuditLog> {
    const data: Prisma.AuditLogCreateInput = {
      action: input.action,
      actor: input.actor,
      targetType: input.targetType,
      targetId: input.targetId,
    };
    if (input.before !== undefined && input.before !== null) data.before = input.before;
    if (input.after !== undefined && input.after !== null) data.after = input.after;
    if (input.metadata !== undefined && input.metadata !== null) data.metadata = input.metadata;
    return this.getPrisma().auditLog.create({ data });
  }

  countByTarget(targetType: string, targetId: string): Promise<number> {
    return this.getPrisma().auditLog.count({ where: { targetType, targetId } });
  }
}
