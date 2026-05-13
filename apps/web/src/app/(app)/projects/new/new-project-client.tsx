'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, Loader2, RotateCw, Sparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api } from '@/lib/api/client';
import type {
  ProjectDetail,
  ProjectPreviewCandidate,
  ProjectSuggestion,
  ProjectSuggestionsResponse,
} from '@/lib/api/types';

export function NewProjectClient(): JSX.Element {
  const t = useTranslations('projects.newPage');
  const tr = useTranslations('projects');
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [autoFill, setAutoFill] = useState(false);
  const [pickedSuggestion, setPickedSuggestion] = useState<ProjectSuggestion | null>(null);
  const [candidates, setCandidates] = useState<ProjectPreviewCandidate[] | null>(null);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());

  const suggestions = useQuery({
    queryKey: ['project-suggestions'],
    queryFn: () => api.get<ProjectSuggestionsResponse>('/projects/suggestions'),
  });

  const rescan = useMutation({
    mutationFn: () =>
      api.post<{ jobId: string; enabled: boolean }>('/projects/suggestions/rescan', {}),
    onSuccess: (res) => {
      if (!res.enabled) {
        toast.error(t('suggestionsDisabled'));
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['project-suggestions'] });
      toast.success(t('rescanQueued', { jobId: res.jobId.slice(0, 8) }));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : tr('createFailed')),
  });

  const preview = useMutation({
    mutationFn: () =>
      api.post<ProjectPreviewCandidate[]>('/projects/preview', {
        name,
        description,
        limit: 50,
      }),
    onSuccess: (data) => {
      setCandidates(data);
      setSelectedDocs(new Set(data.map((c) => c.documentId)));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : tr('createFailed')),
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<ProjectDetail>('/projects', body),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project-suggestions'] });
      toast.success(pickedSuggestion ? tr('acceptedSuccess') : tr('createdSuccess'));
      router.push(`/projects/${project.slug}`);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : tr('createFailed')),
  });

  const dismiss = useMutation({
    mutationFn: (slug: string) => api.post(`/projects/${encodeURIComponent(slug)}/dismiss`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-suggestions'] });
      toast.success(tr('dismissedSuccess'));
      if (pickedSuggestion) {
        setPickedSuggestion(null);
        setName('');
        setDescription('');
      }
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : tr('createFailed')),
  });

  const canSubmit = name.trim().length > 0 && !create.isPending;

  const pickSuggestion = (suggestion: ProjectSuggestion): void => {
    setPickedSuggestion(suggestion);
    setName(suggestion.name);
    setDescription(suggestion.description ?? '');
    setAutoFill(false);
    setCandidates(null);
  };

  const reset = (): void => {
    setPickedSuggestion(null);
    setName('');
    setDescription('');
    setAutoFill(false);
    setCandidates(null);
    setSelectedDocs(new Set());
  };

  const submit = (): void => {
    if (pickedSuggestion) {
      create.mutate({
        acceptFromSlug: pickedSuggestion.slug,
        name,
        description: description || null,
        autoFill,
      });
      return;
    }
    create.mutate({
      name,
      description: description || null,
      autoFill,
      documentIds: candidates && selectedDocs.size > 0 ? Array.from(selectedDocs) : undefined,
    });
  };

  const selectedCount = selectedDocs.size;
  const suggestionList = useMemo(() => suggestions.data?.items ?? [], [suggestions.data]);
  const suggestionsEnabled = suggestions.data?.enabled !== false;

  return (
    <div className="px-8 py-6 space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            {t('suggestionsHeader')}
          </h2>
          <Button
            variant="outline"
            size="sm"
            disabled={rescan.isPending || !suggestionsEnabled}
            onClick={() => rescan.mutate()}
          >
            {rescan.isPending ? <Loader2 className="animate-spin" /> : <RotateCw />}
            {t('rescan')}
          </Button>
        </div>

        {!suggestionsEnabled && (
          <Card>
            <CardContent className="py-3 text-sm text-muted-foreground">
              {t('suggestionsDisabled')}
            </CardContent>
          </Card>
        )}

        {suggestions.isLoading && (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-4 w-32" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-3 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {suggestionsEnabled && suggestionList.length === 0 && !suggestions.isLoading && (
          <Card>
            <CardContent className="py-3 text-sm text-muted-foreground">
              {t('suggestionsEmpty')}
            </CardContent>
          </Card>
        )}

        {suggestionList.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {suggestionList.map((s) => {
              const isPicked = pickedSuggestion?.slug === s.slug;
              return (
                <Card
                  key={s.slug}
                  className={
                    isPicked ? 'border-primary ring-1 ring-primary/40' : 'transition-colors'
                  }
                >
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2 text-base">
                      <span className="truncate">{s.name}</span>
                      <Badge variant="outline" className="shrink-0 text-xs">
                        {tr(`source.${s.source}`)}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {s.description && (
                      <p className="line-clamp-3 text-muted-foreground">{s.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {s.topEntities.slice(0, 5).map((e) => (
                        <Badge key={e} variant="secondary" className="text-xs">
                          {e}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('matchedDocs', { count: s.docCount })}
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        variant={isPicked ? 'default' : 'outline'}
                        onClick={() => pickSuggestion(s)}
                      >
                        {isPicked ? <CheckCircle2 className="mr-1 h-4 w-4" /> : null}
                        {t('useSuggestion')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => dismiss.mutate(s.slug)}
                        disabled={dismiss.isPending}
                      >
                        <X className="mr-1 h-4 w-4" />
                        {t('dismiss')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('manualHeader')}</h2>
        <div className="grid gap-3 max-w-2xl">
          <div className="space-y-1.5">
            <Label htmlFor="p-name">{tr('name')}</Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-desc">{tr('description')}</Label>
            <Textarea
              id="p-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="p-auto"
              checked={autoFill}
              onCheckedChange={(v) => setAutoFill(Boolean(v))}
              disabled={!!pickedSuggestion}
            />
            <Label htmlFor="p-auto" className="cursor-pointer">
              {t('autoFill')}
            </Label>
          </div>
          {!pickedSuggestion && (
            <p className="text-xs text-muted-foreground">{t('autoFillHint')}</p>
          )}

          {!pickedSuggestion && (
            <div>
              <Button
                variant="outline"
                onClick={() => preview.mutate()}
                disabled={preview.isPending || name.trim().length === 0}
              >
                {preview.isPending ? <Loader2 className="animate-spin" /> : null}
                {t('previewCandidates')}
              </Button>
            </div>
          )}

          {candidates && candidates.length > 0 && !pickedSuggestion && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {t('selected', { count: selectedCount })}
              </p>
              <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
                {candidates.map((c) => {
                  const checked = selectedDocs.has(c.documentId);
                  return (
                    <button
                      key={c.documentId}
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40"
                      onClick={() => {
                        const next = new Set(selectedDocs);
                        if (checked) next.delete(c.documentId);
                        else next.add(c.documentId);
                        setSelectedDocs(next);
                      }}
                    >
                      <Checkbox checked={checked} />
                      <span className="flex-1 truncate">{c.title}</span>
                      <span className="text-xs text-muted-foreground">{c.score.toFixed(2)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Button onClick={submit} disabled={!canSubmit}>
              {create.isPending && <Loader2 className="animate-spin" />}
              {pickedSuggestion ? (
                <>
                  <Check className="mr-1 h-4 w-4" />
                  {t('accept')}
                </>
              ) : (
                t('create')
              )}
            </Button>
            {(pickedSuggestion || candidates) && (
              <Button variant="ghost" onClick={reset}>
                Reset
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
