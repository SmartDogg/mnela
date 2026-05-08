import { Badge } from '@/components/ui/badge';
import type { DocumentStatus, JobStatus } from '@/lib/api/types';

const documentVariants: Record<
  DocumentStatus,
  'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'
> = {
  raw: 'secondary',
  parsed: 'outline',
  enriching: 'warning',
  enriched: 'success',
  failed: 'destructive',
  archived: 'secondary',
};

const jobVariants: Record<
  JobStatus,
  'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'
> = {
  queued: 'secondary',
  running: 'warning',
  paused: 'outline',
  completed: 'success',
  failed: 'destructive',
  cancelled: 'secondary',
};

export function DocumentStatusBadge({ status }: { status: DocumentStatus }): JSX.Element {
  return <Badge variant={documentVariants[status]}>{status}</Badge>;
}

export function JobStatusBadge({ status }: { status: JobStatus }): JSX.Element {
  return <Badge variant={jobVariants[status]}>{status}</Badge>;
}
