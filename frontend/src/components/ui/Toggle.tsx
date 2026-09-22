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
    // A real <label>, not just a wrapper: clicking the caption text toggles
    // the switch too, not only the small track itself.
    <label className={cn('inline-flex items-center gap-2 text-sm text-text-secondary', !disabled && 'cursor-pointer', disabled && 'opacity-40', className)}>
      {/*
        The button is the 40x40 (below md) tap target; the track/thumb
        inside it stays visually small at every width — enlarging the whole
        button would turn a pill-shaped switch into an oversized square.
      */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label ? undefined : ariaLabel}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative flex h-10 w-10 shrink-0 items-center justify-center md:h-5 md:w-9"
      >
        <span className={cn('relative h-5 w-9 rounded-full border border-border transition-colors', checked ? 'bg-neutral' : 'bg-panel')}>
          <span
            className={cn(
              'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-text-primary transition-transform',
              checked ? 'translate-x-4' : 'translate-x-0.5',
            )}
          />
        </span>
      </button>
      {label}
    </label>
  )
}
