import { Injectable, Logger } from '@nestjs/common';

import { loadEnv } from '../env.js';

/**
 * Thin HTTP client to apps/api. All calls go bearer-authed with
 * MNELA_INTERNAL_TOKEN, which must have scope `mcp` so it can reach
 * /search/ask + /documents/upload + the MCP-equivalent endpoints used
 * by the bot.
 *
 * Why not call `@mnela/db` directly? Because the bot must respect every
 * pipeline side-effect the api owns: enrichment enqueue, audit logging,
 * conversation state mutation. Hitting the HTTP surface keeps the bot
 * indistinguishable from any other client (Claude Code, MCP, the web
 * UI) — one well-tested code path, not two.
 */
@Injectable()
export class ApiClientService {
  private readonly logger = new Logger(ApiClientService.name);
  private readonly baseUrl: string;
  private readonly token: string;

  constructor() {
    const env = loadEnv();
    this.baseUrl = env.MNELA_API_BASE_URL.replace(/\/+$/, '');
    this.token = env.MNELA_INTERNAL_TOKEN;
  }

  /**
   * Stream `/search/ask` SSE frames. Yields parsed `{event, data}` pairs;
   * caller is responsible for matching frame shapes against the AskDto
   * SSE vocabulary (meta, token, citation, tool_call, tool_result,
   * pinned, heartbeat, done, error).
   */
  async *askStream(body: {
    query: string;
    conversationId?: string | undefined;
    scopeProjectSlug?: string | undefined;
    attachmentIds?: string[];
    mode?: 'auto' | 'fts';
    kind?: 'chat' | 'ingest';
  }): AsyncGenerator<{ event: string; data: unknown }> {
    const res = await fetch(`${this.baseUrl}/search/ask`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`/search/ask ${res.status}: ${text}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const parsed = this.parseFrame(frame);
        if (parsed) yield parsed;
      }
    }
  }

  /**
   * Upload a file via multipart/form-data → POST /documents/upload.
   * Returns the synchronous Job row from the api. Enrichment happens
   * async; the bot subscribes to `document.transcribed` /
   * `document.enriched` events to know when the doc is ready.
   *
   * `source` lets the bot stamp provenance on resulting Documents (and
   * surface "Telegram" on /activity?tab=uploads). Defaults to
   * `'telegram'` for tg-bot uploads — the only acceptable values are
   * filtered server-side; unknown sources fall back to `manual_upload`.
   */
  async uploadDocument(opts: {
    blob: Blob;
    filename: string;
    source?: string;
  }): Promise<{
    job: { id: string; type: string; status: string };
    accepted: boolean;
    duplicate: boolean;
  }> {
    const form = new FormData();
    form.append('file', opts.blob, opts.filename);
    form.append('source', opts.source ?? 'telegram');
    const res = await fetch(`${this.baseUrl}/documents/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`/documents/upload ${res.status}: ${text}`);
    }
    return (await res.json()) as {
      job: { id: string; type: string; status: string };
      accepted: boolean;
      duplicate: boolean;
    };
  }

  /**
   * Patch a Document — used to retro-attach `projects: [slug]` and
   * `metadata.telegram = { chatId, msgId, userId, turnId }` after the
   * upload settles. There's no metadata field on the upload endpoint
   * itself; this is the documented two-step pattern.
   */
  async patchDocument(
    documentId: string,
    patch: { projects?: string[]; metadata?: Record<string, unknown> },
  ): Promise<void> {
    const res = await fetch(`${this.baseUrl}/documents/${encodeURIComponent(documentId)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`PATCH /documents/${documentId} ${res.status}: ${text}`);
    }
  }

  /**
   * Save a free-form note. The api has no dedicated REST entry for the
   * MCP `mnela_save_note` tool, so we use the upload endpoint with a
   * .txt blob — the worker parser ingests it as a Note document. After
   * upload settles the caller may PATCH /documents/:id to attach
   * projects; we don't synchronously wait for the document id here
   * because the upload is async (the job creates the doc later). For
   * /save this asymmetry is fine: the user gets a "saved" confirmation
   * immediately, and the document materialises seconds later.
   */
  async saveNote(input: {
    content: string;
    title?: string;
    source?: string;
    projects?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<{ jobId: string }> {
    const filename = (input.title ?? 'note').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40);
    const blob = new Blob([input.content], { type: 'text/plain;charset=utf-8' });
    const res = await this.uploadDocument({ blob, filename: `${filename || 'note'}.txt` });
    return { jobId: res.job.id };
  }

  /**
   * Recent documents shortcut for the `/last [N]` command. Uses the
   * existing recent-activity surface; filtered to `source='telegram'`
   * when the caller passes it.
   */
  async recentActivity(opts: {
    limit?: number;
    source?: string;
  }): Promise<{ id: string; title: string; createdAt: string; source: string }[]> {
    const qs = new URLSearchParams();
    if (opts.limit) qs.set('limit', String(opts.limit));
    if (opts.source) qs.set('source', opts.source);
    const res = await fetch(`${this.baseUrl}/documents?${qs.toString()}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`/documents?${qs} ${res.status}: ${text}`);
    }
    const body = (await res.json()) as {
      items?: { id: string; title: string; createdAt: string; source: string }[];
    };
    return body.items ?? [];
  }

  private parseFrame(raw: string): { event: string; data: unknown } | null {
    const lines = raw.split('\n');
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) return null;
    const text = dataLines.join('\n');
    try {
      return { event, data: JSON.parse(text) };
    } catch {
      return { event, data: text };
    }
  }
}
