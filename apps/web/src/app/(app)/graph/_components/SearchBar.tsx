'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

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
}

export function SearchBar({
  onMatchInGraph,
  onPickCenter,
  placeholder,
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

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={text}
          placeholder={placeholder ?? t('search.placeholder')}
          className="h-8 pl-8 text-sm"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            setOpen(true);
            onMatchInGraph(next.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'Enter' && results.length > 0) {
              const first = results[0];
              if (first) {
                onPickCenter(first.id);
                setOpen(false);
              }
            }
          }}
        />
        {query.isFetching && (
          <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
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
                onPickCenter(row.id);
                setOpen(false);
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
        </div>
      )}
    </div>
  );
}
