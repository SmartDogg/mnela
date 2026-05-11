'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import { collectMatchSnippets, splitOnMatches, tokenizeQuery } from '@/lib/text/highlight-terms';
import { cn } from '@/lib/utils';

interface HighlightBannerProps {
  body: string;
  query: string;
}

export function HighlightBanner({ body, query }: HighlightBannerProps): JSX.Element | null {
  const t = useTranslations('search');
  const tokens = useMemo(() => tokenizeQuery(query), [query]);
  const snippets = useMemo(
    () => collectMatchSnippets(body, tokens, { maxSnippets: 4, radius: 80 }),
    [body, tokens],
  );

  if (tokens.length === 0 || snippets.length === 0) return null;

  return (
    <aside
      aria-label="Search match preview"
      className="mx-8 mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/[0.04] px-4 py-3"
    >
      <div className="flex items-center gap-2 pb-2">
        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
          {t('matchesInDoc') ?? 'Matches'}
        </Badge>
        <span className="text-[11px] text-muted-foreground">
          {tokens.length === 1 ? tokens[0] : `${tokens.length} terms`}
        </span>
      </div>
      <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
        {snippets.map((snip, i) => (
          <li key={i} className={cn('break-words')}>
            <span aria-hidden="true">…</span>
            {splitOnMatches(snip.text, tokens).map((frag, j) =>
              frag.marked ? <mark key={j}>{frag.text}</mark> : <span key={j}>{frag.text}</span>,
            )}
            <span aria-hidden="true">…</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
