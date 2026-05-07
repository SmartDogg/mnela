import type { Prisma, SystemConfig } from '@prisma/client';

import type { PrismaProvider } from './types.js';

export class SystemConfigRepository {
  constructor(private readonly getPrisma: PrismaProvider) {}

  list(): Promise<SystemConfig[]> {
    return this.getPrisma().systemConfig.findMany({ orderBy: { key: 'asc' } });
  }

  get(key: string): Promise<SystemConfig | null> {
    return this.getPrisma().systemConfig.findUnique({ where: { key } });
  }

  set(key: string, value: Prisma.InputJsonValue): Promise<SystemConfig> {
    return this.getPrisma().systemConfig.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}
