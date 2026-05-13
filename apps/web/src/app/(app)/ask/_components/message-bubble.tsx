'use client';

import {
  Brain,
  CheckCircle2,
  FileText,
  Loader2,
  Paperclip,
  Search,
  Wrench,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Markdown } from '@/components/markdown';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AskMessage, AskToolEvent } from '@/lib/ask/useAskStream';

import { CitationChip } from './citation-chip';

/**
 * Renders one chat turn. After ADR-0050 the assistant body no longer
 * carries `[N]` markers — citations are surfaced as a separate chip
 * strip rendered below the prose, and the body is stripped of any
 * leftover `<cite>` tags the model might emit.
 */
export function MessageBubble({ message }: { message: AskMessage }): JSX.Element {
  const t = useTranslations('ask.messages');
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isIngest = message.kind === 'ingest';
  const cleanedBody = isUser ? message.contentMd : stripCiteMarkup(message.contentMd);

  return (
    <article className={cn('group flex flex-col gap-2 px-1', isUser ? 'items-end' : 'items-start')}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{isUser ? t('you') : isSystem ? t('system') : t('assistant')}</span>
        {isIngest && (
          <Badge
            variant="outline"
            className="h-4 gap-0.5 border-primary/40 px-1 text-[9px] text-primary"
          >
            <Brain className="size-2.5" /> {t('ingested')}
          </Badge>
        )}
        {message.dumbMode && (
          <Badge
            variant="outline"
            className="h-4 border-amber-500/40 px-1 text-[9px] text-amber-600 dark:text-amber-400"
          >
            Dumb Mode
          </Badge>
        )}
        {message.aborted && (
          <Badge
            variant="outline"
            className="h-4 border-muted px-1 text-[9px] text-muted-foreground"
          >
            Aborted
          </Badge>
        )}
      </div>
      {!isUser && message.toolEvents && message.toolEvents.length > 0 && (
        <ToolTimeline events={message.toolEvents} />
      )}
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'rounded-br-md bg-primary text-primary-foreground'
            : 'rounded-bl-md border border-border/60 bg-card/40',
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{cleanedBody}</p>
        ) : (
          <Markdown content={cleanedBody} />
        )}
      </div>
      {!isUser && message.citations.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap gap-1.5">
          {message.citations.map((c) => (
            <CitationChip key={`${c.ord}-${c.docId}`} citation={c} />
          ))}
        </div>
      )}
      {!isUser && message.attachedFiles && message.attachedFiles.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap gap-1.5">
          {message.attachedFiles.map((f) => (
            <Link
              key={f.jobId}
              href={`/jobs/${f.jobId}`}
              className="inline-flex h-6 max-w-[14rem] items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/5 pl-1.5 pr-2 text-[11px] text-amber-700 transition-colors hover:bg-amber-500/15 dark:text-amber-300"
              title={f.filename}
            >
              <Paperclip className="size-3" />
              <span className="truncate">{f.filename}</span>
            </Link>
          ))}
        </div>
      )}
      {!isUser && message.pinnedDocumentId && (
        <Link
          href={`/documents/${message.pinnedDocumentId}`}
          className="inline-flex items-center gap-1.5 text-[11px] text-primary hover:underline"
        >
          <Brain className="size-3" /> {t('ingestSavedAs')}
        </Link>
      )}
    </article>
  );
}

function ToolTimeline({ events }: { events: AskToolEvent[] }): JSX.Element {
  const t = useTranslations('ask.toolCalls');
  return (
    <div className="mb-1 max-w-[85%] space-y-1 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Wrench className="size-3" /> {t('label')}
      </div>
      {events.map((e) => (
        <ToolEventRow key={e.id} event={e} />
      ))}
    </div>
  );
}

function ToolEventRow({ event }: { event: AskToolEvent }): JSX.Element {
  const t = useTranslations('ask.toolCalls.verbs');
  const Icon = pickToolIcon(event.name);
  const verb = pickToolVerb(event.name, t);
  const summary = summariseInput(event.input);
  return (
    <div className="flex items-center gap-2 font-mono text-[11px]">
      {event.ok === undefined ? (
        <Loader2 className="size-3 animate-spin text-muted-foreground" />
      ) : event.ok ? (
        <CheckCircle2 className="size-3 text-emerald-500" />
      ) : (
        <XCircle className="size-3 text-destructive" />
      )}
      <Icon className="size-3 text-muted-foreground" />
      <span className="text-foreground/80">{verb}</span>
      {summary && <span className="text-muted-foreground">{summary}</span>}
      {event.ok === false && event.error && (
        <span className="text-destructive">— {event.error}</span>
      )}
    </div>
  );
}

function pickToolIcon(name: string): typeof Search {
  if (name === 'mnela_find_similar' || name === 'mnela_search') return Search;
  if (name === 'mnela_get_chunks' || name === 'mnela_get_document') return FileText;
  return Wrench;
}

/**
 * Map MCP tool names to localised verbs. The `t` function is the
 * already-namespaced `useTranslations('ask.toolCalls.verbs')` value,
 * passed in so this helper can stay pure (no extra hook). Unknown tools
 * fall back to a humanised version of their name — they're rare in
 * normal flows but show up if a future MCP tool ships before the
 * locale catches up.
 */
function pickToolVerb(name: string, t: (key: string) => string): string {
  const map: Record<string, string> = {
    mnela_find_similar: 'findSimilar',
    mnela_search: 'search',
    mnela_get_chunks: 'getChunks',
    mnela_get_document: 'getDocument',
    mnela_get_daily_note: 'getDailyNote',
    mnela_get_decisions: 'getDecisions',
    mnela_get_entity: 'getEntity',
    mnela_traverse_graph: 'traverseGraph',
    mnela_recent_activity: 'recentActivity',
  };
  const key = map[name];
  if (key) return t(key);
  return name.replace(/^mnela_/, '').replace(/_/g, ' ');
}

function summariseInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input.slice(0, 60);
  if (typeof input !== 'object') return String(input);
  const obj = input as Record<string, unknown>;
  for (const key of ['query', 'text', 'documentId', 'slug', 'name', 'id', 'date']) {
    const v = obj[key];
    if (typeof v === 'string' && v.length > 0) {
      const trimmed = v.length > 60 ? `${v.slice(0, 60)}…` : v;
      return `· ${trimmed}`;
    }
  }
  return '';
}

const CITE_TAG_RE = /<cite\b[^>]*>([\s\S]*?)<\/cite>/gi;
const SQUARE_MARKER_RE = /\s*\[(\d+)\]/g;

/**
 * The new pipeline emits citations as a separate channel, so any
 * stray `<cite doc-id="…">…</cite>` from the model is replaced with
 * its inner text and bracket markers like `[1]` are dropped — the
 * chip strip below the body owns that anchoring now.
 */
function stripCiteMarkup(text: string): string {
  return text.replace(CITE_TAG_RE, '$1').replace(SQUARE_MARKER_RE, '');
}
