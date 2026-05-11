import { create } from 'zustand';

interface InboxSelectionState {
  selectedIds: Set<string>;
  toggle: (id: string) => void;
  set: (id: string, value: boolean) => void;
  clear: () => void;
  selectAll: (ids: string[]) => void;
  has: (id: string) => boolean;
  size: () => number;
}

export const useInboxSelection = create<InboxSelectionState>((set, get) => ({
  selectedIds: new Set(),
  toggle: (id) =>
    set((state) => {
      const next = new Set(state.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    }),
  set: (id, value) =>
    set((state) => {
      const next = new Set(state.selectedIds);
      if (value) next.add(id);
      else next.delete(id);
      return { selectedIds: next };
    }),
  clear: () => set({ selectedIds: new Set() }),
  selectAll: (ids) => set({ selectedIds: new Set(ids) }),
  has: (id) => get().selectedIds.has(id),
  size: () => get().selectedIds.size,
}));
