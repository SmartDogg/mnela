import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { type EnrichmentJob, type IndexingJob, createQueueConnection } from '@mnela/queue';
import { Queue } from 'bullmq';

import { loadEnv } from '../env.js';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  readonly enrichment: Queue<EnrichmentJob>;
  readonly indexing: Queue<IndexingJob>;
  private readonly connections: ReturnType<typeof createQueueConnection>[];

  constructor() {
    const env = loadEnv();
    const enrichmentConn = createQueueConnection(env.REDIS_URL);
    const indexingConn = createQueueConnection(env.REDIS_URL);
    this.connections = [enrichmentConn, indexingConn];
    this.enrichment = new Queue<EnrichmentJob>('enrichment', { connection: enrichmentConn });
    this.indexing = new Queue<IndexingJob>('indexing', { connection: indexingConn });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.enrichment.close(), this.indexing.close()]);
    for (const conn of this.connections) {
      await conn.quit().catch(() => undefined);
    }
    this.logger.log('closed bullmq queues');
  }
}
