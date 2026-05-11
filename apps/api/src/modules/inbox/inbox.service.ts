import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditLogRepository,
  EdgeRepository,
  EntityRepository,
  type InboxListFilters,
  InboxRepository,
  PrismaService,
} from '@mnela/db';
import { publishEvent } from '@mnela/queue';
import type { InboxItem, LinkStatus, Prisma } from '@prisma/client';

import type { Principal } from '../../auth/types.js';
import { RedisService } from '../../redis.service.js';

export interface BulkInboxResult {
  batchId: string;
  accepted: { id: string }[];
  failed: { id: string; reason: string }[];
}

interface LinkSuggestionPayload {
  fromId: string;
  toId: string;
  relationType: string;
  confidence?: number;
  evidenceDocumentId?: string;
}

interface MergeSuggestionPayload {
  sourceId: string;
  targetId: string;
}

@Injectable()
export class InboxService {
  constructor(
    private readonly inbox: InboxRepository,
    private readonly edges: EdgeRepository,
    private readonly entities: EntityRepository,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogRepository,
  ) {}

  list(filters: InboxListFilters, page?: number, limit?: number) {
    return this.inbox.list(filters, { page, limit });
  }

  async findById(id: string): Promise<InboxItem> {
    const item = await this.inbox.findById(id);
    if (!item) throw new NotFoundException(`Inbox item ${id} not found`);
    return item;
  }

  async accept(
    id: string,
    principal: Principal | undefined,
    options: { batchId?: string } = {},
  ): Promise<{ item: InboxItem; sideEffect: unknown }> {
    const item = await this.findById(id);
    if (item.status !== 'pending') {
      throw new BadRequestException(`Inbox item ${id} is already ${item.status}`);
    }
    const sideEffect = await this.applyPayload(item);
    const actor = formatActor(principal);
    const resolved = await this.inbox.resolve(id, 'accepted', actor);
    await this.emitResolved(resolved, actor, 'accepted', options.batchId);
    return { item: resolved, sideEffect };
  }

  async reject(
    id: string,
    principal: Principal | undefined,
    options: { batchId?: string } = {},
  ): Promise<InboxItem> {
    const item = await this.findById(id);
    if (item.status !== 'pending') {
      throw new BadRequestException(`Inbox item ${id} is already ${item.status}`);
    }
    const actor = formatActor(principal);
    const resolved = await this.inbox.resolve(id, 'rejected', actor);
    await this.emitResolved(resolved, actor, 'rejected', options.batchId);
    return resolved;
  }

  async edit(
    id: string,
    payload: Record<string, unknown>,
    principal: Principal | undefined,
  ): Promise<{ item: InboxItem; sideEffect: unknown }> {
    const item = await this.findById(id);
    if (item.status !== 'pending') {
      throw new BadRequestException(`Inbox item ${id} is already ${item.status}`);
    }
    const updated = await this.inbox.updatePayload(id, payload as Prisma.InputJsonValue);
    return this.accept(updated.id, principal);
  }

  private async emitResolved(
    item: InboxItem,
    actor: string,
    status: 'accepted' | 'rejected',
    batchId: string | undefined,
  ): Promise<void> {
    await publishEvent(this.redis.client, {
      type: 'inbox.item_resolved',
      payload: {
        itemId: item.id,
        itemType: item.type,
        status,
        resolvedBy: actor,
        ...(batchId ? { batchId } : {}),
      },
    });
  }

  async acceptMany(ids: string[], principal: Principal | undefined): Promise<BulkInboxResult> {
    return this.bulk(ids, principal, 'accepted');
  }

  async rejectMany(ids: string[], principal: Principal | undefined): Promise<BulkInboxResult> {
    return this.bulk(ids, principal, 'rejected');
  }

  private async bulk(
    ids: string[],
    principal: Principal | undefined,
    mode: 'accepted' | 'rejected',
  ): Promise<BulkInboxResult> {
    const batchId = randomUUID();
    const actor = formatActor(principal);
    const accepted: { id: string }[] = [];
    const failed: { id: string; reason: string }[] = [];
    const auditAction = mode === 'accepted' ? 'inbox.bulk_accept_item' : 'inbox.bulk_reject_item';

    for (const id of ids) {
      try {
        await this.prisma.runInTx(async () => {
          const item = await this.inbox.findById(id);
          if (!item) throw new NotFoundException(`Inbox item ${id} not found`);
          if (item.status !== 'pending') {
            throw new BadRequestException(`Inbox item ${id} is already ${item.status}`);
          }
          if (mode === 'accepted') {
            await this.applyPayload(item);
          }
          const resolved = await this.inbox.resolve(id, mode, actor);
          await this.audit.create({
            action: auditAction,
            actor,
            targetType: 'InboxItem',
            targetId: id,
            after: resolved as unknown as Prisma.InputJsonValue,
            metadata: { batchId } as Prisma.InputJsonValue,
          });
          await this.emitResolved(resolved, actor, mode, batchId);
        });
        accepted.push({ id });
      } catch (err) {
        failed.push({ id, reason: (err as Error).message ?? 'unknown error' });
      }
    }

    return { batchId, accepted, failed };
  }

  private async applyPayload(item: InboxItem): Promise<unknown> {
    const payload = item.payload as unknown as Record<string, unknown>;
    switch (item.type) {
      case 'link_suggestion': {
        const p = payload as unknown as LinkSuggestionPayload;
        if (!p.fromId || !p.toId || !p.relationType) {
          throw new BadRequestException(
            'link_suggestion payload requires fromId, toId, relationType',
          );
        }
        return this.edges.create({
          fromId: p.fromId,
          toId: p.toId,
          relationType: p.relationType,
          confidence: typeof p.confidence === 'number' ? p.confidence : 1,
          status: 'manual' as LinkStatus,
          ...(p.evidenceDocumentId ? { evidenceDocumentId: p.evidenceDocumentId } : {}),
        });
      }
      case 'entity_merge_suggestion': {
        const p = payload as unknown as MergeSuggestionPayload;
        if (!p.sourceId || !p.targetId) {
          throw new BadRequestException(
            'entity_merge_suggestion payload requires sourceId, targetId',
          );
        }
        return this.entities.merge(p.sourceId, p.targetId);
      }
      // Other inbox types are reviewed-only; accept marks them acknowledged.
      case 'duplicate_detection':
      case 'enrichment_failed':
      case 'conflicting_decision':
        // These are reviewed-only — user marking them accepted means they acknowledged; no side effect.
        return null;
    }
  }
}

function formatActor(principal: Principal | undefined): string {
  if (!principal) return 'anonymous';
  return `${principal.kind}:${principal.name ?? principal.id}`;
}
