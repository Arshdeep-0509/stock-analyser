import { useEffect, useState } from 'react'

// Mirrors tailwind.config.ts's `desktop` breakpoint — keep the two in sync by hand.
const QUERY = '(min-width: 900px)'

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => (typeof window === 'undefined' ? true : window.matchMedia(QUERY).matches))

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const onChange = () => setIsDesktop(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isDesktop
}
