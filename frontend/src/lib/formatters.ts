const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const numberFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const istTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  // hourCycle, not hour12: false — for en-IN, hour12: false resolves to the
  // h24 cycle and renders midnight as "24:05:00".
  hourCycle: 'h23',
})

const istDateFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

export function formatINR(value: number): string {
  return inrFormatter.format(value)
}

export function formatNumber(value: number, decimals = 2): string {
  if (decimals === 2) return numberFormatter.format(value)
  return value.toFixed(decimals)
}

export function formatISTTime(date: Date): string {
  return istTimeFormatter.format(date)
}

export function formatISTDate(date: Date): string {
  return istDateFormatter.format(date)
}
