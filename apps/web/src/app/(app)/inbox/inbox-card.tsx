'use client';

import { Check, Loader2, Pencil, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { forwardRef } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import type { InboxItemType, InboxSummary } from '@/lib/api/types';
import { cn, relativeTime } from '@/lib/utils';

import { InboxDiff } from './_components/InboxDiff';

interface InboxCardProps {
  item: InboxSummary;
  onAccept: () => void;
  onReject: () => void;
  onEdit: () => void;
  isPending: boolean;
  isSelected: boolean;
  onSelectChange: (next: boolean) => void;
  isFocused?: boolean;
}

const TYPE_KEY: Record<InboxItemType, string> = {
  link_suggestion: 'linkSuggestion',
  entity_merge_suggestion: 'entityMergeSuggestion',
  duplicate_detection: 'duplicateDetection',
  enrichment_failed: 'enrichmentFailed',
  conflicting_decision: 'conflictingDecision',
};

export const InboxCard = forwardRef<HTMLDivElement, InboxCardProps>(function InboxCard(
  { item, onAccept, onReject, onEdit, isPending, isSelected, onSelectChange, isFocused },
  ref,
) {
  const t = useTranslations('inbox');
  const tTypes = useTranslations('inbox.types');
  const tDescription = useTranslations('inbox.types.description');
  const typeKey = TYPE_KEY[item.type];

  return (
    <Card
      ref={ref}
      data-inbox-card-id={item.id}
      className={cn(
        'border-border/60 transition-colors',
        isSelected && 'border-primary/50 bg-primary/[0.02]',
        isFocused && 'ring-2 ring-ring/40 ring-offset-2 ring-offset-background',
      )}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="flex items-start gap-3">
          <Checkbox
            aria-label="Select"
            checked={isSelected}
            onCheckedChange={(value) => onSelectChange(value === true)}
            className="mt-1"
          />
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                {tTypes(typeKey)}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {relativeTime(item.createdAt)}
              </span>
            </div>
            <CardTitle className="text-sm leading-snug">{item.title}</CardTitle>
            <p className="text-[11px] text-muted-foreground">{tDescription(typeKey)}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            disabled={isPending}
            className="h-7 px-2 text-xs"
            aria-label={t('edit')}
          >
            <Pencil className="size-3" />
            <span className="ml-1.5 hidden md:inline">{t('edit')}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onReject}
            disabled={isPending}
            className="h-7 px-2.5"
            aria-label={t('reject')}
          >
            {isPending ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
            <span className="ml-1.5 hidden text-xs md:inline">{t('reject')}</span>
          </Button>
          <Button
            size="sm"
            onClick={onAccept}
            disabled={isPending}
            className="h-7 px-2.5"
            aria-label={t('accept')}
          >
            {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            <span className="ml-1.5 hidden text-xs md:inline">{t('accept')}</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <InboxDiff item={item} />
      </CardContent>
    </Card>
  );
});
