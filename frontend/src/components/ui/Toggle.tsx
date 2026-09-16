import { cn } from '../../lib/cn'

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
  className?: string
  /** Accessible name when there's no visible `label` (e.g. a switch next to its own separately-styled caption). */
  'aria-label'?: string
}

export function Toggle({ checked, onChange, label, disabled, className, 'aria-label': ariaLabel }: ToggleProps) {
  return (
    <label className={cn('inline-flex items-center gap-2 text-sm text-text-secondary', disabled && 'opacity-40', className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label ? undefined : ariaLabel}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 rounded-full border border-border transition-colors disabled:cursor-not-allowed',
          checked ? 'bg-neutral' : 'bg-panel',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-text-primary transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </button>
      {label}
    </label>
  )
}
