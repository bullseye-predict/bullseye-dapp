import { isSolanaWallet, SolanaWalletConnectors } from '@dynamic-labs/solana'
import { EthereumWalletConnectors, isEthereumWallet } from '@dynamic-labs/ethereum'
import { DynamicContextProvider, useAuthenticateConnectedUser, useDynamicContext } from '@dynamic-labs/sdk-react-core'
import { Check, Copy, ExternalLink, LoaderCircle, LogOut, WalletCards } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { getWalletSessionState } from './walletSessionState'
import type { LiveArenaWalletPort } from './liveArenaAdapter'
import type { DynamicEvmWalletPort } from './DynamicSolanaSession'

type SessionValue = {
  wallet: LiveArenaWalletPort | null
  evmWallet: DynamicEvmWalletPort | null
  walletAddress?: string
  walletReady: boolean
  walletControl: ReactNode
}

type Props = {
  children: (session: SessionValue) => ReactNode
  environmentId: string
}

function compactAddress(address: string) {
  return address.length > 11 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address
}

function WalletControl() {
  const { primaryWallet, sdkHasLoaded, setShowAuthFlow, handleLogOut, showAuthFlow, user } = useDynamicContext()
  const [copied, setCopied] = useState(false)
  const { authenticateUser } = useAuthenticateConnectedUser()
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sessionState = getWalletSessionState(sdkHasLoaded, Boolean(user), Boolean(primaryWallet))

  async function completeSignIn() {
    setSigningIn(true)
    setError(null)
    try {
      await authenticateUser()
    } catch {
      setError('Sign-in did not finish. Unlock your wallet and try again.')
    } finally {
      setSigningIn(false)
    }
  }

  if (!sdkHasLoaded) return <button className="arena-wallet-button" type="button" disabled><LoaderCircle className="spin" size={15} aria-hidden="true" /> Loading login…</button>
  if (sessionState === 'needs-signature') {
    return <div><button className="arena-wallet-button" type="button" disabled={signingIn} onClick={() => void completeSignIn()}>{signingIn ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <WalletCards size={15} aria-hidden="true" />}{signingIn ? 'Confirm in wallet…' : 'Complete sign-in'}</button>{error && <span role="alert">{error}</span>}</div>
  }
  if (!primaryWallet) {
    return <button className="arena-wallet-button" type="button" onClick={() => setShowAuthFlow(true)} aria-haspopup="dialog"><WalletCards size={15} aria-hidden="true" />{showAuthFlow ? 'Sign-in open' : user ? 'Connect wallet' : 'Log in / Connect'}</button>
  }
  const evm = isEthereumWallet(primaryWallet)
  return <details className="arena-wallet-menu"><summary aria-label={`Dynamic account ${compactAddress(primaryWallet.address)}`}><i /><span>Dynamic · {compactAddress(primaryWallet.address)}</span></summary><div><button type="button" onClick={() => void navigator.clipboard.writeText(primaryWallet.address).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1_600) })}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? 'Copied' : 'Copy address'}</button><a href={evm ? `https://shannon-explorer.somnia.network/address/${primaryWallet.address}` : `https://solscan.io/account/${primaryWallet.address}`} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" /> {evm ? 'Somnia explorer' : 'Solscan'}</a><button type="button" onClick={() => void handleLogOut()}><LogOut size={14} aria-hidden="true" /> Log out</button></div></details>
}

function DynamicSessionContent({ children }: Pick<Props, 'children'>) {
  const { primaryWallet, sdkHasLoaded, user } = useDynamicContext()
  const sessionState = getWalletSessionState(sdkHasLoaded, Boolean(user), Boolean(primaryWallet))
  const wallet = useMemo<LiveArenaWalletPort | null>(() => {
    if (sessionState !== 'ready' || !primaryWallet || !isSolanaWallet(primaryWallet)) return null
    return { address: primaryWallet.address, getConnection: () => primaryWallet.getConnection(), getSigner: () => primaryWallet.getSigner() }
  }, [primaryWallet, sessionState])
  const evmWallet = useMemo<DynamicEvmWalletPort | null>(() => {
    if (sessionState !== 'ready' || !primaryWallet || !isEthereumWallet(primaryWallet)) return null
    return { address: primaryWallet.address, getWalletClient: chainId => primaryWallet.getWalletClient(chainId) }
  }, [primaryWallet, sessionState])
  return children({ wallet, evmWallet, walletAddress: wallet?.address, walletReady: sessionState === 'ready' && Boolean(wallet), walletControl: <WalletControl /> })
}

export default function DynamicSolanaSessionClient({ children, environmentId }: Props) {
  return (
    <DynamicContextProvider settings={{
      environmentId,
      walletConnectors: [SolanaWalletConnectors, EthereumWalletConnectors],
      // Predictions need an authenticated wallet owner, so Dynamic requests a chain-native sign-in proof instead of stopping at a silent connection.
      initialAuthenticationMode: 'connect-and-sign',
      appName: 'SOLZ / ODDS',
      shadowDOMEnabled: true,
    }}>
      <DynamicSessionContent>{children}</DynamicSessionContent>
    </DynamicContextProvider>
  )
}
