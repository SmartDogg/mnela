'use client';

import { useTranslations } from 'next-intl';
import { type ChangeEvent } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { InboxFilters } from '../filters';

interface InboxFiltersProps {
  value: InboxFilters;
  onChange: (next: InboxFilters) => void;
  projects: { slug: string; name: string }[];
  total: number;
}

const TYPES = [
  'link_suggestion',
  'entity_merge_suggestion',
  'duplicate_detection',
  'enrichment_failed',
  'conflicting_decision',
] as const;

const STATUSES = ['pending', 'accepted', 'rejected'] as const;
const RANGES = ['today', '7d', '30d', 'all'] as const;

export function InboxFiltersBar({
  value,
  onChange,
  projects,
  total,
}: InboxFiltersProps): JSX.Element {
  const t = useTranslations('inbox.filters');
  const tTypes = useTranslations('inbox.types');

  const isDefault =
    !value.type && value.status === 'pending' && !value.projectSlug && value.range === 'all';

  return (
    <div className="border-b border-border/60 bg-card/40 px-8 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <FilterGroup label={t('status')}>
          {STATUSES.map((s) => (
            <FilterChip
              key={s}
              active={value.status === s}
              onClick={() => onChange({ ...value, status: s })}
            >
              {t(`status_${s}`)}
            </FilterChip>
          ))}
        </FilterGroup>
        <FilterGroup label={t('type')}>
          <FilterChip active={!value.type} onClick={() => onChange({ ...value, type: undefined })}>
            {t('allTypes')}
          </FilterChip>
          {TYPES.map((tp) => (
            <FilterChip
              key={tp}
              active={value.type === tp}
              onClick={() => onChange({ ...value, type: tp })}
            >
              {tTypes(typeKeyOf(tp))}
            </FilterChip>
          ))}
        </FilterGroup>
        <FilterGroup label={t('dateRange')}>
          {RANGES.map((r) => (
            <FilterChip
              key={r}
              active={value.range === r}
              onClick={() => onChange({ ...value, range: r })}
            >
              {t(`range_${r}`)}
            </FilterChip>
          ))}
        </FilterGroup>
        {projects.length > 0 && (
          <FilterGroup label={t('project')}>
            <select
              value={value.projectSlug ?? ''}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                onChange({ ...value, projectSlug: e.target.value || undefined })
              }
              className="rounded-md border border-border/60 bg-background px-2 py-1 text-xs"
            >
              <option value="">{t('allProjects')}</option>
              {projects.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          </FilterGroup>
        )}
        {!isDefault && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() =>
              onChange({ type: undefined, status: 'pending', projectSlug: undefined, range: 'all' })
            }
          >
            {t('clear')}
          </Button>
        )}
        <div className="ml-auto">
          <Badge variant="outline" className="font-mono text-[10px]">
            {total}
          </Badge>
        </div>
      </div>
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
        active
          ? 'border-primary/50 bg-primary/10 text-foreground'
          : 'border-border/60 text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function typeKeyOf(type: (typeof TYPES)[number]): string {
  switch (type) {
    case 'link_suggestion':
      return 'linkSuggestion';
    case 'entity_merge_suggestion':
      return 'entityMergeSuggestion';
    case 'duplicate_detection':
      return 'duplicateDetection';
    case 'enrichment_failed':
      return 'enrichmentFailed';
    case 'conflicting_decision':
      return 'conflictingDecision';
  }
}
