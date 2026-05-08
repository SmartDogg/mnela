'use client';

import type { MnelaGraphLayout } from '@mnela/ui';
import { Circle, Grid3x3, Hexagon, Network } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ComponentType } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface LayoutSwitcherProps {
  value: MnelaGraphLayout;
  onChange: (next: MnelaGraphLayout) => void;
}

interface LayoutOption {
  id: MnelaGraphLayout;
  icon: ComponentType<{ className?: string }>;
  labelKey: 'cose' | 'coseBilkent' | 'circular' | 'grid';
}

const LAYOUTS: readonly LayoutOption[] = [
  { id: 'cose', icon: Network, labelKey: 'cose' },
  { id: 'cose-bilkent', icon: Hexagon, labelKey: 'coseBilkent' },
  { id: 'circular', icon: Circle, labelKey: 'circular' },
  { id: 'grid', icon: Grid3x3, labelKey: 'grid' },
];

export function LayoutSwitcher({ value, onChange }: LayoutSwitcherProps): JSX.Element {
  const t = useTranslations('graph.layouts');
  return (
    <div className="inline-flex items-center rounded-md border bg-background p-0.5">
      {LAYOUTS.map((opt) => {
        const Icon = opt.icon;
        const active = opt.id === value;
        return (
          <Button
            key={opt.id}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t(opt.labelKey)}
            title={t(opt.labelKey)}
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            className={cn('h-7 w-7 rounded-sm', active && 'bg-accent text-accent-foreground')}
          >
            <Icon className="h-3.5 w-3.5" />
          </Button>
        );
      })}
    </div>
  );
}
