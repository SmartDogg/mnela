'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bookmark,
  Brain,
  Loader2,
  MessageSquare,
  Paperclip,
  Send,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from '@/lib/api/client';
import {
  useAskStream,
  type AskCitation,
  type AskMessage,
  type AskMessageKind,
} from '@/lib/ask/useAskStream';
import { useAskAttachments, type AttachmentDraft } from '@/lib/ask/useAskAttachments';
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
    kind?: AskMessageKind;
    contentMd: string;
    citations: AskCitation[];
    dumbMode: boolean;
    aborted: boolean;
    pinnedDocumentId?: string | null;
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
  const searchParams = useSearchParams();
  /**
   * ADR-0050: `?scope=project:<slug>` restricts the agent loop's search
   * tools (mnela_find_similar / mnela_search) to documents in that project.
   * Sticky for the session — re-renders read the param fresh; we don't
   * persist it elsewhere so changing the URL flips the scope immediately.
   */
  const scopeProjectSlug = useMemo(() => {
    const raw = searchParams?.get('scope');
    if (raw && raw.startsWith('project:')) {
      const slug = raw.slice('project:'.length);
      return slug.length > 0 ? slug : null;
    }
    return null;
  }, [searchParams]);
  const attachments = useAskAttachments();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [appKind, setAppKind] = useState<AskMessageKind>('chat');
  const [saveOpen, setSaveOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const history = useQuery({
    queryKey: ['conversations', conversationId],
    queryFn: () => api.get<ConversationDetail>(`/conversations/${conversationId}`),
    enabled: Boolean(conversationId) && ask.messages.length === 0,
    staleTime: 30_000,
  });

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
        history.data.messages.map<AskMessage>((m) => {
          const out: AskMessage = {
            id: m.id,
            role: m.role,
            contentMd: m.contentMd,
            citations: m.citations,
          };
          if (m.kind) out.kind = m.kind;
          if (m.dumbMode) out.dumbMode = m.dumbMode;
          if (m.aborted) out.aborted = m.aborted;
          if (m.pinnedDocumentId) out.pinnedDocumentId = m.pinnedDocumentId;
          return out;
        }),
      );
    }
  }, [conversationId, history.data, messagesCount, reset, askSetConversationId, askSetMessages]);

  useEffect(() => {
    if (ask.conversationId && ask.conversationId !== conversationId) {
      onConversationCreated(ask.conversationId);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    }
  }, [ask.conversationId, conversationId, onConversationCreated, queryClient]);

  // Refresh memory + conversations sidebar whenever a turn terminates.
  useEffect(() => {
    if (ask.status === 'error' || ask.status === 'done') {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['pinned-by-day'] });
    }
  }, [ask.status, queryClient]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' });
  }, [ask.messages, ask.status]);

  const busy = ask.status === 'streaming' || ask.status === 'reconnecting';
  const canSubmit =
    query.trim().length > 0 &&
    !busy &&
    !attachments.uploading &&
    !attachments.drafts.some((d) => d.status === 'error');

  const submit = async (): Promise<void> => {
    const q = query.trim();
    if (q.length === 0 || busy) return;
    if (attachments.uploading) return;
    const ids = attachments.readyIds;
    const sendOpts: Parameters<typeof ask.send>[1] = { kind: appKind };
    if (conversationId) sendOpts.conversationId = conversationId;
    if (ids.length > 0) sendOpts.attachmentIds = ids;
    if (scopeProjectSlug) sendOpts.scopeProjectSlug = scopeProjectSlug;
    setQuery('');
    // Drop the local chips immediately. The server has already taken
    // ownership of the files (chat-mode deletes after the stream;
    // ingest-mode renames into uploads/ + enqueues ingest_file jobs).
    attachments.clear();
    setAppKind('chat');
    await ask.send(q, sendOpts);
  };

  useHotkeys(
    'mod+enter',
    () => {
      // Cmd+Enter inserts a newline (default textarea behaviour).
    },
    { enableOnFormTags: true },
    [],
  );

  const onPickFiles = (): void => fileInputRef.current?.click();
  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    if (e.target.files && e.target.files.length > 0) {
      attachments.add(e.target.files);
      e.target.value = '';
    }
  };

  const lastAssistant = [...ask.messages].reverse().find((m) => m.role === 'assistant');
  const canSave =
    ask.status === 'done' &&
    ask.conversationId &&
    lastAssistant &&
    lastAssistant.contentMd.trim().length > 0 &&
    !lastAssistant.aborted;

  return (
    <section
      className="relative flex h-full flex-1 flex-col"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.items).some((it) => it.kind === 'file')) {
          e.preventDefault();
          if (!busy) setDragActive(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        if (busy) return;
        if (e.dataTransfer.files.length > 0) {
          attachments.add(e.dataTransfer.files);
        }
      }}
    >
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
          {ask.status === 'reconnecting' && (
            <div className="flex items-center gap-2 px-2 text-xs text-amber-600 dark:text-amber-400">
              <Loader2 className="size-3 animate-spin" />
              <span>{t('reconnecting')}</span>
            </div>
          )}
          {ask.error && ask.error.reason !== 'rate-limit' && ask.status !== 'reconnecting' && (
            <div className="rounded-md border border-destructive/40 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive">
              {translateError(ask.error.reason, t)}
            </div>
          )}
        </div>
      </div>

      <footer className="border-t border-border/60 px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <KindToggle kind={appKind} onChange={setAppKind} disabled={busy} />
          <p className="text-[10px] text-muted-foreground">
            {appKind === 'ingest' ? t('composer.ingestHint') : t('composer.chatHint')}
          </p>
          {scopeProjectSlug && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
              <Sparkles className="size-3" />
              scope: project:{scopeProjectSlug}
            </span>
          )}
        </div>
        {attachments.drafts.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.drafts.map((d) => (
              <AttachmentChip
                key={d.tempId}
                draft={d}
                onRemove={() => attachments.remove(d.tempId)}
              />
            ))}
          </div>
        )}
        <div className="relative">
          <Textarea
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('placeholder')}
            disabled={busy}
            rows={3}
            className="resize-none pl-10 pr-12 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onFileInputChange}
          />
          <button
            type="button"
            onClick={onPickFiles}
            disabled={busy}
            aria-label={t('composer.attachAria')}
            className="absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:opacity-50"
          >
            <Paperclip className="size-4" />
          </button>
          <div className="absolute right-2 top-2 flex items-center gap-1">
            {busy ? (
              <Button size="sm" variant="ghost" onClick={ask.abort} className="h-8 w-8 p-0">
                <X className="size-4" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void submit()}
                disabled={!canSubmit}
                className="h-8 w-8 p-0"
                title={
                  attachments.uploading
                    ? t('composer.waitForUploads')
                    : query.trim().length === 0
                      ? t('composer.emptyHint')
                      : undefined
                }
              >
                <Send className="size-4" />
              </Button>
            )}
          </div>
        </div>
        <p className={cn('mt-1.5 text-[10px] text-muted-foreground')}>{t('input.hint')}</p>
      </footer>

      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-primary/[0.08] backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-1.5 rounded-lg border-2 border-dashed border-primary/70 bg-card/90 px-6 py-4 text-sm text-primary">
            <Upload className="size-5" />
            <span>{t('composer.dropHere')}</span>
          </div>
        </div>
      )}

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

