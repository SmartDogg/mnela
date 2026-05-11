'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api } from '@/lib/api/client';
import type { Paginated, ProjectSummary } from '@/lib/api/types';
import { relativeTime } from '@/lib/utils';

export function ProjectsList(): JSX.Element {
  const t = useTranslations('projects');
  const queryClient = useQueryClient();
  const [page] = useState(1);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');

  const query = useQuery({
    queryKey: ['projects', page],
    queryFn: () => api.get<Paginated<ProjectSummary>>('/projects', { query: { page, limit: 50 } }),
    placeholderData: keepPreviousData,
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; slug: string; description?: string }) =>
      api.post<ProjectSummary>('/projects', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setOpen(false);
      setName('');
      setSlug('');
      setDescription('');
      toast.success('Project created');
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create');
    },
  });

  return (
    <div className="px-8 py-6 space-y-4">
      <div className="flex items-center justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus /> {t('create')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('create')}</DialogTitle>
              <DialogDescription>{t('subtitle')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="p-name">{t('name')}</Label>
                <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-slug">{t('slug')}</Label>
                <Input
                  id="p-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="my-project"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-desc">{t('description')}</Label>
                <Textarea
                  id="p-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                disabled={!name || !slug || createMutation.isPending}
                onClick={() =>
                  createMutation.mutate({
                    name,
                    slug,
                    description: description || undefined,
                  })
                }
              >
                {createMutation.isPending && <Loader2 className="animate-spin" />}
                {t('create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {query.isLoading &&
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
        {query.data?.items.map((project) => (
          <Link key={project.id} href={`/projects/${project.slug}`}>
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{project.name}</span>
                  <code className="text-xs font-normal text-muted-foreground">{project.slug}</code>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs text-muted-foreground">
                {project.description && (
                  <p className="line-clamp-2 text-sm">{project.description}</p>
                )}
                <p>{relativeTime(project.updatedAt)}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
