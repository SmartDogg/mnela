import { describe, expect, it } from 'vitest';

import { getDailyNote } from '../tools/get-daily-note.js';
import { buildMockCtx, makeDailyNote } from './helpers.js';

describe('getDailyNote', () => {
  it('returns the note when one exists for the given date', async () => {
    const note = makeDailyNote({
      date: new Date('2026-05-08T00:00:00.000Z'),
      contentMd: 'today',
    });
    const bag = buildMockCtx({ dailyNotes: [note] });
    const out = await getDailyNote({ date: '2026-05-08' }, bag.ctx);
    expect(out).not.toBeNull();
    expect(out?.contentMd).toBe('today');
    expect(out?.date).toBe('2026-05-08');
  });

  it('returns null when no note exists for that date', async () => {
    const bag = buildMockCtx();
    const out = await getDailyNote({ date: '2099-01-01' }, bag.ctx);
    expect(out).toBeNull();
  });
});
