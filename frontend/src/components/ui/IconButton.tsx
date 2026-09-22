import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement>

/**
 * An icon-only button sized to a 40x40 minimum tap target below `md` (a
 * bigger clickable box via padding, not a bigger icon — the icon inside
 * keeps whatever size its own className/props give it), shrinking to a
 * tighter mouse-appropriate box at `md` and up. Every icon-only control in
 * the app (drawer close buttons, the top bar's theme/settings toggles, row
 * action icons, ...) should use this instead of a bare `<button>`, so the
 * tap-target rule only has to be satisfied once, here.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(({ className, type = 'button', ...props }, ref) => {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded text-text-secondary transition-colors hover:bg-surface hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 md:h-7 md:w-7',
        className,
      )}
      {...props}
    />
  )
})

IconButton.displayName = 'IconButton'
