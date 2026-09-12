import { isSolanaWallet, SolanaWalletConnectors } from '@dynamic-labs/solana'
import { EthereumWalletConnectors, isEthereumWallet } from '@dynamic-labs/ethereum'
import { DynamicContextProvider, mergeNetworks, useAuthenticateConnectedUser, useDynamicContext, useReinitialize, type EvmNetwork } from '@dynamic-labs/sdk-react-core'
import { Check, Copy, ExternalLink, LoaderCircle, LogOut, UserRound, WalletCards } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { getWalletSessionState } from './walletSessionState'
import type { LiveArenaWalletPort } from './liveArenaAdapter'
import type { DynamicEvmWalletPort } from './DynamicSolanaSession'
import { SomniaWalletBalances } from '../home/SomniaWalletBalances'
import { profileHref } from '../portfolio/profileRoute'
import { getWallets } from '@wallet-standard/app'
import type { Wallet } from '@wallet-standard/base'
import { compatibleSolanaWallets, connectStandardSolanaWallet, type DirectSolanaSession } from './walletStandardSolana'

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
  allowEvm: boolean
}

// Somnia is not yet available in Dynamic's dashboard network catalogue. Keep it
// in code so Dynamic can ask injected wallets to add/switch to the actual
// DreamDEX testnet instead of falling back to the dashboard's Ethereum network.
const somniaTestnet: EvmNetwork = {
  blockExplorerUrls: ['https://shannon-explorer.somnia.network/'],
  chainId: 50312,
  iconUrls: [],
  isTestnet: true,
  name: 'Somnia Testnet',
  nativeCurrency: { decimals: 18, name: 'Somnia Test Token', symbol: 'STT' },
  networkId: 50312,
  rpcUrls: ['https://dream-rpc.somnia.network'],
  vanityName: 'Somnia Testnet',
}

const DYNAMIC_LOAD_TIMEOUT_MS = 10_000

function compactAddress(address: string) {
  return address.length > 11 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address
}

function WalletControl({ allowEvm, directSession, onDirectSession }: Pick<Props, 'allowEvm'> & { directSession: DirectSolanaSession | null; onDirectSession: (session: DirectSolanaSession | null) => void }) {
  const { primaryWallet, sdkHasLoaded, setShowAuthFlow, handleLogOut, showAuthFlow, user } = useDynamicContext()
  const reinitialize = useReinitialize()
  const [copied, setCopied] = useState(false)
  const { authenticateUser } = useAuthenticateConnectedUser()
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadTimedOut, setLoadTimedOut] = useState(false)
  const [detectedWallets, setDetectedWallets] = useState<Wallet[]>([])
  const [directBusy, setDirectBusy] = useState('')
  const sessionState = getWalletSessionState(sdkHasLoaded, Boolean(user), Boolean(primaryWallet))

  useEffect(() => {
    if (sdkHasLoaded) {
      setLoadTimedOut(false)
      return
    }
    setLoadTimedOut(false)
    const timeout = window.setTimeout(() => setLoadTimedOut(true), DYNAMIC_LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(timeout)
  }, [loadAttempt, sdkHasLoaded])

  useEffect(() => {
    const registry = getWallets()
    const refresh = () => setDetectedWallets([...compatibleSolanaWallets(registry.get())])
    refresh()
    const offRegister = registry.on('register', refresh)
    const offUnregister = registry.on('unregister', refresh)
    return () => { offRegister(); offUnregister() }
  }, [])

  function retryInitialization() {
    setLoadAttempt(attempt => attempt + 1)
    reinitialize()
  }

  async function connectDirect(wallet: Wallet) {
    setDirectBusy(wallet.name)
    setError(null)
    try {
      onDirectSession(await connectStandardSolanaWallet(wallet as ReturnType<typeof compatibleSolanaWallets>[number]))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${wallet.name} did not connect.`)
    } finally {
      setDirectBusy('')
    }
  }

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

  if (directSession && !(sessionState === 'ready' && primaryWallet)) return <div className="arena-wallet-status"><details className="arena-wallet-menu"><summary aria-label={`${directSession.name} account ${compactAddress(directSession.port.address)}`}><i /><span>{directSession.name} · {compactAddress(directSession.port.address)}</span></summary><div><button type="button" onClick={() => void navigator.clipboard.writeText(directSession.port.address).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1_600) })}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? 'Copied' : 'Copy address'}</button><a href={`https://solscan.io/account/${directSession.port.address}?cluster=devnet`} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" /> Solscan</a><button type="button" onClick={() => void directSession.disconnect().finally(() => onDirectSession(null))}><LogOut size={14} aria-hidden="true" /> Disconnect</button></div></details></div>
  if (!sdkHasLoaded && loadTimedOut) return <div className="arena-wallet-recovery"><div><button className="arena-wallet-button" type="button" onClick={retryInitialization}><WalletCards size={15} aria-hidden="true" /> Retry login</button>{detectedWallets.slice(0, 4).map(wallet => <button className="arena-wallet-button" type="button" key={wallet.name} disabled={Boolean(directBusy)} onClick={() => void connectDirect(wallet)}><WalletCards size={15} aria-hidden="true" />{directBusy === wallet.name ? `Connecting ${wallet.name}…` : `Use ${wallet.name} directly`}</button>)}</div><span role="alert">Dynamic login was blocked. You can still connect a detected Solana wallet directly.</span>{error && <span role="alert">{error}</span>}</div>
  if (!sdkHasLoaded) return <button className="arena-wallet-button" type="button" disabled><LoaderCircle className="spin" size={15} aria-hidden="true" /> Loading login…</button>
  if (sessionState === 'needs-signature') {
    return <div><button className="arena-wallet-button" type="button" disabled={signingIn} onClick={() => void completeSignIn()}>{signingIn ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <WalletCards size={15} aria-hidden="true" />}{signingIn ? 'Confirm in wallet…' : 'Complete sign-in'}</button>{error && <span role="alert">{error}</span>}</div>
  }
  if (!primaryWallet) {
    return <button className="arena-wallet-button" type="button" onClick={() => setShowAuthFlow(true)} aria-haspopup="dialog"><WalletCards size={15} aria-hidden="true" />{showAuthFlow ? 'Sign-in open' : user ? 'Connect wallet' : 'Log in / Connect'}</button>
  }
  const evm = allowEvm && isEthereumWallet(primaryWallet)
  const evmWallet = evm ? { address: primaryWallet.address, getWalletClient: (chainId?: string) => primaryWallet.getWalletClient(chainId) } : null
  const profile = profileHref(evm ? 'somnia' : 'solana', evm ? 'testnet' : 'devnet', primaryWallet.address)
  return <div className="arena-wallet-status">{evmWallet && <SomniaWalletBalances compact wallet={evmWallet}/>}<details className="arena-wallet-menu"><summary aria-label={`Dynamic account ${compactAddress(primaryWallet.address)}`}><i /><span>Dynamic · {compactAddress(primaryWallet.address)}</span></summary><div><a href={profile}><UserRound size={14} aria-hidden="true" /> Profile</a><button type="button" onClick={() => void navigator.clipboard.writeText(primaryWallet.address).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1_600) })}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? 'Copied' : 'Copy address'}</button><a href={evm ? `https://shannon-explorer.somnia.network/address/${primaryWallet.address}` : `https://solscan.io/account/${primaryWallet.address}`} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" /> {evm ? 'Somnia explorer' : 'Solscan'}</a><button type="button" onClick={() => void handleLogOut()}><LogOut size={14} aria-hidden="true" /> Log out</button></div></details></div>
}

