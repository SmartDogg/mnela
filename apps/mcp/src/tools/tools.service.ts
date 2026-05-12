import { Injectable } from '@nestjs/common';
import {
  AttachmentRepository,
  AuditLogRepository,
  DailyNoteRepository,
  DecisionRepository,
  DocumentEntityRepository,
  DocumentRepository,
  EdgeRepository,
  EntityRepository,
  InboxRepository,
  JobRepository,
  PrismaService,
  type Principal,
  ProjectRepository,
} from '@mnela/db';
import { type McpToolContext, PHASE_5_TOOLS, type ToolDefinition } from '@mnela/mcp-tools';
import { publishEvent } from '@mnela/queue';
import { HybridSearchAdapter } from '@mnela/search';

import { QueueService } from '../queue/queue.service.js';
import { RedisService } from '../redis/redis.service.js';

@Injectable()
export class ToolsService {
  private readonly searchAdapter: HybridSearchAdapter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly queues: QueueService,
    private readonly documents: DocumentRepository,
    private readonly entities: EntityRepository,
    private readonly edges: EdgeRepository,
    private readonly documentEntities: DocumentEntityRepository,
    private readonly inbox: InboxRepository,
    private readonly projects: ProjectRepository,
    private readonly decisions: DecisionRepository,
    private readonly daily: DailyNoteRepository,
    private readonly jobs: JobRepository,
    private readonly audit: AuditLogRepository,
    private readonly attachments: AttachmentRepository,
  ) {
    this.searchAdapter = new HybridSearchAdapter(() => this.prisma.active());
  }

  getToolList(): readonly ToolDefinition<unknown, unknown>[] {
    return PHASE_5_TOOLS;
  }

  buildContext(principal: Principal): McpToolContext {
    const search = {
      findSimilar: async (text: string, limit: number) => {
        const trimmed = text.length > 600 ? text.slice(0, 600) : text;
        const result = await this.searchAdapter.search({ query: trimmed, page: 1, limit });
        return result.hits.map((h) => {
          const out: { documentId: string; title: string; snippet?: string; score: number } = {
            documentId: h.documentId,
            title: h.title,
            score: h.score,
          };
          if (h.snippet) out.snippet = h.snippet;
          return out;
        });
      },
      search: (opts: Parameters<HybridSearchAdapter['search']>[0]) =>
        this.searchAdapter.search(opts),
    };

    const events = {
      graphNodeAdded: (entity: { id: string; name: string; type: string }) =>
        publishEvent(this.redis.client, { type: 'graph.node_added', payload: { entity } }).then(
          () => undefined,
        ),
      graphEdgeAdded: (edge: { id: string; fromId: string; toId: string; relationType: string }) =>
        publishEvent(this.redis.client, { type: 'graph.edge_added', payload: { edge } }).then(
          () => undefined,
        ),
      inboxItemAdded: (item: { itemId: string; itemType: string; title: string }) =>
        publishEvent(this.redis.client, { type: 'inbox.item_added', payload: item }).then(
          () => undefined,
        ),
    };

    return {
      documents: this.documents,
      attachments: this.attachments,
      entities: this.entities,
      edges: this.edges,
      documentEntities: this.documentEntities,
      inbox: this.inbox,
      projects: this.projects,
      decisions: this.decisions,
      daily: this.daily,
      jobs: this.jobs,
      audit: this.audit,
      auditTx: (fn) => this.prisma.runInTx(fn),
      principal,
      search,
      events,
      enrichmentQueue: this.queues.enrichment,
      indexingQueue: this.queues.indexing,
    };
  }
}
