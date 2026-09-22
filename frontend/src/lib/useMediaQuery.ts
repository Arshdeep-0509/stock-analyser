import { useEffect, useState } from 'react'

/**
 * For the cases CSS breakpoints alone can't solve — where two structurally
 * different component trees must be mounted (a virtualized table vs. a
 * virtualized card list), not just restyled. Everything else should use
 * Tailwind's sm:/md:/lg:/xl:/2xl: prefixes directly instead of this hook.
 *
 * Pass a full media query string, e.g. `useMediaQuery('(min-width: 900px)')`.
 * Some structural swaps (the signals table) intentionally use a threshold
 * that doesn't match any single named breakpoint — that's fine, this hook
 * takes any query, not just the six named ones.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(query).matches))

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