function DynamicSessionContent({ children, allowEvm }: Pick<Props, 'children' | 'allowEvm'>) {
  const { primaryWallet, sdkHasLoaded, user } = useDynamicContext()
  const [directSession, setDirectSession] = useState<DirectSolanaSession | null>(null)
  const sessionState = getWalletSessionState(sdkHasLoaded, Boolean(user), Boolean(primaryWallet))
  const dynamicWallet = useMemo<LiveArenaWalletPort | null>(() => {
    if (sessionState !== 'ready' || !primaryWallet || !isSolanaWallet(primaryWallet)) return null
    return { address: primaryWallet.address, getConnection: () => primaryWallet.getConnection(), getSigner: () => primaryWallet.getSigner() }
  }, [primaryWallet, sessionState])
  const wallet = dynamicWallet ?? directSession?.port ?? null
  const evmWallet = useMemo<DynamicEvmWalletPort | null>(() => {
    if (!allowEvm || sessionState !== 'ready' || !primaryWallet || !isEthereumWallet(primaryWallet)) return null
    return { address: primaryWallet.address, getWalletClient: chainId => primaryWallet.getWalletClient(chainId) }
  }, [allowEvm, primaryWallet, sessionState])
  return children({ wallet, evmWallet, walletAddress: wallet?.address ?? evmWallet?.address, walletReady: Boolean(wallet ?? evmWallet), walletControl: <WalletControl allowEvm={allowEvm} directSession={directSession} onDirectSession={setDirectSession} /> })
}

export default function DynamicSolanaSessionClient({ children, environmentId, allowEvm }: Props) {
  return (
    <DynamicContextProvider settings={{
      environmentId,
      walletConnectors: allowEvm ? [SolanaWalletConnectors, EthereumWalletConnectors] : [SolanaWalletConnectors],
      ...(allowEvm ? { overrides: {
        // Preserve dashboard-enabled networks while adding Somnia Testnet.
        evmNetworks: dashboardNetworks => mergeNetworks([somniaTestnet], dashboardNetworks),
      } } : {}),
      // Predictions need an authenticated wallet owner, so Dynamic requests a chain-native sign-in proof instead of stopping at a silent connection.
      initialAuthenticationMode: 'connect-and-sign',
      appName: 'SOLZ / ODDS',
      shadowDOMEnabled: true,
    }}>
      <DynamicSessionContent allowEvm={allowEvm}>{children}</DynamicSessionContent>
    </DynamicContextProvider>
  )
}
