'use client';

import { Check, Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { InboxSummary, LinkSuggestionPayload } from '@/lib/api/types';
import { cn, relativeTime } from '@/lib/utils';

interface InboxCardProps {
  item: InboxSummary;
  onAccept: () => void;
  onReject: () => void;
  isPending: boolean;
}

function confidenceClass(c: number): { label: 'high' | 'mid' | 'low'; tone: string } {
  if (c >= 0.8) return { label: 'high', tone: 'text-emerald-400 border-emerald-500/40' };
  if (c >= 0.5) return { label: 'mid', tone: 'text-amber-400 border-amber-500/40' };
  return { label: 'low', tone: 'text-red-400 border-red-500/40' };
}

function isLinkSuggestion(
  payload: Record<string, unknown>,
): payload is LinkSuggestionPayload & Record<string, unknown> {
  return (
    typeof payload['fromName'] === 'string' &&
    typeof payload['toName'] === 'string' &&
    typeof payload['relationType'] === 'string' &&
    typeof payload['confidence'] === 'number'
  );
}

export function InboxCard({ item, onAccept, onReject, isPending }: InboxCardProps): JSX.Element {
  const t = useTranslations('inbox');

  if (item.type === 'link_suggestion' && isLinkSuggestion(item.payload)) {
    const conf = confidenceClass(item.payload.confidence);
    return (
      <Card className="border-border/60">
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
          <div className="space-y-1.5">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
              {t('types.linkSuggestion')}
            </Badge>
            <CardTitle className="font-mono text-sm leading-snug">
              <span className="text-foreground">{item.payload.fromName}</span>
              <span className="mx-1.5 text-muted-foreground">·</span>
              <span className="text-muted-foreground italic">{item.payload.relationType}</span>
              <span className="mx-1.5 text-muted-foreground">·</span>
              <span className="text-foreground">{item.payload.toName}</span>
            </CardTitle>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge variant="outline" className={cn('font-mono text-[10px]', conf.tone)}>
              {item.payload.confidence.toFixed(2)} · {t(`confidence.${conf.label}`)}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {relativeTime(item.createdAt)}
            </span>
          </div>
        </CardHeader>
        <CardContent className="flex items-center justify-between pt-0">
          <div className="text-xs text-muted-foreground">
            {item.payload.evidenceDocumentId ? (
              <a
                className="hover:text-foreground hover:underline"
                href={`/documents/${item.payload.evidenceDocumentId}`}
              >
                {t('viewEvidence')}
              </a>
            ) : (
              <span>{t('noEvidence')}</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onReject}
              disabled={isPending}
              className="h-7 px-2.5"
            >
              {isPending ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
              <span className="ml-1.5 text-xs">{t('reject')}</span>
            </Button>
            <Button size="sm" onClick={onAccept} disabled={isPending} className="h-7 px-2.5">
              {isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Check className="size-3" />
              )}
              <span className="ml-1.5 text-xs">{t('accept')}</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Other inbox types — minimal stub for Phase 5; Phase 7 builds full diff UIs.
  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div className="space-y-1">
          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
            {t(`types.${typeKeyFor(item.type)}`)}
          </Badge>
          <CardTitle className="text-sm">{item.title}</CardTitle>
        </div>
        <span className="text-[10px] text-muted-foreground">{relativeTime(item.createdAt)}</span>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        {item.description}
        <p className="mt-2 italic">{t('phase7Note')}</p>
      </CardContent>
    </Card>
  );
}

function typeKeyFor(type: InboxSummary['type']): string {
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
