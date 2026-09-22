// Shared by SignalDetail (its loading/empty placeholders) and SignalChart
// (the actual lightweight-charts container, which auto-sizes to whatever
// height this class gives it) — a standalone module rather than living in
// either file, since those two already import from each other.
// 330px on desktop; on phones min(58dvh, 300px), but never below 200px.
export const CHART_HEIGHT_CLASS = 'h-[max(200px,min(58dvh,300px))] sm:h-[330px]'
