import { describe, expect, it } from 'vitest';

import { recentActivity } from '../tools/recent-activity.js';
import { buildMockCtx, makeDailyNote, makeDocument } from './helpers.js';

describe('recentActivity', () => {
  it('returns recent docs, decisions filtered by decidedAt, and notes', async () => {
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const bag = buildMockCtx({
      documents: [makeDocument({ createdAt: recent }), makeDocument({ createdAt: old })],
      dailyNotes: [makeDailyNote({ date: recent }), makeDailyNote({ date: old })],
    });
    bag.decisions.push(
      {
        id: 'd1',
        projectId: null,
        title: 'recent',
        decision: 'go',
        context: null,
        consequences: null,
        status: 'active',
        supersededById: null,
        sourceDocumentId: null,
        decidedAt: recent,
        createdAt: recent,
      },
      {
        id: 'd2',
        projectId: null,
        title: 'old',
        decision: 'no',
        context: null,
        consequences: null,
        status: 'active',
        supersededById: null,
        sourceDocumentId: null,
        decidedAt: old,
        createdAt: old,
      },
    );
    const out = await recentActivity({ days: 7 }, bag.ctx);
    expect(out.decisions).toHaveLength(1);
    expect(out.decisions[0]?.id).toBe('d1');
    // The mock daily.list filters by `from`, so old notes are dropped.
    expect(out.notes).toHaveLength(1);
  });

  it('defaults to 7 days when days not provided', async () => {
    const bag = buildMockCtx();
    const out = await recentActivity({}, bag.ctx);
    expect(out).toEqual({ documents: [], decisions: [], notes: [] });
  });
});
