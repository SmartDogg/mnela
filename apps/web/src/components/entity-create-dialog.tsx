'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

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
import { api } from '@/lib/api/client';
import { ENTITY_TYPES, type EntityType } from '@/app/(app)/graph/_components/filterState';

interface EntityCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful create (or find-of-existing) with the new id. */
  onCreated?: (id: string) => void;
}

interface CreateEntityResponse {
  entity: { id: string; name: string; type: string };
  reused: boolean;
}

export function EntityCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: EntityCreateDialogProps): JSX.Element {
  const t = useTranslations('graph.create');
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState<EntityType>('concept');
  const [description, setDescription] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<CreateEntityResponse>('/graph/entities', {
        name: name.trim(),
        type,
        description: description.trim() ? description.trim() : null,
      }),
    onSuccess: (result) => {
      // Refresh both the overview snapshot and any entity-type/relation facet
      // lists — a new node may unlock a previously-empty type bucket.
      queryClient.invalidateQueries({ queryKey: ['graph'] });
      onCreated?.(result.entity.id);
      onOpenChange(false);
      setName('');
      setDescription('');
      setErrorMsg(null);
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    },
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!name.trim()) return;
    setErrorMsg(null);
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="entity-create-name" className="text-xs">
              {t('name')}
            </Label>
            <Input
              id="entity-create-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="entity-create-type" className="text-xs">
              {t('type')}
            </Label>
            <select
              id="entity-create-type"
              value={type}
              onChange={(e) => setType(e.target.value as EntityType)}
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono text-xs"
            >
              {ENTITY_TYPES.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="entity-create-desc" className="text-xs">
              {t('description')}
            </Label>
            <textarea
              id="entity-create-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('descriptionPlaceholder')}
              rows={3}
              className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-xs leading-relaxed"
            />
          </div>
          {errorMsg && (
            <p className="rounded-sm border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
              {errorMsg}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={mutation.isPending || name.trim().length === 0}
            >
              {mutation.isPending ? t('creating') : t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
