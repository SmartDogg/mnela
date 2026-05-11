'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { Markdown } from '@/components/markdown';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AskMessage } from '@/lib/ask/useAskStream';

import { CitationChip } from './citation-chip';

const MARKER_RE = /\[(\d+)\]/g;

/**
 * Renders the assistant message body where `[N]` markers in the markdown are
 * replaced by live CitationChip components linked to /documents/:id?highlight=...
 *
 * Strategy: split the markdown text on `[N]` markers. Each fragment renders
 * via react-markdown; chips render in-between. This keeps the markdown
 * parser unaware of citations.
 */
export function MessageBubble({ message }: { message: AskMessage }): JSX.Element {
  const t = useTranslations('ask.messages');
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  const segments = useMemo(() => splitOnMarkers(message.contentMd), [message.contentMd]);
  const byOrd = useMemo(() => {
    const m = new Map<number, AskMessage['citations'][number]>();
    for (const c of message.citations) m.set(c.ord, c);
    return m;
  }, [message.citations]);

  return (
    <article className={cn('group flex flex-col gap-2 px-1', isUser ? 'items-end' : 'items-start')}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{isUser ? t('you') : isSystem ? t('system') : t('assistant')}</span>
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
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'rounded-br-md bg-primary text-primary-foreground'
            : 'rounded-bl-md border border-border/60 bg-card/40',
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.contentMd}</p>
        ) : (
          <div className="space-y-0.5">
            {segments.map((seg, idx) => {
              if (seg.kind === 'text') {
                return seg.text ? (
                  <span key={idx} className="contents">
                    <Markdown content={seg.text} />
                  </span>
                ) : null;
              }
              const cite = byOrd.get(seg.ord);
              if (!cite) {
                return (
                  <span key={idx} className="text-xs text-muted-foreground">
                    [{seg.ord}]
                  </span>
                );
              }
              return <CitationChip key={idx} citation={cite} />;
            })}
          </div>
        )}
      </div>
    </article>
  );
}

type Segment = { kind: 'text'; text: string } | { kind: 'cite'; ord: number };

function splitOnMarkers(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  MARKER_RE.lastIndex = 0;
  for (const match of text.matchAll(MARKER_RE)) {
    const idx = match.index ?? 0;
    if (idx > last) segments.push({ kind: 'text', text: text.slice(last, idx) });
    segments.push({ kind: 'cite', ord: Number(match[1]) });
    last = idx + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}
