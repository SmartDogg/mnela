import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type Prisma, PrismaClient } from '@prisma/client';

export type ActivePrisma = PrismaClient | Prisma.TransactionClient;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient;
  readonly als: AsyncLocalStorage<Prisma.TransactionClient>;

  constructor() {
    this.client = new PrismaClient({ log: ['warn', 'error'] });
    this.als = new AsyncLocalStorage<Prisma.TransactionClient>();
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  active(): ActivePrisma {
    return this.als.getStore() ?? this.client;
  }

  async runInTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const existing = this.als.getStore();
    if (existing) {
      return fn(existing);
    }
    return this.client.$transaction((tx) => this.als.run(tx, () => fn(tx)));
  }
}
