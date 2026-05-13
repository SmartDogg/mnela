'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, RotateCw, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ApiError, api } from '@/lib/api/client';
import type {
  Paginated,
  ProjectStatus,
  ProjectSummary,
  ProjectSuggestionsResponse,
} from '@/lib/api/types';
import { relativeTime } from '@/lib/utils';

const TAB_TO_STATUS: Record<'active' | 'suggested' | 'dismissed', ProjectStatus> = {
  active: 'active',
  suggested: 'suggested',
  dismissed: 'dismissed',
};

export function ProjectsList(): JSX.Element {
  const t = useTranslations('projects');
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'active' | 'suggested' | 'dismissed'>('active');
  const status = TAB_TO_STATUS[tab];

  const list = useQuery({
    queryKey: ['projects', status],
    queryFn: () =>
      api.get<Paginated<ProjectSummary>>('/projects', {
        query: { status, limit: 100 },
      }),
    placeholderData: keepPreviousData,
  });

  const suggestions = useQuery({
    queryKey: ['project-suggestions'],
    queryFn: () => api.get<ProjectSuggestionsResponse>('/projects/suggestions'),
  });

  const rescan = useMutation({
    mutationFn: () =>
      api.post<{ jobId: string; enabled: boolean }>('/projects/suggestions/rescan', {}),
    onSuccess: (res) => {
      if (!res.enabled) {
        toast.error(t('newPage.suggestionsDisabled'));
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['project-suggestions'] });
      toast.success(t('newPage.rescanQueued', { jobId: res.jobId.slice(0, 8) }));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('createFailed')),
  });

  const suggestedBadge = useMemo(() => suggestions.data?.items.length ?? 0, [suggestions.data]);

  return (
    <div className="px-8 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="active">{t('tabs.active')}</TabsTrigger>
            <TabsTrigger value="suggested" className="gap-2">
              <Sparkles className="h-3.5 w-3.5" />
              {t('tabs.suggested')}
              {suggestedBadge > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {suggestedBadge}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="dismissed">{t('tabs.dismissed')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => rescan.mutate()}
            disabled={rescan.isPending}
            title={t('newPage.rescan')}
          >
            {rescan.isPending ? <Loader2 className="animate-spin" /> : <RotateCw />}
            {t('newPage.rescan')}
          </Button>
          <Link href="/projects/new">
            <Button>
              <Plus /> {t('create')}
            </Button>
          </Link>
        </div>
      </div>

      {suggestions.data && !suggestions.data.enabled && (
        <Card>
          <CardContent className="py-3 text-sm text-muted-foreground">
            {t('newPage.suggestionsDisabled')}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.isLoading &&
          Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-3 w-full" />
              </CardContent>
            </Card>
          ))}
        {list.data?.items.length === 0 && !list.isLoading && (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              {tab === 'active' && (
                <>
                  No projects yet. Try{' '}
                  <Link href="/projects/new" className="underline">
                    /projects/new
                  </Link>
                  .
                </>
              )}
              {tab === 'suggested' && t('newPage.suggestionsEmpty')}
              {tab === 'dismissed' && '—'}
            </CardContent>
          </Card>
        )}
        {list.data?.items.map((project) => (
          <Link key={project.id} href={`/projects/${project.slug}`}>
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span className="truncate">{project.name}</span>
                  <code className="text-xs font-normal text-muted-foreground">{project.slug}</code>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs text-muted-foreground">
                {project.description && (
                  <p className="line-clamp-2 text-sm">{project.description}</p>
                )}
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-xs">
                    {t(`source.${project.source}`)}
                  </Badge>
                  {project.autoFill && (
                    <Badge variant="secondary" className="text-xs">
                      auto-fill
                    </Badge>
                  )}
                </div>
                <p>{relativeTime(project.updatedAt)}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
