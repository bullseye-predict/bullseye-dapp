import { Component, lazy, Suspense, type ReactNode } from 'react'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
const Terminal = lazy(async () => {
  await import('../../../packages/adapters/solana/manifest/runtime')
  return { default: (await import('./ManifestTerminal')).ManifestTerminal }
})
export function ManifestTerminal(props: { venue: PublicPredictionVenue; apiUrl: string }) {
  return <ManifestBoundary><Suspense fallback={<p role="status" className="pt-empty">Loading Solana trading…</p>}><Terminal {...props}/></Suspense></ManifestBoundary>
}

class ManifestBoundary extends Component<{children:ReactNode},{error:string}> {
  state = {error:''}
  static getDerivedStateFromError(error: Error) { return {error:error.message} }
  render() { return this.state.error ? <div className="pt-empty" role="alert"><h3>Solana trading unavailable</h3><p>{this.state.error}</p><p>Check the deployment configuration and reload this page.</p></div> : this.props.children }
}
