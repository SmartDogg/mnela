'use client';

import { Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import { usePrincipalOrNull } from '@/lib/auth/principal-context';
import { cn } from '@/lib/utils';

const HASH_TO_SECTION: Record<string, string> = {
  providers: 'providers',
  telegram: 'telegram',
  whisper: 'whisper',
  storage: 'storage',
  ingestion: 'ingestion',
  enrichment: 'enrichment',
  search: 'search',
  api: 'api',
  projects: 'projects',
  advanced: 'advanced',
  backups: 'backups',
  tokens: 'tokens',
};

interface SettingsSearchProps {
  query: string;
  onQueryChange: (next: string) => void;
}

/**
 * Search-bar for the /admin/system page. Two responsibilities:
 *
 *   1. Free-text filter over section names and config-key text. The
 *      page-level renderer reads `query` and hides cards whose name +
 *      keys don't match. Empty query = show all (status quo).
 *   2. Deep-link via `#hash`. `/admin/system#telegram` opens the
 *      Telegram card on first paint by writing localStorage =1 for
 *      the matching useCollapsibleSection key. Same as if the user had
 *      clicked the header manually — the next render finds the persisted
 *      open state and renders an expanded card.
 *
 * The hash effect runs ONCE — afterwards the user owns the open state
 * via the existing card toggle. We don't re-apply on every render to
 * avoid fighting manual collapses.
 */
export function SettingsSearch({ query, onQueryChange }: SettingsSearchProps): JSX.Element {
  const t = useTranslations('admin.system.search');
  const [hashApplied, setHashApplied] = useState(false);
  const principal = usePrincipalOrNull();
  const userKey = principal?.id ?? 'anon';

  useEffect(() => {
    if (hashApplied || typeof window === 'undefined') return;
    const hash = window.location.hash.replace(/^#/, '').toLowerCase();
    if (!hash) {
      setHashApplied(true);
      return;
    }
    const section = HASH_TO_SECTION[hash];
    if (section) {
      window.localStorage.setItem(`mnela:admin-system:open:${section}:u:${userKey}`, '1');
      // Defer the scroll so React has time to flip the card open from
      // the localStorage read. Two RAFs is enough on every browser we
      // ship for; setTimeout(0) skips one paint we want to keep.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.getElementById(`section-${section}`)?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
        });
      });
    }
    setHashApplied(true);
  }, [hashApplied, userKey]);

  const clearable = useMemo(() => query.length > 0, [query]);

  return (
    <div className="relative mx-8 mt-4 max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        placeholder={t('placeholder')}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        className={cn('h-9 pl-9 pr-9 text-sm')}
        aria-label={t('placeholder')}
      />
      {clearable && (
        <button
          type="button"
          onClick={() => onQueryChange('')}
          className="absolute right-2 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t('clear')}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function sectionMatchesQuery(query: string, haystack: string[]): boolean {
  if (query.trim().length === 0) return true;
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const joined = haystack.join(' ').toLowerCase();
  return tokens.every((tok) => joined.includes(tok));
}
