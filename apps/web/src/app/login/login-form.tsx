'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api/client';

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
type FormValues = z.infer<typeof schema>;

export function LoginForm({ next }: { next?: string }): JSX.Element {
  const t = useTranslations('login');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      api.post<{ id: string; username: string }>('/auth/login', values),
    onSuccess: () => {
      router.replace(next ?? '/');
      router.refresh();
    },
  });

  const onSubmit = form.handleSubmit((values) => mutation.mutate(values));

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="username">{t('username')}</Label>
          <Input id="username" autoComplete="username" autoFocus {...form.register('username')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t('password')}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            {...form.register('password')}
          />
        </div>
      </div>

      {mutation.isError && (
        <p className="text-sm text-destructive" role="alert">
          {mutation.error instanceof ApiError && mutation.error.status === 401
            ? t('error')
            : tCommon('error')}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={mutation.isPending}>
        {mutation.isPending && <Loader2 className="animate-spin" />}
        {mutation.isPending ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
