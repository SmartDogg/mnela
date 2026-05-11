import { describe, expect, it } from 'vitest';

import { useInboxSelection } from './inbox-selection';

describe('useInboxSelection', () => {
  it('toggles ids on and off', () => {
    const { toggle, has, clear } = useInboxSelection.getState();
    clear();
    toggle('a');
    expect(has('a')).toBe(true);
    toggle('a');
    expect(has('a')).toBe(false);
  });

  it('selectAll replaces selection', () => {
    const { selectAll, selectedIds, clear } = useInboxSelection.getState();
    clear();
    selectAll(['a', 'b', 'c']);
    expect(useInboxSelection.getState().selectedIds.size).toBe(3);
    expect(useInboxSelection.getState().has('b')).toBe(true);
  });

  it('clear empties selection', () => {
    const { selectAll, clear } = useInboxSelection.getState();
    selectAll(['x', 'y']);
    clear();
    expect(useInboxSelection.getState().selectedIds.size).toBe(0);
  });

  it('set toggles deterministically', () => {
    const store = useInboxSelection.getState();
    store.clear();
    store.set('z', true);
    expect(useInboxSelection.getState().has('z')).toBe(true);
    store.set('z', false);
    expect(useInboxSelection.getState().has('z')).toBe(false);
  });
});
