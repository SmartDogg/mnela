'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * App-level kind. The wire and DB still carry the legacy
 * 'ephemeral|pinned' label internally (see ADR-0050); the API
 * translates at the controller layer.
 */
export type AskMessageKind = 'chat' | 'ingest';

export interface AskCitation {
  ord: number;
  docId: string;
  title: string | null;
  snippet: string;
}

export interface AskToolEvent {
  id: string;
  name: string;
  /** When omitted: the call is still pending. */
  ok?: boolean;
  /** Best-effort summary of what the tool was given. */
  input?: unknown;
  /** Tool error message (when ok=false). */
  error?: string;
}

export interface AskAttachedFile {
  jobId: string;
  filename: string;
}

export interface AskMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  kind?: AskMessageKind;
  contentMd: string;
  citations: AskCitation[];
  /** Ordered tool calls observed during this turn (filled live). */
  toolEvents?: AskToolEvent[];
  dumbMode?: boolean;
  aborted?: boolean;
  /** Set when an ingest turn was promoted into a Document. */
  pinnedDocumentId?: string;
  /** Files uploaded in ingest mode, each backed by an ingest_file Job. */
  attachedFiles?: AskAttachedFile[];
}

export interface AskStreamMeta {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  dumbMode: boolean;
  providerId?: string;
  providerName?: string;
  kind: AskMessageKind;
  attachments: { id: string; filename: string; mimeType: string; size: number }[];
}

export interface AskStreamDone {
  conversationId: string;
  messageId: string;
  durationMs: number;
  citationsTotal: number;
  totalTokensIn: number | null;
  totalTokensOut: number | null;
  dumbMode: boolean;
  kind: AskMessageKind;
  pinnedDocumentId?: string;
  attachedFiles?: AskAttachedFile[];
}

export interface AskStreamError {
  reason: 'rate-limit' | 'no-binary' | 'auth' | 'timeout' | 'generic';
  resetAt?: string;
  message?: string;
}

export type AskStreamStatus = 'idle' | 'streaming' | 'reconnecting' | 'done' | 'error';

export interface SendOpts {
  conversationId?: string;
  mode?: 'auto' | 'fts';
  kind?: AskMessageKind;
  attachmentIds?: string[];
}

export interface UseAskStreamApi {
  status: AskStreamStatus;
  conversationId: string | null;
  messages: AskMessage[];
  error: AskStreamError | null;
  send(query: string, opts?: SendOpts): Promise<void>;
  abort(): void;
  reset(): void;
  setMessages(messages: AskMessage[]): void;
  setConversationId(id: string | null): void;
}

const SSE_BASE = '/_api/search/ask';
const RETRY_DELAY_MS = 800;

