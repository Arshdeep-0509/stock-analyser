import { RouterProvider } from 'react-router-dom'
import { MarketDataProvider } from '../data/MarketDataSource'
import { dataSource } from './dataSource'
import { router } from './router'

export function AppProviders() {
  return (
    <MarketDataProvider value={dataSource}>
      <RouterProvider router={router} />
    </MarketDataProvider>
  )
}
