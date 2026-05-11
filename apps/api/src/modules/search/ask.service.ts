import { randomUUID } from 'node:crypto';

import { streamClaude, type StreamHandle } from '@mnela/claude-runner';
import {
  AuditLogRepository,
  ConversationRepository,
  DocumentRepository,
  MessageRepository,
  PrismaService,
  scopeAllows,
} from '@mnela/db';
import {
  acquireSlot,
  publishEvent,
  readClaudeStatus,
  refreshSlot,
  releaseSlot,
} from '@mnela/queue';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { Principal } from '../../auth/types.js';
import { claudeMcpConfigPath, claudeVaultDir, loadEnv } from '../../env.js';
import { RedisService } from '../../redis.service.js';
import { CitationParser } from './citation-parser.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { SearchService } from './search.service.js';

const SLOT_TTL_SEC = 180;
const SLOT_REFRESH_INTERVAL_MS = 60_000;

export type AskFrameOut =
  | {
      event: 'meta';
      data: {
        conversationId: string;
        userMessageId: string;
        assistantMessageId: string;
        dumbMode: boolean;
      };
    }
  | { event: 'token'; data: { delta: string } }
  | {
      event: 'citation';
      data: { ord: number; docId: string; title: string | null; snippet: string };
    }
  | {
      event: 'done';
      data: {
        conversationId: string;
        messageId: string;
        totalTokensIn: number | null;
        totalTokensOut: number | null;
        durationMs: number;
        citationsTotal: number;
        dumbMode: boolean;
      };
    }
  | {
      event: 'error';
      data: {
        reason: 'rate-limit' | 'no-binary' | 'auth' | 'generic';
        resetAt?: string;
        message?: string;
      };
    };

export interface AskInput {
  query: string;
  conversationId?: string;
  /** Manual override: force 'fts' fallback regardless of Claude status. */
  forceMode?: 'auto' | 'fts';
  principal: Principal | undefined;
  abort: AbortSignal;
}

interface CitationRecord {
  ord: number;
  docId: string;
  title: string | null;
  snippet: string;
}

@Injectable()
export class AskService {
  private readonly logger = new Logger(AskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly conversations: ConversationsService,
    private readonly conversationsRepo: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly documents: DocumentRepository,
    private readonly audit: AuditLogRepository,
    private readonly search: SearchService,
  ) {}

  async *streamAsk(input: AskInput): AsyncGenerator<AskFrameOut> {
    if (input.principal && !scopeAllows(input.principal.scope, 'read_only')) {
      yield {
        event: 'error',
        data: { reason: 'auth', message: 'Insufficient scope' },
      };
      return;
    }

    const startedAt = Date.now();
    const adminUserId = await this.conversations.resolveAdminUserId(input.principal);
    const conversationId =
      input.conversationId ?? (await this.createConversation(adminUserId, input.query));
    const userMessage = await this.messages.append({
      conversationId,
      role: 'user',
      contentMd: input.query,
    });

    const status = await readClaudeStatus(this.redis.client);
    const claudeAvailable = status.available && input.forceMode !== 'fts';

    const assistantMessageId = randomUUID();

    yield {
      event: 'meta',
      data: {
        conversationId,
        userMessageId: userMessage.id,
        assistantMessageId,
        dumbMode: !claudeAvailable,
      },
    };

    if (!claudeAvailable) {
      yield* this.streamDumbMode({
        conversationId,
        assistantMessageId,
        query: input.query,
        startedAt,
        adminUserId,
      });
      return;
    }

    yield* this.streamSmart({
      conversationId,
      assistantMessageId,
      query: input.query,
      startedAt,
      adminUserId,
      abort: input.abort,
    });
  }

  private async createConversation(adminUserId: string, query: string): Promise<string> {
    const title =
      query.length > 60 ? `${query.slice(0, 60).trimEnd()}…` : query.trim() || 'Untitled';
    const conv = await this.conversationsRepo.create({ adminUserId, title });
    return conv.id;
  }

  private async *streamDumbMode(args: {
    conversationId: string;
    assistantMessageId: string;
    query: string;
    startedAt: number;
    adminUserId: string;
  }): AsyncGenerator<AskFrameOut> {
    const env = loadEnv();
    const result = await this.search.searchFts({
      query: args.query,
      filters: undefined,
      limit: env.ASK_DUMB_MODE_FTS_LIMIT,
      page: 1,
    });

    const cites: CitationRecord[] = [];
    const lines: string[] = [
      'AI Smart Mode is disabled — showing keyword search results only.',
      '',
    ];

    if (result.hits.length === 0) {
      lines.push('No matching documents found.');
    } else {
      result.hits.forEach((hit, idx) => {
        const ord = idx + 1;
        cites.push({
          ord,
          docId: hit.documentId,
          title: hit.title,
          snippet: stripHtml(hit.snippet ?? '').slice(0, 200) || hit.title,
        });
        lines.push(`- [${ord}] ${hit.title}`);
      });
    }
    const body = lines.join('\n');

    yield { event: 'token', data: { delta: body } };
    for (const c of cites) {
      yield { event: 'citation', data: c };
    }

    const durationMs = Date.now() - args.startedAt;
    await this.persistAssistantMessage({
      conversationId: args.conversationId,
      assistantMessageId: args.assistantMessageId,
      contentMd: body,
      cites,
      durationMs,
      dumbMode: true,
      aborted: false,
      auditAction: 'ask.completed',
      auditMetadata: { durationMs, citationsTotal: cites.length, dumbMode: true },
    });

    yield {
      event: 'done',
      data: {
        conversationId: args.conversationId,
        messageId: args.assistantMessageId,
        totalTokensIn: null,
        totalTokensOut: null,
        durationMs,
        citationsTotal: cites.length,
        dumbMode: true,
      },
    };
  }

