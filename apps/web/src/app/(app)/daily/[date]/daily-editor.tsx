'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api } from '@/lib/api/client';
import type { DailyNote } from '@/lib/api/types';

export function DailyEditor({
  date,
  initial,
}: {
  date: string;
  initial: DailyNote | null;
}): JSX.Element {
  const t = useTranslations('daily');
  const queryClient = useQueryClient();
  const [contentMd, setContentMd] = useState(initial?.contentMd ?? '');
  const [mood, setMood] = useState(initial?.mood ?? '');

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put<DailyNote>(`/daily/${encodeURIComponent(date)}`, {
        contentMd,
        mood: mood || undefined,
      }),
    onSuccess: (note) => {
      toast.success('Saved');
      queryClient.setQueryData(['daily', date], note);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save');
    },
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
      <div className="space-y-2">
        <Label htmlFor="d-content">{t('content')}</Label>
        <Textarea
          id="d-content"
          rows={20}
          value={contentMd}
          onChange={(e) => setContentMd(e.target.value)}
          spellCheck={false}
          className="font-mono text-sm"
        />
      </div>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="d-mood">{t('mood')}</Label>
          <Input
            id="d-mood"
            value={mood}
            onChange={(e) => setMood(e.target.value)}
            placeholder="✨"
          />
        </div>
        <Button
          className="w-full"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? <Loader2 className="animate-spin" /> : <Save />}
          {saveMutation.isPending ? t('saving') : 'Save'}
        </Button>
      </div>
    </div>
  );
}
