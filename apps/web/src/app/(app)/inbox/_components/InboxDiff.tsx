'use client';

import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import type {
  ConflictingDecisionPayload,
  DuplicateDetectionPayload,
  EnrichmentFailedPayload,
  EntityMergeSuggestionPayload,
  InboxSummary,
  LinkSuggestionPayload,
} from '@/lib/api/types';
import { cn } from '@/lib/utils';

interface InboxDiffProps {
  item: InboxSummary;
}

export function InboxDiff({ item }: InboxDiffProps): JSX.Element {
  switch (item.type) {
    case 'link_suggestion':
      return <LinkSuggestionDiff payload={item.payload as unknown as LinkSuggestionPayload} />;
    case 'entity_merge_suggestion':
      return <EntityMergeDiff payload={item.payload as unknown as EntityMergeSuggestionPayload} />;
    case 'duplicate_detection':
      return (
        <DuplicateDetectionDiff payload={item.payload as unknown as DuplicateDetectionPayload} />
      );
    case 'enrichment_failed':
      return <EnrichmentFailedDiff payload={item.payload as unknown as EnrichmentFailedPayload} />;
    case 'conflicting_decision':
      return (
        <ConflictingDecisionDiff payload={item.payload as unknown as ConflictingDecisionPayload} />
      );
  }
}

export function confidenceTone(c: number): { label: 'high' | 'mid' | 'low'; tone: string } {
  if (c >= 0.8) return { label: 'high', tone: 'text-emerald-400 border-emerald-500/40' };
  if (c >= 0.5) return { label: 'mid', tone: 'text-amber-400 border-amber-500/40' };
  return { label: 'low', tone: 'text-red-400 border-red-500/40' };
}

function LinkSuggestionDiff({ payload }: { payload: LinkSuggestionPayload }): JSX.Element {
  const t = useTranslations('inbox.diff');
  const tConf = useTranslations('inbox.confidence');
  const conf = confidenceTone(payload.confidence);
  return (
    <div className="space-y-3 font-mono text-xs">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-md border border-border/60 bg-muted/30 px-4 py-3">
        <EntityChip label={t('from')} name={payload.fromName} />
        <div className="flex flex-col items-center gap-1 text-muted-foreground">
          <span className="text-[10px] uppercase tracking-wide">{t('relation')}</span>
          <span className="text-foreground italic">{payload.relationType}</span>
          <Badge variant="outline" className={cn('mt-1 font-mono text-[10px]', conf.tone)}>
            {payload.confidence.toFixed(2)} · {tConf(conf.label)}
          </Badge>
        </div>
        <EntityChip label={t('to')} name={payload.toName} align="end" />
      </div>
      <EvidenceLink documentId={payload.evidenceDocumentId} />
    </div>
  );
}

function EntityChip({
  label,
  name,
  align = 'start',
}: {
  label: string;
  name: string;
  align?: 'start' | 'end';
}): JSX.Element {
  return (
    <div className={cn('flex flex-col gap-1', align === 'end' && 'items-end text-right')}>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="break-words text-sm text-foreground">{name}</span>
    </div>
  );
}

function EntityMergeDiff({ payload }: { payload: EntityMergeSuggestionPayload }): JSX.Element {
  const t = useTranslations('inbox.diff');
  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-md border border-border/60 bg-muted/30 px-4 py-3">
        <EntityChip label={t('from')} name={payload.sourceName ?? payload.sourceId} />
        <span className="text-muted-foreground">→</span>
        <EntityChip label={t('to')} name={payload.targetName ?? payload.targetId} align="end" />
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        {payload.sharedNeighbors !== undefined && (
          <span>{t('sharedNeighbors', { count: payload.sharedNeighbors })}</span>
        )}
        {payload.sharedDocuments !== undefined && (
          <span>{t('sharedDocuments', { count: payload.sharedDocuments })}</span>
        )}
      </div>
    </div>
  );
}

function DuplicateDetectionDiff({ payload }: { payload: DuplicateDetectionPayload }): JSX.Element {
  const t = useTranslations('inbox.diff');
  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-3 rounded-md border border-border/60 bg-muted/30 px-4 py-3">
        <DocCell title={payload.titleA ?? payload.documentIdA} id={payload.documentIdA} />
        <span className="self-center text-muted-foreground">≅</span>
        <DocCell
          title={payload.titleB ?? payload.documentIdB}
          id={payload.documentIdB}
          align="end"
        />
      </div>
      {typeof payload.similarityScore === 'number' && (
        <span className="text-[11px] text-muted-foreground">
          similarity: {payload.similarityScore.toFixed(2)}
        </span>
      )}
      {payload.contentHashMatch && (
        <Badge variant="outline" className="border-amber-500/40 text-amber-400">
          identical content
        </Badge>
      )}
    </div>
  );
}

function DocCell({
  title,
  id,
  align = 'start',
}: {
  title: string;
  id: string;
  align?: 'start' | 'end';
}): JSX.Element {
  const t = useTranslations('inbox.diff');
  return (
    <div className={cn('flex flex-col gap-1', align === 'end' && 'items-end text-right')}>
      <span className="line-clamp-2 text-sm text-foreground">{title}</span>
      <a
        className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
        href={`/documents/${id}`}
      >
        {t('openDocument')}
      </a>
    </div>
  );
}

function EnrichmentFailedDiff({ payload }: { payload: EnrichmentFailedPayload }): JSX.Element {
  const t = useTranslations('inbox.diff');
  return (
    <div className="space-y-2 text-xs">
      <div className="rounded-md border border-border/60 bg-muted/30 px-4 py-3">
        <a
          className="text-sm text-foreground hover:underline"
          href={`/documents/${payload.documentId}`}
        >
          {t('openDocument')}
        </a>
        {payload.lastError && (
          <pre className="mt-2 max-h-32 overflow-auto rounded bg-background/60 p-2 text-[11px] text-muted-foreground">
            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
              {t('lastError')}
            </span>
            {payload.lastError}
          </pre>
        )}
      </div>
      {typeof payload.attempts === 'number' && (
        <span className="text-[11px] text-muted-foreground">
          {t('attempts', { count: payload.attempts })}
        </span>
      )}
    </div>
  );
}

function ConflictingDecisionDiff({
  payload,
}: {
  payload: ConflictingDecisionPayload;
}): JSX.Element {
  return (
    <div className="space-y-2 text-xs">
      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-3 rounded-md border border-border/60 bg-muted/30 px-4 py-3">
        <code className="break-all text-sm text-foreground">{payload.decisionId}</code>
        <span className="self-center text-muted-foreground">↔</span>
        <code className="break-all text-right text-sm text-foreground">
          {payload.conflictingDecisionId}
        </code>
      </div>
      {payload.summary && <p className="text-[11px] text-muted-foreground">{payload.summary}</p>}
    </div>
  );
}

function EvidenceLink({ documentId }: { documentId: string | null | undefined }): JSX.Element {
  const t = useTranslations('inbox.diff');
  if (!documentId) {
    return <span className="text-[11px] text-muted-foreground">{t('noEvidence')}</span>;
  }
  return (
    <a
      href={`/documents/${documentId}`}
      className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
    >
      {t('evidence')} · {t('openDocument')}
    </a>
  );
}
