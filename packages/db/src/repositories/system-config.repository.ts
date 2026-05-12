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

  /**
   * Remove the override for `key`. Returns true if a row was deleted (the
   * spec falls back to its registry default) and false if no override existed.
   */
  async delete(key: string): Promise<boolean> {
    const result = await this.getPrisma().systemConfig.deleteMany({ where: { key } });
    return result.count > 0;
  }
}
