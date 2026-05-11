'use client';

import { useHotkeys } from 'react-hotkeys-hook';

export interface InboxKeyboardHandlers {
  next: () => void;
  prev: () => void;
  accept: () => void;
  reject: () => void;
  edit: () => void;
  viewEvidence: () => void;
  clear: () => void;
  toggleHelp: () => void;
}

/**
 * Registers j/k/a/r/e/V/Esc/? on the inbox list. Letters are intentionally NOT
 * fired when an input/textarea/contenteditable has focus (default react-hotkeys-hook
 * behaviour). Esc fires everywhere so the edit form can also close on it via its
 * own listener.
 */
export function useInboxKeyboard(handlers: InboxKeyboardHandlers, enabled = true): void {
  useHotkeys('j', () => handlers.next(), { enabled, preventDefault: true });
  useHotkeys('k', () => handlers.prev(), { enabled, preventDefault: true });
  useHotkeys('a', () => handlers.accept(), { enabled, preventDefault: true });
  useHotkeys('r', () => handlers.reject(), { enabled, preventDefault: true });
  useHotkeys('e', () => handlers.edit(), { enabled, preventDefault: true });
  useHotkeys('shift+v', () => handlers.viewEvidence(), { enabled, preventDefault: true });
  useHotkeys('escape', () => handlers.clear(), {
    enabled,
    enableOnFormTags: true,
  });
  useHotkeys('shift+/', () => handlers.toggleHelp(), { enabled, preventDefault: true });
}

/**
 * For edit-mode: Cmd/Ctrl+Enter submits, Esc cancels. Fires on form inputs.
 */
export function useInboxEditKeyboard(
  handlers: { submit: () => void; cancel: () => void },
  enabled = true,
): void {
  useHotkeys('mod+enter', () => handlers.submit(), {
    enabled,
    enableOnFormTags: true,
    preventDefault: true,
  });
  useHotkeys('escape', () => handlers.cancel(), { enabled, enableOnFormTags: true });
}
