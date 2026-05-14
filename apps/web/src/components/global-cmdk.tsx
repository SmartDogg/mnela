'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Boxes,
  CheckCircle2,
  Loader2,
  Maximize2,
  MessagesSquare,
  Minimize2,
  Sparkles,
} from 'lucide-react';
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
  CommandShortcut,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUnifiedSearch } from '@/hooks/use-unified-search';
import { api } from '@/lib/api/client';
import type {
  DecisionSummary,
  Paginated,
  ProjectSummary,
  SearchHit,
  SearchMode,
  SearchRequest,
} from '@/lib/api/types';
import { useCmdkStore } from '@/lib/state/cmdk-store';
import { sanitizeHighlight } from '@/lib/text/sanitize-highlights';
import { cn } from '@/lib/utils';

type PaletteMode = 'compact' | 'expanded';

interface PaletteFilters {
  mode: SearchMode;
  status: string;
  source: string;
  type: string;
  projectSlug: string;
}

interface ConversationRow {
  id: string;
  title: string;
  updatedAt: string;
  synthesisDocumentId: string | null;
}

const DEFAULT_FILTERS: PaletteFilters = {
  mode: 'hybrid',
  status: '',
  source: '',
  type: '',
  projectSlug: '',
};

const STATUS_OPTIONS = ['raw', 'parsed', 'enriching', 'enriched', 'failed', 'archived'] as const;
const SOURCE_OPTIONS = [
  'chatgpt_export',
  'claude_export',
  'obsidian_vault',
  'manual_upload',
  'api_ingest',
  'telegram',
  'voice_note',
  'email',
  'web_clip',
] as const;
const MODE_OPTIONS: readonly SearchMode[] = ['hybrid', 'fts', 'fuzzy'] as const;

const COMPACT_LIMITS = { documents: 8, entities: 8, projects: 5, decisions: 5, conversations: 5 };
const EXPANDED_LIMITS = {
  documents: 30,
  entities: 20,
  projects: 20,
  decisions: 20,
  conversations: 20,
};

function docValue(id: string): string {
  return `doc:${id}`;
}

function entValue(id: string): string {
  return `ent:${id}`;
}

function projValue(slug: string): string {
  return `proj:${slug}`;
}

function decValue(id: string): string {
  return `dec:${id}`;
}

function convValue(id: string): string {
  return `conv:${id}`;
}

function tokensMatch(haystack: string | null | undefined, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  if (!haystack) return false;
  const norm = haystack.toLowerCase();
  return tokens.every((t) => norm.includes(t));
}

