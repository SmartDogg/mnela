'use client';

import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { Brain, CalendarDays, FileText, MessageSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface PinnedDocument {
  id: string;
  title: string;
  source: 'chat' | 'daily';
  conversationId?: string;
  assistantMessageId?: string;
}

interface PinnedByDayResponse {
  days: { date: string; documents: PinnedDocument[] }[];
}

/**
 * Sidebar pane that groups Document(source IN 'chat','daily') by day.
 * Chat-pinned rows deep-link back into the conversation; daily rows go
 * straight to the Document detail view. Lives alongside the
 * Conversations list (see ConversationsSidebar).
 */
export function DailySidebar({
  onOpenConversation,
}: {
  onOpenConversation?: (conversationId: string) => void;
}): JSX.Element {
  const t = useTranslations('ask.memorySidebar');
  const list = useQuery({
    queryKey: ['pinned-by-day'],
    queryFn: () => api.get<PinnedByDayResponse>('/search/pinned-by-day'),
    staleTime: 30_000,
  });

  if (list.isLoading) {
    return <div className="px-3 py-3 text-[11px] text-muted-foreground">{t('loading')}</div>;
  }

  if (!list.data || list.data.days.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 px-3 py-6 text-center text-[11px] text-muted-foreground">
        <CalendarDays className="size-4" />
        <p>{t('empty')}</p>
        <p className="text-[10px] text-muted-foreground/80">{t('emptyHint')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-2 py-2">
      {list.data.days.map((day) => (
        <DayGroup
          key={day.date}
          date={day.date}
          documents={day.documents}
          onOpenConversation={onOpenConversation}
        />
      ))}
    </div>
  );
}

function DayGroup({
  date,
  documents,
  onOpenConversation,
}: {
  date: string;
  documents: PinnedDocument[];
  onOpenConversation?: (id: string) => void;
}): JSX.Element {
  const relative = (() => {
    try {
      return formatDistanceToNow(parseISO(`${date}T00:00:00.000Z`), { addSuffix: true });
    } catch {
      return '';
    }
  })();

  return (
    <section>
      <header className="mb-1 flex items-baseline justify-between px-1">
        <h3 className="text-[11px] font-semibold text-foreground">{date}</h3>
        {relative && (
          <span className="text-[10px] text-muted-foreground" title={relative}>
            {relative}
          </span>
        )}
      </header>
      <ul className="space-y-0.5">
        {documents.map((d) => (
          <PinnedItem key={d.id} document={d} onOpenConversation={onOpenConversation} />
        ))}
      </ul>
    </section>
  );
}

function PinnedItem({
  document,
  onOpenConversation,
}: {
  document: PinnedDocument;
  onOpenConversation?: (id: string) => void;
}): JSX.Element {
  const Icon = document.source === 'daily' ? FileText : Brain;
  const titleClass = 'flex-1 truncate text-left';

  // Chat-pinned: prefer opening the source conversation in-place when
  // possible (state lift from page.tsx), falling back to the document
  // detail page. Daily: always document detail.
  if (document.source === 'chat' && document.conversationId && onOpenConversation) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onOpenConversation(document.conversationId!)}
          className={cn(
            'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-foreground/85 transition-colors hover:bg-accent/50',
          )}
          title={document.title}
        >
          <Icon className="size-3 shrink-0 text-primary" />
          <span className={titleClass}>{document.title}</span>
          <MessageSquare className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={`/documents/${document.id}`}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-foreground/85 transition-colors hover:bg-accent/50',
        )}
        title={document.title}
      >
        <Icon
          className={cn(
            'size-3 shrink-0',
            document.source === 'daily' ? 'text-amber-500' : 'text-primary',
          )}
        />
        <span className={titleClass}>{document.title}</span>
      </Link>
    </li>
  );
}
