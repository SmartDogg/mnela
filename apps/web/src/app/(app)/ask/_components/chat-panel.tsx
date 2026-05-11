'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Loader2, Send, Sparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api/client';
import { useAskStream, type AskCitation, type AskMessage } from '@/lib/ask/useAskStream';
import { cn } from '@/lib/utils';

import { DumbModeBanner } from './dumb-mode-banner';
import { MessageBubble } from './message-bubble';
import { RateLimitBanner } from './rate-limit-banner';
import { SaveSynthesisDialog } from './save-synthesis-dialog';

interface ConversationDetail {
  conversation: {
    id: string;
    title: string;
    adminUserId: string;
    synthesisDocumentId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  messages: {
    id: string;
    role: 'user' | 'assistant' | 'system';
    contentMd: string;
    citations: AskCitation[];
    dumbMode: boolean;
    aborted: boolean;
    createdAt: string;
  }[];
}

export function ChatPanel({
  conversationId,
  onConversationCreated,
}: {
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
}): JSX.Element {
  const t = useTranslations('ask');
  const queryClient = useQueryClient();
  const ask = useAskStream();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);

  // Load history for an existing conversation; new conversations start empty.
  const history = useQuery({
    queryKey: ['conversations', conversationId],
    queryFn: () => api.get<ConversationDetail>(`/conversations/${conversationId}`),
    enabled: Boolean(conversationId) && ask.messages.length === 0,
    staleTime: 30_000,
  });

  // Destructure stable handles (useState setters + useCallback'd reset) so the
  // effect deps stay referentially stable; depending on the whole `ask`
  // object previously rebuilt the effect every render and `reset()` itself
  // triggered a new render → infinite loop. Track the previous
  // conversationId via a ref so we only reset on actual transitions to null.
  const { reset, setConversationId: askSetConversationId, setMessages: askSetMessages } = ask;
  const messagesCount = ask.messages.length;
  const prevConversationIdRef = useRef<string | null>(conversationId);
  useEffect(() => {
    if (prevConversationIdRef.current !== conversationId) {
      prevConversationIdRef.current = conversationId;
      if (!conversationId) {
        reset();
        return;
      }
    }
    if (conversationId && history.data && messagesCount === 0) {
      askSetConversationId(history.data.conversation.id);
      askSetMessages(
        history.data.messages.map<AskMessage>((m) => ({
          id: m.id,
          role: m.role,
          contentMd: m.contentMd,
          citations: m.citations,
          dumbMode: m.dumbMode,
          aborted: m.aborted,
        })),
      );
    }
  }, [conversationId, history.data, messagesCount, reset, askSetConversationId, askSetMessages]);

  useEffect(() => {
    if (ask.conversationId && ask.conversationId !== conversationId) {
      onConversationCreated(ask.conversationId);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    }
  }, [ask.conversationId, conversationId, onConversationCreated, queryClient]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' });
  }, [ask.messages, ask.status]);

  const submit = async (): Promise<void> => {
    const q = query.trim();
    if (q.length === 0 || ask.status === 'streaming') return;
    setQuery('');
    await ask.send(q, conversationId ? { conversationId } : undefined);
  };

  useHotkeys(
    'mod+enter',
    () => {
      // Standard chat ergonomics: Cmd+Enter inserts a newline (the user prompt).
      // Default textarea behavior already inserts a newline on Enter; this
      // hotkey is a no-op handler that prevents Enter→submit from firing.
    },
    { enableOnFormTags: true },
    [],
  );

  const lastAssistant = [...ask.messages].reverse().find((m) => m.role === 'assistant');
  const canSave =
    ask.status === 'done' &&
    ask.conversationId &&
    lastAssistant &&
    lastAssistant.contentMd.trim().length > 0 &&
    !lastAssistant.aborted;

  return (
    <section className="flex h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold">{t('title')}</h1>
          <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canSave && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSaveOpen(true)}
            className="h-7 gap-1.5 px-2 text-xs"
          >
            <Bookmark className="size-3" /> {t('saveSynthesis')}
          </Button>
        )}
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4" ref={scrollerRef}>
        {ask.messages.length === 0 && (
          <EmptyState
            title={t('empty.title')}
            description={t('empty.subtitle')}
            icon={Sparkles}
            className="my-12"
          />
        )}

        {ask.messages.length === 0 && (
          <p className="px-2 text-center text-[11px] text-muted-foreground">
            {t('empty.examples')}
          </p>
        )}

        {ask.messages.some((m) => m.dumbMode) && <DumbModeBanner />}
        {ask.error?.reason === 'rate-limit' && <RateLimitBanner resetAt={ask.error.resetAt} />}

        <div className="space-y-4">
          {ask.messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {ask.status === 'streaming' && (
            <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              <span>{t('sending')}</span>
            </div>
          )}
          {ask.error && ask.error.reason !== 'rate-limit' && (
            <div className="rounded-md border border-destructive/40 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive">
              {translateError(ask.error.reason, t)}
              {ask.error.message && <span className="ml-1 opacity-70">— {ask.error.message}</span>}
            </div>
          )}
        </div>
      </div>

      <footer className="border-t border-border/60 px-4 py-3">
        <div className="relative">
          <Textarea
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('placeholder')}
            disabled={ask.status === 'streaming'}
            rows={3}
            className="resize-none pr-24 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <div className="absolute right-2 top-2 flex items-center gap-1">
            {ask.status === 'streaming' ? (
              <Button size="sm" variant="ghost" onClick={ask.abort} className="h-8 w-8 p-0">
                <X className="size-4" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void submit()}
                disabled={query.trim().length === 0}
                className="h-8 w-8 p-0"
              >
                <Send className="size-4" />
              </Button>
            )}
          </div>
        </div>
        <p className={cn('mt-1.5 text-[10px] text-muted-foreground')}>{t('input.hint')}</p>
      </footer>

      {ask.conversationId && lastAssistant && (
        <SaveSynthesisDialog
          open={saveOpen}
          onOpenChange={setSaveOpen}
          conversationId={ask.conversationId}
          messageId={lastAssistant.id}
        />
      )}
    </section>
  );
}

function translateError(
  reason: 'rate-limit' | 'no-binary' | 'auth' | 'generic',
  t: ReturnType<typeof useTranslations>,
): string {
  switch (reason) {
    case 'no-binary':
      return t('error.noBinary');
    case 'auth':
      return t('error.auth');
    case 'rate-limit':
      return t('error.rateLimit');
    default:
      return t('error.generic');
  }
}
