'use client';

import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { AskCitation } from '@/lib/ask/useAskStream';

/**
 * Citation chip rendered in the strip above the answer body. The
 * answer text no longer carries `[N]` markers — chips are the
 * top-level visual handle on each cited document. Hover surfaces the
 * snippet + a "Open document" affordance.
 */
export function CitationChip({
  citation,
  className,
}: {
  citation: AskCitation;
  className?: string;
}): JSX.Element {
  const t = useTranslations('ask.citation');
  const missing = !citation.title;
  const href = citation.docId
    ? `/documents/${citation.docId}?highlight=${encodeURIComponent(citation.snippet)}`
    : '#';
  const label = citation.title ?? t('tooltipMissing');
  const truncated = label.length > 32 ? `${label.slice(0, 32).trimEnd()}…` : label;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={href}
            className={cn(
              'inline-flex h-6 max-w-[14rem] items-center gap-1 rounded-full border border-primary/30 bg-primary/5 pl-1.5 pr-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15',
              missing && 'border-muted bg-muted/30 text-muted-foreground',
              className,
            )}
          >
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] tabular-nums leading-none">
              {citation.ord}
            </span>
            <span className="truncate">{truncated}</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" className="max-w-sm">
          <div className="space-y-1.5 text-xs">
            <div className="font-medium">{label}</div>
            {citation.snippet && (
              <div className="text-muted-foreground line-clamp-3">{citation.snippet}</div>
            )}
            {!missing && (
              <div className="flex items-center gap-1 text-[10px] text-primary">
                <ExternalLink className="size-3" />
                <span>{t('openDocument')}</span>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
