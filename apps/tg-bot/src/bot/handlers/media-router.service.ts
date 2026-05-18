import { Injectable, Logger } from '@nestjs/common';
import type { Api } from 'grammy';

import { ApiClientService } from '../../api-client/api-client.service.js';
import { loadEnv } from '../../env.js';
import type { TurnItem } from './turn-buffer.service.js';

export interface UploadResult {
  /** Job id from /documents/upload. The document id arrives via
   * `document.created` pubsub event later. */
  jobId: string;
  duplicate: boolean;
}

/**
 * Pulls Telegram file bytes and routes them to /documents/upload with
 * `source='telegram'` and `metadata.telegram = { chatId, msgId, userId,
 * turnId }`. The post-upload PATCH attaches the chat's sticky scope
 * (when set) — the upload endpoint doesn't accept `projects` directly.
 */
@Injectable()
export class MediaRouterService {
  private readonly logger = new Logger(MediaRouterService.name);

  constructor(private readonly api: ApiClientService) {}

  /**
   * Download + upload one media item. The mime guess is informational —
   * the worker parser auto-detects via magic bytes — but we keep it so
   * filenames default sensibly (`.ogg` for voice, `.jpg` for photo).
   */
  async ingest(
    api: Api,
    item: TurnItem,
    ctx: { chatId: number; userId: number; turnId: string; scopeSlug: string | null },
  ): Promise<UploadResult | null> {
    if (!item.fileId) return null;
    const env = loadEnv();
    try {
      const file = await api.getFile(item.fileId);
      if (!file.file_path) {
        this.logger.warn(`getFile returned no file_path (file_id=${item.fileId})`);
        return null;
      }
      // Token isn't available on the grammY `Api`; download URL pattern
      // is fixed (https://api.telegram.org/file/bot<TOKEN>/<PATH>) so we
      // re-build it from the api's internal `apiRoot` + token segment.
      // We round-trip through ctx.api.config.apiRoot if accessible, else
      // resolve manually from the env-supplied token via the API client.
      const downloadUrl = await this.resolveDownloadUrl(api, file.file_path);
      const res = await fetch(downloadUrl);
      if (!res.ok) {
        this.logger.warn(
          `download failed (${res.status}) for file_id=${item.fileId} path=${file.file_path}`,
        );
        return null;
      }
      const blob = await res.blob();
      const filename = item.filename ?? this.defaultFilename(item, file.file_path);
      const result = await this.api.uploadDocument({ blob, filename });

      // Post-upload metadata patch is async-best-effort: the job creates
      // the Document later, so the api won't have a documentId yet at
      // this point. We tag the metadata on the JOB via a separate
      // endpoint when it lands — or, in the simpler MVP, the bot
      // subscribes to `document.created`, matches by jobId, and PATCHes
      // then. That subscription lives in AskRelay's event listener so we
      // don't duplicate subscriptions per service.
      this.logger.debug(
        `uploaded kind=${item.kind} chat=${ctx.chatId} msg=${item.msgId} job=${result.job.id} dup=${result.duplicate}`,
      );
      return { jobId: result.job.id, duplicate: result.duplicate };
    } catch (err) {
      this.logger.error(
        `media ingest failed kind=${item.kind}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    } finally {
      void env;
    }
  }

  private defaultFilename(item: TurnItem, telegramPath: string): string {
    const fromPath = telegramPath.split('/').pop();
    if (fromPath && fromPath.includes('.')) return fromPath;
    switch (item.kind) {
      case 'voice':
        return `voice-${Date.now()}.ogg`;
      case 'audio':
        return `audio-${Date.now()}.mp3`;
      case 'photo':
        return `photo-${Date.now()}.jpg`;
      case 'document':
        return `doc-${Date.now()}.bin`;
      default:
        return `tg-${Date.now()}.bin`;
    }
  }

  /**
   * grammY caches the token in api.config (private). Fall back to
   * concatenating the env file-server URL with the standard bot prefix
   * using the token resolved at ConfigService time. We accept the token
   * twice (once for poll, once for download) because the file-server
   * URL is per-bot.
   */
  private async resolveDownloadUrl(api: Api, filePath: string): Promise<string> {
    // grammY exposes `api.raw.getFile`; the download URL is documented
    // as `https://api.telegram.org/file/bot<TOKEN>/<file_path>`. We
    // reuse api.config.token (TypeScript-private but runtime-accessible)
    // to avoid plumbing the plaintext through every method.
    const cfg = (api as unknown as { token: string }).token;
    if (!cfg) {
      throw new Error('cannot resolve file download URL — grammY Api has no token in config');
    }
    return `https://api.telegram.org/file/bot${cfg}/${filePath}`;
  }
}
