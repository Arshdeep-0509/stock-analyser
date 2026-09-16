import { forwardRef, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/cn'

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ className, children, ...props }, ref) => {
  return (
    <span className="relative inline-flex">
      <select
        ref={ref}
        className={cn(
          'h-8 appearance-none rounded border border-border bg-panel pl-2.5 pr-7 text-sm text-text-primary outline-none focus:border-neutral',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-secondary" />
    </span>
  )
})

Select.displayName = 'Select'
