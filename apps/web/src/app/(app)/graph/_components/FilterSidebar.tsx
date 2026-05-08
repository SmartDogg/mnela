'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { api } from '@/lib/api/client';
import type { Paginated, ProjectSummary } from '@/lib/api/types';
import { cn } from '@/lib/utils';

import { ENTITY_TYPES, type EntityType, type GraphFilters } from './filterState';

interface FilterSidebarProps {
  filters: GraphFilters;
  onChange: (next: GraphFilters) => void;
  onReset: () => void;
}

export function FilterSidebar({ filters, onChange, onReset }: FilterSidebarProps): JSX.Element {
  const t = useTranslations('graph.filters');

  const projectsQuery = useQuery({
    queryKey: ['projects', 'all-for-filter'],
    queryFn: () =>
      api.get<Paginated<ProjectSummary>>('/projects', { query: { page: 1, limit: 100 } }),
  });
  const projects = projectsQuery.data?.data ?? [];

  function toggleType(type: EntityType): void {
    const has = filters.types.includes(type);
    onChange({
      ...filters,
      types: has ? filters.types.filter((t2) => t2 !== type) : [...filters.types, type],
    });
  }

  // Bridge a free-form text input ("mentions, uses") with the parsed array.
  const [relationsText, setRelationsText] = useState(filters.relations.join(', '));
  useEffect(() => {
    // Re-sync if URL/state changes externally (e.g. reset).
    setRelationsText(filters.relations.join(', '));
  }, [filters.relations]);

  function commitRelations(raw: string): void {
    const list = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const a = filters.relations;
    const same = a.length === list.length && a.every((v, i) => v === list[i]);
    if (!same) onChange({ ...filters, relations: list });
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r bg-background">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('title')}
        </h2>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onReset}>
          {t('reset')}
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-5 px-3 pb-6">
          <Section label={t('depth')}>
            <div className="flex items-center gap-2">
              <Slider
                value={filters.depth}
                min={1}
                max={4}
                step={1}
                onValueChange={(v) => onChange({ ...filters, depth: v })}
                aria-label={t('depth')}
              />
              <span className="w-6 text-right font-mono text-xs tabular-nums text-muted-foreground">
                {filters.depth}
              </span>
            </div>
          </Section>

          <Section label={t('entityTypes')}>
            <div className="grid grid-cols-2 gap-1">
              {ENTITY_TYPES.map((type) => {
                const checked = filters.types.includes(type);
                return (
                  <label
                    key={type}
                    className={cn(
                      'flex cursor-pointer items-center gap-1.5 rounded-sm border px-2 py-1 text-xs',
                      checked
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-input text-muted-foreground hover:bg-accent/50',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleType(type)}
                      className="sr-only"
                    />
                    <span className="font-mono">{type}</span>
                  </label>
                );
              })}
            </div>
          </Section>

          <Section label={t('relations')}>
            <Input
              value={relationsText}
              placeholder="mentions, uses, depends-on"
              className="h-8 font-mono text-xs"
              onChange={(e) => setRelationsText(e.target.value)}
              onBlur={(e) => commitRelations(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRelations(e.currentTarget.value);
              }}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{t('relationsHint')}</p>
          </Section>

          <Section label={t('project')}>
            <select
              value={filters.projectSlug ?? ''}
              onChange={(e) =>
                onChange({
                  ...filters,
                  projectSlug: e.target.value === '' ? null : e.target.value,
                })
              }
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs"
            >
              <option value="">{t('allProjects')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          </Section>

          <Section label={t('dateRange')}>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <Label htmlFor="g-from" className="text-[11px] text-muted-foreground">
                  {t('from')}
                </Label>
                <Input
                  id="g-from"
                  type="date"
                  value={filters.from ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      from: e.target.value === '' ? null : e.target.value,
                    })
                  }
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label htmlFor="g-to" className="text-[11px] text-muted-foreground">
                  {t('to')}
                </Label>
                <Input
                  id="g-to"
                  type="date"
                  value={filters.to ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      to: e.target.value === '' ? null : e.target.value,
                    })
                  }
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </Section>

          <Section label={t('confidence')}>
            <div className="flex items-center gap-2">
              <Slider
                value={filters.confidence}
                min={0}
                max={1}
                step={0.05}
                onValueChange={(v) => onChange({ ...filters, confidence: v })}
                aria-label={t('confidence')}
              />
              <span className="w-10 text-right font-mono text-xs tabular-nums text-muted-foreground">
                {filters.confidence.toFixed(2)}
              </span>
            </div>
          </Section>

          <Section label={t('status')}>
            <div className="flex gap-1">
              <ToggleButton
                active={filters.confirmedOnly}
                onClick={() => onChange({ ...filters, confirmedOnly: true })}
              >
                {t('confirmedOnly')}
              </ToggleButton>
              <ToggleButton
                active={!filters.confirmedOnly}
                onClick={() => onChange({ ...filters, confirmedOnly: false })}
              >
                {t('includeReview')}
              </ToggleButton>
            </div>
          </Section>
        </div>
      </ScrollArea>
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-1.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </h3>
      {children}
    </div>
  );
}

function ToggleButton({
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
        'flex-1 rounded-sm border px-2 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-input text-muted-foreground hover:bg-accent/50',
      )}
    >
      {children}
    </button>
  );
}
