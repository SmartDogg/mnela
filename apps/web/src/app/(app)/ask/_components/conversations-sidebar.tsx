'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiError, api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface ConversationSummary {
  id: string;
  title: string;
  synthesisDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ConversationsPage {
  items: ConversationSummary[];
  total: number;
  page: number;
  limit: number;
}

export function ConversationsSidebar({
  activeId,
  onSelect,
  onNew,
}: {
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}): JSX.Element {
  const t = useTranslations('ask.conversations');
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.get<ConversationsPage>('/conversations', { query: { limit: 50 } }),
    staleTime: 10_000,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ id: string }>(`/conversations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Delete failed'),
  });

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border/60 bg-card/30">
      <header className="flex items-center justify-between border-b border-border/60 px-3 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('title')}
        </h2>
        <Button size="sm" variant="ghost" onClick={onNew} className="h-7 gap-1.5 px-2 text-xs">
          <Plus className="size-3" /> {t('newConversation')}
        </Button>
      </header>
      <div className="flex-1 overflow-y-auto p-2">
        {list.isLoading && <p className="px-2 py-4 text-xs text-muted-foreground">Loading…</p>}
        {list.data?.items.length === 0 && (
          <p className="px-2 py-4 text-xs text-muted-foreground">{t('empty')}</p>
        )}
        <ul className="space-y-0.5">
          {list.data?.items.map((c) => (
            <li
              key={c.id}
              className={cn(
                'group flex items-center justify-between gap-1 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/60',
                activeId === c.id && 'bg-accent text-accent-foreground',
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                className="flex-1 truncate text-left text-xs"
                title={c.title}
              >
                <span className="block truncate">{c.title}</span>
                <span className="block text-[10px] text-muted-foreground">
                  {formatDistanceToNow(new Date(c.updatedAt), { addSuffix: true })}
                  {c.synthesisDocumentId && (
                    <span className="ml-1.5 text-primary">• {t('synthesisBadge')}</span>
                  )}
                </span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem
                    onClick={() => {
                      if (window.confirm(t('deleteConfirm'))) remove.mutate(c.id);
                    }}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="size-3" />
                    <span className="ml-1.5">{t('delete')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