function KindToggle({
  kind,
  onChange,
  disabled,
}: {
  kind: AskMessageKind;
  onChange: (next: AskMessageKind) => void;
  disabled: boolean;
}): JSX.Element {
  const t = useTranslations('ask.composer');
  return (
    <TooltipProvider delayDuration={250}>
      <div className="inline-flex items-center gap-0 rounded-md border border-border/60 bg-card/40 p-0.5 text-[11px]">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onChange('chat')}
              disabled={disabled}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-sm px-2 transition-colors',
                kind === 'chat'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              aria-pressed={kind === 'chat'}
            >
              <MessageSquare className="size-3" /> {t('chatLabel')}
            </button>
          </TooltipTrigger>
          <TooltipContent>{t('chatTooltip')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onChange('ingest')}
              disabled={disabled}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-sm px-2 transition-colors',
                kind === 'ingest'
                  ? 'bg-primary/15 text-primary shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              aria-pressed={kind === 'ingest'}
            >
              <Brain className="size-3" /> {t('ingestLabel')}
            </button>
          </TooltipTrigger>
          <TooltipContent>{t('ingestTooltip')}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

function AttachmentChip({
  draft,
  onRemove,
}: {
  draft: AttachmentDraft;
  onRemove: () => void;
}): JSX.Element {
  const t = useTranslations('ask.composer');
  const removeLabel = t('removeAttachment');
  const ringClass =
    draft.status === 'error'
      ? 'border-destructive/40 bg-destructive/5 text-destructive'
      : draft.status === 'uploading'
        ? 'border-muted bg-muted/30 text-muted-foreground'
        : 'border-primary/30 bg-primary/5 text-primary';
  return (
    <span
      className={cn(
        'inline-flex h-7 max-w-[18rem] items-center gap-1.5 rounded-full border pl-2 pr-1 text-[11px]',
        ringClass,
      )}
      title={
        draft.status === 'error' ? draft.error : `${draft.filename} · ${formatBytes(draft.size)}`
      }
    >
      {draft.status === 'uploading' ? (
        <Loader2 className="size-3 animate-spin" />
      ) : draft.status === 'error' ? (
        <AlertTriangle className="size-3" />
      ) : (
        <Paperclip className="size-3" />
      )}
      <span className="truncate font-medium">{draft.filename}</span>
      <span className="shrink-0 text-[10px] opacity-70">{formatBytes(draft.size)}</span>
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex size-4 items-center justify-center rounded-full hover:bg-foreground/10"
        aria-label={removeLabel}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function translateError(
  reason: 'rate-limit' | 'no-binary' | 'auth' | 'timeout' | 'generic',
  t: ReturnType<typeof useTranslations>,
): string {
  switch (reason) {
    case 'no-binary':
      return t('error.noBinary');
    case 'auth':
      return t('error.auth');
    case 'rate-limit':
      return t('error.rateLimit');
    case 'timeout':
      return t('error.timeout');
    default:
      return t('error.generic');
  }
}
