import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { CitationChip } from './citation-chip';

const VALID_DOC = 'c' + 'a'.repeat(24);

function withIntl(node: JSX.Element): JSX.Element {
  return (
    <NextIntlClientProvider
      locale="en"
      messages={{
        ask: {
          citation: {
            tooltipMissing: 'Source not found',
            openDocument: 'Open document',
          },
        },
      }}
    >
      {node}
    </NextIntlClientProvider>
  );
}

describe('CitationChip', () => {
  it('renders ord + truncated title and links to the document with a highlight', () => {
    render(
      withIntl(
        <CitationChip
          citation={{ ord: 3, docId: VALID_DOC, title: 'Strict typing', snippet: 'use it' }}
        />,
      ),
    );
    const link = screen.getByRole('link');
    expect(link).toHaveTextContent('3');
    expect(link).toHaveTextContent('Strict typing');
    expect(link.getAttribute('href')).toBe(`/documents/${VALID_DOC}?highlight=use%20it`);
  });

  it('falls back to the "source not found" label when title is null', () => {
    render(
      withIntl(
        <CitationChip citation={{ ord: 1, docId: VALID_DOC, title: null, snippet: 'fragment' }} />,
      ),
    );
    const link = screen.getByRole('link');
    expect(link).toHaveTextContent('1');
    // setup.ts mocks next-intl so `t(key)` returns the key string itself
    // — and the component scopes useTranslations('ask.citation'), so the
    // namespace prefix is dropped. We test the fallback slot fires, not
    // the actual copy.
    expect(link).toHaveTextContent('tooltipMissing');
  });
});
