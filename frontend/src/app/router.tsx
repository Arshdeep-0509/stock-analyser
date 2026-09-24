import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from './AppShell'
// Direct, not via the pages barrel: the barrel also re-exports IntradayPage, which would pull it back into the startup chunk.
import { RsiHaPage } from '../pages/RsiHaPage'

/** /intraday loads on first visit: its analytics and panels stay out of the startup bundle (Layer 9 bundle budget). */
const IntradayPage = lazy(() => import('../pages/IntradayPage').then((m) => ({ default: m.IntradayPage })))

function RouteLoading() {
  return <div className="p-4 text-xs text-text-secondary" role="status">Loading…</div>
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/rsi-ha" replace /> },
      { path: 'rsi-ha', element: <RsiHaPage /> },
      {
        path: 'intraday',
        element: (
          <Suspense fallback={<RouteLoading />}>
            <IntradayPage />
          </Suspense>
        ),
      },
      // Anything else falls back to the default page rather than a "coming soon" stub.
      { path: '*', element: <Navigate to="/rsi-ha" replace /> },
    ],
  },
])
