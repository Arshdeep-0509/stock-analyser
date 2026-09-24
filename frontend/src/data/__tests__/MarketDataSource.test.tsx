import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { NoopDataSource } from '../../test-utils/fixtures'
import { MarketDataProvider, useMarketData } from '../MarketDataSource'
import { allowConsoleError } from '../../../vitest.setup'

describe('useMarketData', () => {
  it('returns the provided source', () => {
    const source = new NoopDataSource()
    const wrapper = ({ children }: { children: ReactNode }) => <MarketDataProvider value={source}>{children}</MarketDataProvider>
    expect(renderHook(() => useMarketData(), { wrapper }).result.current).toBe(source)
  })

  it('throws a clear error outside a provider', () => {
    allowConsoleError(/useMarketData\(\) must be used within a MarketDataProvider|The above error occurred/)
    expect(() => renderHook(() => useMarketData())).toThrow('useMarketData() must be used within a MarketDataProvider')
  })
})
