'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Folder, Globe, Search, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api/client';
import type { Paginated, ProjectSummary } from '@/lib/api/types';
import { cn } from '@/lib/utils';

/**
 * Reads the current scope from the URL (`?scope=project:<slug>`) and lets
 * the user change it inline. Updates the URL with `router.replace` so the
 * change is shareable and reloading keeps the scope. The chat-panel reads
 * the same URL param to thread `scopeProjectSlug` into the SSE call —
 * single source of truth.
 *
 * Active projects come from `GET /projects?status=active`; suggested ones
 * are surfaced separately at the bottom of the menu so the user can scope
 * into a suggestion (which still has documents linked under the hood) and
 * accept it later from the project page.
 */
export function ScopeSelect({ disabled }: { disabled?: boolean }): JSX.Element {
  const t = useTranslations('ask.scope');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const currentSlug = useMemo(() => {
    const raw = searchParams?.get('scope');
    if (raw && raw.startsWith('project:')) {
      const slug = raw.slice('project:'.length);
      return slug.length > 0 ? slug : null;
    }
    return null;
  }, [searchParams]);

  const active = useQuery({
    queryKey: ['scope-select', 'active'],
    queryFn: () =>
      api.get<Paginated<ProjectSummary>>('/projects', {
        query: { status: 'active', limit: 100 },
      }),
  });

  const suggested = useQuery({
    queryKey: ['scope-select', 'suggested'],
    queryFn: () =>
      api.get<Paginated<ProjectSummary>>('/projects', {
        query: { status: 'suggested', limit: 50 },
      }),
  });

  const { activeMatches, suggestedMatches, current } = useMemo(() => {
    const a = active.data?.items ?? [];
    const s = suggested.data?.items ?? [];
    const norm = filter.trim().toLowerCase();
    const match = (p: ProjectSummary): boolean =>
      norm.length === 0 ||
      p.name.toLowerCase().includes(norm) ||
      p.slug.toLowerCase().includes(norm);
    return {
      activeMatches: a.filter(match),
      suggestedMatches: s.filter(match),
      current: [...a, ...s].find((p) => p.slug === currentSlug) ?? null,
    };
  }, [active.data, suggested.data, filter, currentSlug]);

  const setScope = (slug: string | null): void => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (slug) params.set('scope', `project:${slug}`);
    else params.delete('scope');
    const qs = params.toString();
    const url = qs.length > 0 ? `${pathname}?${qs}` : pathname;
    router.replace(url, { scroll: false });
    setOpen(false);
    setFilter('');
  };

  const buttonLabel = current ? current.name : t('all');

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant={current ? 'default' : 'outline'}
          size="sm"
          disabled={disabled}
          className={cn(
            'h-7 gap-1.5 px-2.5 text-xs font-normal',
            current ? 'border-primary/40 bg-primary/15 text-primary hover:bg-primary/20' : '',
          )}
        >
          {current ? <Sparkles className="size-3.5" /> : <Globe className="size-3.5" />}
          <span className="max-w-[180px] truncate">{buttonLabel}</span>
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <div className="relative px-2 pt-2">
          <Search className="absolute left-4 top-4 size-3.5 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('search')}
            className="h-8 pl-7 text-xs"
            autoFocus
          />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setScope(null);
          }}
          className="gap-2"
        >
          <Globe className="size-4" />
          <span className="flex-1">{t('all')}</span>
          {!currentSlug && <Check className="size-4" />}
        </DropdownMenuItem>

        {activeMatches.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase text-muted-foreground">
              {t('activeHeader')}
            </DropdownMenuLabel>
            <div className="max-h-48 overflow-y-auto">
              {activeMatches.map((p) => (
                <DropdownMenuItem
                  key={p.slug}
                  onSelect={(e) => {
                    e.preventDefault();
                    setScope(p.slug);
                  }}
                  className="gap-2"
                >
                  <Folder className="size-4" />
                  <span className="flex-1 truncate">{p.name}</span>
                  {currentSlug === p.slug && <Check className="size-4" />}
                </DropdownMenuItem>
              ))}
            </div>
          </>
        )}

        {suggestedMatches.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-1 text-[10px] uppercase text-muted-foreground">
              <Sparkles className="size-3" />
              {t('suggestedHeader')}
            </DropdownMenuLabel>
            <div className="max-h-32 overflow-y-auto">
              {suggestedMatches.map((p) => (
                <DropdownMenuItem
                  key={p.slug}
                  onSelect={(e) => {
                    e.preventDefault();
                    setScope(p.slug);
                  }}
                  className="gap-2"
                >
                  <Folder className="size-4 opacity-60" />
                  <span className="flex-1 truncate">{p.name}</span>
                  <Badge variant="secondary" className="text-[9px] uppercase">
                    sugg
                  </Badge>
                  {currentSlug === p.slug && <Check className="size-4" />}
                </DropdownMenuItem>
              ))}
            </div>
          </>
        )}

        {active.data &&
          suggested.data &&
          activeMatches.length === 0 &&
          suggestedMatches.length === 0 && (
            <div className="py-3 text-center text-xs text-muted-foreground">{t('empty')}</div>
          )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
