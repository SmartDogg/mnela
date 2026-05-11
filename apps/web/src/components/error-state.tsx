'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title,
  description,
  onRetry,
  className,
}: ErrorStateProps): JSX.Element {
  const t = useTranslations('errors');
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/40 bg-destructive/[0.04] px-6 py-12 text-center',
        className,
      )}
    >
      <div className="rounded-full bg-destructive/15 p-3">
        <AlertTriangle className="size-5 text-destructive" strokeWidth={1.5} />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-foreground">{title ?? t('generic')}</h3>
        {description && <p className="max-w-md text-xs text-muted-foreground">{description}</p>}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="h-8 px-3">
          <RefreshCw className="size-3" />
          <span className="ml-1.5 text-xs">Retry</span>
        </Button>
      )}
    </div>
  );
}