export function GlobalCmdk(): JSX.Element {
  const t = useTranslations('cmdk');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { isOpen, open, close, toggle } = useCmdkStore();
  const [mode, setMode] = useState<PaletteMode>('compact');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<PaletteFilters>(DEFAULT_FILTERS);

  const limits = mode === 'compact' ? COMPACT_LIMITS : EXPANDED_LIMITS;

  // Reset transient state on close so reopening always lands on a clean
  // compact palette. We keep the filters across open/close in expanded mode
  // because remembering them feels right for a power-user surface.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        open();
      } else {
        close();
        setQuery('');
        setMode('compact');
      }
    },
    [open, close],
  );

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

  const apiFilters = useMemo<SearchRequest['filters'] | undefined>(() => {
    const out: NonNullable<SearchRequest['filters']> = {};
    if (filters.status)
      out.status = filters.status as NonNullable<SearchRequest['filters']>['status'];
    if (filters.source)
      out.source = filters.source as NonNullable<SearchRequest['filters']>['source'];
    if (filters.type) out.type = filters.type;
    if (filters.projectSlug) out.projectSlug = filters.projectSlug;
    return Object.keys(out).length === 0 ? undefined : out;
  }, [filters]);

  const search = useUnifiedSearch({
    query,
    mode: filters.mode,
    filters: apiFilters,
    documentLimit: limits.documents,
    entityLimit: limits.entities,
  });

  /*
   * Projects / Decisions / Conversations are filtered client-side: the
   * admin user's N is small (typically < 200), the existing endpoints
   * don't accept a `q=` filter, and we want the palette to feel instant
   * when the user keeps typing. We fetch once when the palette opens and
   * filter against `search.debounced` (the shared 200ms debounce from
   * useUnifiedSearch).
   */
  const projectsAll = useQuery({
    queryKey: ['cmdk', 'projects-all'],
    enabled: isOpen,
    staleTime: 30_000,
    queryFn: async () => {
      const [active, suggested] = await Promise.all([
        api.get<Paginated<ProjectSummary>>('/projects', {
          query: { status: 'active', limit: 100 },
        }),
        api.get<Paginated<ProjectSummary>>('/projects', {
          query: { status: 'suggested', limit: 50 },
        }),
      ]);
      return [...active.items, ...suggested.items];
    },
  });
  const decisionsAll = useQuery({
    queryKey: ['cmdk', 'decisions-all'],
    enabled: isOpen,
    staleTime: 30_000,
    queryFn: () =>
      api
        .get<Paginated<DecisionSummary>>('/decisions', { query: { limit: 100 } })
        .then((p) => p.items),
  });
  const conversationsAll = useQuery({
    queryKey: ['cmdk', 'conversations-all'],
    enabled: isOpen,
    staleTime: 30_000,
    queryFn: () =>
      api
        .get<Paginated<ConversationRow>>('/conversations', { query: { limit: 100 } })
        .then((p) => p.items),
  });

  const docs = search.documents?.hits ?? [];
  const ents = search.entities?.items ?? [];
  const hasInput = search.debounced.length > 0;

  const tokens = useMemo(
    () =>
      search.debounced
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 0),
    [search.debounced],
  );

  const projectRows = useMemo(() => {
    const all = projectsAll.data ?? [];
    if (!hasInput) return [];
    const matches = all.filter(
      (p) =>
        tokensMatch(p.name, tokens) ||
        tokensMatch(p.slug, tokens) ||
        tokensMatch(p.description, tokens),
    );
    return matches.slice(0, limits.projects);
  }, [projectsAll.data, hasInput, tokens, limits.projects]);

  const decisionRows = useMemo(() => {
    const all = decisionsAll.data ?? [];
    if (!hasInput) return [];
    /*
     * Decisions without a `projectId` have no detail page to open (ADR-0052
     * folded /decisions into the project detail Decisions tab). Skip them
     * — they're rare and showing a no-op row in the palette would be a
     * worse experience than hiding it.
     */
    const projectById = new Map((projectsAll.data ?? []).map((p) => [p.id, p] as const));
    const matches = all.filter(
      (d) => d.projectId && projectById.has(d.projectId) && tokensMatch(d.title, tokens),
    );
    return matches.slice(0, limits.decisions).map((d) => ({
      decision: d,
      project: projectById.get(d.projectId as string)!,
    }));
  }, [decisionsAll.data, projectsAll.data, hasInput, tokens, limits.decisions]);

  const conversationRows = useMemo(() => {
    const all = conversationsAll.data ?? [];
    if (!hasInput) return [];
    const matches = all.filter((c) => tokensMatch(c.title, tokens));
    return matches.slice(0, limits.conversations);
  }, [conversationsAll.data, hasInput, tokens, limits.conversations]);

  const hasAnyResults =
    docs.length > 0 ||
    ents.length > 0 ||
    projectRows.length > 0 ||
    decisionRows.length > 0 ||
    conversationRows.length > 0;

  const handleSelect = useCallback(
    (value: string) => {
      if (value.startsWith('doc:')) {
        const id = value.slice(4);
        const highlight = encodeURIComponent(search.debounced);
        router.push(`/documents/${id}${highlight ? `?highlight=${highlight}` : ''}`);
      } else if (value.startsWith('ent:')) {
        const id = value.slice(4);
        router.push(`/graph?center=${encodeURIComponent(id)}`);
      } else if (value.startsWith('proj:')) {
        const slug = value.slice(5);
        router.push(`/projects/${encodeURIComponent(slug)}`);
      } else if (value.startsWith('dec:')) {
        // Routed through the project page (decisions live inside the
        // project detail tab per ADR-0052). Caller-side lookup put the
        // project slug in the option `value` after the id, separated
        // by `|`, to avoid a second indirection here.
        const rest = value.slice(4);
        const [, slug] = rest.split('|');
        if (slug) router.push(`/projects/${encodeURIComponent(slug)}`);
      } else if (value.startsWith('conv:')) {
        const id = value.slice(5);
        router.push(`/ask?conv=${encodeURIComponent(id)}`);
      } else {
        return;
      }
      handleOpenChange(false);
    },
    [router, search.debounced, handleOpenChange],
  );

  // Tab toggles compact ↔ expanded. cmdk would otherwise let Tab escape the
  // input and shift focus to the next focusable element inside the dialog —
  // claim it explicitly so the keybinding wins.
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      setMode((m) => (m === 'compact' ? 'expanded' : 'compact'));
    }
  }, []);

  const clearFilters = useCallback(() => setFilters(DEFAULT_FILTERS), []);
  const hasNonDefaultFilters =
    filters.status !== '' ||
    filters.source !== '' ||
    filters.type !== '' ||
    filters.projectSlug !== '' ||
    filters.mode !== DEFAULT_FILTERS.mode;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          'overflow-hidden p-0',
          mode === 'compact'
            ? 'sm:max-w-2xl'
            : 'h-[88vh] max-h-[88vh] w-[min(96vw,72rem)] max-w-none',
        )}
      >
        <DialogTitle className="sr-only">
          {mode === 'compact' ? t('placeholder') : t('expandedTitle')}
        </DialogTitle>
        <Command shouldFilter={false} onKeyDown={handleKeyDown} className="h-full">
          <div className="relative">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={t('placeholder')}
              className="pr-20"
            />
            {/*
              Sits left of the DialogContent's built-in close X (top-4 right-4).
              Using `right-12` keeps a comfortable gap so the two icons don't
              visually merge in the corner.
            */}
            <button
              type="button"
              onClick={() => setMode((m) => (m === 'compact' ? 'expanded' : 'compact'))}
              className="absolute right-12 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={mode === 'compact' ? t('expand') : t('collapse')}
              title={mode === 'compact' ? t('expand') : t('collapse')}
            >
              {mode === 'compact' ? (
                <Maximize2 className="h-3.5 w-3.5" />
              ) : (
                <Minimize2 className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {mode === 'expanded' && (
            <FilterBar
              filters={filters}
              onChange={setFilters}
              canClear={hasNonDefaultFilters}
              onClear={clearFilters}
            />
          )}

          <CommandList
            className={cn(
              mode === 'compact' ? 'max-h-[60vh]' : 'h-full max-h-none flex-1 overflow-y-auto',
            )}
          >
            {search.isFetching && !hasAnyResults && (
              <p className="px-3 py-2 text-xs text-muted-foreground">{tCommon('loading')}</p>
            )}

            {!hasInput && !search.isFetching && <CommandEmpty>{t('startTyping')}</CommandEmpty>}

            {hasInput && !search.isFetching && !hasAnyResults && (
              <CommandEmpty>{tCommon('empty')}</CommandEmpty>
            )}

            {docs.length > 0 && (
              <CommandGroup
                heading={
                  search.documents
                    ? `${t('documents')} · ${t('hits', { count: search.documents.total })}`
                    : t('documents')
                }
              >
                {docs.map((hit) => (
                  <DocumentRow
                    key={hit.documentId}
                    hit={hit}
                    onSelect={handleSelect}
                    expanded={mode === 'expanded'}
                  />
                ))}
                {search.documents &&
                  search.documents.total > docs.length &&
                  mode === 'expanded' && (
                    <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                      {t('moreDocuments', {
                        count: search.documents.total - docs.length,
                      })}
                    </p>
                  )}
              </CommandGroup>
            )}

            {ents.length > 0 && (
              <CommandGroup
                heading={
                  search.entities
                    ? `${t('entities')} · ${t('hits', { count: search.entities.total })}`
                    : t('entities')
                }
              >
                {ents.map((row) => (
                  <CommandItem
                    key={row.id}
                    value={entValue(row.id)}
                    onSelect={handleSelect}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate font-medium">{row.name}</span>
                    <CommandShortcut className="font-mono text-[10px] uppercase tracking-wider">
                      {row.type}
                    </CommandShortcut>
                  </CommandItem>
                ))}
                {search.entities && search.entities.total > ents.length && mode === 'expanded' && (
                  <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                    {t('moreEntities', {
                      count: search.entities.total - ents.length,
                    })}
                  </p>
                )}
              </CommandGroup>
            )}

            {projectRows.length > 0 && (
              <CommandGroup heading={t('projects')}>
                {projectRows.map((p) => (
                  <CommandItem
                    key={p.slug}
                    value={projValue(p.slug)}
                    onSelect={handleSelect}
                    className="flex items-center gap-2"
                  >
                    {p.status === 'suggested' ? (
                      <Sparkles className="size-3.5 text-amber-500" />
                    ) : (
                      <Boxes className="size-3.5 text-muted-foreground" />
                    )}
                    <span className="flex-1 truncate font-medium">{p.name}</span>
                    <CommandShortcut className="font-mono text-[10px] uppercase tracking-wider">
                      {p.status === 'suggested' ? t('suggested') : t('active')}
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {decisionRows.length > 0 && (
              <CommandGroup heading={t('decisions')}>
                {decisionRows.map(({ decision, project }) => (
                  <CommandItem
                    key={decision.id}
                    value={`${decValue(decision.id)}|${project.slug}`}
                    onSelect={handleSelect}
                    className="flex items-center gap-2"
                  >
                    <CheckCircle2 className="size-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate font-medium">{decision.title}</span>
                    <CommandShortcut className="font-mono text-[10px] normal-case tracking-normal">
                      {project.name}
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {conversationRows.length > 0 && (
              <CommandGroup heading={t('conversations')}>
                {conversationRows.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={convValue(c.id)}
                    onSelect={handleSelect}
                    className="flex items-center gap-2"
                  >
                    <MessagesSquare className="size-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate font-medium">
                      {c.title || t('conversationUntitled')}
                    </span>
                    {c.synthesisDocumentId && (
                      <CommandShortcut className="font-mono text-[10px] uppercase tracking-wider">
                        {t('saved')}
                      </CommandShortcut>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>

          <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-2">
              {search.isFetching && hasAnyResults && (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              )}
              {mode === 'compact' ? t('compactHint') : t('expandedHint')}
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function DocumentRow({
  hit,
  onSelect,
  expanded,
}: {
  hit: SearchHit;
  onSelect: (value: string) => void;
  expanded: boolean;
}): JSX.Element {
  return (
    <CommandItem
      value={docValue(hit.documentId)}
      onSelect={onSelect}
      className="flex-col items-start gap-1"
    >
      <div className="flex w-full items-center gap-2">
        <span className="truncate font-medium">{hit.title}</span>
        <CommandShortcut className="font-mono tabular-nums text-[10px]">
          {hit.score.toFixed(2)}
        </CommandShortcut>
      </div>
      {hit.snippet && (
        <p
          className={cn(
            'w-full text-xs text-muted-foreground',
            expanded ? 'line-clamp-2' : 'truncate',
          )}
          // FTS snippets are emitted with ts_headline using `<mark>` only;
          // sanitizeHighlight strips anything else. Same path search-view used.
          dangerouslySetInnerHTML={{ __html: sanitizeHighlight(hit.snippet) }}
        />
      )}
    </CommandItem>
  );
}

function FilterBar({
  filters,
  onChange,
  canClear,
  onClear,
}: {
  filters: PaletteFilters;
  onChange: (next: PaletteFilters) => void;
  canClear: boolean;
  onClear: () => void;
}): JSX.Element {
  const t = useTranslations('cmdk');
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs">
      <span className="font-medium uppercase tracking-wider text-muted-foreground">
        {t('filters.title')}
      </span>
      <LabeledSelect
        label={t('filters.mode')}
        value={filters.mode}
        onChange={(v) => onChange({ ...filters, mode: v as SearchMode })}
        options={MODE_OPTIONS.map((m) => ({ value: m, label: t(`modes.${m}`) }))}
      />
      <LabeledSelect
        label={t('filters.status')}
        value={filters.status}
        onChange={(v) => onChange({ ...filters, status: v })}
        options={[
          { value: '', label: t('filters.any') },
          ...STATUS_OPTIONS.map((s) => ({ value: s, label: s })),
        ]}
      />
      <LabeledSelect
        label={t('filters.source')}
        value={filters.source}
        onChange={(v) => onChange({ ...filters, source: v })}
        options={[
          { value: '', label: t('filters.any') },
          ...SOURCE_OPTIONS.map((s) => ({ value: s, label: s })),
        ]}
      />
      <label className="inline-flex items-center gap-1.5">
        <span className="text-muted-foreground">{t('filters.type')}</span>
        <Input
          value={filters.type}
          onChange={(e) => onChange({ ...filters, type: e.target.value })}
          placeholder={t('filters.typePlaceholder')}
          className="h-7 w-36 text-xs"
        />
      </label>
      <label className="inline-flex items-center gap-1.5">
        <span className="text-muted-foreground">{t('filters.project')}</span>
        <Input
          value={filters.projectSlug}
          onChange={(e) => onChange({ ...filters, projectSlug: e.target.value })}
          placeholder={t('filters.projectPlaceholder')}
          className="h-7 w-36 text-xs"
        />
      </label>
      {canClear && (
        <button
          type="button"
          onClick={onClear}
          className="ml-auto rounded-md border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {t('filters.clear')}
        </button>
      )}
    </div>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}): JSX.Element {
  // Radix Select treats empty string as "no value" — encode it as a sentinel
  // so we can include an "Any" option without the underlying primitive
  // throwing on `<SelectItem value="">`.
  const SENTINEL = '__any__';
  return (
    <label className="inline-flex items-center gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <Select
        value={value === '' ? SENTINEL : value}
        onValueChange={(v) => onChange(v === SENTINEL ? '' : v)}
      >
        <SelectTrigger className="h-7 w-32 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value || SENTINEL} value={o.value === '' ? SENTINEL : o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
