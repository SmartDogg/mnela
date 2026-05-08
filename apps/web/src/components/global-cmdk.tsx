'use client';

import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useCmdkStore } from '@/lib/state/cmdk-store';
import { api } from '@/lib/api/client';
import type { SearchHit, SearchResult } from '@/lib/api/types';

const DEBOUNCE_MS = 180;

export function GlobalCmdk(): JSX.Element {
  const t = useTranslations('cmdk');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { isOpen, open, close, toggle } = useCmdkStore();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const search = useMutation({
    mutationFn: (q: string) =>
      api.post<SearchResult>('/search', { query: q, mode: 'hybrid', limit: 10 }),
    onSuccess: (res) => setHits(res.hits),
  });

  useEffect(() => {
    if (debounced.length === 0) {
      setHits([]);
      return;
    }
    search.mutate(debounced);
    // search.mutate is stable across renders
  }, [debounced]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  const select = useCallback(
    (hit: SearchHit) => {
      close();
      setQuery('');
      router.push(`/documents/${hit.documentId}`);
    },
    [close, router],
  );

  const isLoading = search.isPending;
  const groups = useMemo(() => groupHits(hits), [hits]);

  return (
    <Dialog open={isOpen} onOpenChange={(o) => (o ? open() : close())}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-2xl">
        <DialogTitle className="sr-only">{t('placeholder')}</DialogTitle>
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={t('placeholder')} />
          <CommandList>
            {isLoading && (
              <p className="px-3 py-2 text-xs text-muted-foreground">{tCommon('loading')}</p>
            )}
            {!isLoading && debounced && hits.length === 0 && (
              <CommandEmpty>{tCommon('empty')}</CommandEmpty>
            )}
            {groups.map((group) => (
              <CommandGroup key={group.label} heading={group.label}>
                {group.hits.map((hit) => (
                  <CommandItem
                    key={hit.documentId}
                    onSelect={() => select(hit)}
                    value={hit.documentId}
                  >
                    <span className="truncate font-medium">{hit.title}</span>
                    {hit.snippet && (
                      <span className="ml-3 hidden flex-1 truncate text-xs text-muted-foreground sm:inline">
                        {hit.snippet}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <div className="flex items-center justify-end gap-2 border-t px-3 py-2 text-[11px] text-muted-foreground">
            {t('hint')}
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

interface HitGroup {
  label: string;
  hits: SearchHit[];
}

function groupHits(hits: SearchHit[]): HitGroup[] {
  const map = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const key = labelForType(hit.type);
    const existing = map.get(key);
    if (existing) existing.push(hit);
    else map.set(key, [hit]);
  }
  return Array.from(map.entries()).map(([label, hits]) => ({ label, hits }));
}

function labelForType(type: string): string {
  switch (type) {
    case 'conversation':
      return 'Conversations';
    case 'note':
      return 'Notes';
    case 'article':
      return 'Articles';
    case 'document':
      return 'Documents';
    case 'transcript':
      return 'Transcripts';
    case 'image':
      return 'Images';
    case 'audio':
      return 'Audio';
    case 'synthesis':
      return 'Synthesis';
    default:
      return 'Other';
  }
}
