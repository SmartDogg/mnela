import { Injectable } from '@nestjs/common';
import { PrismaService, SystemConfigRepository } from '@mnela/db';
import type { Prisma, SystemConfig } from '@prisma/client';

export interface SystemStats {
  documents: number;
  entities: number;
  edges: number;
  projects: number;
  decisions: number;
  inboxPending: number;
  jobsQueued: number;
  dbSizeBytes: number;
}

@Injectable()
export class SystemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configRepo: SystemConfigRepository,
  ) {}

  async stats(): Promise<SystemStats> {
    const client = this.prisma.client;
    const [documents, entities, edges, projects, decisions, inboxPending, jobsQueued, sizeRows] =
      await Promise.all([
        client.document.count(),
        client.entity.count(),
        client.edge.count(),
        client.project.count(),
        client.decision.count(),
        client.inboxItem.count({ where: { status: 'pending' } }),
        client.job.count({ where: { status: 'queued' } }),
        client.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`,
      ]);
    const dbSizeBytes = sizeRows[0]?.size !== undefined ? Number(sizeRows[0].size) : 0;
    return {
      documents,
      entities,
      edges,
      projects,
      decisions,
      inboxPending,
      jobsQueued,
      dbSizeBytes,
    };
  }

  listConfig(): Promise<SystemConfig[]> {
    return this.configRepo.list();
  }

  setConfig(key: string, value: unknown): Promise<SystemConfig> {
    return this.configRepo.set(key, value as Prisma.InputJsonValue);
  }
}
