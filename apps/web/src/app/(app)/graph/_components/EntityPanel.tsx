'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, GitMerge, Loader2, Pencil, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { EntityMergeDialog } from '@/components/entity-merge-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { DocumentSummary, EntitySummary, Paginated } from '@/lib/api/types';

interface EntityPanelProps {
  entityId: string;
  onClose: () => void;
  /** Set the graph center to this entity (re-runs the neighborhood query). */
  onSetCenter: (entityId: string) => void;
  /** Pulled from the in-graph node so the header is instant; backing fetch fills in details. */
  initialName?: string;
  initialType?: string;
}

type EntityDetail = EntitySummary;

interface NeighborhoodNode {
  data: { id: string; label: string; type: string };
}

interface NeighborhoodEdge {
  data: { id: string; source: string; target: string; label: string };
}

interface NeighborhoodResponse {
  center: string;
  nodes: NeighborhoodNode[];
  edges: NeighborhoodEdge[];
}

export function EntityPanel({
  entityId,
  onClose,
  onSetCenter,
  initialName,
  initialType,
}: EntityPanelProps): JSX.Element {
  const t = useTranslations('graph.entityPanel');

  const entityQuery = useQuery({
    queryKey: ['graph-entity', entityId],
    queryFn: () => api.get<EntityDetail>(`/graph/entities/${encodeURIComponent(entityId)}`),
  });

  // Recent documents that mention this entity. We rely on the documents
  // endpoint accepting an entityId filter; if it doesn't, the response is
  // simply empty and the panel still renders cleanly.
  const documentsQuery = useQuery({
    queryKey: ['graph-entity-documents', entityId],
    queryFn: () =>
      api.get<Paginated<DocumentSummary>>('/documents', {
        query: { entityId, limit: 8, page: 1 },
      }),
    retry: false,
  });

  // Pull the entity's 1-hop neighborhood to surface adjacent project entities.
  const neighborhoodQuery = useQuery({
    queryKey: ['graph-entity-neighborhood', entityId],
    queryFn: () =>
      api.get<NeighborhoodResponse>('/graph', {
        query: { center: entityId, depth: 1 },
      }),
  });

  const projectNodes = (neighborhoodQuery.data?.nodes ?? []).filter(
    (n) => n.data.type === 'project' && n.data.id !== entityId,
  );

  const entity = entityQuery.data;
  const name = entity?.name ?? initialName ?? entityId;
  const type = entity?.type ?? initialType ?? 'entity';
  const [mergeOpen, setMergeOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [editingAliases, setEditingAliases] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (patch: { name?: string; description?: string | null; aliases?: string[] }) =>
      api.patch<EntityDetail>(`/graph/entities/${encodeURIComponent(entityId)}`, patch),
    onSuccess: () => {
      // Re-fetch this entity's full record AND invalidate the graph snapshot
      // — a rename changes the node label and the user expects to see it.
      void queryClient.invalidateQueries({ queryKey: ['graph-entity', entityId] });
      void queryClient.invalidateQueries({ queryKey: ['graph'] });
    },
  });

  // Escape closes the panel — the canvas underneath retains focus naturally
  // because we don't trap. Non-modal dialog semantics.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    closeBtnRef.current?.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const titleId = `entity-panel-title-${entityId}`;

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      // Absolute overlay over the canvas — never modifies canvas width, so a
      // page-level horizontal scroll is structurally impossible. Slide-in
      // from the right via tailwindcss-animate; the soft border + backdrop
      // blur give the floating-panel feel without a full-screen darkener.
      className="absolute right-0 top-0 z-20 flex h-full w-[min(20rem,calc(100vw-2rem))] min-w-0 flex-col overflow-hidden border-l border-white/10 bg-background/95 shadow-2xl shadow-black/40 backdrop-blur-md duration-200 animate-in slide-in-from-right-4 fade-in-0 md:w-80"
    >
      <div className="flex items-start justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1 space-y-1">
          {editingName ? (
            <EditableName
              initial={name}
              busy={updateMutation.isPending}
              onCancel={() => setEditingName(false)}
              onSave={(next) => {
                updateMutation.mutate({ name: next }, { onSuccess: () => setEditingName(false) });
              }}
            />
          ) : (
            <button
              type="button"
              id={titleId}
              onDoubleClick={() => setEditingName(true)}
              className="block w-full truncate rounded-sm text-left text-sm font-semibold hover:bg-accent/30"
              title={t('renameHint')}
            >
              {name}
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider">
              {type}
            </Badge>
            <span className="font-mono text-[10px] text-muted-foreground">
              {entityId.slice(0, 8)}…
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-5 w-5"
              onClick={() => setEditingName(true)}
              aria-label={t('renameAria')}
              title={t('renameAria')}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <Button
          ref={closeBtnRef}
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
          aria-label={t('close')}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="min-w-0 flex-1">
        <div className="w-full min-w-0 space-y-4 break-words px-3 pb-6 pt-3">
          <Section
            label={t('description')}
            onEdit={!editingDescription ? () => setEditingDescription(true) : undefined}
          >
            {editingDescription ? (
              <EditableDescription
                initial={entity?.description ?? ''}
                busy={updateMutation.isPending}
                onCancel={() => setEditingDescription(false)}
                onSave={(next) => {
                  updateMutation.mutate(
                    { description: next.trim() === '' ? null : next.trim() },
                    { onSuccess: () => setEditingDescription(false) },
                  );
                }}
              />
            ) : entity?.description ? (
              <p
                onDoubleClick={() => setEditingDescription(true)}
                className="whitespace-pre-wrap rounded-sm text-xs leading-relaxed text-foreground/90 hover:bg-accent/30"
                title={t('renameHint')}
              >
                {entity.description}
              </p>
            ) : (
              <p className="text-xs italic text-muted-foreground/70">{t('emptyDescription')}</p>
            )}
          </Section>

          <Section
            label={t('aliases')}
            onEdit={!editingAliases ? () => setEditingAliases(true) : undefined}
          >
            {editingAliases ? (
              <EditableAliases
                initial={entity?.aliases ?? []}
                busy={updateMutation.isPending}
                onCancel={() => setEditingAliases(false)}
                onSave={(next) => {
                  updateMutation.mutate(
                    { aliases: next },
                    { onSuccess: () => setEditingAliases(false) },
                  );
                }}
              />
            ) : entity?.aliases && entity.aliases.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {entity.aliases.map((a) => (
                  <Badge key={a} variant="secondary" className="font-mono text-[10px]">
                    {a}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs italic text-muted-foreground/70">{t('emptyAliases')}</p>
            )}
          </Section>

          <Section label={t('actions')}>
            <div className="space-y-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-full justify-start text-xs"
                onClick={() => onSetCenter(entityId)}
              >
                {t('setCenter')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-full justify-start text-xs"
                disabled={!entity || entity.mergedIntoId !== null}
                onClick={() => setMergeOpen(true)}
              >
                <GitMerge className="size-3" />
                <span className="ml-1.5">{t('mergeInto')}</span>
              </Button>
            </div>
          </Section>

          <Section label={t('projects')}>
            {neighborhoodQuery.isLoading ? (
              <Skeleton className="h-6 w-full" />
            ) : projectNodes.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('emptyProjects')}</p>
            ) : (
              <ul className="space-y-1">
                {projectNodes.map((p) => (
                  <li key={p.data.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1 text-left text-xs hover:bg-accent"
                      onClick={() => onSetCenter(p.data.id)}
                    >
                      <span className="truncate">{p.data.label}</span>
                      <span className="font-mono text-[10px] uppercase text-muted-foreground">
                        project
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section label={t('documents')}>
            {documentsQuery.isLoading && <Skeleton className="h-6 w-full" />}
            {documentsQuery.error !== null && documentsQuery.error !== undefined && (
              <p className="text-xs text-muted-foreground">{t('emptyDocuments')}</p>
            )}
            {documentsQuery.data && documentsQuery.data.items.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('emptyDocuments')}</p>
            )}
            {documentsQuery.data && documentsQuery.data.items.length > 0 && (
              <ul className="space-y-1">
                {documentsQuery.data.items.map((doc) => (
                  <li key={doc.id}>
                    <Link
                      href={`/documents/${doc.id}`}
                      className="flex items-center justify-between gap-2 rounded-sm px-2 py-1 text-xs hover:bg-accent"
                    >
                      <span className="truncate">{doc.title}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </ScrollArea>
      {entity && <EntityMergeDialog open={mergeOpen} onOpenChange={setMergeOpen} source={entity} />}
    </aside>
  );
}

function Section({
  label,
  onEdit,
  children,
}: {
  label: string;
  onEdit?: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </h3>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
            aria-label={`Edit ${label}`}
          >
            <Pencil className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// ─── Editable mini-forms ────────────────────────────────────────────────────

function EditableName({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  onSave: (next: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const next = value.trim();
        if (next && next !== initial) onSave(next);
        else onCancel();
      }}
      className="flex items-center gap-1"
    >
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
        disabled={busy}
        className="h-7 flex-1 text-sm font-semibold"
      />
      <EditActions busy={busy} onCancel={onCancel} />
    </form>
  );
}

function EditableDescription({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  onSave: (next: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value);
      }}
      className="space-y-1.5"
    >
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          // Cmd/Ctrl-Enter saves; plain Enter is for newlines.
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSave(value);
        }}
        disabled={busy}
        rows={4}
        className={cn(
          'w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-xs leading-relaxed',
          'focus:outline-none focus:ring-1 focus:ring-ring',
        )}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">⌘/Ctrl + Enter</span>
        <EditActions busy={busy} onCancel={onCancel} />
      </div>
    </form>
  );
}

function EditableAliases({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string[];
  busy: boolean;
  onSave: (next: string[]) => void;
  onCancel: () => void;
}): JSX.Element {
  const [text, setText] = useState(initial.join(', '));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const list = Array.from(
          new Set(
            text
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0),
          ),
        );
        onSave(list);
      }}
      className="space-y-1.5"
    >
      <Input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="alias-one, alias-two"
        disabled={busy}
        className="h-7 font-mono text-xs"
      />
      <div className="flex justify-end">
        <EditActions busy={busy} onCancel={onCancel} />
      </div>
    </form>
  );
}

function EditActions({ busy, onCancel }: { busy: boolean; onCancel: () => void }): JSX.Element {
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={onCancel}
        disabled={busy}
        aria-label="Cancel"
      >
        <X className="h-3 w-3" />
      </Button>
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        disabled={busy}
        aria-label="Save"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
      </Button>
    </div>
  );
}