export function useAskStream(): UseAskStreamApi {
  const [status, setStatus] = useState<AskStreamStatus>('idle');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [error, setError] = useState<AskStreamError | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const userAbortRef = useRef(false);

  const reset = useCallback((): void => {
    userAbortRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
    setMessages([]);
    setConversationId(null);
    setError(null);
  }, []);

  const abort = useCallback((): void => {
    userAbortRef.current = true;
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (query: string, opts?: SendOpts): Promise<void> => {
      if (status === 'streaming' || status === 'reconnecting') return;
      userAbortRef.current = false;
      setError(null);

      const kind: AskMessageKind = opts?.kind ?? 'chat';
      const optimisticUserId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: optimisticUserId, role: 'user', kind, contentMd: query, citations: [] },
      ]);

      const body = JSON.stringify({
        query,
        ...(opts?.conversationId ? { conversationId: opts.conversationId } : {}),
        mode: opts?.mode ?? 'auto',
        kind,
        ...(opts?.attachmentIds && opts.attachmentIds.length > 0
          ? { attachmentIds: opts.attachmentIds }
          : {}),
      });

      const attempt = async (): Promise<'done' | 'retry' | 'aborted' | 'fatal'> => {
        const ac = new AbortController();
        abortRef.current = ac;
        let assistantId: string | null = null;
        let sawTerminal = false;
        let sawError = false;

        const res = await fetch(SSE_BASE, {
          method: 'POST',
          credentials: 'include',
          signal: ac.signal,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body,
        });

        if (!res.ok || !res.body) {
          setError({ reason: 'generic', message: `HTTP ${res.status}` });
          return 'fatal';
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const handleFrame = (frame: { event: string; data: unknown }): void => {
          switch (frame.event) {
            case 'meta': {
              const meta = frame.data as AskStreamMeta;
              assistantId = meta.assistantMessageId;
              setConversationId(meta.conversationId);
              setMessages((prev) => {
                if (prev.some((m) => m.id === meta.assistantMessageId)) return prev;
                return [
                  ...prev,
                  {
                    id: meta.assistantMessageId,
                    role: 'assistant',
                    kind: meta.kind,
                    contentMd: '',
                    citations: [],
                    dumbMode: meta.dumbMode,
                  },
                ];
              });
              break;
            }
            case 'token': {
              const { delta } = frame.data as { delta: string };
              if (!assistantId) break;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, contentMd: m.contentMd + delta } : m,
                ),
              );
              break;
            }
            case 'citation': {
              const cite = frame.data as AskCitation;
              if (!assistantId) break;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, citations: [...m.citations, cite] } : m,
                ),
              );
              break;
            }
            case 'tool_call': {
              const call = frame.data as { id: string; name: string; input?: unknown };
              if (!assistantId) break;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  const existing = m.toolEvents ?? [];
                  return {
                    ...m,
                    toolEvents: [...existing, { id: call.id, name: call.name, input: call.input }],
                  };
                }),
              );
              break;
            }
            case 'tool_result': {
              const result = frame.data as {
                id: string;
                name: string;
                ok: boolean;
                error?: string;
              };
              if (!assistantId) break;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  const events = m.toolEvents ?? [];
                  const idx = events.findIndex((e) => e.id === result.id && e.ok === undefined);
                  if (idx === -1) {
                    return {
                      ...m,
                      toolEvents: [...events, result],
                    };
                  }
                  const next = events.slice();
                  next[idx] = { ...events[idx]!, ok: result.ok, error: result.error };
                  return { ...m, toolEvents: next };
                }),
              );
              break;
            }
            case 'pinned': {
              const p = frame.data as {
                messageId: string;
                documentId: string;
                attachedFiles?: AskAttachedFile[];
              };
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === p.messageId
                    ? {
                        ...m,
                        pinnedDocumentId: p.documentId,
                        ...(p.attachedFiles ? { attachedFiles: p.attachedFiles } : {}),
                      }
                    : m,
                ),
              );
              break;
            }
            case 'heartbeat': {
              break;
            }
            case 'done': {
              const done = frame.data as AskStreamDone;
              if (assistantId) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          id: done.messageId,
                          dumbMode: done.dumbMode,
                          kind: done.kind,
                          ...(done.pinnedDocumentId
                            ? { pinnedDocumentId: done.pinnedDocumentId }
                            : {}),
                          ...(done.attachedFiles ? { attachedFiles: done.attachedFiles } : {}),
                        }
                      : m,
                  ),
                );
              }
              sawTerminal = true;
              break;
            }
            case 'error': {
              setError(frame.data as AskStreamError);
              sawError = true;
              sawTerminal = true;
              break;
            }
          }
        };

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let sep: number;
            while ((sep = buffer.indexOf('\n\n')) !== -1) {
              const block = buffer.slice(0, sep);
              buffer = buffer.slice(sep + 2);
              const parsed = parseSseBlock(block);
              if (!parsed) continue;
              handleFrame(parsed);
            }
          }
          if (buffer.trim().length > 0) {
            const parsed = parseSseBlock(buffer);
            if (parsed) handleFrame(parsed);
          }
        } catch (err) {
          const name = (err as { name?: string }).name;
          if (name === 'AbortError') {
            return userAbortRef.current ? 'aborted' : 'retry';
          }
          if (!sawTerminal) return 'retry';
          return 'fatal';
        }

        if (sawError) return 'fatal';
        if (sawTerminal) return 'done';
        return 'retry';
      };

      setStatus('streaming');
      try {
        const result = await attempt();
        if (result === 'done') {
          setStatus('done');
          return;
        }
        if (result === 'aborted') {
          setStatus('idle');
          return;
        }
        if (result === 'fatal') {
          setStatus('error');
          return;
        }
        setStatus('reconnecting');
        await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        if (userAbortRef.current) {
          setStatus('idle');
          return;
        }
        const second = await attempt();
        if (second === 'done') {
          setStatus('done');
        } else if (second === 'aborted') {
          setStatus('idle');
        } else {
          if (!error) {
            setError({ reason: 'generic', message: 'Connection lost — please try again.' });
          }
          setStatus('error');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError({ reason: 'generic', message });
        setStatus('error');
      } finally {
        abortRef.current = null;
      }
    },
    [status, error],
  );

  return {
    status,
    conversationId,
    messages,
    error,
    send,
    abort,
    reset,
    setMessages,
    setConversationId,
  };
}

function parseSseBlock(block: string): { event: string; data: unknown } | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join('\n');
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    return null;
  }
}
