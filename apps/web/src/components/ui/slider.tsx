'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

// Lightweight slider built on a styled native range input. Avoids adding a
// new radix dependency for the single use site (graph confidence threshold).
// Drop-in upgrade to `@radix-ui/react-slider` later is straightforward.
export interface SliderProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'defaultValue'
> {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onValueChange?: (value: number) => void;
}

const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({ className, value, min = 0, max = 1, step = 0.05, onValueChange, onChange, ...rest }, ref) => {
    return (
      <input
        ref={ref}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          onChange?.(e);
          onValueChange?.(Number(e.target.value));
        }}
        className={cn(
          'h-2 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...rest}
      />
    );
  },
);
Slider.displayName = 'Slider';

export { Slider };
