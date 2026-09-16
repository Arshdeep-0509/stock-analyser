import { useScreenerStore } from '../app/screenerStore'
import { SignalsTable } from '../features/rsi-ha/SignalsTable'

export function RsiHaPage() {
  return (
    <div className="h-full">
      <SignalsTable store={useScreenerStore} />
    </div>
  )
}