  private async *streamSmart(args: {
    conversationId: string;
    assistantMessageId: string;
    query: string;
    startedAt: number;
    adminUserId: string;
    abort: AbortSignal;
  }): AsyncGenerator<AskFrameOut> {
    const env = loadEnv();
    const sessionId = randomUUID();
    const acquired = await acquireSlot(this.redis.client, 'ask', sessionId, SLOT_TTL_SEC);
    if (!acquired) {
      this.logger.warn(`ask: could not acquire claude slot — running anyway (best-effort)`);
    }
    const refresher = setInterval(() => {
      void refreshSlot(this.redis.client, sessionId, SLOT_TTL_SEC);
    }, SLOT_REFRESH_INTERVAL_MS);

    const ac = new AbortController();
    const propagate = (): void => ac.abort();
    args.abort.addEventListener('abort', propagate, { once: true });

    let handle: StreamHandle | null = null;
    let bodyBuf = '';
    let assistantBody = '';
    const pendingCites: CitationRecord[] = [];
    const allCites: CitationRecord[] = [];
    let aborted = false;
    let errorEmitted = false;

    const parser = new CitationParser({
      onText(delta) {
        bodyBuf += delta;
        assistantBody += delta;
      },
      onCitation(c) {
        const record: CitationRecord = {
          ord: c.ord,
          docId: c.docId,
          title: null,
          snippet: c.snippet,
        };
        pendingCites.push(record);
        allCites.push(record);
      },
    });

    try {
      handle = streamClaude({
        prompt: askPrompt(args.query),
        mcpConfig: claudeMcpConfigPath(env),
        addDirs: [claudeVaultDir(env)],
        bin: env.MNELA_CLAUDE_BIN,
        timeoutMs: env.MNELA_CLAUDE_TIMEOUT_MS,
        outputFormat: 'stream-json',
        signal: ac.signal,
        env: {
          DATABASE_URL: env.DATABASE_URL,
          REDIS_URL: env.REDIS_URL,
          MNELA_DATA_DIR: env.MNELA_DATA_DIR,
          MNELA_LOG_LEVEL: env.MNELA_LOG_LEVEL,
        },
      });

      for await (const frame of handle.frames) {
        if (args.abort.aborted) {
          aborted = true;
          handle.abort();
          break;
        }
        if (
          frame.type === 'system' &&
          (frame as { subtype?: string }).subtype === 'api_retry' &&
          (frame as { error?: string }).error === 'rate_limit'
        ) {
          errorEmitted = true;
          handle.abort();
          yield { event: 'error', data: { reason: 'rate-limit' } };
          break;
        }
        if (frame.type === 'stream_event') {
          const event = (frame as { event?: { delta?: { text?: string } } }).event;
          const text = event?.delta?.text;
          if (text) {
            parser.feed(text);
            if (bodyBuf.length > 0) {
              const delta = bodyBuf;
              bodyBuf = '';
              yield { event: 'token', data: { delta } };
            }
            while (pendingCites.length > 0) {
              const c = pendingCites.shift()!;
              yield { event: 'citation', data: c };
            }
          }
        }
      }

      const finalized = await handle.finalize();
      if (!errorEmitted) {
        // Some Claude versions only stream the final text via result.result, not stream_event.
        if (bodyBuf.length === 0 && finalized.result?.result) {
          parser.feed(finalized.result.result);
        }
        parser.end();
        if (bodyBuf.length > 0) {
          const delta = bodyBuf;
          bodyBuf = '';
          yield { event: 'token', data: { delta } };
        }
        while (pendingCites.length > 0) {
          const c = pendingCites.shift()!;
          yield { event: 'citation', data: c };
        }

        if (finalized.rateLimitHit) {
          errorEmitted = true;
          yield {
            event: 'error',
            data: {
              reason: 'rate-limit',
              ...(finalized.rateLimitHit.resetAt
                ? { resetAt: finalized.rateLimitHit.resetAt.toISOString() }
                : {}),
            },
          };
        } else if (finalized.authError) {
          errorEmitted = true;
          yield { event: 'error', data: { reason: 'auth', message: finalized.authError } };
        } else if (finalized.exitCode !== 0 && !aborted) {
          errorEmitted = true;
          yield {
            event: 'error',
            data: { reason: 'generic', message: `claude exited ${finalized.exitCode}` },
          };
        }
      }

      const tokensIn = readUsage(finalized.result?.usage, 'input_tokens');
      const tokensOut = readUsage(finalized.result?.usage, 'output_tokens');
      const durationMs = finalized.result?.duration_ms ?? Date.now() - args.startedAt;
      const collected = await this.annotateCitations(allCites);

      await this.persistAssistantMessage({
        conversationId: args.conversationId,
        assistantMessageId: args.assistantMessageId,
        contentMd: assistantBody,
        cites: collected,
        durationMs,
        dumbMode: false,
        aborted,
        tokensIn,
        tokensOut,
        auditAction: aborted ? 'ask.aborted' : errorEmitted ? 'ask.failed' : 'ask.completed',
        auditMetadata: {
          durationMs,
          tokensIn,
          tokensOut,
          citationsTotal: collected.length,
          dumbMode: false,
          aborted,
          errorEmitted,
        },
      });

      if (!errorEmitted) {
        yield {
          event: 'done',
          data: {
            conversationId: args.conversationId,
            messageId: args.assistantMessageId,
            totalTokensIn: tokensIn,
            totalTokensOut: tokensOut,
            durationMs,
            citationsTotal: collected.length,
            dumbMode: false,
          },
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`ask: stream failed: ${message}`);
      if (!errorEmitted) {
        yield { event: 'error', data: { reason: 'generic', message } };
      }
    } finally {
      args.abort.removeEventListener('abort', propagate);
      clearInterval(refresher);
      if (acquired) await releaseSlot(this.redis.client, sessionId).catch(() => undefined);
    }
  }

  /**
   * Looks up each cite's source document title for richer chip rendering.
   * Keeps the original ords (the body's `[N]` markers already shipped over SSE);
   * citations pointing at non-existent documents are kept with title=null so the
   * UI can show "missing source" rather than silently dropping the bracket.
   */
  private async annotateCitations(cites: CitationRecord[]): Promise<CitationRecord[]> {
    if (cites.length === 0) return [];
    const ids = Array.from(new Set(cites.map((c) => c.docId)));
    const docs = await this.documents.findManyByIds(ids);
    const titleByDocId = new Map<string, string>();
    for (const d of docs) titleByDocId.set(d.id, d.title);
    return cites.map((c) => ({
      ord: c.ord,
      docId: c.docId,
      title: titleByDocId.get(c.docId) ?? null,
      snippet: c.snippet,
    }));
  }

  private async persistAssistantMessage(args: {
    conversationId: string;
    assistantMessageId: string;
    contentMd: string;
    cites: CitationRecord[];
    durationMs: number;
    dumbMode: boolean;
    aborted: boolean;
    tokensIn?: number | null;
    tokensOut?: number | null;
    auditAction: string;
    auditMetadata: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.runInTx(async () => {
      const created = await this.messages.append({
        id: args.assistantMessageId,
        conversationId: args.conversationId,
        role: 'assistant',
        contentMd: args.contentMd,
        citations: args.cites as unknown as Prisma.InputJsonValue,
        tokensIn: args.tokensIn ?? null,
        tokensOut: args.tokensOut ?? null,
        durationMs: args.durationMs,
        dumbMode: args.dumbMode,
        aborted: args.aborted,
      });
      await this.conversationsRepo.touch(args.conversationId);
      await this.audit.create({
        action: args.auditAction,
        actor: 'system:api',
        targetType: 'Conversation',
        targetId: args.conversationId,
        metadata: {
          ...args.auditMetadata,
          messageId: created.id,
        } as Prisma.InputJsonValue,
      });
    });
    await publishEvent(this.redis.client, {
      type: 'system.claude_status_changed',
      payload: { available: true },
    }).catch(() => undefined);
  }
}

function askPrompt(query: string): string {
  return [
    'You are answering a question for the Mnela second-brain owner.',
    'Use mnela_find_similar first to discover 5-10 candidate documents, then read targeted chunks via mnela_get_chunks.',
    'Wrap every claim grounded in a source document in <cite doc-id="THE_DOCUMENT_CUID">verbatim snippet ≤120 chars</cite>. Never invent doc-ids.',
    'Do not cite the same document twice in adjacent sentences — group claims.',
    'If evidence is insufficient, say so plainly. Do not guess.',
    'Answer in the user’s language (Russian if the question is in Russian, English otherwise).',
    '',
    `Question: ${query}`,
  ].join('\n');
}

function readUsage(usage: Record<string, unknown> | undefined, key: string): number | null {
  if (!usage) return null;
  const v = usage[key];
  return typeof v === 'number' ? v : null;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}
