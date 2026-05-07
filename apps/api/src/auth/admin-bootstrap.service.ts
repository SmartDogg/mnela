import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AdminUserRepository } from '@mnela/db';
import argon2 from 'argon2';

import { loadEnv } from '../env.js';

@Injectable()
export class AdminBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrap.name);

  constructor(private readonly admins: AdminUserRepository) {}

  async onApplicationBootstrap(): Promise<void> {
    const env = loadEnv();
    if (!env.ADMIN_INITIAL_USERNAME || !env.ADMIN_INITIAL_PASSWORD) {
      return;
    }
    const existing = await this.admins.count();
    if (existing > 0) {
      return;
    }
    const passwordHash = await argon2.hash(env.ADMIN_INITIAL_PASSWORD, {
      type: argon2.argon2id,
    });
    await this.admins.create({
      username: env.ADMIN_INITIAL_USERNAME,
      passwordHash,
    });
    this.logger.log(`bootstrapped initial admin user "${env.ADMIN_INITIAL_USERNAME}"`);
  }
}
