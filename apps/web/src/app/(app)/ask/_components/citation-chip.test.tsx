import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CitationChip } from './citation-chip';

const VALID_DOC = 'c' + 'a'.repeat(24);

describe('CitationChip', () => {
  it('renders ord and links to /documents/:docId with highlight', () => {
    render(
      <CitationChip
        citation={{ ord: 3, docId: VALID_DOC, title: 'Strict typing', snippet: 'use it' }}
      />,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveTextContent('[3]');
    expect(link.getAttribute('href')).toBe(`/documents/${VALID_DOC}?highlight=use%20it`);
  });

  it('still renders when title is null (missing source)', () => {
    render(
      <CitationChip citation={{ ord: 1, docId: VALID_DOC, title: null, snippet: 'fragment' }} />,
    );
    expect(screen.getByRole('link')).toHaveTextContent('[1]');
  });
});
