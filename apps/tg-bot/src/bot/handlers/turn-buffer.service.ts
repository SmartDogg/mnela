import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

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

interface PendingTurn {
  turnId: string;
  chatId: number;
  userId: number;
  items: TurnItem[];
  firstAt: number;
  timer: NodeJS.Timeout;
}

export type TurnReadyHandler = (turn: ReadyTurn) => Promise<void>;

export interface ReadyTurn {
  turnId: string;
  chatId: number;
  userId: number;
  items: TurnItem[];
  firstAt: number;
}

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
 * The buffer is in-memory and per-process; restarting the bot mid-burst
 * drops the buffer. That's acceptable: a 4s window means at most 4s of
 * un-processed media on restart, and the user can always retry. We do
 * NOT persist this to Redis — the complexity isn't worth the rare
 * recovery scenario.
 */
@Injectable()
export class TurnBufferService {
  private readonly logger = new Logger(TurnBufferService.name);
  private readonly pending = new Map<number, PendingTurn>();
  private handler: TurnReadyHandler | null = null;
  private bundleWindowMs = 4000;

  setBundleWindowMs(ms: number): void {
    this.bundleWindowMs = Math.max(500, Math.min(30_000, ms));
  }

  onReady(handler: TurnReadyHandler): void {
    this.handler = handler;
  }

  add(chatId: number, userId: number, item: TurnItem): void {
    let turn = this.pending.get(chatId);
    if (!turn) {
      turn = {
        turnId: randomUUID(),
        chatId,
        userId,
        items: [],
        firstAt: Date.now(),
        timer: setTimeout(() => undefined, this.bundleWindowMs),
      };
      this.pending.set(chatId, turn);
    }
    turn.items.push(item);
    clearTimeout(turn.timer);
    turn.timer = setTimeout(() => {
      void this.fire(chatId).catch((err) => {
        this.logger.error(
          `turn fire failed chat=${chatId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, this.bundleWindowMs);
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
    return this.fire(chatId);
  }

  private async fire(chatId: number): Promise<void> {
    const turn = this.pending.get(chatId);
    if (!turn) return;
    this.pending.delete(chatId);
    clearTimeout(turn.timer);
    if (!this.handler) {
      this.logger.warn(`turn ready but no handler registered; dropping ${turn.items.length} items`);
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
}
