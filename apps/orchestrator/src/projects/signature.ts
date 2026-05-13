import { createHash } from 'node:crypto';

/**
 * Deterministic signature helpers for project suggestion candidates.
 *
 * The detector emits one `Project.signature` per cluster so the next pass
 * can recognise "I already proposed this group" without re-emitting it. For
 * dismissed suggestions, the same signature acts as a revival key — the
 * detector compares the live cluster metrics with the snapshot stored in
 * `signatureMetrics`; meaningful growth (≥50% more docs OR ≥2 new top
 * entities) ships as a *new* suggestion (fresh row, fresh signature bucket)
 * rather than reviving the dismissed row directly. That way the user keeps
 * an audit trail of what they dismissed without it silently reappearing.
 */

/** `batch:<batchId>` — one import grouped into a single proposal. */
export function batchSignature(batchId: string): string {
  return `batch:${batchId}`;
}

/**
 * `cluster:<hash>:<bucket>` — entity-cluster proposal. The hash folds the
 * sorted set of top-N entity ids so re-ordering doesn't produce a new
 * signature; the `bucket` quantises the doc-count so revival re-emission
 * has a stable identity even as the cluster grows.
 */
export function clusterSignature(entityIds: string[], docCount: number): string {
  if (entityIds.length === 0) {
    throw new Error('clusterSignature: at least one entity required');
  }
  const sorted = [...entityIds].sort();
  const hash = createHash('sha256').update(sorted.join('\n')).digest('hex').slice(0, 16);
  return `cluster:${hash}:${docCountBucket(docCount)}`;
}

/**
 * Bucket doc counts so a cluster that ticks from 12→13 documents doesn't
 * mint a new signature every enrichment cycle. Buckets are: <5, 5-9, 10-19,
 * 20-49, 50-99, 100-249, 250-499, 500+.
 */
export function docCountBucket(count: number): string {
  if (count < 5) return '0-4';
  if (count < 10) return '5-9';
  if (count < 20) return '10-19';
  if (count < 50) return '20-49';
  if (count < 100) return '50-99';
  if (count < 250) return '100-249';
  if (count < 500) return '250-499';
  return '500+';
}

export interface SignatureMetrics {
  docCount: number;
  topEntities: string[];
}

/**
 * Decide whether a dismissed suggestion has gained enough signal to be
 * re-emitted as a fresh suggestion. Trigger when EITHER:
 *   - doc count grew by 50% or more (rounded up, min +3 new docs)
 *   - the top-entities set gained 2 or more new entries
 *
 * Both axes guard against spurious revivals: a couple of new docs aren't
 * enough on their own, and a small entity churn isn't enough on its own.
 */
export function shouldRevive(previous: SignatureMetrics, current: SignatureMetrics): boolean {
  const docGrowth = current.docCount - previous.docCount;
  const docGrowthThreshold = Math.max(3, Math.ceil(previous.docCount * 0.5));
  if (docGrowth >= docGrowthThreshold) return true;

  const prevSet = new Set(previous.topEntities);
  const newEntities = current.topEntities.filter((e) => !prevSet.has(e));
  if (newEntities.length >= 2) return true;

  return false;
}

export function isValidSignatureMetrics(value: unknown): value is SignatureMetrics {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v['docCount'] !== 'number') return false;
  if (!Array.isArray(v['topEntities'])) return false;
  return v['topEntities'].every((e) => typeof e === 'string');
}
