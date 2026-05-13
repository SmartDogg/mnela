import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  AttachmentRepository,
  AuditLogRepository,
  ConversationRepository,
  DecisionRepository,
  DocumentEntityRepository,
  DocumentRepository,
  EdgeRepository,
  EntityRepository,
  InboxRepository,
  JobRepository,
  MessageRepository,
  PrismaService,
  ProjectRepository,
  scopeAllows,
} from '@mnela/db';
import {
  type LLMProvider,
  type ProviderFrame,
  type ProviderMessage,
  runAgentLoop,
} from '@mnela/llm-providers';
import { PHASE_5_TOOLS } from '@mnela/mcp-tools';
import {
  acquireSlot,
  publishEvent,
  readClaudeStatus,
  refreshSlot,
  releaseSlot,
} from '@mnela/queue';
import { HybridSearchAdapter } from '@mnela/search';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { McpToolContext } from '@mnela/mcp-tools';

import type { Principal } from '../../auth/types.js';
import { loadEnv, resolvedDataDir } from '../../env.js';
import { QueueService } from '../../queue/queue.service.js';
import { RedisService } from '../../redis.service.js';
import { sha256File } from '../imports/upload.config.js';
import { ProvidersService } from '../providers/providers.service.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { AskAttachmentsService, type StagedAttachment } from './ask-attachments.service.js';
import { SearchService } from './search.service.js';

const SLOT_TTL_SEC = 180;
const SLOT_REFRESH_INTERVAL_MS = 60_000;
/** Emit SSE heartbeats so proxies (nginx etc.) don't drop a quiet stream. */
const HEARTBEAT_INTERVAL_MS = 15_000;
/** Abort if the provider goes this long without yielding ANY frame. */
const IDLE_TIMEOUT_MS = 60_000;
/** Max bytes of a single attached text-like file inlined into the prompt. */
const ATTACHMENT_INLINE_BYTES = 16_384;

/**
 * Public, app-level vocabulary. The DB enum still stores
 * `ephemeral|pinned` — that's a legacy of ADR-0050. The rename to
 * `chat|ingest` happens only at the controller / service / UI boundary;
 * see {@link toDbKind}. The read-side translation lives in
 * conversations.controller (it's the only place that surfaces stored
 * messages to the client).
 */
export type AskMessageKind = 'chat' | 'ingest';

type DbMessageKind = 'ephemeral' | 'pinned';

function toDbKind(kind: AskMessageKind): DbMessageKind {
  return kind === 'ingest' ? 'pinned' : 'ephemeral';
}

export type AskFrameOut =
  | {
      event: 'meta';
      data: {
        conversationId: string;
        userMessageId: string;
        assistantMessageId: string;
        dumbMode: boolean;
        providerId: string;
        providerName: string;
        kind: AskMessageKind;
        attachments: { id: string; filename: string; mimeType: string; size: number }[];
      };
    }
  | { event: 'token'; data: { delta: string } }
  | {
      event: 'tool_call';
      data: { id: string; name: string; input: unknown };
    }
  | {
      event: 'tool_result';
      data: { id: string; name: string; ok: boolean; error?: string };
    }
  | {
      event: 'citation';
      data: { ord: number; docId: string; title: string | null; snippet: string };
    }
  | {
      event: 'pinned';
      data: {
        messageId: string;
        documentId: string;
        attachedFiles: { jobId: string; filename: string }[];
      };
    }
  | { event: 'heartbeat'; data: { ts: number } }
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
        kind: AskMessageKind;
        pinnedDocumentId?: string;
        attachedFiles?: { jobId: string; filename: string }[];
      };
    }
  | {
      event: 'error';
      data: {
        reason: 'rate-limit' | 'no-binary' | 'auth' | 'timeout' | 'generic';
        resetAt?: string;
        message?: string;
      };
    };

export interface AskInput {
  query: string;
  conversationId?: string;
  /** Manual override: force 'fts' fallback regardless of Claude status. */
  forceMode?: 'auto' | 'fts';
  kind?: AskMessageKind;
  attachmentIds?: readonly string[];
  principal: Principal | undefined;
  abort: AbortSignal;
  /**
   * ADR-0051 scope. When set, the agent loop's search tools (FTS,
   * find_similar) prepend this project slug to their filters so the
   * model only sees documents the user pinned to this project. Manual
   * dropdown in the /ask composer → URL param `scope=project:<slug>`.
   */
  scopeProjectSlug?: string;
}

interface CitationRecord {
  ord: number;
  docId: string;
  title: string | null;
  snippet: string;
}

interface IngestedAttachment {
  jobId: string;
  filename: string;
}

