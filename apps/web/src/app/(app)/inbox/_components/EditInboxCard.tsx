'use client';

import { Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useInboxEditKeyboard } from '@/lib/keyboard/useInboxKeyboard';
import type { InboxSummary, LinkSuggestionPayload } from '@/lib/api/types';
import { cn } from '@/lib/utils';

interface EditInboxCardProps {
  item: InboxSummary;
  onCancel: () => void;
  onSubmit: (patchedPayload: Record<string, unknown>) => void;
  isPending: boolean;
}

interface LinkSuggestionFormValues {
  relationType: string;
  confidence: number;
}

export function EditInboxCard({
  item,
  onCancel,
  onSubmit,
  isPending,
}: EditInboxCardProps): JSX.Element {
  if (item.type === 'link_suggestion') {
    return (
      <EditLinkSuggestion
        item={item}
        onCancel={onCancel}
        onSubmit={onSubmit}
        isPending={isPending}
      />
    );
  }

  return <EditUnsupported item={item} onCancel={onCancel} />;
}

function EditLinkSuggestion({
  item,
  onCancel,
  onSubmit,
  isPending,
}: EditInboxCardProps): JSX.Element {
  const t = useTranslations('inbox');
  const tEdit = useTranslations('inbox.editForm');
  const payload = item.payload as unknown as LinkSuggestionPayload;
  const form = useForm<LinkSuggestionFormValues>({
    defaultValues: {
      relationType: payload.relationType,
      confidence: payload.confidence,
    },
  });

  const submit = form.handleSubmit((values) => {
    if (!values.relationType.trim()) {
      form.setError('relationType', { message: tEdit('fieldRequired') });
      return;
    }
    onSubmit({
      ...payload,
      relationType: values.relationType.trim(),
      confidence: Math.max(0, Math.min(1, values.confidence)),
    });
  });

  useInboxEditKeyboard({ submit, cancel: onCancel });

  const confidenceValue = form.watch('confidence');

  return (
    <Card data-inbox-card-id={item.id} className="border-primary/60 bg-primary/[0.02]">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="space-y-1">
          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
            {tEdit('title')}
          </Badge>
          <CardTitle className="text-sm leading-snug">{item.title}</CardTitle>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-7 px-2"
          aria-label={t('cancel')}
        >
          <X className="size-3" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={submit} className="space-y-4" data-inbox-edit-form>
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                from
              </Label>
              <span className="font-mono text-sm">{payload.fromName}</span>
            </div>
            <div className="flex flex-col gap-1">
              <Label
                htmlFor={`relationType-${item.id}`}
                className="text-[10px] uppercase tracking-wide text-muted-foreground"
              >
                {tEdit('relationType')}
              </Label>
              <Input
                id={`relationType-${item.id}`}
                {...form.register('relationType')}
                placeholder={tEdit('relationTypePlaceholder')}
                className="h-8 font-mono text-xs"
              />
              {form.formState.errors.relationType && (
                <span className="text-[10px] text-destructive">
                  {form.formState.errors.relationType.message}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1 text-right">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                to
              </Label>
              <span className="font-mono text-sm">{payload.toName}</span>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label
                htmlFor={`confidence-${item.id}`}
                className="text-[10px] uppercase tracking-wide text-muted-foreground"
              >
                {tEdit('confidence')}
              </Label>
              <span className="font-mono text-xs">{confidenceValue.toFixed(2)}</span>
            </div>
            <Slider
              id={`confidence-${item.id}`}
              min={0}
              max={1}
              step={0.05}
              value={confidenceValue}
              onValueChange={(v) => form.setValue('confidence', v)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
              {t('cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={isPending} className={cn('h-8')}>
              {isPending && <Loader2 className="size-3 animate-spin" />}
              <span className={cn(isPending && 'ml-1.5')}>{tEdit('submit')}</span>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function EditUnsupported({
  item,
  onCancel,
}: {
  item: InboxSummary;
  onCancel: () => void;
}): JSX.Element {
  const t = useTranslations('inbox');
  const tEdit = useTranslations('inbox.editForm');
  return (
    <Card data-inbox-card-id={item.id} className="border-amber-500/40">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <CardTitle className="text-sm">{item.title}</CardTitle>
        <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 px-2">
          <X className="size-3" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-muted-foreground">
        <p>{tEdit('noteOnMerge')}</p>
        <div className="flex justify-end pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {t('cancel')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
