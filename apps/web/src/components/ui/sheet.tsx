'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
} from 'react';

import { cn } from '@/lib/utils';

/**
 * Side-anchored drawer built on Radix Dialog. The shadcn `Sheet` component
 * is a published recipe with the same API surface; we re-derive it here
 * to avoid adding a new dependency just for this primitive — Radix
 * Dialog is already in the bundle. Mobile sidebar uses `side="left"`;
 * future uses can pick right/top/bottom.
 */
const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;
const SheetPortal = DialogPrimitive.Portal;

const SheetOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = 'SheetOverlay';

type Side = 'left' | 'right' | 'top' | 'bottom';

interface SheetContentProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: Side;
  hideClose?: boolean;
}

function sideClasses(side: Side): string {
  switch (side) {
    case 'right':
      return 'inset-y-0 right-0 h-full w-80 max-w-[85vw] border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right';
    case 'top':
      return 'inset-x-0 top-0 h-auto w-full border-b data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top';
    case 'bottom':
      return 'inset-x-0 bottom-0 h-auto w-full border-t data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom';
    case 'left':
    default:
      return 'inset-y-0 left-0 h-full w-72 max-w-[85vw] border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left';
  }
}

const SheetContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, SheetContentProps>(
  ({ className, children, side = 'left', hideClose = false, ...props }, ref) => (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed z-50 flex flex-col bg-background shadow-lg transition ease-in-out data-[state=closed]:duration-200 data-[state=open]:duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out',
          sideClasses(side),
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close className="absolute right-3 top-3 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </SheetPortal>
  ),
);
SheetContent.displayName = 'SheetContent';

function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn('flex flex-col gap-1 border-b border-border/60 px-4 py-3', className)}
      {...props}
    />
  );
}

const SheetTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-sm font-semibold tracking-tight', className)}
    {...props}
  />
));
SheetTitle.displayName = 'SheetTitle';

const SheetDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-xs text-muted-foreground', className)}
    {...props}
  />
));
SheetDescription.displayName = 'SheetDescription';

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetPortal,
  SheetOverlay,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
};
