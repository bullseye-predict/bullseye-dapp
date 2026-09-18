import { getWalletProviderRegistry, type BaseWalletAccount } from '@dynamic-labs-sdk/client/core'
import { solanaNetworkFromRpcEndpoint, solanaRpcEndpoint, solscanAccountUrl } from './solanaRpc'
import {
  useConnectAndVerifyWithWalletProvider,
  useGetAvailableWalletProvidersData,
  useGetWalletAccounts,
  useInitStatus,
  useLogout,
  useSignInWithSocialPopUp,
  useUser,
  DynamicProvider,
} from '@dynamic-labs-sdk/react-hooks'
import { isSolanaWalletAccount, signTransaction } from '@dynamic-labs-sdk/solana'
import type { SolanaWalletAccount } from '@dynamic-labs-sdk/solana'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TraderIdentity } from '../identity/TraderIdentity'
import { shortAddress } from '../identity/profile'
import { base58 } from '@scure/base'
import { Check, Copy, ExternalLink, LoaderCircle, LogOut, WalletCards } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
import type { ISolana } from '@dynamic-labs/solana-core'
import type { LiveArenaWalletPort } from './liveArenaAdapter'
import { SolanaWalletBalances } from '../home/SolanaWalletBalances'
import { LoginDialog } from '../auth/LoginDialog'
import { profileHref } from '../portfolio/profileRoute'
import {
  ensureSolanaWaasAccount,
  hasDynamicAuthentication,
  initializePredictionDynamicClient,
  predictionDynamicClient,
  signDynamicMessage,
  withDynamicAuthRecovery,
} from './dynamicModularClient'

type SessionValue = {
  wallet: LiveArenaWalletPort | null
  evmWallet: null
  walletAddress?: string
  walletReady: boolean
  walletControl: ReactNode
}

type Props = {
  children: (session: SessionValue) => ReactNode
  environmentId: string
  predictionApiUrl: string
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } })

/** The login screen names the cluster it is about to sign against. The endpoint
 *  is the only thing in the browser that knows which one that is, and it throws
 *  when unconfigured — which is a readout, not a reason to fail the screen. */
function clusterLabel() {
  try {
    const host = new URL(solanaRpcEndpoint()).hostname
    if (/devnet/i.test(host)) return 'devnet'
    if (/testnet/i.test(host)) return 'testnet'
    if (/localhost|127\.0\.0\.1/.test(host)) return 'localnet'
    return 'mainnet'
  } catch {
    return 'unset'
  }
}

/** The app's one truncation. The chip shows a resolved handle where there is
 *  one — see WalletName below — and this for every wallet that has none. */
const compactAddress = (address: string) => shortAddress(address)

function decodeSignature(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  try {
    const binary = window.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
    const decoded = Uint8Array.from(binary, character => character.charCodeAt(0))
    if (decoded.length === 64) return decoded
  } catch {
    // Try Solana's ordinary base58 representation below.
  }
  const decoded = base58.decode(value)
  if (decoded.length === 64) return decoded
  throw new Error('Dynamic returned an unsupported Solana signature encoding.')
}

function isEmbeddedAccount(client: ReturnType<typeof predictionDynamicClient>, account: BaseWalletAccount) {
  const credential = client.user?.verifiedCredentials.find(candidate => candidate.id === account.verifiedCredentialId)
  const provider = getWalletProviderRegistry(client).getByKey(account.walletProviderKey)
  return Boolean(credential?.embeddedWalletId) || provider?.walletProviderType === 'embeddedWallet'
}

