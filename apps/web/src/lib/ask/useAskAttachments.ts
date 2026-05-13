'use client';

import { useCallback, useRef, useState } from 'react';

import { api, ApiError } from '@/lib/api/client';

export interface AttachmentDraft {
  /** Local UUID so the chip is addressable before the server replies. */
  tempId: string;
  filename: string;
  size: number;
  mimeType: string;
  status: 'uploading' | 'ready' | 'error';
  /** Server-side id once the upload succeeds. */
  id?: string;
  /** Error message when status === 'error'. */
  error?: string;
}

interface StagedAttachmentResponse {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface UseAskAttachmentsApi {
  drafts: AttachmentDraft[];
  /** True until every draft reaches a terminal state (ready|error). */
  uploading: boolean;
  /** Server-side ids of drafts that uploaded successfully. */
  readyIds: string[];
  add(files: FileList | File[]): void;
  remove(tempId: string): void;
  clear(): void;
}

/**
 * Composer-side helper for /ask attachments. Multipart upload per file,
 * with optimistic chip rendering: each `add()` registers an 'uploading'
 * draft immediately and flips to 'ready' (or 'error') as fetch resolves.
 *
 * The server's POST /search/ask/attachments stages each file and returns
 * a short-lived id; the `send()` flow in `useAskStream` passes the ready
 * ids in `attachmentIds`. `remove()` releases unsent ones; staged files
 * that were sent get cleaned up server-side when the stream completes.
 */
export function useAskAttachments(): UseAskAttachmentsApi {
  const [drafts, setDrafts] = useState<AttachmentDraft[]>([]);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const add = useCallback((files: FileList | File[]): void => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const queued: AttachmentDraft[] = list.map((f) => ({
      tempId: crypto.randomUUID(),
      filename: f.name,
      size: f.size,
      mimeType: f.type || 'application/octet-stream',
      status: 'uploading',
    }));
    setDrafts((prev) => [...prev, ...queued]);

    for (let i = 0; i < list.length; i++) {
      const file = list[i]!;
      const draft = queued[i]!;
      const fd = new FormData();
      fd.append('file', file, file.name);
      api
        .post<StagedAttachmentResponse>('/search/ask/attachments', fd)
        .then((res) => {
          setDrafts((prev) =>
            prev.map((d) =>
              d.tempId === draft.tempId
                ? { ...d, status: 'ready', id: res.id, mimeType: res.mimeType, size: res.size }
                : d,
            ),
          );
        })
        .catch((err: unknown) => {
          const message =
            err instanceof ApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : 'Upload failed';
          setDrafts((prev) =>
            prev.map((d) =>
              d.tempId === draft.tempId ? { ...d, status: 'error', error: message } : d,
            ),
          );
        });
    }
  }, []);

  const remove = useCallback((tempId: string): void => {
    const current = draftsRef.current.find((d) => d.tempId === tempId);
    setDrafts((prev) => prev.filter((d) => d.tempId !== tempId));
    if (current?.id) {
      api
        .delete<void>(`/search/ask/attachments/${encodeURIComponent(current.id)}`)
        .catch(() => undefined);
    }
  }, []);

  const clear = useCallback((): void => {
    const current = draftsRef.current;
    setDrafts([]);
    for (const draft of current) {
      if (draft.id) {
        api
          .delete<void>(`/search/ask/attachments/${encodeURIComponent(draft.id)}`)
          .catch(() => undefined);
      }
    }
  }, []);

  const uploading = drafts.some((d) => d.status === 'uploading');
  const readyIds = drafts.filter((d) => d.status === 'ready' && d.id).map((d) => d.id!);

  return { drafts, uploading, readyIds, add, remove, clear };
}
