import { useEffect } from 'react'

/**
 * Closes an open dialog/drawer/sheet on Escape and locks background scroll
 * while it's open — every hand-rolled overlay in the app wires this the same
 * way, so a swipe over the backdrop on mobile can never scroll the page
 * behind a full-screen drawer.
 */
export function useEscapeToClose(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])
}
