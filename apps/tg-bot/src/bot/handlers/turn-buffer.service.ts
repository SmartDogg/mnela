import { randomUUID } from 'node:crypto';

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { RedisService } from '../../redis/redis.service.js';

export type TurnItemKind = 'text' | 'voice' | 'photo' | 'document' | 'audio';

export interface TurnItem {
  kind: TurnItemKind;
  msgId: number;
  /** True iff this is a /save-forced ingest item (no /ask afterwards). */
  forceSave?: boolean;
  /** Raw text (for kind='text') or caption (for media). */
  text?: string;
  /** File id from Telegram — fetched lazily by MediaRouter. */
  fileId?: string;
  /** Filename to use when uploading to /documents/upload. */
  filename?: string;
  /** Mime type guess; informational, parser auto-detects from bytes. */
  mime?: string;
}

interface PersistedTurn {
  turnId: string;
  chatId: number;
  userId: number;
  items: TurnItem[];
  firstAt: number;
}

export type TurnReadyHandler = (turn: ReadyTurn) => Promise<void>;

export interface ReadyTurn {
  turnId: string;
  chatId: number;
  userId: number;
  items: TurnItem[];
  firstAt: number;
}

const KEY_PREFIX = 'mnela:tg:turn:';
const GRACE_MS = 30_000;
const SCAN_COUNT = 100;

/**
 * Debounced multi-modal turn bundler.
 *
 * Telegram delivers each part of a thought (voice, photo, caption, text)
 * as a separate `update`. The TurnBuffer holds them per chat for
 * `bundleWindowMs`; every new item resets the timer. When the timer
 * elapses, the accumulated items are delivered as a single ReadyTurn to
 * the registered handler — the bot then composes one /ask call (or one
 * batched save), reflecting the user's mental model of "I sent that
 * stuff as one message."
 *
 * Storage is split:
 *   - Items live in Redis under `mnela:tg:turn:<chatId>` with TTL =
 *     bundleWindow + 30 s grace, so a bot restart mid-burst no longer
 *     drops the buffer.
 *   - The debounce timer (`setTimeout`) is in-memory. On startup,
 *     `recoverPending()` scans the key prefix and immediately fires any
 *     persisted turns — the next 4 s window of "should I wait for more?"
 *     is sacrificed for "don't lose what's already there", which is the
 *     right call: the next user message restarts the buffer cleanly.
 */
@Injectable()
export class TurnBufferService implements OnModuleInit {
  private readonly logger = new Logger(TurnBufferService.name);
  private readonly timers = new Map<number, NodeJS.Timeout>();
  private handler: TurnReadyHandler | null = null;
  private bundleWindowMs = 4000;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    // Defer the recovery sweep — the handler is registered later by
    // RealHandlersFactory.bind(). One tick later it will exist; even
    // if it doesn't, the persisted items survive in Redis until TTL.
    setImmediate(() => {
      void this.recoverPending().catch((err) => {
        this.logger.warn(
          `turn recovery sweep failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    });
  }

  setBundleWindowMs(ms: number): void {
    this.bundleWindowMs = Math.max(500, Math.min(30_000, ms));
  }

  onReady(handler: TurnReadyHandler): void {
    this.handler = handler;
  }

  async add(chatId: number, userId: number, item: TurnItem): Promise<void> {
    const key = this.keyFor(chatId);
    const raw = await this.redis.client.get(key);
    const turn: PersistedTurn = raw
      ? (JSON.parse(raw) as PersistedTurn)
      : { turnId: randomUUID(), chatId, userId, items: [], firstAt: Date.now() };
    turn.items.push(item);
    const ttlMs = this.bundleWindowMs + GRACE_MS;
    await this.redis.client.set(key, JSON.stringify(turn), 'PX', ttlMs);
    const prev = this.timers.get(chatId);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      this.timers.delete(chatId);
      void this.fire(chatId).catch((err) => {
        this.logger.error(
          `turn fire failed chat=${chatId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, this.bundleWindowMs);
    this.timers.set(chatId, t);
    this.logger.debug(
      `chat=${chatId} +${item.kind} → ${turn.items.length} items, debounce=${this.bundleWindowMs}ms`,
    );
  }

  /**
   * Force-fire the chat's pending turn immediately. Used by /save when
   * it ships in the same message — we don't want the user to wait the
   * full debounce for a "just remember this" intent.
   */
  flush(chatId: number): Promise<void> {
    const t = this.timers.get(chatId);
    if (t) {
      clearTimeout(t);
      this.timers.delete(chatId);
    }
    return this.fire(chatId);
  }

  private keyFor(chatId: number): string {
    return `${KEY_PREFIX}${chatId}`;
  }

  private async fire(chatId: number): Promise<void> {
    const key = this.keyFor(chatId);
    /*
     * GETDEL is atomic — between GET and DEL nothing else can sneak in
     * a new item and have it dropped. Falls back to a transaction on
     * older Redis (<6.2) but the docker image is redis:7-alpine.
     */
    const raw = await this.redis.client.getdel(key);
    if (!raw) return;
    let turn: PersistedTurn;
    try {
      turn = JSON.parse(raw) as PersistedTurn;
    } catch {
      this.logger.warn(`turn at ${key} unparseable; dropping`);
      return;
    }
    if (turn.items.length === 0) return;
    if (!this.handler) {
      // Re-stash for the next handler binding so we don't drop work.
      const ttlMs = this.bundleWindowMs + GRACE_MS;
      await this.redis.client.set(key, raw, 'PX', ttlMs);
      this.logger.warn(
        `turn ready but no handler registered; re-stashed ${turn.items.length} items`,
      );
      return;
    }
    await this.handler({
      turnId: turn.turnId,
      chatId: turn.chatId,
      userId: turn.userId,
      items: turn.items,
      firstAt: turn.firstAt,
    });
  }

  /**
   * On boot, fire any turn whose TTL didn't expire. We skip the
   * debounce here — restart already cost more than the bundle window.
   */
  private async recoverPending(): Promise<void> {
    let cursor = '0';
    let recovered = 0;
    do {
      const [next, keys] = await this.redis.client.scan(
        cursor,
        'MATCH',
        `${KEY_PREFIX}*`,
        'COUNT',
        SCAN_COUNT,
      );
      cursor = next;
      for (const key of keys) {
        const chatId = Number(key.slice(KEY_PREFIX.length));
        if (!Number.isFinite(chatId)) continue;
        await this.fire(chatId);
        recovered += 1;
      }
    } while (cursor !== '0');
    if (recovered > 0) this.logger.log(`recovered ${recovered} pending turn(s) after restart`);
  }
}
