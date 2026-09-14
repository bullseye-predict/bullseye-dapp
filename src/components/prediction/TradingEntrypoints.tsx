import { lazy, Suspense, type ComponentProps } from 'react'
import '../../styles/global.css'
import '../../styles/home.css'
import '../../styles/site-loading.css'
import { AppShell } from '../solz/AppShell'
const Home = lazy(async () => { await import('../../../packages/adapters/solana/manifest/runtime'); return { default: (await import('../home/HomeApp')).HomeApp } })
const Event = lazy(async () => { await import('../../../packages/adapters/solana/manifest/runtime'); return { default: (await import('../events/EventApp')).EventApp } })
const Prediction = lazy(async () => { await import('../../../packages/adapters/solana/manifest/runtime'); return { default: (await import('./PredictionApp')).PredictionApp } })
const loading = <AppShell className="solz-home cc-loading-shell" active="highlight" walletControl={null}><main><p className="cc-loading-state" role="status"><i aria-hidden="true"/>Loading arena…</p></main></AppShell>
// The market directory reads the Solana question catalogue, so it needs the same
// Buffer/process shim the other trading entrypoints load before their component.
const Markets = lazy(async () => { await import('../../../packages/adapters/solana/manifest/runtime'); return { default: (await import('../markets/MarketsDirectoryApp')).MarketsDirectoryApp } })
export function MarketsDirectoryApp(props: ComponentProps<typeof Markets>) { return <Suspense fallback={loading}><Markets {...props}/></Suspense> }
const Portfolio = lazy(async () => { await import('../../../packages/adapters/solana/manifest/runtime'); return { default: (await import('../portfolio/PortfolioApp')).PortfolioApp } })
export function PortfolioApp(props: ComponentProps<typeof Portfolio>) { return <Suspense fallback={loading}><Portfolio {...props}/></Suspense> }
export function HomeApp(props: ComponentProps<typeof Home>) { return <Suspense fallback={loading}><Home {...props}/></Suspense> }
// No fallback: the event page renders a server-side skeleton that stays on
// screen until this chunk resolves and the app replaces it.
export function EventApp(props: ComponentProps<typeof Event>) { return <Suspense fallback={null}><Event {...props}/></Suspense> }
export function PredictionApp(props: ComponentProps<typeof Prediction>) { return <Suspense fallback={loading}><Prediction {...props}/></Suspense> }
