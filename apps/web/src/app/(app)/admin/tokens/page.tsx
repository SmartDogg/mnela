'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, api } from '@/lib/api/client';
import type { AuthTokenSummary, CreatedAuthToken, TokenScope } from '@/lib/api/types';
import { formatDate } from '@/lib/utils';

export default function AdminTokensPage(): JSX.Element {
  const t = useTranslations('admin.tokens');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<TokenScope>('mcp');
  const [showToken, setShowToken] = useState<CreatedAuthToken | null>(null);

  const tokens = useQuery({
    queryKey: ['tokens'],
    queryFn: () => api.get<AuthTokenSummary[]>('/auth/tokens'),
  });

  const create = useMutation({
    mutationFn: (body: { name: string; scope: TokenScope }) =>
      api.post<CreatedAuthToken>('/auth/tokens', body),
    onSuccess: (token) => {
      queryClient.invalidateQueries({ queryKey: ['tokens'] });
      setShowToken(token);
      setOpen(false);
      setName('');
      setScope('mcp');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed'),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/tokens/${encodeURIComponent(id)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tokens'] });
      toast.success('Revoked');
    },
  });

  const copy = (value: string): void => {
    navigator.clipboard.writeText(value).then(() => toast.success('Copied'));
  };

  return (
    <div>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus /> {t('create')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('create')}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tk-name">{t('name')}</Label>
                  <Input id="tk-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tk-scope">{t('scope')}</Label>
                  <Select value={scope} onValueChange={(v) => setScope(v as TokenScope)}>
                    <SelectTrigger id="tk-scope">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">{t('scopes.admin')}</SelectItem>
                      <SelectItem value="mcp">{t('scopes.mcp')}</SelectItem>
                      <SelectItem value="read_only">{t('scopes.read_only')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  disabled={!name || create.isPending}
                  onClick={() => create.mutate({ name, scope })}
                >
                  {create.isPending && <Loader2 className="animate-spin" />}
                  {t('create')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="px-8 py-6">
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('name')}</TableHead>
                <TableHead>{t('scope')}</TableHead>
                <TableHead>{t('lastUsed')}</TableHead>
                <TableHead>{t('expires')}</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.isLoading &&
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {tokens.data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No tokens.
                  </TableCell>
                </TableRow>
              )}
              {tokens.data?.map((token) => (
                <TableRow key={token.id}>
                  <TableCell className="font-medium">{token.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{token.scope}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {token.lastUsedAt ? formatDate(token.lastUsedAt) : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {token.expiresAt ? formatDate(token.expiresAt) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => revoke.mutate(token.id)}
                      aria-label={t('revoke')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!showToken} onOpenChange={() => setShowToken(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{showToken?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">{t('plaintextWarning')}</p>
          <pre className="overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs scrollbar-thin">
            {showToken?.token}
          </pre>
          <DialogFooter>
            <Button onClick={() => showToken && copy(showToken.token)}>
              <Copy /> Copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
