import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RsiHaPage } from '../pages'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/rsi-ha" replace /> },
      { path: 'rsi-ha', element: <RsiHaPage /> },
      // No other routes exist yet — anything else falls back to the one real page rather than a "coming soon" stub.
      { path: '*', element: <Navigate to="/rsi-ha" replace /> },
    ],
  },
])
