'use client';

import Link from 'next/link';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { AskCitation } from '@/lib/ask/useAskStream';

export function CitationChip({
  citation,
  className,
}: {
  citation: AskCitation;
  className?: string;
}): JSX.Element {
  const href = citation.docId
    ? `/documents/${citation.docId}?highlight=${encodeURIComponent(citation.snippet)}`
    : '#';

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={href}
            className={cn(
              'inline-flex h-5 items-center rounded bg-primary/10 px-1.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/20',
              className,
            )}
          >
            [{citation.ord}]
          </Link>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" className="max-w-sm">
          <div className="space-y-1 text-xs">
            <div className="font-medium">{citation.title ?? 'Source not found'}</div>
            <div className="text-muted-foreground">{citation.snippet}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