function ModularSession({ children, client, environmentId, predictionApiUrl }: Pick<Props, 'children' | 'environmentId' | 'predictionApiUrl'> & { client: ReturnType<typeof predictionDynamicClient> }) {
  const { data: initStatus, error: initError } = useInitStatus()
  const { data: user } = useUser()
  const { data: accounts = [] } = useGetWalletAccounts()
  const { data: providers = [] } = useGetAvailableWalletProvidersData()
  const { mutateAsync: socialLogin, isPending: socialPending } = useSignInWithSocialPopUp()
  const { mutateAsync: connectWallet, isPending: walletPending } = useConnectAndVerifyWithWalletProvider()
  const { mutateAsync: logout, isPending: logoutPending } = useLogout()
  const [copied, setCopied] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [setupPending, setSetupPending] = useState(false)
  const walletPreferenceKey = `solz-prediction:selected-solana-wallet:${environmentId}`
  const [selectedWalletAddress, setSelectedWalletAddress] = useState(() => window.localStorage.getItem(walletPreferenceKey) ?? '')
  const authenticated = hasDynamicAuthentication(client)
  const verifiedIds = useMemo(() => new Set(user?.verifiedCredentials.map(value => value.id) ?? []), [user])
  const solanaAccounts = useMemo(() => accounts
    .filter(account => account.chain === 'SOL')
    .map(account => account as SolanaWalletAccount)
    .filter(account => Boolean(account.verifiedCredentialId) && verifiedIds.has(account.verifiedCredentialId!)), [accounts, verifiedIds])
  const embeddedWallet = solanaAccounts.find(account => isEmbeddedAccount(client, account)) ?? null
  const externalWallets = solanaAccounts.filter(account => !isEmbeddedAccount(client, account))
  // Match zero-engine: an attached external wallet is the default economic
  // identity. The user can explicitly select the embedded WaaS executor.
  const selectedWallet = solanaAccounts.find(account => account.address === selectedWalletAddress)
    ?? externalWallets[0]
    ?? embeddedWallet
  const selectedWalletIsEmbedded = selectedWallet ? isEmbeddedAccount(client, selectedWallet) : false
  const selectedProvider = selectedWallet ? getWalletProviderRegistry(client).getByKey(selectedWallet.walletProviderKey) : null
  const selectedProviderName = selectedWalletIsEmbedded
    ? 'Dynamic WaaS'
    : selectedProvider?.metadata.displayName || 'Main Wallet'
  const walletChoices = [...externalWallets, ...(embeddedWallet ? [embeddedWallet] : [])]
  const installedSolana = useMemo(() => providers
    .filter(provider => provider.chain === 'SOL')
    .map(provider => ({ key: provider.key, name: provider.metadata.displayName, iconUrl: provider.metadata.icon })), [providers])
  const busy = socialPending || walletPending || setupPending || logoutPending

  function selectWallet(account: SolanaWalletAccount) {
    setSelectedWalletAddress(account.address)
    window.localStorage.setItem(walletPreferenceKey, account.address)
  }

  useEffect(() => {
    if (initStatus !== 'finished' || !user || !authenticated || embeddedWallet) return
    let active = true
    setSetupPending(true)
    setError('')
    void ensureSolanaWaasAccount(client)
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'Dynamic wallet setup did not finish.')
      })
      .finally(() => { if (active) setSetupPending(false) })
    return () => { active = false }
  }, [authenticated, client, embeddedWallet, initStatus, user])

  const wallet = useMemo<LiveArenaWalletPort | null>(() => {
    if (!selectedWallet) return null
    const owner = new PublicKey(selectedWallet.address)
    const signer = {
      isConnected: true,
      publicKey: owner,
      async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
        const { signedTransaction } = await withDynamicAuthRecovery(client, () =>
          signTransaction({ transaction, walletAccount: selectedWallet }, client),
        )
        return signedTransaction as T
      },
      async signMessage(message: Uint8Array) {
        const { signature } = await signDynamicMessage(client, selectedWallet, message)
        return { signature: decodeSignature(signature) }
      },
    } as unknown as ISolana
    return {
      address: selectedWallet.address,
      getConnection: async () => new Connection(solanaRpcEndpoint(), 'confirmed'),
      getSigner: async () => signer,
    }
  }, [client, selectedWallet])

  async function finishLogin(label: string, action: () => Promise<unknown>) {
    if (busy) return
    setError('')
    setPending(label)
    try {
      await action()
      await ensureSolanaWaasAccount(client)
      setLoginOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Dynamic login did not finish.')
    } finally {
      setPending('')
    }
  }

  const walletControl = selectedWallet ? (
    <div className="arena-wallet-status">
      <SolanaWalletBalances address={selectedWallet.address} apiUrl={predictionApiUrl}/>
      <details className="arena-wallet-menu">
        <summary aria-label={`${selectedProviderName} account ${compactAddress(selectedWallet.address)}`}><i /><span>{selectedProviderName} · <TraderIdentity address={selectedWallet.address} avatar={false}/></span></summary>
        <div>
          {walletChoices.length > 1 && <div className="arena-wallet-account-switcher" role="group" aria-label="Transaction wallet">
            <small>TRANSACTION WALLET</small>
            {walletChoices.map(account => {
              const accountIsEmbedded = isEmbeddedAccount(client, account)
              const provider = getWalletProviderRegistry(client).getByKey(account.walletProviderKey)
              const name = accountIsEmbedded ? 'Dynamic WaaS' : provider?.metadata.displayName || 'Main Wallet'
              const active = account.address === selectedWallet.address
              return <button type="button" key={account.address} aria-pressed={active} onClick={() => selectWallet(account)}>
                {active ? <Check size={14} aria-hidden="true" /> : <WalletCards size={14} aria-hidden="true" />}
                <span><b>{name}</b><small><TraderIdentity address={account.address} avatar={false}/></small></span>
              </button>
            })}
            <p>Orders, positions, and payouts use the selected wallet.</p>
          </div>}
          <a href={profileHref('solana', solanaNetworkFromRpcEndpoint(), selectedWallet.address)}>Profile</a>
          <button type="button" onClick={() => void navigator.clipboard.writeText(selectedWallet.address).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1_600) })}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? 'Copied' : 'Copy address'}</button>
          <a href={solscanAccountUrl(selectedWallet.address)} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" /> Solscan</a>
          <button type="button" disabled={logoutPending} onClick={() => void logout().then(() => queryClient.clear())}><LogOut size={14} aria-hidden="true" /> Log out</button>
        </div>
      </details>
    </div>
  ) : initStatus === 'in-progress' || initStatus === 'uninitialized' ? (
    <button className="arena-wallet-button" type="button" disabled><LoaderCircle className="spin" size={15} aria-hidden="true" /> Loading login…</button>
  ) : (
    <div className="arena-wallet-recovery">
      <button className="arena-wallet-button" type="button" disabled={busy} aria-haspopup="dialog" onClick={() => setLoginOpen(true)}><WalletCards size={15} aria-hidden="true" />{setupPending ? 'Preparing Dynamic wallet…' : authenticated ? 'Restore Dynamic wallet' : 'Log in / Connect'}</button>
      <LoginDialog
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        initStatus={initStatus}
        initError={initError?.message}
        installed={installedSolana}
        busy={busy}
        pending={pending}
        error={error}
        setupPending={setupPending}
        network={clusterLabel()}
        onGoogle={() => void finishLogin('Google', () => socialLogin({ provider: 'google' }))}
        onX={() => void finishLogin('X', () => socialLogin({ provider: 'twitter' }))}
        onWallet={(walletProviderKey, name) => void finishLogin(name, () => connectWallet({ walletProviderKey }))}
      />
      {/* The screen carries its own failure signal while it is open. */}
      {!loginOpen && (error || initStatus === 'failed') && <span role="alert">{error || initError?.message || 'Dynamic account restoration failed.'}</span>}
    </div>
  )

  return children({ wallet, evmWallet: null, walletAddress: wallet?.address, walletReady: Boolean(wallet), walletControl })
}

export default function DynamicWaasSolanaSessionClient({ children, environmentId, predictionApiUrl }: Props) {
  const client = useMemo(() => predictionDynamicClient(environmentId), [environmentId])
  useEffect(() => { void initializePredictionDynamicClient(client) }, [client])
  return <QueryClientProvider client={queryClient}><DynamicProvider client={client}><ModularSession client={client} environmentId={environmentId} predictionApiUrl={predictionApiUrl}>{children}</ModularSession></DynamicProvider></QueryClientProvider>
}
