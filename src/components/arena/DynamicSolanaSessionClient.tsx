import { isSolanaWallet, SolanaWalletConnectors } from '@dynamic-labs/solana'
import { EthereumWalletConnectors, isEthereumWallet } from '@dynamic-labs/ethereum'
import { DynamicContextProvider, mergeNetworks, useAuthenticateConnectedUser, useDynamicContext, useReinitialize, type EvmNetwork } from '@dynamic-labs/sdk-react-core'
import { Check, Copy, ExternalLink, LoaderCircle, LogOut, UserRound, WalletCards } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { getWalletSessionState } from './walletSessionState'
import type { LiveArenaWalletPort } from './liveArenaAdapter'
import type { DynamicEvmWalletPort } from './DynamicSolanaSession'
import { SomniaWalletBalances } from '../home/SomniaWalletBalances'
import { SolanaWalletBalances } from '../home/SolanaWalletBalances'
import { profileHref } from '../portfolio/profileRoute'
import { getWallets } from '@wallet-standard/app'
import type { Wallet } from '@wallet-standard/base'
import { compatibleSolanaWallets, connectStandardSolanaWallet, type DirectSolanaSession } from './walletStandardSolana'
import { PublicKey } from '@solana/web3.js'

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
  predictionApiUrl: string
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

function WalletControl({ allowEvm, predictionApiUrl, directSession, onDirectSession, solanaAddress, solanaSignerError }: Pick<Props, 'allowEvm' | 'predictionApiUrl'> & { directSession: DirectSolanaSession | null; onDirectSession: (session: DirectSolanaSession | null) => void; solanaAddress?: string; solanaSignerError?: string }) {
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

  if (directSession && (solanaSignerError || !(sessionState === 'ready' && primaryWallet))) return <div className="arena-wallet-status"><SolanaWalletBalances address={directSession.port.address} apiUrl={predictionApiUrl}/><details className="arena-wallet-menu"><summary aria-label={`${directSession.name} account ${compactAddress(directSession.port.address)}`}><i /><span>{directSession.name} · {compactAddress(directSession.port.address)}</span></summary><div><button type="button" onClick={() => void navigator.clipboard.writeText(directSession.port.address).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1_600) })}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? 'Copied' : 'Copy address'}</button><a href={`https://solscan.io/account/${directSession.port.address}?cluster=devnet`} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" /> Solscan</a><button type="button" onClick={() => void directSession.disconnect().finally(() => onDirectSession(null))}><LogOut size={14} aria-hidden="true" /> Disconnect</button></div></details></div>
  if (!sdkHasLoaded && loadTimedOut) return <div className="arena-wallet-recovery"><div><button className="arena-wallet-button" type="button" onClick={retryInitialization}><WalletCards size={15} aria-hidden="true" /> Retry login</button>{detectedWallets.slice(0, 4).map(wallet => <button className="arena-wallet-button" type="button" key={wallet.name} disabled={Boolean(directBusy)} onClick={() => void connectDirect(wallet)}><WalletCards size={15} aria-hidden="true" />{directBusy === wallet.name ? `Connecting ${wallet.name}…` : `Use ${wallet.name} directly`}</button>)}</div><span role="alert">Dynamic login was blocked. You can still connect a detected Solana wallet directly.</span>{error && <span role="alert">{error}</span>}</div>
  if (!sdkHasLoaded) return <button className="arena-wallet-button" type="button" disabled><LoaderCircle className="spin" size={15} aria-hidden="true" /> Loading login…</button>
  if (sessionState === 'needs-signature') {
    return <div><button className="arena-wallet-button" type="button" disabled={signingIn} onClick={() => void completeSignIn()}>{signingIn ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <WalletCards size={15} aria-hidden="true" />}{signingIn ? 'Confirm in wallet…' : 'Complete sign-in'}</button>{error && <span role="alert">{error}</span>}</div>
  }
  if (!primaryWallet) {
    return <button className="arena-wallet-button" type="button" onClick={() => setShowAuthFlow(true)} aria-haspopup="dialog"><WalletCards size={15} aria-hidden="true" />{showAuthFlow ? 'Sign-in open' : user ? 'Connect wallet' : 'Log in / Connect'}</button>
  }
  if (solanaSignerError && isSolanaWallet(primaryWallet)) {
    return <div className="arena-wallet-recovery"><div><button className="arena-wallet-button" type="button" onClick={() => void handleLogOut().then(() => setShowAuthFlow(true))}><WalletCards size={15} aria-hidden="true" /> Reconnect Dynamic</button>{detectedWallets.slice(0, 3).map(wallet => <button className="arena-wallet-button" type="button" key={wallet.name} disabled={Boolean(directBusy)} onClick={() => void connectDirect(wallet)}><WalletCards size={15} aria-hidden="true" />{directBusy === wallet.name ? `Connecting ${wallet.name}…` : `Use ${wallet.name} directly`}</button>)}</div><span role="alert">{solanaSignerError}</span>{error && <span role="alert">{error}</span>}</div>
  }
  const evm = allowEvm && isEthereumWallet(primaryWallet)
  const evmWallet = evm ? { address: primaryWallet.address, getWalletClient: (chainId?: string) => primaryWallet.getWalletClient(chainId) } : null
  const activeAddress = evm ? primaryWallet.address : solanaAddress ?? primaryWallet.address
  const profile = profileHref(evm ? 'somnia' : 'solana', evm ? 'testnet' : 'devnet', activeAddress)
  return <div className="arena-wallet-status">{evmWallet ? <SomniaWalletBalances compact wallet={evmWallet}/> : <SolanaWalletBalances address={activeAddress} apiUrl={predictionApiUrl}/>}<details className="arena-wallet-menu"><summary aria-label={`Dynamic account ${compactAddress(activeAddress)}`}><i /><span>Dynamic · {compactAddress(activeAddress)}</span></summary><div><a href={profile}><UserRound size={14} aria-hidden="true" /> Profile</a><button type="button" onClick={() => void navigator.clipboard.writeText(activeAddress).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1_600) })}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? 'Copied' : 'Copy address'}</button><a href={evm ? `https://shannon-explorer.somnia.network/address/${activeAddress}` : `https://solscan.io/account/${activeAddress}`} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" /> {evm ? 'Somnia explorer' : 'Solscan'}</a><button type="button" onClick={() => void handleLogOut()}><LogOut size={14} aria-hidden="true" /> Log out</button></div></details></div>
}

