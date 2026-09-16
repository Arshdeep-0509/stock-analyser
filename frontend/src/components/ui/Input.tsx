import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export type InputProps = InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn(
        'h-8 rounded border border-border bg-panel px-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-neutral',
        className,
      )}
      {...props}
    />
  )
})

Input.displayName = 'Input'
