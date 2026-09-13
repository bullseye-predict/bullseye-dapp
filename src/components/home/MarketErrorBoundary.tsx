import { Component, type ErrorInfo, type ReactNode } from 'react'
import { pushAlert } from './alerts/store'

/** A venue adapter, an RPC outage or a malformed binding must degrade the panel
 *  it belongs to, never blank the application. Without this, one throw inside a
 *  market panel unmounted the whole tree and the page rendered empty. */
export class MarketErrorBoundary extends Component<{ children: ReactNode; label?: string }, { message: string | null }> {
  state = { message: null as string | null }
  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : 'Market data failed to render.' }
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    pushAlert({
      level: 'error',
      title: `${this.props.label ?? 'Market'} failed to render`,
      detail: error instanceof Error ? error.message : String(error),
    })
    // Keep the component stack in the console for diagnosis; the user gets the alert.
    console.error('[market-error-boundary]', error, info.componentStack)
  }
  render() {
    if (this.state.message === null) return this.props.children
    return (
      <div className="ch-market-empty" role="alert">
        <strong>This market panel could not load.</strong>
        <span>{this.state.message}</span>
      </div>
    )
  }
}
