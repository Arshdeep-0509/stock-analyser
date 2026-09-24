import { createContext, useContext, type ReactNode } from 'react'

export type Density = 'comfortable' | 'compact'

const DensityContext = createContext<Density>('comfortable')

export function DensityProvider({ density, children }: { density: Density; children: ReactNode }) {
  return <DensityContext.Provider value={density}>{children}</DensityContext.Provider>
}

/** Read by TopStrengthTable/SectorGrid to shrink row height and padding — the two densest, most row-heavy areas of the page. Defaults to 'comfortable' for any consumer rendered outside the provider (e.g. a unit test mounting a table in isolation). */
export function useDensity(): Density {
  return useContext(DensityContext)
}
