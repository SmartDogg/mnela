'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox as InboxIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { KeyboardShortcutsOverlay } from '@/components/keyboard-shortcuts-overlay';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api/client';
import { useInboxKeyboard } from '@/lib/keyboard/useInboxKeyboard';
import type { BulkInboxResult, InboxSummary, Paginated, ProjectSummary } from '@/lib/api/types';
import { useLiveEvents } from '@/lib/socket/useLiveEvents';
import { useInboxSelection } from '@/lib/stores/inbox-selection';

import { BulkActionBar } from './_components/BulkActionBar';
import { EditInboxCard } from './_components/EditInboxCard';
import { InboxFiltersBar } from './_components/InboxFilters';
import {
  type DEFAULT_FILTERS,
  filtersFromSearchParams,
  filtersToSearchParams,
  rangeStart,
} from './filters';
import { InboxCard } from './inbox-card';

// Backend cap on `limit` is 100 (apps/api inbox dto). Don't raise above that —
// raising the cap is a separate decision (bulk endpoint is capped at 100 too).
const PAGE_LIMIT = 100;

export default function InboxPage(): JSX.Element {
  const t = useTranslations('inbox');
  const tBulk = useTranslations('inbox.bulk');
  const tPage = useTranslations('inbox.pagination');
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selection = useInboxSelection();
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => filtersFromSearchParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const projectsQuery = useQuery({
    queryKey: ['projects', 'all'],
    queryFn: () => api.get<Paginated<ProjectSummary>>('/projects', { query: { limit: 100 } }),
    staleTime: 60_000,
  });

  const inboxQuery = useQuery({
    queryKey: ['inbox', page, filters.status, filters.type, filters.projectSlug, filters.range],
    queryFn: () =>
      api.get<Paginated<InboxSummary>>('/inbox', {
        query: {
          page,
          limit: PAGE_LIMIT,
          status: filters.status,
          type: filters.type,
        },
      }),
  });

  const live = useLiveEvents({ types: ['inbox.item_added', 'inbox.item_resolved'] });
  useEffect(() => {
    if (!live.lastEvent) return;
    queryClient.invalidateQueries({ queryKey: ['inbox'] });
  }, [live.lastEvent, queryClient]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const filtered = useMemo(() => {
    const items = inboxQuery.data?.items ?? [];
    const after = rangeStart(filters.range);
    if (!after) return items;
    return items.filter((i) => new Date(i.createdAt) >= after);
  }, [inboxQuery.data, filters.range]);

  // Clear selection when filters change so stale ids don't survive. Depend on
  // the Zustand `clear` action — its identity is stable across renders, unlike
  // the whole `selection` object whose reference flips on every state change
  // and used to trigger an infinite re-render loop here.
  const clearSelection = useInboxSelection((s) => s.clear);
  useEffect(() => {
    clearSelection();
    setEditingId(null);
    setFocusedId(null);
    setPage(1);
  }, [filters.status, filters.type, filters.projectSlug, filters.range, clearSelection]);

  // After a bulk accept/reject, the current page may have drained — if so,
  // step back so the user isn't stranded on an empty page. Guard on
  // isFetching to avoid fighting with an in-flight refetch.
  useEffect(() => {
    if (
      !inboxQuery.isFetching &&
      inboxQuery.data &&
      inboxQuery.data.items.length === 0 &&
      page > 1
    ) {
      setPage((p) => Math.max(1, p - 1));
    }
  }, [inboxQuery.data, inboxQuery.isFetching, page]);

  const handleFilterChange = (next: typeof DEFAULT_FILTERS): void => {
    const params = filtersToSearchParams(next).toString();
    router.replace(params ? `/inbox?${params}` : '/inbox');
  };

  const accept = useMutation({
    mutationFn: (id: string) => api.post<InboxSummary>(`/inbox/${encodeURIComponent(id)}/accept`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox'] });
      toast.success(t('accepted'));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('actionFailed')),
  });

  const reject = useMutation({
    mutationFn: (id: string) => api.post<InboxSummary>(`/inbox/${encodeURIComponent(id)}/reject`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox'] });
      toast.success(t('rejected'));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('actionFailed')),
  });

  const editAccept = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api.post<InboxSummary>(`/inbox/${encodeURIComponent(id)}/edit`, { payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox'] });
      toast.success(t('edited'));
      setEditingId(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('actionFailed')),
  });

  const bulk = useMutation({
    mutationFn: ({ ids, mode }: { ids: string[]; mode: 'accept' | 'reject' }) =>
      api.post<BulkInboxResult>(`/inbox/bulk/${mode}`, { ids }),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['inbox'] });
      selection.clear();
      const accepted = data.accepted.length;
      const failed = data.failed.length;
      const total = accepted + failed;
      if (failed === 0) {
        toast.success(
          tBulk(variables.mode === 'accept' ? 'successAll' : 'successRejectAll', {
            accepted,
            total,
          }),
        );
      } else {
        toast.warning(
          tBulk(variables.mode === 'accept' ? 'partial' : 'partialReject', { accepted, failed }),
        );
      }
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : tBulk('allFailed')),
  });

  const isPending = accept.isPending || reject.isPending || editAccept.isPending || bulk.isPending;

  useInboxKeyboard(
    {
      next: () => {
        if (filtered.length === 0) return;
        const idx = focusedId ? filtered.findIndex((i) => i.id === focusedId) : -1;
        const nextItem = filtered[Math.min(filtered.length - 1, idx + 1)];
        setFocusedId(nextItem?.id ?? null);
      },
      prev: () => {
        if (filtered.length === 0) return;
        const idx = focusedId ? filtered.findIndex((i) => i.id === focusedId) : 0;
        const prevItem = filtered[Math.max(0, idx - 1)];
        setFocusedId(prevItem?.id ?? null);
      },
      accept: () => {
        if (focusedId) accept.mutate(focusedId);
      },
      reject: () => {
        if (focusedId) reject.mutate(focusedId);
      },
      edit: () => {
        if (focusedId) setEditingId(focusedId);
      },
      viewEvidence: () => {
        if (!focusedId) return;
        const item = filtered.find((i) => i.id === focusedId);
        const evidenceId =
          (item?.payload as { evidenceDocumentId?: string } | undefined)?.evidenceDocumentId ??
          item?.documentId ??
          undefined;
        if (evidenceId) window.open(`/documents/${evidenceId}`, '_blank');
      },
      clear: () => {
        if (editingId) setEditingId(null);
        else selection.clear();
      },
      toggleHelp: () => setHelpOpen((v) => !v),
    },
    editingId === null,
  );

  const totalShown = filtered.length;
  const totalAll = inboxQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalAll / PAGE_LIMIT));

  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <InboxFiltersBar
        value={filters}
        onChange={handleFilterChange}
        projects={projectsQuery.data?.items ?? []}
        visibleCount={totalShown}
        totalCount={totalAll}
        selectedCount={selection.selectedIds.size}
        onSelectAllVisible={() => selection.selectAll(filtered.map((i) => i.id))}
        onClearSelection={() => selection.clear()}
      />
      <div className="space-y-2 px-8 py-6">
        {inboxQuery.isLoading &&
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}

        {!inboxQuery.isLoading && inboxQuery.isError && (
          <ErrorState
            title={t('loadError')}
            description={
              inboxQuery.error instanceof ApiError ? inboxQuery.error.message : undefined
            }
            onRetry={() => inboxQuery.refetch()}
          />
        )}

        {!inboxQuery.isLoading && !inboxQuery.isError && filtered.length === 0 && (
          <EmptyState icon={InboxIcon} title={t('empty')} description={t('emptyHint')} />
        )}

        {filtered.map((item) => {
          if (editingId === item.id) {
            return (
              <EditInboxCard
                key={item.id}
                item={item}
                onCancel={() => setEditingId(null)}
                onSubmit={(payload) => editAccept.mutate({ id: item.id, payload })}
                isPending={editAccept.isPending}
              />
            );
          }
          return (
            <InboxCard
              key={item.id}
              item={item}
              isPending={isPending}
              isSelected={selection.selectedIds.has(item.id)}
              isFocused={focusedId === item.id}
              onSelectChange={(value) => selection.set(item.id, value)}
              onAccept={() => accept.mutate(item.id)}
              onReject={() => reject.mutate(item.id)}
              onEdit={() => setEditingId(item.id)}
            />
          );
        })}

        {totalAll > PAGE_LIMIT && (
          <div className="flex items-center justify-between pt-2 text-sm text-muted-foreground">
            <span>{tPage('summary', { page, pages: pageCount, total: totalAll })}</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || inboxQuery.isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {tPage('prev')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount || inboxQuery.isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                {tPage('next')}
              </Button>
            </div>
          </div>
        )}
      </div>
      <BulkActionBar
        selectedCount={selection.selectedIds.size}
        onAcceptAll={() => bulk.mutate({ ids: Array.from(selection.selectedIds), mode: 'accept' })}
        onRejectAll={() => bulk.mutate({ ids: Array.from(selection.selectedIds), mode: 'reject' })}
        onClear={() => selection.clear()}
        isPending={bulk.isPending}
      />
      <KeyboardShortcutsOverlay open={helpOpen} onOpenChange={setHelpOpen} scope="inbox" />
    </div>
  );
}