@Injectable()
export class AskService {
  private readonly logger = new Logger(AskService.name);
  private readonly uploadsDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly conversations: ConversationsService,
    private readonly conversationsRepo: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly documents: DocumentRepository,
    private readonly audit: AuditLogRepository,
    private readonly search: SearchService,
    private readonly providers: ProvidersService,
    private readonly queues: QueueService,
    private readonly askAttachments: AskAttachmentsService,
    // Repositories used to build the tool context for the in-process agent
    // loop (mirrors apps/mcp/src/tools/tools.service.ts).
    private readonly attachments: AttachmentRepository,
    private readonly entities: EntityRepository,
    private readonly edges: EdgeRepository,
    private readonly documentEntities: DocumentEntityRepository,
    private readonly inbox: InboxRepository,
    private readonly projects: ProjectRepository,
    private readonly decisions: DecisionRepository,
    private readonly jobs: JobRepository,
  ) {
    const env = loadEnv();
    this.uploadsDir = path.resolve(resolvedDataDir(env), 'uploads');
  }

  /**
   * Aggregate the /ask sidebar's "Memory" view: ingested chat turns AND
   * migrated daily notes, grouped by the day they landed in the brain.
   * Ingested chat day = createdAt::date; daily-note day = metadata.date
   * (or sourceId as fallback).
   */
  async getPinnedByDay(limit = 200): Promise<{
    days: {
      date: string;
      documents: {
        id: string;
        title: string;
        source: 'chat' | 'daily';
        conversationId?: string;
        assistantMessageId?: string;
      }[];
    }[];
  }> {
    const docs = await this.documents.listPinnedAndDaily(undefined, limit);
    const byDay = new Map<
      string,
      {
        id: string;
        title: string;
        source: 'chat' | 'daily';
        conversationId?: string;
        assistantMessageId?: string;
      }[]
    >();
    for (const d of docs) {
      const source = d.source as 'chat' | 'daily';
      const metadata = (d.metadata ?? {}) as {
        date?: string;
        conversationId?: string;
        assistantMessageId?: string;
      };
      const day =
        source === 'daily'
          ? (metadata.date ?? d.sourceId ?? d.createdAt.toISOString().slice(0, 10))
          : d.createdAt.toISOString().slice(0, 10);
      const entry: {
        id: string;
        title: string;
        source: 'chat' | 'daily';
        conversationId?: string;
        assistantMessageId?: string;
      } = { id: d.id, title: d.title, source };
      if (source === 'chat') {
        if (metadata.conversationId) entry.conversationId = metadata.conversationId;
        if (metadata.assistantMessageId) entry.assistantMessageId = metadata.assistantMessageId;
      }
      const bucket = byDay.get(day) ?? [];
      bucket.push(entry);
      byDay.set(day, bucket);
    }
    const days = Array.from(byDay.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, documents]) => ({ date, documents }));
    return { days };
  }

  async *streamAsk(input: AskInput): AsyncGenerator<AskFrameOut> {
    if (input.principal && !scopeAllows(input.principal.scope, 'read_only')) {
      yield {
        event: 'error',
        data: { reason: 'auth', message: 'Insufficient scope' },
      };
      return;
    }

    const startedAt = Date.now();
    const kind: AskMessageKind = input.kind ?? 'chat';
    const adminUserId = await this.conversations.resolveAdminUserId(input.principal);
    const conversationId =
      input.conversationId ?? (await this.createConversation(adminUserId, input.query));

    // Consume staged attachments up-front so a typo'd id fails fast,
    // before we burn a Claude slot. Ownership-checked against the
    // current principal — never accept attachment ids on behalf of
    // a different user.
    let staged: StagedAttachment[] = [];
    if (input.attachmentIds && input.attachmentIds.length > 0) {
      try {
        staged = await this.askAttachments.consume(
          input.attachmentIds,
          principalOwnerKey(input.principal),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        yield { event: 'error', data: { reason: 'generic', message } };
        return;
      }
    }

    const userMessage = await this.messages.append({
      conversationId,
      role: 'user',
      kind: toDbKind(kind),
      contentMd: input.query,
    });

    const provider = await this.providers.resolveForFeature('ask');
    const status = await readClaudeStatus(this.redis.client);
    // For the built-in CLI we honour the Redis-cached status; for other
    // providers we trust resolveForFeature to have given us a usable one.
    const usingCli = provider.config.kind === 'claude_cli';
    const claudeAvailable = usingCli
      ? status.available && input.forceMode !== 'fts'
      : input.forceMode !== 'fts';

    const assistantMessageId = randomUUID();

    yield {
      event: 'meta',
      data: {
        conversationId,
        userMessageId: userMessage.id,
        assistantMessageId,
        dumbMode: !claudeAvailable,
        providerId: provider.config.id,
        providerName: provider.config.name,
        kind,
        attachments: staged.map((s) => ({
          id: s.id,
          filename: s.filename,
          mimeType: s.mimeType,
          size: s.size,
        })),
      },
    };

    if (!claudeAvailable) {
      // Dumb mode doesn't grant brain access; we still discard any
      // staged files so they don't linger in .chat-staging/.
      try {
        yield* this.streamDumbMode({
          conversationId,
          assistantMessageId,
          query: input.query,
          startedAt,
          adminUserId,
          kind,
        });
      } finally {
        await this.discardStagedFiles(staged);
      }
      return;
    }

    // In ingest mode we promote the user's files to the brain BEFORE
    // running the LLM — that way the agent loop's mnela_find_similar
    // / mnela_get_chunks can already pick them up if ingestion lands
    // fast enough. In chat mode we keep the files in staging and
    // delete them in the finally.
    let ingestedAttachments: IngestedAttachment[] = [];
    let stagedFilesOwnedByCaller: StagedAttachment[] = staged;
    if (kind === 'ingest' && staged.length > 0) {
      ingestedAttachments = await this.enqueueAttachmentIngestion(
        staged,
        conversationId,
        assistantMessageId,
      );
      // Ingested files are now renamed into uploads/<batchId>-<name>
      // and owned by the BullMQ queue — we must NOT delete them in
      // finally. Drop them from the caller-disposal list.
      stagedFilesOwnedByCaller = [];
    }

    const composedQuery = await this.composePromptWithAttachments(input.query, staged, kind);

    try {
      yield* this.streamSmart({
        provider,
        conversationId,
        assistantMessageId,
        userMessageId: userMessage.id,
        userQuery: input.query,
        query: composedQuery,
        startedAt,
        adminUserId,
        abort: input.abort,
        principal: input.principal,
        kind,
        ingestedAttachments,
        ...(input.scopeProjectSlug ? { scopeProjectSlug: input.scopeProjectSlug } : {}),
      });
    } finally {
      await this.discardStagedFiles(stagedFilesOwnedByCaller);
    }
  }

  private async createConversation(adminUserId: string, query: string): Promise<string> {
    const title =
      query.length > 60 ? `${query.slice(0, 60).trimEnd()}…` : query.trim() || 'Untitled';
    const conv = await this.conversationsRepo.create({ adminUserId, title });
    return conv.id;
  }

  /**
   * Build the user-message string the LLM actually sees. Text-like
   * attachments are inlined up to ATTACHMENT_INLINE_BYTES so the model
   * can quote / reason over them; non-text attachments are mentioned
   * by name so the model knows they exist (vision/binary handling
   * happens through the ingestion pipeline in `ingest` mode).
   */
  private async composePromptWithAttachments(
    query: string,
    staged: readonly StagedAttachment[],
    kind: AskMessageKind,
  ): Promise<string> {
    if (staged.length === 0) return query;
    const blocks: string[] = [];
    for (const att of staged) {
      const inlineable = isTextLikeMime(att.mimeType, att.filename);
      if (inlineable) {
        try {
          const handle = await fs.open(att.storedPath, 'r');
          try {
            const buf = Buffer.alloc(ATTACHMENT_INLINE_BYTES);
            const { bytesRead } = await handle.read(buf, 0, ATTACHMENT_INLINE_BYTES, 0);
            const text = buf.subarray(0, bytesRead).toString('utf8');
            const truncated = att.size > bytesRead;
            blocks.push(
              [
                `[Attached file: ${att.filename} (${att.mimeType}, ${att.size} bytes${truncated ? ', truncated' : ''})]`,
                '',
                text,
                truncated ? `…[truncated at ${ATTACHMENT_INLINE_BYTES} bytes]` : '',
              ]
                .filter(Boolean)
                .join('\n'),
            );
          } finally {
            await handle.close();
          }
        } catch (err) {
          this.logger.warn(
            `ask: failed to inline ${att.filename}: ${err instanceof Error ? err.message : String(err)}`,
          );
          blocks.push(`[Attached file: ${att.filename} — unreadable]`);
        }
      } else if (kind === 'ingest') {
        blocks.push(
          `[Attached file: ${att.filename} (${att.mimeType}) — uploaded to the brain; search results may include its content once ingestion finishes.]`,
        );
      } else {
        blocks.push(
          `[Attached file: ${att.filename} (${att.mimeType}) — switch to "Feed brain" to add this to the knowledge graph.]`,
        );
      }
    }
    return [...blocks, '---', `Question: ${query}`].join('\n\n');
  }

  /**
   * Mirror ImportsService.createFromUpload for every staged attachment:
   * rename into uploads/<batchId>-<name>, hash, create a Job row, and
   * push an `ingest_file` BullMQ entry. importBatchId binds the upload
   * to the originating /ask turn so the /jobs UI groups them and the
   * Q&A Document can list its companions via metadata.
   */
  private async enqueueAttachmentIngestion(
    staged: readonly StagedAttachment[],
    conversationId: string,
    assistantMessageId: string,
  ): Promise<IngestedAttachment[]> {
    const importBatchId = `${conversationId}:${assistantMessageId}`;
    await fs.mkdir(this.uploadsDir, { recursive: true });
    const out: IngestedAttachment[] = [];
    for (const att of staged) {
      try {
        const safeName = att.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
        const dest = path.join(this.uploadsDir, `${importBatchId}-${out.length}-${safeName}`);
        try {
          await fs.rename(att.storedPath, dest);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'EXDEV') {
            await fs.copyFile(att.storedPath, dest);
            await fs.unlink(att.storedPath).catch(() => undefined);
          } else {
            throw err;
          }
        }
        const contentHash = att.contentHash ?? (await sha256File(dest));
        const job = await this.jobs.create({
          type: 'ingest_file',
          payload: {
            importBatchId,
            uploadPath: dest,
            filename: att.filename,
            mimetype: att.mimeType,
            size: att.size,
            contentHash,
            receivedAt: new Date().toISOString(),
            origin: 'api_ingest',
            status: 'received',
            askContext: { conversationId, assistantMessageId },
          } as unknown as Prisma.InputJsonValue,
          priority: 50,
        });
        await this.queues.enqueueIngestFile({
          dbJobId: job.id,
          filePath: dest,
          originalName: att.filename,
          mimeType: att.mimeType,
          size: att.size,
          contentHash,
          origin: 'api_ingest',
          importBatchId,
        });
        out.push({ jobId: job.id, filename: att.filename });
      } catch (err) {
        this.logger.error(
          `ask: failed to enqueue ingestion for ${att.filename}: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Best-effort cleanup; the file may already be in uploads/ or
        // still in staging. Try both.
        await fs.unlink(att.storedPath).catch(() => undefined);
      }
    }
    return out;
  }

  private async discardStagedFiles(staged: readonly StagedAttachment[]): Promise<void> {
    if (staged.length === 0) return;
    await Promise.all(staged.map((s) => this.askAttachments.discardFile(s)));
  }

  private async *streamDumbMode(args: {
    conversationId: string;
    assistantMessageId: string;
    query: string;
    startedAt: number;
    adminUserId: string;
    kind: AskMessageKind;
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
        lines.push(`- ${hit.title}`);
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
      kind: args.kind,
      auditAction: 'ask.completed',
      auditMetadata: { durationMs, citationsTotal: cites.length, dumbMode: true, kind: args.kind },
    });

    // Dumb mode never pins (no model reasoning to enrich on).
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
        kind: args.kind,
      },
    };
  }

  private async *streamSmart(args: {
    provider: LLMProvider;
    conversationId: string;
    assistantMessageId: string;
    userMessageId: string;
    userQuery: string;
    query: string;
    startedAt: number;
    adminUserId: string;
    abort: AbortSignal;
    principal: Principal | undefined;
    kind: AskMessageKind;
    ingestedAttachments: readonly IngestedAttachment[];
    scopeProjectSlug?: string;
  }): AsyncGenerator<AskFrameOut> {
    const usingCli = args.provider.config.kind === 'claude_cli';
    const sessionId = randomUUID();
    const acquired = usingCli
      ? await acquireSlot(this.redis.client, 'ask', sessionId, SLOT_TTL_SEC)
      : false;
    if (usingCli && !acquired) {
      this.logger.warn(`ask: could not acquire claude slot — running anyway (best-effort)`);
    }
    const refresher = usingCli
      ? setInterval(() => {
          void refreshSlot(this.redis.client, sessionId, SLOT_TTL_SEC);
        }, SLOT_REFRESH_INTERVAL_MS)
      : null;

    const ac = new AbortController();
    const propagate = (): void => ac.abort();
    args.abort.addEventListener('abort', propagate, { once: true });

    let assistantBody = '';
    let citationOrd = 0;
    const citeByDocId = new Map<string, CitationRecord>();
    const allCites: CitationRecord[] = [];
    /**
     * Tool-call inputs by id. Citations are derived from `(tool name, input,
     * output)`, but the provider frame for `tool_result` only carries the
     * output — so we cache the input we already saw on the matching
     * `tool_call` frame.
     */
    const toolCallInputs = new Map<string, unknown>();
    let aborted = false;
    let errorEmitted = false;
    let timedOut = false;
    let totalTokensIn: number | null = null;
    let totalTokensOut: number | null = null;
    let durationMs: number | null = null;

    try {
      const providerFrames = this.runProviderForAsk({
        provider: args.provider,
        query: args.query,
        principal: args.principal,
        signal: ac.signal,
        ...(args.scopeProjectSlug ? { scopeProjectSlug: args.scopeProjectSlug } : {}),
      });
      const frames = withHeartbeatAndIdleTimeout(providerFrames, {
        heartbeatMs: HEARTBEAT_INTERVAL_MS,
        idleMs: IDLE_TIMEOUT_MS,
        onTimeout: () => {
          timedOut = true;
          ac.abort();
        },
      });
      for await (const frame of frames) {
        if (args.abort.aborted && !timedOut) {
          aborted = true;
          break;
        }
        if (frame.kind === 'heartbeat') {
          yield { event: 'heartbeat', data: { ts: frame.ts } };
          continue;
        }
        const provider = frame.frame;
        if (provider.type === 'token') {
          assistantBody += provider.delta;
          yield { event: 'token', data: { delta: provider.delta } };
        } else if (provider.type === 'tool_call') {
          toolCallInputs.set(provider.id, provider.input);
          yield {
            event: 'tool_call',
            data: { id: provider.id, name: provider.name, input: provider.input },
          };
        } else if (provider.type === 'tool_result') {
          const data: { id: string; name: string; ok: boolean; error?: string } = {
            id: provider.id,
            name: provider.name,
            ok: provider.ok,
          };
          if (!provider.ok && provider.error) data.error = provider.error;
          yield { event: 'tool_result', data };
          if (provider.ok) {
            const matchedInput = toolCallInputs.get(provider.id);
            for (const cite of extractCitationsFromTool(
              provider.name,
              matchedInput,
              provider.output,
            )) {
              if (citeByDocId.has(cite.docId)) continue;
              citationOrd += 1;
              const record: CitationRecord = { ord: citationOrd, ...cite };
              citeByDocId.set(cite.docId, record);
              allCites.push(record);
              yield { event: 'citation', data: record };
            }
          }
        } else if (provider.type === 'done') {
          totalTokensIn = provider.usage?.inputTokens ?? null;
          totalTokensOut = provider.usage?.outputTokens ?? null;
          durationMs = provider.durationMs ?? Date.now() - args.startedAt;
          if (assistantBody.length === 0 && provider.text) {
            assistantBody = provider.text;
            yield { event: 'token', data: { delta: provider.text } };
          }
        } else if (provider.type === 'error') {
          errorEmitted = true;
          const data: {
            reason: 'rate-limit' | 'auth' | 'no-binary' | 'timeout' | 'generic';
            message?: string;
            resetAt?: string;
          } = {
            reason:
              provider.reason === 'rate-limit'
                ? 'rate-limit'
                : provider.reason === 'auth'
                  ? 'auth'
                  : provider.reason === 'no-binary'
                    ? 'no-binary'
                    : provider.reason === 'timeout'
                      ? 'timeout'
                      : 'generic',
          };
          if (provider.message) data.message = provider.message;
          if (provider.reason === 'rate-limit' && provider.resetAt) {
            data.resetAt = provider.resetAt.toISOString();
          }
          yield { event: 'error', data };
        }
      }

      if (timedOut && !errorEmitted) {
        errorEmitted = true;
        yield {
          event: 'error',
          data: {
            reason: 'timeout',
            message: `No response for ${IDLE_TIMEOUT_MS / 1000}s — the assistant might be stuck. Try again.`,
          },
        };
      }

      durationMs ??= Date.now() - args.startedAt;
      const collected = await this.annotateCitations(allCites);

      let pinnedDocumentId: string | undefined;
      if (args.kind === 'ingest' && !errorEmitted && !aborted && assistantBody.trim().length > 0) {
        try {
          pinnedDocumentId = await this.promoteToDocument({
            conversationId: args.conversationId,
            userMessageId: args.userMessageId,
            assistantMessageId: args.assistantMessageId,
            question: args.userQuery,
            answer: assistantBody,
            cites: collected,
            ingestedAttachments: args.ingestedAttachments,
          });
          yield {
            event: 'pinned',
            data: {
              messageId: args.assistantMessageId,
              documentId: pinnedDocumentId,
              attachedFiles: [...args.ingestedAttachments],
            },
          };
        } catch (err) {
          this.logger.error(
            `ask: pin failed for ${args.assistantMessageId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      await this.persistAssistantMessage({
        conversationId: args.conversationId,
        assistantMessageId: args.assistantMessageId,
        contentMd: assistantBody,
        cites: collected,
        durationMs,
        dumbMode: false,
        aborted,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        kind: args.kind,
        pinnedDocumentId,
        auditAction: aborted ? 'ask.aborted' : errorEmitted ? 'ask.failed' : 'ask.completed',
        auditMetadata: {
          durationMs,
          tokensIn: totalTokensIn,
          tokensOut: totalTokensOut,
          citationsTotal: collected.length,
          dumbMode: false,
          aborted,
          errorEmitted,
          providerId: args.provider.config.id,
          kind: args.kind,
          pinnedDocumentId,
          attachedFiles: args.ingestedAttachments.length,
        },
      });

      if (!errorEmitted) {
        const doneData: {
          conversationId: string;
          messageId: string;
          totalTokensIn: number | null;
          totalTokensOut: number | null;
          durationMs: number;
          citationsTotal: number;
          dumbMode: boolean;
          kind: AskMessageKind;
          pinnedDocumentId?: string;
          attachedFiles?: { jobId: string; filename: string }[];
        } = {
          conversationId: args.conversationId,
          messageId: args.assistantMessageId,
          totalTokensIn,
          totalTokensOut,
          durationMs,
          citationsTotal: collected.length,
          dumbMode: false,
          kind: args.kind,
        };
        if (pinnedDocumentId) doneData.pinnedDocumentId = pinnedDocumentId;
        if (args.ingestedAttachments.length > 0) {
          doneData.attachedFiles = [...args.ingestedAttachments];
        }
        yield { event: 'done', data: doneData };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`ask: stream failed: ${message}`);
      if (!errorEmitted) {
        yield { event: 'error', data: { reason: 'generic', message } };
      }
    } finally {
      args.abort.removeEventListener('abort', propagate);
      if (refresher) clearInterval(refresher);
      if (acquired) await releaseSlot(this.redis.client, sessionId).catch(() => undefined);
    }
  }

  /**
   * Drive the provider for /ask. The CLI handles MCP internally so it just
   * streams; non-CLI providers go through the agent loop with our MCP-tools
   * exposed as function definitions.
   */
  private async *runProviderForAsk(args: {
    provider: LLMProvider;
    query: string;
    principal: Principal | undefined;
    signal: AbortSignal;
    scopeProjectSlug?: string;
  }): AsyncGenerator<ProviderFrame> {
    const usingCli = args.provider.config.kind === 'claude_cli';
    const systemPrompt = askSystemPrompt();
    const userTurn = args.scopeProjectSlug
      ? `[scope: project ${args.scopeProjectSlug} — restrict search to this project]\n\n${args.query}`
      : args.query;
    const messages: ProviderMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userTurn },
    ];
    if (usingCli) {
      yield* args.provider.stream({ messages, signal: args.signal });
      return;
    }
    const toolContext = this.buildToolContext(args.principal, args.scopeProjectSlug);
    yield* runAgentLoop({
      provider: args.provider,
      messages,
      toolDefinitions: PHASE_5_TOOLS,
      toolContext,
      signal: args.signal,
    });
  }

  private buildToolContext(
    principal: Principal | undefined,
    scopeProjectSlug?: string,
  ): McpToolContext {
    const adapter = new HybridSearchAdapter(() => this.prisma.active());
    const principalForTools: Principal = principal ?? {
      kind: 'admin',
      id: 'system:ask',
      scope: 'admin',
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
      jobs: this.jobs,
      search: {
        findSimilar: async (text, limit) => {
          const trimmed = text.length > 600 ? text.slice(0, 600) : text;
          const result = await adapter.search({
            query: trimmed,
            page: 1,
            limit,
            ...(scopeProjectSlug ? { filters: { projectSlug: scopeProjectSlug } } : {}),
          });
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
        search: (opts) => {
          if (scopeProjectSlug) {
            const merged = {
              ...opts,
              filters: {
                ...(opts.filters ?? {}),
                projectSlug: scopeProjectSlug,
              },
            };
            return adapter.search(merged);
          }
          return adapter.search(opts);
        },
      },
      events: {
        graphNodeAdded: (entity) =>
          publishEvent(this.redis.client, {
            type: 'graph.node_added',
            payload: { entity },
          }).then(() => undefined),
        graphEdgeAdded: (edge) =>
          publishEvent(this.redis.client, {
            type: 'graph.edge_added',
            payload: { edge },
          }).then(() => undefined),
        inboxItemAdded: (item) =>
          publishEvent(this.redis.client, {
            type: 'inbox.item_added',
            payload: item,
          }).then(() => undefined),
      },
      audit: this.audit,
      auditTx: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => this.prisma.runInTx(fn),
      principal: principalForTools,
      enrichmentQueue: { add: async () => ({ id: undefined }) },
      indexingQueue: { add: async () => ({ id: undefined }) },
    };
  }

  /**
   * Annotate citations with the source-document title so the UI can show
   * "<title>" on the chip without an extra round-trip. Citations
   * pointing at non-existent documents are kept with title=null.
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
      title: titleByDocId.get(c.docId) ?? c.title,
      snippet: c.snippet,
    }));
  }

  /**
   * Promote an ingest-mode Q&A turn: bundle the question + answer into a
   * Document(source='chat'), back-reference any uploaded files via
   * metadata.attachedFiles, and enqueue enrichment so the new node
   * shows up in /graph alongside imported documents.
   */
  private async promoteToDocument(args: {
    conversationId: string;
    userMessageId: string;
    assistantMessageId: string;
    question: string;
    answer: string;
    cites: CitationRecord[];
    ingestedAttachments: readonly IngestedAttachment[];
  }): Promise<string> {
    const titleSource = args.question.trim();
    const title =
      titleSource.length > 80
        ? `${titleSource.slice(0, 80).trimEnd()}…`
        : titleSource || 'Ingested chat';
    const rawText = [
      '# Question',
      '',
      args.question.trim(),
      '',
      '# Answer',
      '',
      args.answer.trim(),
    ].join('\n');
    const contentHash = `chat:${createHash('sha256').update(rawText).digest('hex')}`;
    const metadata: Prisma.InputJsonValue = {
      conversationId: args.conversationId,
      userMessageId: args.userMessageId,
      assistantMessageId: args.assistantMessageId,
      kind: 'ingest',
      citationDocIds: args.cites.map((c) => c.docId),
      attachedFiles: args.ingestedAttachments.map((a) => ({
        jobId: a.jobId,
        filename: a.filename,
      })),
    };

    const doc = await this.documents.createChatPin({
      id: randomUUID(),
      sourceId: args.assistantMessageId,
      title,
      rawText,
      contentHash,
      metadata: metadata as Record<string, unknown>,
    });

    await this.messages.setPinnedDocument(args.assistantMessageId, doc.id);

    const jobRow = await this.jobs.create({
      type: 'enrich_document',
      payload: { documentId: doc.id },
      documentId: doc.id,
    });
    await this.queues.enqueueEnrichment({ dbJobId: jobRow.id, documentId: doc.id }).catch((err) => {
      this.logger.error(
        `ask: enrichment enqueue failed for ${doc.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    return doc.id;
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
    kind: AskMessageKind;
    pinnedDocumentId?: string;
    auditAction: string;
    auditMetadata: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.runInTx(async () => {
      const created = await this.messages.append({
        id: args.assistantMessageId,
        conversationId: args.conversationId,
        role: 'assistant',
        kind: toDbKind(args.kind),
        contentMd: args.contentMd,
        citations: args.cites as unknown as Prisma.InputJsonValue,
        tokensIn: args.tokensIn ?? null,
        tokensOut: args.tokensOut ?? null,
        durationMs: args.durationMs,
        dumbMode: args.dumbMode,
        aborted: args.aborted,
      });
      if (args.pinnedDocumentId) {
        await this.messages.setPinnedDocument(created.id, args.pinnedDocumentId);
      }
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

function principalOwnerKey(principal: Principal | undefined): string {
  return principal ? `${principal.kind}:${principal.id}` : 'anonymous';
}

function askSystemPrompt(): string {
  return [
    'You are answering a question for the Mnela second-brain owner.',
    'Use mnela_find_similar first to discover 5-10 candidate documents, then read targeted chunks via mnela_get_chunks.',
    'Ground every claim by referencing documents returned by your search tools — the chat UI auto-attaches them as citations next to your answer, so you do NOT need to write <cite> tags in the body.',
    'If the user attached files, treat their contents (when inlined in the prompt) as primary context to draw on.',
    'If evidence is insufficient, say so plainly. Do not guess.',
    "Answer in the user's language (Russian if the question is in Russian, English otherwise).",
    // Hard guardrails against meta-talk leaking into the final answer.
    // Without these, claude-cli sometimes prefaces its response with
    // process narration like "I will NOT use TodoWrite for this..." or
    // "Let me read the missing chunks..." which is noise to the end
    // user. Only `mcp__mnela__*` is relevant; everything else (TodoWrite,
    // Skill, environment metadata) is invisible runtime plumbing.
    'Do NOT mention or narrate your tool choices, planning steps, or any tool that is not an `mcp__mnela__*` tool. Do not say things like "I will not use TodoWrite" or "Let me read the next part" — just produce the answer.',
    'No preamble, no recap of what you are about to do. Start with the answer; finish at the end.',
  ].join('\n');
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

const TEXT_LIKE_EXTS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.csv',
  '.tsv',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.log',
  '.html',
  '.htm',
  '.xml',
  '.sql',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.rb',
  '.sh',
  '.css',
  '.scss',
]);

function isTextLikeMime(mime: string, filename: string): boolean {
  if (mime.startsWith('text/')) return true;
  if (mime === 'application/json' || mime === 'application/xml') return true;
  if (mime === 'application/x-ndjson' || mime === 'application/x-yaml') return true;
  const ext = path.extname(filename).toLowerCase();
  return TEXT_LIKE_EXTS.has(ext);
}

/**
 * Pull citation candidates out of an mcp-tools result. We intentionally
 * accept a narrow set of shapes — search-like tools have well-known
 * output keys, anything else is left to the model to cite via
 * mnela_get_document afterwards. Exported for unit testing.
 */
export function extractCitationsFromTool(
  toolName: string,
  toolInput: unknown,
  output: unknown,
): { docId: string; title: string | null; snippet: string }[] {
  if (!output || typeof output !== 'object') return [];

  if (toolName === 'mnela_find_similar' || toolName === 'mnela_search') {
    const docs = (output as { documents?: unknown }).documents;
    if (!Array.isArray(docs)) return [];
    return docs
      .map((d) => normaliseDocumentSummary(d))
      .filter((d): d is { docId: string; title: string | null; snippet: string } => d !== null);
  }

  if (toolName === 'mnela_get_document') {
    const doc = output as { id?: unknown; title?: unknown; cleanText?: unknown; rawText?: unknown };
    if (typeof doc.id !== 'string' || doc.id.length === 0) return [];
    const title = typeof doc.title === 'string' ? doc.title : null;
    const body =
      typeof doc.cleanText === 'string'
        ? doc.cleanText
        : typeof doc.rawText === 'string'
          ? doc.rawText
          : '';
    return [
      {
        docId: doc.id,
        title,
        snippet: body.slice(0, 200) || title || '',
      },
    ];
  }

  if (toolName === 'mnela_get_chunks') {
    const documentId =
      toolInput && typeof toolInput === 'object'
        ? (toolInput as { documentId?: unknown }).documentId
        : undefined;
    if (typeof documentId !== 'string' || documentId.length === 0) return [];
    const chunks = (output as { chunks?: unknown }).chunks;
    const firstChunk =
      Array.isArray(chunks) && chunks[0] && typeof chunks[0] === 'object'
        ? (chunks[0] as { text?: unknown }).text
        : undefined;
    const snippet = typeof firstChunk === 'string' ? firstChunk.slice(0, 200) : '';
    return [{ docId: documentId, title: null, snippet }];
  }

  return [];
}

function normaliseDocumentSummary(
  raw: unknown,
): { docId: string; title: string | null; snippet: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { id?: unknown; documentId?: unknown; title?: unknown; snippet?: unknown };
  const id =
    typeof obj.id === 'string'
      ? obj.id
      : typeof obj.documentId === 'string'
        ? obj.documentId
        : null;
  if (!id) return null;
  const title = typeof obj.title === 'string' ? obj.title : null;
  const snippet = typeof obj.snippet === 'string' ? obj.snippet : (title ?? '');
  return { docId: id, title, snippet: snippet.slice(0, 200) };
}

type FramedItem = { kind: 'frame'; frame: ProviderFrame } | { kind: 'heartbeat'; ts: number };

async function* withHeartbeatAndIdleTimeout(
  source: AsyncIterable<ProviderFrame>,
  opts: { heartbeatMs: number; idleMs: number; onTimeout: () => void },
): AsyncGenerator<FramedItem> {
  const queue: FramedItem[] = [];
  const wake: (() => void)[] = [];
  let done = false;
  let error: unknown;
  let timedOut = false;

  function notify(): void {
    const w = wake.shift();
    if (w) w();
  }

  const heartbeat = setInterval(() => {
    if (done) return;
    queue.push({ kind: 'heartbeat', ts: Date.now() });
    notify();
  }, opts.heartbeatMs);

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const armIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (done || timedOut) return;
      timedOut = true;
      opts.onTimeout();
    }, opts.idleMs);
  };
  armIdle();

  (async () => {
    try {
      for await (const frame of source) {
        armIdle();
        queue.push({ kind: 'frame', frame });
        notify();
      }
    } catch (err) {
      error = err;
    } finally {
      done = true;
      clearInterval(heartbeat);
      if (idleTimer) clearTimeout(idleTimer);
      notify();
    }
  })();

  try {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      if (done) {
        if (error) throw error;
        return;
      }
      await new Promise<void>((resolve) => wake.push(resolve));
    }
  } finally {
    clearInterval(heartbeat);
    if (idleTimer) clearTimeout(idleTimer);
  }
}
