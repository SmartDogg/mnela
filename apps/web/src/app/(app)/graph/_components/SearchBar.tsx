'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api/client';
import type { Paginated } from '@/lib/api/types';
import { cn } from '@/lib/utils';

interface EntityRow {
  id: string;
  name: string;
  type: string;
}

interface SearchBarProps {
  /** When non-empty, the user typed a name. Calls onMatchInGraph for in-graph centering. */
  onMatchInGraph: (query: string) => void;
  /** Selecting a result re-centers the graph on that entity. */
  onPickCenter: (entityId: string) => void;
  /** Pre-fill text — useful for showing the current center name. */
  placeholder?: string;
  /**
   * When set, the bar renders the picked entity as a leading chip with a
   * clear button. Backspace on an empty input also clears the chip. The
   * parent owns the actual center state — this is presentation only.
   */
  centerLabel?: string;
  /** Called when the user removes the chip (clears center). */
  onClearCenter?: () => void;
}

export function SearchBar({
  onMatchInGraph,
  onPickCenter,
  placeholder,
  centerLabel,
  onClearCenter,
}: SearchBarProps): JSX.Element {
  const t = useTranslations('graph');
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Debounce remote lookup; cheap in-graph match is fired on every keystroke.
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(text.trim()), 220);
    return () => window.clearTimeout(id);
  }, [text]);

  const enabled = debounced.length >= 2;
  const query = useQuery({
    queryKey: ['graph-entities-search', debounced],
    enabled,
    queryFn: () =>
      api.get<Paginated<EntityRow>>('/graph/entities', {
        query: { q: debounced, limit: 10 },
      }),
  });

  useEffect(() => {
    function onClick(e: MouseEvent): void {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const results = query.data?.items ?? [];

  function pickCenter(id: string): void {
    onPickCenter(id);
    // Picking a result switches modes from "filter highlight" to "navigation".
    // Clear the typed text so the highlight doesn't linger on the new graph.
    setText('');
    onMatchInGraph('');
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div
        className={cn(
          'relative flex h-8 items-center gap-1.5 rounded-md border bg-background pl-2.5 pr-2.5',
          'focus-within:ring-1 focus-within:ring-ring',
        )}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {centerLabel && (
          <Badge
            variant="secondary"
            className="flex shrink-0 items-center gap-1 px-1.5 py-0.5 font-mono text-[11px]"
          >
            <span className="max-w-[10rem] truncate" title={centerLabel}>
              {centerLabel}
            </span>
            {onClearCenter && (
              <button
                type="button"
                onClick={() => {
                  onClearCenter();
                  setText('');
                  onMatchInGraph('');
                }}
                className="-mr-0.5 ml-0.5 rounded hover:bg-background/50"
                aria-label={t('search.clearCenter')}
                title={t('search.clearCenter')}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        )}
        <input
          value={text}
          placeholder={
            centerLabel ? t('search.replaceCenter') : (placeholder ?? t('search.placeholder'))
          }
          className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            setOpen(true);
            onMatchInGraph(next.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              setText('');
              onMatchInGraph('');
            }
            if (e.key === 'Enter' && results.length > 0) {
              const first = results[0];
              if (first) pickCenter(first.id);
            }
            // Gmail-style chip removal: Backspace on empty input drops center.
            if (
              e.key === 'Backspace' &&
              text === '' &&
              centerLabel !== undefined &&
              onClearCenter
            ) {
              onClearCenter();
            }
          }}
        />
        {query.isFetching && (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        )}
      </div>
      {open && enabled && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {query.isLoading && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('search.loading')}</div>
          )}
          {!query.isLoading && results.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('search.empty')}</div>
          )}
          {results.map((row) => (
            <button
              key={row.id}
              type="button"
              onMouseDown={(e) => {
                // Prevent input blur from closing the popover before click.
                e.preventDefault();
                pickCenter(row.id);
              }}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                'hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:outline-none',
              )}
            >
              <span className="truncate">{row.name}</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {row.type}
              </span>
            </button>
          ))}
          {results.length > 0 && (
            <div className="border-t mt-1 px-2 py-1 text-[10px] text-muted-foreground">
              {t('search.hint')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
