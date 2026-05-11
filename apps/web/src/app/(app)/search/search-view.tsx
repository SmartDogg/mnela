'use client';

import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api/client';
import { sanitizeHighlight } from '@/lib/text/sanitize-highlights';
import type { SearchHit, SearchMode, SearchResult } from '@/lib/api/types';

const DEBOUNCE_MS = 250;

export function SearchView(): JSX.Element {
  const t = useTranslations('search');
  const tCommon = useTranslations('common');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [mode, setMode] = useState<SearchMode>('hybrid');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [meta, setMeta] = useState<{ total: number } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const search = useMutation({
    mutationFn: ({ q, m }: { q: string; m: SearchMode }) =>
      api.post<SearchResult>('/search', { query: q, mode: m, limit: 30 }),
    onSuccess: (res) => {
      setHits(res.hits);
      setMeta({ total: res.total });
    },
  });

  useEffect(() => {
    if (debounced.length === 0) {
      setHits([]);
      setMeta(null);
      return;
    }
    search.mutate({ q: debounced, m: mode });
    // search.mutate is stable; intentionally not in deps
  }, [debounced, mode]);

  return (
    <div className="px-8 py-6 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('placeholder')}
          className="sm:max-w-md"
        />
        <Select value={mode} onValueChange={(v) => setMode(v as SearchMode)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hybrid">{t('modes.hybrid')}</SelectItem>
            <SelectItem value="fts">{t('modes.fts')}</SelectItem>
            <SelectItem value="fuzzy">{t('modes.fuzzy')}</SelectItem>
          </SelectContent>
        </Select>
        {search.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {meta && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{t('hits', { count: meta.total })}</span>
        </div>
      )}

      <div className="divide-y rounded-lg border">
        {hits.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {debounced ? t('noResults') : t('cmdkHint')}
          </div>
        )}
        {hits.map((hit) => (
          <Link
            key={hit.documentId}
            href={`/documents/${hit.documentId}?highlight=${encodeURIComponent(debounced)}`}
            className="block px-5 py-3 transition-colors hover:bg-muted/50"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{hit.title}</span>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {hit.score.toFixed(2)}
              </span>
            </div>
            {hit.snippet && (
              <p
                className="mt-1 line-clamp-2 text-sm text-muted-foreground"
                dangerouslySetInnerHTML={{ __html: sanitizeHighlight(hit.snippet) }}
              />
            )}
          </Link>
        ))}
      </div>

      {search.isError && <p className="text-sm text-destructive">{tCommon('error')}</p>}
    </div>
  );
}
