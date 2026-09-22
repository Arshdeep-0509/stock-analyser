import { cn } from '../../lib/cn'

export interface RangeSliderProps {
  min: number
  max: number
  valueMin: number
  valueMax: number
  onChange: (min: number, max: number) => void
  className?: string
}

// 44px thumb (and matching track height, so it stays centered/tappable)
// below md, shrinking to the tighter mouse-appropriate size at md+.
const thumbClass =
  'pointer-events-none absolute inset-0 h-11 w-full appearance-none bg-transparent md:h-5 ' +
  '[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-11 [&::-webkit-slider-thumb]:w-11 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-neutral [&::-webkit-slider-thumb]:bg-text-primary md:[&::-webkit-slider-thumb]:h-3.5 md:[&::-webkit-slider-thumb]:w-3.5'

/** A dual-thumb range slider built from two overlapping native range inputs — no dependency, keyboard-accessible for free. */
export function RangeSlider({ min, max, valueMin, valueMax, onChange, className }: RangeSliderProps) {
  return (
    <div className={cn('relative h-11 w-full md:h-5', className)}>
      <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-border" />
      <div
        className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-neutral"
        style={{
          left: `${((valueMin - min) / (max - min)) * 100}%`,
          right: `${100 - ((valueMax - min) / (max - min)) * 100}%`,
        }}
      />
      <input
        type="range"
        min={min}
        max={max}
        value={valueMin}
        onChange={(e) => onChange(Math.min(Number(e.target.value), valueMax), valueMax)}
        className={thumbClass}
        aria-label="Minimum RSI"
      />
      <input
        type="range"
        min={min}
        max={max}
        value={valueMax}
        onChange={(e) => onChange(valueMin, Math.max(Number(e.target.value), valueMin))}
        className={thumbClass}
        aria-label="Maximum RSI"
      />
    </div>
  )
}
