import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type {
  ConflictingDecisionPayload,
  DuplicateDetectionPayload,
  EnrichmentFailedPayload,
  EntityMergeSuggestionPayload,
  InboxItemType,
  InboxSummary,
  LinkSuggestionPayload,
} from '@/lib/api/types';

import { InboxCard } from './inbox-card';

function makeItem(type: InboxItemType, payload: object): InboxSummary {
  return {
    id: `inbox-${type}`,
    type,
    status: 'pending',
    title: `${type} title`,
    description: 'desc',
    createdAt: new Date().toISOString(),
    payload: payload as Record<string, unknown>,
    documentId: null,
    edgeId: null,
    entityId: null,
  };
}

const LINK_PAYLOAD: LinkSuggestionPayload = {
  fromName: 'Alpha',
  toName: 'Beta',
  relationType: 'related_to',
  confidence: 0.72,
  evidenceDocumentId: 'doc-1',
};

describe('InboxCard', () => {
  function renderCard(
    item: InboxSummary,
    isSelected = false,
  ): { onSelectChange: ReturnType<typeof vi.fn>; onEdit: ReturnType<typeof vi.fn> } {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const onEdit = vi.fn();
    const onSelectChange = vi.fn();
    render(
      <InboxCard
        item={item}
        onAccept={onAccept}
        onReject={onReject}
        onEdit={onEdit}
        isPending={false}
        isSelected={isSelected}
        onSelectChange={onSelectChange}
      />,
    );
    return { onSelectChange, onEdit };
  }

  it('renders link_suggestion with from/to/relation', () => {
    renderCard(makeItem('link_suggestion', LINK_PAYLOAD));
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('related_to')).toBeInTheDocument();
  });

  it('renders entity_merge_suggestion with shared counts', () => {
    const p: EntityMergeSuggestionPayload = {
      sourceId: 'src',
      targetId: 'tgt',
      sourceName: 'OldName',
      targetName: 'NewName',
      sharedNeighbors: 4,
      sharedDocuments: 12,
    };
    renderCard(makeItem('entity_merge_suggestion', p));
    expect(screen.getByText('OldName')).toBeInTheDocument();
    expect(screen.getByText('NewName')).toBeInTheDocument();
  });

  it('renders duplicate_detection with two documents', () => {
    const p: DuplicateDetectionPayload = {
      documentIdA: 'a',
      documentIdB: 'b',
      titleA: 'Doc A',
      titleB: 'Doc B',
      similarityScore: 0.93,
    };
    renderCard(makeItem('duplicate_detection', p));
    expect(screen.getByText('Doc A')).toBeInTheDocument();
    expect(screen.getByText('Doc B')).toBeInTheDocument();
  });

  it('renders enrichment_failed with lastError', () => {
    const p: EnrichmentFailedPayload = {
      documentId: 'doc-99',
      attempts: 3,
      lastError: 'rate-limit',
    };
    renderCard(makeItem('enrichment_failed', p));
    expect(screen.getByText(/rate-limit/)).toBeInTheDocument();
  });

  it('renders conflicting_decision with both ids', () => {
    const p: ConflictingDecisionPayload = {
      decisionId: 'd1',
      conflictingDecisionId: 'd2',
      summary: 'two paths',
    };
    renderCard(makeItem('conflicting_decision', p));
    expect(screen.getByText('d1')).toBeInTheDocument();
    expect(screen.getByText('d2')).toBeInTheDocument();
  });

  it('toggle selection fires onSelectChange', async () => {
    const user = userEvent.setup();
    const { onSelectChange } = renderCard(makeItem('link_suggestion', LINK_PAYLOAD));
    await user.click(screen.getByLabelText('Select'));
    expect(onSelectChange).toHaveBeenCalledWith(true);
  });

  it('clicking edit calls onEdit', async () => {
    const user = userEvent.setup();
    const { onEdit } = renderCard(makeItem('link_suggestion', LINK_PAYLOAD));
    await user.click(screen.getByLabelText('edit'));
    expect(onEdit).toHaveBeenCalled();
  });
});
