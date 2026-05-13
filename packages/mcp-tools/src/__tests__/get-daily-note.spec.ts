import { describe, expect, it } from 'vitest';

import { getDailyNote } from '../tools/get-daily-note.js';
import { buildMockCtx, makeDailyDoc } from './helpers.js';

describe('getDailyNote', () => {
  it('returns the note when a Document(source=daily) exists for that date', async () => {
    const note = makeDailyDoc({ date: '2026-05-08', rawText: 'today' });
    const bag = buildMockCtx({ dailyDocs: [note] });
    const out = await getDailyNote({ date: '2026-05-08' }, bag.ctx);
    expect(out).not.toBeNull();
    expect(out?.contentMd).toBe('today');
    expect(out?.date).toBe('2026-05-08');
  });

  it('returns null when no daily document exists for that date', async () => {
    const bag = buildMockCtx();
    const out = await getDailyNote({ date: '2099-01-01' }, bag.ctx);
    expect(out).toBeNull();
  });
});
