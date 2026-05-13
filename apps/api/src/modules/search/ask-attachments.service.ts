import { randomUUID } from 'node:crypto';
import { promises as fs, mkdirSync } from 'node:fs';
import path from 'node:path';

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
} from '@nestjs/common';

import { loadEnv, resolvedDataDir } from '../../env.js';
import { sha256File } from '../imports/upload.config.js';

export interface StagedAttachment {
  id: string;
  ownerKey: string;
  filename: string;
  mimeType: string;
  size: number;
  storedPath: string;
  uploadedAt: number;
  /**
   * SHA-256 of the file body, lazy-computed on first `consume()` call.
   * Avoids hashing every multipart at upload time — most chat attachments
   * never end up ingested.
   */
  contentHash?: string;
}

const TTL_MS = 60 * 60 * 1000; // 1h
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Owns the on-disk staging area for /ask composer attachments.
 *
 * Lifecycle:
 *   1. POST /search/ask/attachments multipart -> `stage()` moves the
 *      multer .incoming/ file into uploads/.chat-staging/<uuid>-<safe>
 *      and registers an in-memory entry tagged with the principal.
 *   2. POST /search/ask consumes the IDs once via `consume(ids,
 *      principal)`. The records leave the map but the file stays on
 *      disk — AskService is responsible for either inlining + deleting
 *      (chat mode) or renaming into uploads/ + enqueueing through the
 *      ingestion queue (ingest mode).
 *   3. If the user removes a chip before sending, the controller calls
 *      `release(id, principal)` which unlinks and forgets it.
 *   4. Entries older than TTL_MS are swept on every access plus by a
 *      coarse 5-minute interval — this keeps abandoned uploads from
 *      piling up if the user closes the tab mid-compose.
 *
 * Per-principal ownership is mandatory: in a future multi-admin
 * deployment Bob must not be able to attach Alice's staged file.
 */
@Injectable()
export class AskAttachmentsService implements OnModuleDestroy {
  private readonly logger = new Logger(AskAttachmentsService.name);
  private readonly stagingDir: string;
  private readonly records = new Map<string, StagedAttachment>();
  private readonly sweeper: NodeJS.Timeout;

  constructor() {
    const env = loadEnv();
    this.stagingDir = path.resolve(resolvedDataDir(env), 'uploads', '.chat-staging');
    mkdirSync(this.stagingDir, { recursive: true });
    this.sweeper = setInterval(() => {
      void this.sweep();
    }, SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
  }

  /**
   * Move the multer-staged upload into our chat-staging dir and
   * register the record. Returns the public payload the controller
   * echoes back to the composer.
   */
  async stage(
    multer: { path: string; originalname: string; mimetype: string; size: number },
    ownerKey: string,
  ): Promise<StagedAttachment> {
    await this.sweep();
    const id = randomUUID();
    const safe = sanitiseName(multer.originalname);
    const storedPath = path.join(this.stagingDir, `${id}-${safe}`);
    try {
      await fs.rename(multer.path, storedPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EXDEV') {
        await fs.copyFile(multer.path, storedPath);
        await fs.unlink(multer.path).catch(() => undefined);
      } else {
        throw err;
      }
    }
    const record: StagedAttachment = {
      id,
      ownerKey,
      filename: multer.originalname || safe,
      mimeType: multer.mimetype || 'application/octet-stream',
      size: multer.size,
      storedPath,
      uploadedAt: Date.now(),
    };
    this.records.set(id, record);
    return record;
  }

  /**
   * Find a record by id, enforcing ownership and TTL. Throws
   * NotFound for unknown/expired, Forbidden for cross-principal access.
   */
  get(id: string, ownerKey: string): StagedAttachment {
    const record = this.records.get(id);
    if (!record || isExpired(record)) {
      throw new NotFoundException(`Staged attachment ${id} not found or expired`);
    }
    if (record.ownerKey !== ownerKey) {
      throw new ForbiddenException(`Staged attachment ${id} belongs to a different principal`);
    }
    return record;
  }

  /**
   * Remove a chip from staging. Unlinks the file and drops the record.
   * No-op on already-removed ids — safe to call from the UI after a
   * race with submit.
   */
  async release(id: string, ownerKey: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    if (record.ownerKey !== ownerKey) {
      throw new ForbiddenException(`Staged attachment ${id} belongs to a different principal`);
    }
    this.records.delete(id);
    await fs.unlink(record.storedPath).catch(() => undefined);
  }

  /**
   * Atomically pop multiple records (used at the start of /ask).
   * Callers own the disposal of the underlying files afterward.
   */
  async consume(ids: readonly string[], ownerKey: string): Promise<StagedAttachment[]> {
    if (ids.length === 0) return [];
    const out: StagedAttachment[] = [];
    for (const id of ids) {
      const record = this.get(id, ownerKey);
      this.records.delete(id);
      // Hash lazily so chat-mode pulls (the common case) skip the
      // 5–100 ms sha256 over each blob.
      record.contentHash ??= await sha256File(record.storedPath);
      out.push(record);
    }
    return out;
  }

  /**
   * Delete the on-disk file. Used by AskService.cleanupChatAttachments
   * after a chat-mode stream completes; ingest-mode handles disposal
   * itself by renaming the file out of staging.
   */
  async discardFile(record: StagedAttachment): Promise<void> {
    await fs.unlink(record.storedPath).catch(() => undefined);
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    const expired: StagedAttachment[] = [];
    for (const [id, record] of this.records) {
      if (now - record.uploadedAt > TTL_MS) {
        expired.push(record);
        this.records.delete(id);
      }
    }
    for (const record of expired) {
      await fs.unlink(record.storedPath).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') {
          this.logger.warn(
            `ask-attachments: sweep failed to unlink ${record.storedPath}: ${err.message}`,
          );
        }
      });
    }
  }
}

function isExpired(record: StagedAttachment): boolean {
  return Date.now() - record.uploadedAt > TTL_MS;
}

function sanitiseName(original: string): string {
  return (original || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}