function DynamicSessionContent({ children, allowEvm, predictionApiUrl }: Pick<Props, 'children' | 'allowEvm' | 'predictionApiUrl'>) {
  const { primaryWallet, sdkHasLoaded, user } = useDynamicContext()
  const [directSession, setDirectSession] = useState<DirectSolanaSession | null>(null)
  const sessionState = getWalletSessionState(sdkHasLoaded, Boolean(user), Boolean(primaryWallet))
  const [syncedSolana, setSyncedSolana] = useState<{ walletId: string; address: string } | null>(null)
  const [solanaSignerError, setSolanaSignerError] = useState('')

  // Dynamic can keep rendering a cached wallet after its WAAS/auth session has
  // expired. Keep this watchdog separate from getSigner(): a connector may
  // reject, return an unusable signer, or never settle at all. In every case the
  // user must get a visible recovery path instead of a permanently disabled
  // trade button.
  useEffect(() => {
    if (sessionState !== 'ready' || !primaryWallet || !isSolanaWallet(primaryWallet) || syncedSolana?.walletId === primaryWallet.id) return
    const timeout = window.setTimeout(() => {
      setSolanaSignerError(current => current || 'Dynamic signing session is unavailable. Reconnect Dynamic or use an installed Solana wallet directly.')
    }, 5_000)
    return () => window.clearTimeout(timeout)
  }, [primaryWallet, sessionState, syncedSolana])

  useEffect(() => {
    let active = true
    setSyncedSolana(null)
    setSolanaSignerError('')
    if (sessionState !== 'ready' || !primaryWallet || !isSolanaWallet(primaryWallet)) return () => { active = false }
    void (async () => {
      try {
        // Dynamic can retain a cached address after an injected wallet changes
        // account. Resolve identity from this connector's signer before exposing
        // a trading port. Calling wallet.sync() here breaks some injected
        // Brave/Phantom connectors even though getSigner() is already available.
        const signer = await primaryWallet.getSigner()
        if (!signer.isConnected || !signer.publicKey) throw new Error('Dynamic signer is disconnected')
        const address = new PublicKey(signer.publicKey.toBytes()).toBase58()
        if (active) {
          setSyncedSolana({ walletId: primaryWallet.id, address })
          setSolanaSignerError('')
        }
      } catch (reason) {
        if (active) {
          setSyncedSolana(null)
          const message = reason instanceof Error ? reason.message : ''
          setSolanaSignerError(/401|auth token|secure token exchange/i.test(message)
            ? 'Dynamic signing session expired. Reconnect Dynamic or use an installed Solana wallet directly.'
            : 'Dynamic could not access this wallet signer. Reconnect Dynamic or use the wallet directly.')
        }
      }
    })()
    return () => { active = false }
  }, [primaryWallet, sessionState])
  const solanaAddress = primaryWallet && syncedSolana?.walletId === primaryWallet.id ? syncedSolana.address : undefined
  const dynamicWallet = useMemo<LiveArenaWalletPort | null>(() => {
    if (sessionState !== 'ready' || !primaryWallet || !isSolanaWallet(primaryWallet) || !solanaAddress) return null
    return { address: solanaAddress, getConnection: () => primaryWallet.getConnection(), getSigner: () => primaryWallet.getSigner() }
  }, [primaryWallet, sessionState, solanaAddress])
  const wallet = dynamicWallet ?? directSession?.port ?? null
  const evmWallet = useMemo<DynamicEvmWalletPort | null>(() => {
    if (!allowEvm || sessionState !== 'ready' || !primaryWallet || !isEthereumWallet(primaryWallet)) return null
    return { address: primaryWallet.address, getWalletClient: chainId => primaryWallet.getWalletClient(chainId) }
  }, [allowEvm, primaryWallet, sessionState])
  return children({ wallet, evmWallet, walletAddress: wallet?.address ?? evmWallet?.address, walletReady: Boolean(wallet ?? evmWallet), walletControl: <WalletControl allowEvm={allowEvm} predictionApiUrl={predictionApiUrl} directSession={directSession} onDirectSession={setDirectSession} solanaAddress={solanaAddress} solanaSignerError={solanaSignerError} /> })
}

export default function DynamicSolanaSessionClient({ children, environmentId, predictionApiUrl, allowEvm }: Props) {
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
      <DynamicSessionContent allowEvm={allowEvm} predictionApiUrl={predictionApiUrl}>{children}</DynamicSessionContent>
    </DynamicContextProvider>
  )
}
