import { describe, expect, it } from 'vitest';

import { recentActivity } from '../tools/recent-activity.js';
import { buildMockCtx, makeDailyDoc, makeDocument } from './helpers.js';

describe('recentActivity', () => {
  it('returns recent docs, decisions filtered by decidedAt, and daily notes', async () => {
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentKey = recent.toISOString().slice(0, 10);
    const oldKey = old.toISOString().slice(0, 10);
    const bag = buildMockCtx({
      documents: [makeDocument({ createdAt: recent }), makeDocument({ createdAt: old })],
      dailyDocs: [
        makeDailyDoc({ date: recentKey, createdAt: recent }),
        makeDailyDoc({ date: oldKey, createdAt: old }),
      ],
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
    // listDaily filters by the YYYY-MM-DD key so notes older than the window
    // (oldKey < fromKey) are dropped.
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0]?.date).toBe(recentKey);
  });

  it('defaults to 7 days when days not provided', async () => {
    const bag = buildMockCtx();
    const out = await recentActivity({}, bag.ctx);
    expect(out).toEqual({ documents: [], decisions: [], notes: [] });
  });
});
