'use client';

import { useTranslations } from 'next-intl';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface KeyboardShortcutsOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: 'inbox' | 'global';
}

interface Shortcut {
  keys: string[];
  labelKey: string;
}

const INBOX_SHORTCUTS: Shortcut[] = [
  { keys: ['j'], labelKey: 'j' },
  { keys: ['k'], labelKey: 'k' },
  { keys: ['a'], labelKey: 'a' },
  { keys: ['r'], labelKey: 'r' },
  { keys: ['e'], labelKey: 'e' },
  { keys: ['shift', 'V'], labelKey: 'V' },
  { keys: ['esc'], labelKey: 'esc' },
  { keys: ['⌘', '↵'], labelKey: 'cmdEnter' },
  { keys: ['?'], labelKey: 'questionMark' },
];

export function KeyboardShortcutsOverlay({
  open,
  onOpenChange,
  scope,
}: KeyboardShortcutsOverlayProps): JSX.Element {
  const t = useTranslations('inbox.keyboard');

  const shortcuts = scope === 'inbox' ? INBOX_SHORTCUTS : INBOX_SHORTCUTS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('list')}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1.5 text-sm">
          {shortcuts.map((sc) => (
            <li key={sc.labelKey} className="flex items-center justify-between gap-3">
              <span className="text-foreground">{t(sc.labelKey)}</span>
              <span className="flex items-center gap-1">
                {sc.keys.map((k) => (
                  <kbd
                    key={k}
                    className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px]"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
