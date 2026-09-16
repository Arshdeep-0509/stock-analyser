import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertOctagon, Clipboard } from 'lucide-react'
import { Button } from './Button'

export interface PanelErrorBoundaryProps {
  /** Shown in the crash message ("Something went wrong in the <panelName> panel") and in the copied diagnostics. */
  panelName: string
  children: ReactNode
  /** Extra context (e.g. the mock's current seed) merged into the copied diagnostics — evaluated only at crash time. */
  diagnostics?: () => Record<string, string | number>
}

interface PanelErrorBoundaryState {
  error: Error | null
  info: ErrorInfo | null
}

/**
 * One boundary per independent panel (the table, the chart, each drawer) so
 * a bug in one — say, a bad candle series blowing up the chart — never
 * blanks the whole screener. React error boundaries must be classes; there
 * is no hooks equivalent.
 */
export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  state: PanelErrorBoundaryState = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<PanelErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, info })
  }

  private reset = (): void => {
    this.setState({ error: null, info: null })
  }

  private copyDiagnostics = (): void => {
    const { error, info } = this.state
    const extra = this.props.diagnostics?.() ?? {}
    const lines = [
      `Panel: ${this.props.panelName}`,
      `Time: ${new Date().toISOString()}`,
      ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
      `Error: ${error?.message ?? 'unknown'}`,
      '',
      'Stack:',
      error?.stack ?? '(no stack)',
      '',
      'Component stack:',
      info?.componentStack ?? '(no component stack)',
    ]
    void navigator.clipboard.writeText(lines.join('\n'))
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div role="alert" className="flex flex-col items-center gap-3 p-8 text-center">
        <AlertOctagon className="h-6 w-6 text-warning" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-text-primary">Something went wrong in the {this.props.panelName} panel</p>
          <p className="mt-1 text-xs text-text-secondary">
            This is a prototype-only crash in one panel — the rest of the app is unaffected. Try again, or copy diagnostics to report it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={this.reset}>
            Try again
          </Button>
          <Button size="sm" variant="ghost" onClick={this.copyDiagnostics}>
            <Clipboard className="h-3.5 w-3.5" /> Copy diagnostics
          </Button>
        </div>
      </div>
    )
  }
}
