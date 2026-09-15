import { lazy, Suspense, type ReactNode } from 'react'
import { activeForPath, chromeHandlers, useChrome } from '../session/chrome'
import { SiteHeader } from './SiteHeader'

const DynamicSolanaSession = lazy(async () => {
  // Import the shim before the wallet dependency graph. Static ESM imports
  // evaluate every dependency before SiteChrome's old shim side effect, which
  // made a fresh page crash with `Buffer is not defined`.
  await import('../../../packages/adapters/solana/manifest/runtime')
  return import('../arena/DynamicSolanaSession').then((module) => ({
    default: module.DynamicSolanaSession,
  }))
})

type Props = {
  environmentId: string
  apiUrl?: string
  /** Enables the optional Somnia/EVM wallet flow, as the market sources allow. */
  allowEvm?: boolean
}

/**
 * The site chrome, mounted once in SiteLayout and persisted across navigation.
 *
 * This is the only place the wallet session is created. It used to be created
 * by every page island, so each navigation tore down the Dynamic client and
 * remounted SolanaWalletBalances, which blanks its value and makes two network
 * round trips before it can show a number again. Persisted, none of that
 * restarts: the session and the balance outlive the page under them.
 *
 * Everything below reads the wallets from the session store rather than from a
 * render prop, because those consumers are now in a different island entirely.
 */
export function SiteChrome({ environmentId, apiUrl, allowEvm }: Props) {
  const { active, marketsHref, skipTo, skipLabel } = useChrome()
  const lit = active ?? activeForPath(typeof location === 'undefined' ? '/' : location.pathname)
  const header = (walletControl: ReactNode) => <SiteHeader
    homeHref="/"
    marketsHref={marketsHref}
    active={lit}
    walletControl={walletControl}
    onArena={() => chromeHandlers().onArena?.()}
    onMarkets={() => chromeHandlers().onMarkets?.()}
  />
  return <>
    {/* Ahead of the header so it is still the first thing a keyboard reaches,
        which it would not be if the page island owned it. */}
    {skipTo && <a className="sh-skip-link" href={skipTo}>{skipLabel ?? 'Skip to content'}</a>}
    <Suspense fallback={header(<button className="arena-wallet-button" type="button" disabled>Wallet loading</button>)}>
      <DynamicSolanaSession environmentId={environmentId} predictionApiUrl={apiUrl} allowEvm={allowEvm}>
        {(session) => header(session.walletControl)}
      </DynamicSolanaSession>
    </Suspense>
  </>
}
