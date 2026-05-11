import type { AdminUser } from '@prisma/client';

import type { PrismaProvider } from './types.js';

export interface CreateAdminUserInput {
  username: string;
  passwordHash: string;
}

export class AdminUserRepository {
  constructor(private readonly getPrisma: PrismaProvider) {}

  create(input: CreateAdminUserInput): Promise<AdminUser> {
    return this.getPrisma().adminUser.create({ data: input });
  }

  findByUsername(username: string): Promise<AdminUser | null> {
    return this.getPrisma().adminUser.findUnique({ where: { username } });
  }

  findById(id: string): Promise<AdminUser | null> {
    return this.getPrisma().adminUser.findUnique({ where: { id } });
  }

  findFirst(): Promise<AdminUser | null> {
    return this.getPrisma().adminUser.findFirst({ orderBy: { createdAt: 'asc' } });
  }

  count(): Promise<number> {
    return this.getPrisma().adminUser.count();
  }

  touchLastLogin(id: string): Promise<AdminUser> {
    return this.getPrisma().adminUser.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }
}
