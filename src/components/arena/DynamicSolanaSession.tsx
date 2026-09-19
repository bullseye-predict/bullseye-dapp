import { getAuthToken } from '@dynamic-labs/sdk-react-core'
import { WalletCards } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { setSession } from '../session/store'
import DynamicSolanaSessionClient from './DynamicSolanaSessionClient'
import DynamicWaasSolanaSessionClient from './DynamicWaasSolanaSessionClient'
import { predictionDynamicClient } from './dynamicModularClient'
import type { LiveArenaWalletPort } from './liveArenaAdapter'
import type { WalletClient } from 'viem'

export type DynamicEvmWalletPort = {
  address: string
  getWalletClient(chainId?: string): Promise<WalletClient>
}

export type DynamicSolanaSessionValue = {
  wallet: LiveArenaWalletPort | null
  evmWallet: DynamicEvmWalletPort | null
  walletAddress?: string
  walletReady: boolean
  walletControl: ReactNode
}

type Props = {
  environmentId: string
  predictionApiUrl?: string
  colacatMint?: string
  /** Enables the optional Somnia/EVM wallet flow. Solana is always available. */
  allowEvm?: boolean
  children: (session: DynamicSolanaSessionValue) => ReactNode
}

/** Publishes the session to the store on the way through, so every consumer
 *  below reads the wallets from one place instead of being handed them down a
 *  chain of components that do not use them. The render prop is untouched:
 *  walletControl is a ReactNode slot and stays a prop. */
/**
 * READING THE TOKEN MUST NOT THROW, because callers read it during render, and
 * it must read the SDK this build actually mounted.
 *
 * `getAuthToken` comes from `@dynamic-labs/sdk-react-core` - the legacy SDK -
 * and it raises `ClientNotFoundError: No Dynamic client has been created yet`
 * whenever that SDK has no client. In the Solana-only build there never is one:
 * `allowEvm` is false, so this file mounts DynamicWaasSolanaSessionClient, which
 * is the modular `@dynamic-labs-sdk/client` and creates ITS client in
 * dynamicModularClient.ts. The two SDKs do not share a registry.
 *
 * So the accessor published below used to throw for every consumer the moment a
 * wallet connected. PromptComposer.tsx:100 calls `authToken?.()` inside its
 * render, which turned that throw into an unmounted React tree and a blank
 * page - first seen on /colacat, which mounts the composer immediately instead
 * of waiting on market data the way the home console does.
 *
 * `undefined` is already this store's documented value for "nobody is signed
 * in" (see SessionState.authToken).
 *
 * SWALLOWING THE THROW WAS ONLY HALF THE FIX. A Solana viewer who had signed in
 * still published no token, because the token they hold belongs to the modular
 * client. Every relay call that needs a bearer - a paid directive above all -
 * was therefore refused as "not signed in" while the profile menu showed the
 * wallet connected. So each build now reads its own SDK: the modular client's
 * `token` for the WaaS path, `getAuthToken()` for the legacy mixed-chain one.
 *
 * The reader is memoised per environment because `setSession` compares this
 * accessor by identity; a fresh closure on every render would loop the store.
 */
const readers = new Map<string, () => string | undefined>()
function authTokenReader(environmentId: string, modular: boolean) {
  const key = `${modular ? 'modular' : 'legacy'}:${environmentId}`
  const existing = readers.get(key)
  if (existing) return existing
  const reader = modular
    ? () => {
        try {
          return predictionDynamicClient(environmentId).token ?? undefined
        } catch {
          return undefined
        }
      }
    : () => {
        try {
          return getAuthToken()
        } catch {
          return undefined
        }
      }
  readers.set(key, reader)
  return reader
}

function PublishSession({ session, authToken, children }: { session: DynamicSolanaSessionValue; authToken: () => string | undefined; children: (session: DynamicSolanaSessionValue) => ReactNode }) {
  const { wallet, evmWallet, walletAddress, walletReady } = session
  useEffect(() => {
    // The reader is a module-level constant, so the store's identity comparison
    // stays quiet while consumers still get a token that is current at the
    // moment they ask for it.
    setSession({ solanaWallet: wallet, evmWallet, walletAddress, walletReady, authToken })
  }, [wallet, evmWallet, walletAddress, walletReady, authToken])
  return <>{children(session)}</>
}

export function DynamicSolanaSession({ children, environmentId, predictionApiUrl = '', colacatMint, allowEvm = false }: Props) {
  const authToken = authTokenReader(environmentId, !allowEvm)
  const publish = (session: DynamicSolanaSessionValue) => <PublishSession session={session} authToken={authToken}>{children}</PublishSession>
  if (!environmentId) {
    return publish({
      wallet: null,
      evmWallet: null,
      walletReady: false,
      walletControl: <button className="arena-wallet-button" type="button" disabled><WalletCards size={15} aria-hidden="true" /> Dynamic setup required</button>,
    })
  }

  // The Solana-only prediction build uses the same modular Dynamic/WaaS
  // lifecycle as zero-engine. Keep the legacy mixed-chain client only for the
  // existing Somnia build until its EVM environment is moved to the modular
  // client; this prevents the Solana fix from regressing DreamDEX.
  if (!allowEvm) return <DynamicWaasSolanaSessionClient environmentId={environmentId} predictionApiUrl={predictionApiUrl} colacatMint={colacatMint}>{publish}</DynamicWaasSolanaSessionClient>
  return <DynamicSolanaSessionClient environmentId={environmentId} predictionApiUrl={predictionApiUrl} colacatMint={colacatMint} allowEvm>{publish}</DynamicSolanaSessionClient>
}
