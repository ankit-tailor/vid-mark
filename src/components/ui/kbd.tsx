import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A key cap.
 *
 * Manrope carries none of the modifier glyphs — ⌘, ⇧, ↵ are all outside its
 * subsets — so they render from a system fallback. Set loose in a sentence that
 * reads as the font breaking mid-word; inside a cap it reads as a key, which is
 * what it is. Any modifier symbol in the UI belongs in one of these.
 */
function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex items-center rounded border border-border bg-muted',
        'px-1 py-px font-sans text-[10px] leading-4 text-muted-foreground',
        className
      )}
      {...props}
    />
  );
}

/** Mac shows symbols, everyone else shows words. */
export const SHORTCUT_KEYS = navigator.userAgent.includes('Mac')
  ? ['⌘', '⇧', 'K']
  : ['Ctrl', 'Shift', 'K'];

export { Kbd };
