import type { InboxItemType } from '@/lib/api/types';

export type InboxStatusFilter = 'pending' | 'accepted' | 'rejected';
export type InboxDateRange = 'today' | '7d' | '30d' | 'all';

export interface InboxFilters {
  type?: InboxItemType;
  status: InboxStatusFilter;
  projectSlug?: string;
  range: InboxDateRange;
}

export const DEFAULT_FILTERS: InboxFilters = {
  type: undefined,
  status: 'pending',
  projectSlug: undefined,
  range: 'all',
};

export function filtersFromSearchParams(params: URLSearchParams): InboxFilters {
  const type = params.get('type');
  const status = params.get('status');
  const projectSlug = params.get('projectSlug') ?? undefined;
  const range = params.get('range');

  return {
    type: isValidType(type) ? type : undefined,
    status: isValidStatus(status) ? status : 'pending',
    projectSlug,
    range: isValidRange(range) ? range : 'all',
  };
}

export function filtersToSearchParams(filters: InboxFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.type) params.set('type', filters.type);
  if (filters.status !== 'pending') params.set('status', filters.status);
  if (filters.projectSlug) params.set('projectSlug', filters.projectSlug);
  if (filters.range !== 'all') params.set('range', filters.range);
  return params;
}

export function rangeStart(range: InboxDateRange): Date | null {
  const now = new Date();
  switch (range) {
    case 'today': {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case 'all':
      return null;
  }
}

const TYPES = new Set<InboxItemType>([
  'link_suggestion',
  'entity_merge_suggestion',
  'duplicate_detection',
  'enrichment_failed',
  'conflicting_decision',
]);

function isValidType(v: string | null): v is InboxItemType {
  return v !== null && TYPES.has(v as InboxItemType);
}

function isValidStatus(v: string | null): v is InboxStatusFilter {
  return v === 'pending' || v === 'accepted' || v === 'rejected';
}

function isValidRange(v: string | null): v is InboxDateRange {
  return v === 'today' || v === '7d' || v === '30d' || v === 'all';
}
