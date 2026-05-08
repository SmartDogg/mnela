import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Worker-side Prisma. Unlike the API service, the worker doesn't run an
 * HTTP-bound AuditInterceptor — ingestion writes are not audited (per ADR-0013).
 * The `active()` shape mirrors the API repository contract so the same
 * `@mnela/db` repository classes work unchanged.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient;

  constructor() {
    this.client = new PrismaClient({ log: ['warn', 'error'] });
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  active(): PrismaClient {
    return this.client;
  }
}
