'use client';

import ReactMarkdown from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

import { cn } from '@/lib/utils';

const SCHEMA = {
  ...defaultSchema,
  tagNames: [
    'p',
    'br',
    'strong',
    'em',
    'code',
    'pre',
    'blockquote',
    'a',
    'ul',
    'ol',
    'li',
    'hr',
    'h1',
    'h2',
    'h3',
    'h4',
  ],
  attributes: {
    a: ['href', 'title'],
    code: ['className'],
    pre: ['className'],
  },
  protocols: { href: ['http', 'https', 'mailto'] },
};

/**
 * Minimal markdown renderer for assistant message bodies (Phase 8, Q32).
 * No raw HTML, no images, no tables in v1 — extend the SCHEMA when needed.
 */
export function Markdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={cn(
        'prose prose-sm max-w-none text-foreground prose-p:my-2 prose-pre:my-2 prose-pre:bg-muted/50 prose-pre:rounded-md prose-pre:p-3 prose-code:rounded prose-code:bg-muted/50 prose-code:px-1 prose-code:py-0.5 prose-a:text-primary prose-a:no-underline hover:prose-a:underline',
        className,
      )}
    >
      <ReactMarkdown
        rehypePlugins={[[rehypeSanitize, SCHEMA]]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
