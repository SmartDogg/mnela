// URL <-> filter-state codec for the /graph page. Pure functions, easy to
// unit test. Keys mirror the API query string accepted by GET /graph.

export const ENTITY_TYPES = [
  'project',
  'person',
  'organization',
  'technology',
  'concept',
  'product',
  'service',
  'bug',
  'feature',
  'custom',
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export interface GraphFilters {
  /** Center entity id; required for the API call. Empty string means none. */
  center: string;
  depth: number;
  types: EntityType[];
  relations: string[];
  projectSlug: string | null;
  /** ISO date strings, day precision (UI uses native date input). */
  from: string | null;
  to: string | null;
  /** 0..1, inclusive minimum. */
  confidence: number;
  /** When false, includes needs_review edges (no extra API filter; UI hint). */
  confirmedOnly: boolean;
  /**
   * Overview density cap: how many of the top-degree entities to fetch on
   * /graph/overview. `0` is "no cap" (server still applies GRAPH_MAX_NODES).
   * Only meaningful while `center === ''`.
   */
  overviewLimit: number;
}

/** Hand-picked density presets shown in the sidebar as a segmented control. */
export const OVERVIEW_LIMIT_PRESETS: readonly number[] = [50, 200, 500, 1000, 0] as const;

export const DEFAULT_FILTERS: GraphFilters = {
  center: '',
  depth: 1,
  types: [],
  relations: [],
  projectSlug: null,
  from: null,
  to: null,
  confidence: 0,
  confirmedOnly: true,
  overviewLimit: 200,
};

function isEntityType(value: string): value is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(value);
}

function clampDepth(n: number): number {
  if (Number.isNaN(n)) return 1;
  return Math.max(1, Math.min(4, Math.round(n)));
}

function clampConfidence(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Parse the URL search string (or URLSearchParams) into a GraphFilters object. */
export function filtersFromSearchParams(
  input: URLSearchParams | string | Record<string, string | string[] | undefined>,
): GraphFilters {
  const params: URLSearchParams =
    input instanceof URLSearchParams
      ? input
      : typeof input === 'string'
        ? new URLSearchParams(input)
        : recordToParams(input);

  const center = params.get('center') ?? '';
  const depthRaw = params.get('depth');
  const depth = depthRaw ? clampDepth(Number(depthRaw)) : DEFAULT_FILTERS.depth;

  const typesRaw = params.getAll('types');
  const flatTypes = typesRaw.flatMap((v) => v.split(',')).map((v) => v.trim());
  const types = Array.from(new Set(flatTypes.filter(isEntityType)));

  const relationsRaw = params.getAll('relations');
  const flatRelations = relationsRaw
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  const relations = Array.from(new Set(flatRelations));

  const projectSlug = params.get('projectSlug');
  const from = params.get('from');
  const to = params.get('to');

  const confidenceRaw = params.get('confidence');
  const confidence = confidenceRaw
    ? clampConfidence(Number(confidenceRaw))
    : DEFAULT_FILTERS.confidence;

  const confirmedOnlyRaw = params.get('confirmedOnly');
  const confirmedOnly =
    confirmedOnlyRaw === null ? DEFAULT_FILTERS.confirmedOnly : confirmedOnlyRaw !== 'false';

  const limitRaw = params.get('limit');
  const overviewLimit =
    limitRaw !== null ? clampLimit(Number(limitRaw)) : DEFAULT_FILTERS.overviewLimit;

  return {
    center,
    depth,
    types,
    relations,
    projectSlug: projectSlug && projectSlug.length > 0 ? projectSlug : null,
    from: from && from.length > 0 ? from : null,
    to: to && to.length > 0 ? to : null,
    confidence,
    confirmedOnly,
    overviewLimit,
  };
}

function clampLimit(n: number): number {
  if (Number.isNaN(n) || n < 0) return DEFAULT_FILTERS.overviewLimit;
  // Server-side hard cap is 500 in the existing dto.ts, but the overview
  // endpoint independently honors a higher ceiling. `0` = unlimited.
  return Math.min(10_000, Math.round(n));
}

function recordToParams(input: Record<string, string | string[] | undefined>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) out.append(k, item);
    } else {
      out.set(k, v);
    }
  }
  return out;
}

/** Serialize a filters object to a URLSearchParams (omits defaults). */
export function filtersToSearchParams(filters: GraphFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.center) params.set('center', filters.center);
  if (filters.depth !== DEFAULT_FILTERS.depth) params.set('depth', String(filters.depth));
  if (filters.types.length > 0) params.set('types', filters.types.join(','));
  if (filters.relations.length > 0) params.set('relations', filters.relations.join(','));
  if (filters.projectSlug) params.set('projectSlug', filters.projectSlug);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.confidence !== DEFAULT_FILTERS.confidence) {
    params.set('confidence', filters.confidence.toFixed(2));
  }
  if (filters.confirmedOnly !== DEFAULT_FILTERS.confirmedOnly) {
    params.set('confirmedOnly', String(filters.confirmedOnly));
  }
  if (filters.overviewLimit !== DEFAULT_FILTERS.overviewLimit) {
    params.set('limit', String(filters.overviewLimit));
  }
  return params;
}

/**
 * Build the query object passed to `api.get('/graph', { query })`. Strips
 * UI-only fields (confirmedOnly is a client filter on edge.status) and
 * normalizes empty arrays to undefined.
 */
export interface GraphApiQuery {
  center: string;
  depth?: number;
  types?: string;
  relations?: string;
  projectSlug?: string;
  from?: string;
  to?: string;
  confidence?: number;
  maxNodes?: number;
}

export function filtersToApiQuery(filters: GraphFilters): GraphApiQuery | null {
  if (!filters.center) return null;
  const out: GraphApiQuery = { center: filters.center };
  if (filters.depth !== DEFAULT_FILTERS.depth) out.depth = filters.depth;
  if (filters.types.length > 0) out.types = filters.types.join(',');
  if (filters.relations.length > 0) out.relations = filters.relations.join(',');
  if (filters.projectSlug) out.projectSlug = filters.projectSlug;
  // The API takes ISO datetime with offset. We only have a YYYY-MM-DD from
  // the native date picker; widen to UTC midnight at the chosen day.
  if (filters.from) out.from = `${filters.from}T00:00:00.000Z`;
  if (filters.to) out.to = `${filters.to}T23:59:59.999Z`;
  if (filters.confidence > 0) out.confidence = filters.confidence;
  return out;
}
