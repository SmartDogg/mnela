'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api/client';

interface SaveSynthesisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  messageId: string;
  defaultTitle?: string;
}

interface SaveResponse {
  documentId: string;
  conversationId: string;
}

export function SaveSynthesisDialog({
  open,
  onOpenChange,
  conversationId,
  messageId,
  defaultTitle,
}: SaveSynthesisDialogProps): JSX.Element {
  const t = useTranslations('ask.save');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(defaultTitle ?? '');

  useEffect(() => {
    if (open) setTitle(defaultTitle ?? '');
  }, [open, defaultTitle]);

  const save = useMutation({
    mutationFn: (): Promise<SaveResponse> =>
      api.post<SaveResponse>('/search/ask/save', {
        conversationId,
        messageId,
        ...(title.trim() ? { title: title.trim() } : {}),
      }),
    onSuccess: (data) => {
      toast.success(t('saved'));
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      onOpenChange(false);
      router.push(`/documents/${data.documentId}`);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : t('saving'));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
          <DialogDescription>{t('dialogSubtitle')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="synthesis-title">{t('titleLabel')}</Label>
          <Input
            id="synthesis-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-3.5 animate-spin" />}
            <span className="ml-1.5">{save.isPending ? t('saving') : t('confirm')}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
