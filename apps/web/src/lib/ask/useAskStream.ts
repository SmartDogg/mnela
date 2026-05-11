'use client';

import { useCallback, useRef, useState } from 'react';

export interface AskCitation {
  ord: number;
  docId: string;
  title: string | null;
  snippet: string;
}

export interface AskMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  contentMd: string;
  citations: AskCitation[];
  dumbMode?: boolean;
  aborted?: boolean;
}

export interface AskStreamMeta {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  dumbMode: boolean;
}

export interface AskStreamDone {
  conversationId: string;
  messageId: string;
  durationMs: number;
  citationsTotal: number;
  totalTokensIn: number | null;
  totalTokensOut: number | null;
  dumbMode: boolean;
}

export interface AskStreamError {
  reason: 'rate-limit' | 'no-binary' | 'auth' | 'generic';
  resetAt?: string;
  message?: string;
}

export type AskStreamStatus = 'idle' | 'streaming' | 'done' | 'error';

export interface UseAskStreamApi {
  status: AskStreamStatus;
  conversationId: string | null;
  messages: AskMessage[];
  error: AskStreamError | null;
  send(query: string, opts?: { conversationId?: string; mode?: 'auto' | 'fts' }): Promise<void>;
  abort(): void;
  reset(): void;
  setMessages(messages: AskMessage[]): void;
  setConversationId(id: string | null): void;
}

const SSE_BASE = '/_api/search/ask';

/**
 * Streaming client for POST /search/ask. Native EventSource is GET-only, so
 * we POST + read the response as text/event-stream and parse SSE frames
 * (`event: …\ndata: …\n\n` blocks) by hand. Cookies flow via credentials:'include'.
 */
export function useAskStream(): UseAskStreamApi {
  const [status, setStatus] = useState<AskStreamStatus>('idle');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [error, setError] = useState<AskStreamError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
    setMessages([]);
    setConversationId(null);
    setError(null);
  }, []);

  const abort = useCallback((): void => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (
      query: string,
      opts?: { conversationId?: string; mode?: 'auto' | 'fts' },
    ): Promise<void> => {
      if (status === 'streaming') return;
      const ac = new AbortController();
      abortRef.current = ac;
      setStatus('streaming');
      setError(null);

      // Optimistic: user bubble first; assistant bubble starts empty on meta.
      const optimisticUserId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: optimisticUserId, role: 'user', contentMd: query, citations: [] },
      ]);

      let sawError = false;

      try {
        const res = await fetch(SSE_BASE, {
          method: 'POST',
          credentials: 'include',
          signal: ac.signal,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({
            query,
            ...(opts?.conversationId ? { conversationId: opts.conversationId } : {}),
            mode: opts?.mode ?? 'auto',
          }),
        });

        if (!res.ok || !res.body) {
          const message = `HTTP ${res.status}`;
          setError({ reason: 'generic', message });
          setStatus('error');
          sawError = true;
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let assistantId: string | null = null;

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

        // Drain any leftover buffered frame at EOS.
        if (buffer.trim().length > 0) {
          const parsed = parseSseBlock(buffer);
          if (parsed) handleFrame(parsed);
        }

        if (!sawError) setStatus('done');

        function handleFrame(frame: { event: string; data: unknown }): void {
          switch (frame.event) {
            case 'meta': {
              const meta = frame.data as AskStreamMeta;
              assistantId = meta.assistantMessageId;
              setConversationId(meta.conversationId);
              setMessages((prev) => [
                ...prev,
                {
                  id: meta.assistantMessageId,
                  role: 'assistant',
                  contentMd: '',
                  citations: [],
                  dumbMode: meta.dumbMode,
                },
              ]);
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
            case 'done': {
              const done = frame.data as AskStreamDone;
              if (assistantId) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, id: done.messageId, dumbMode: done.dumbMode }
                      : m,
                  ),
                );
              }
              setStatus('done');
              break;
            }
            case 'error': {
              setError(frame.data as AskStreamError);
              setStatus('error');
              sawError = true;
              break;
            }
          }
        }
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') {
          setStatus('idle');
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setError({ reason: 'generic', message });
        setStatus('error');
        sawError = true;
      } finally {
        abortRef.current = null;
      }
    },
    [status],
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
