import { create } from 'zustand'
import type { DynamicEvmWalletPort } from '../arena/DynamicSolanaSession'
import type { LiveArenaWalletPort } from '../arena/liveArenaAdapter'

/** The connected wallets, published once by the Dynamic provider and read
 *  wherever they are needed.
 *
 *  They used to be threaded from the provider's render prop through HomeApp,
 *  Home and InteractionConsole — neither of the two middle components touching
 *  them — before reaching the trade ticket that actually signs with them.
 *
 *  walletControl deliberately stays a prop: it is a rendered ReactNode, a slot
 *  the site header fills, not state. Putting an element built fresh on every
 *  render into a store buys nothing and costs a re-render loop. */
export type SessionState = {
  solanaWallet: LiveArenaWalletPort | null
  evmWallet: DynamicEvmWalletPort | null
  walletAddress?: string
  walletReady: boolean
  /** Reads the signed-in viewer's bearer token for the SOLZ control plane. It
   *  is an accessor, not a value: the token rotates while the page is open, and
   *  a copy taken at publish time would be stale by the time a directive is
   *  paid for. `undefined` means nobody is signed in. */
  authToken?: () => string | undefined
}

const useSessionStore = create<SessionState>(() => ({ solanaWallet: null, evmWallet: null, walletReady: false }))

/** Called on every provider render, so it must not notify unless something
 *  actually moved; the wallet ports are compared by identity because a fresh
 *  port carries a fresh signer even at the same address. */
export function setSession(next: SessionState) {
  const current = useSessionStore.getState()
  if (
    current.solanaWallet === next.solanaWallet &&
    current.evmWallet === next.evmWallet &&
    current.walletAddress === next.walletAddress &&
    current.walletReady === next.walletReady &&
    current.authToken === next.authToken
  ) return
  useSessionStore.setState(next, true)
}

export const useSolanaWallet = () => useSessionStore(state => state.solanaWallet)
export const useEvmWallet = () => useSessionStore(state => state.evmWallet)
export const useWalletReady = () => useSessionStore(state => state.walletReady)
export const useWalletAddress = () => useSessionStore(state => state.walletAddress)
export const useAuthToken = () => useSessionStore(state => state.authToken)
export const getSession = () => useSessionStore.getState()
