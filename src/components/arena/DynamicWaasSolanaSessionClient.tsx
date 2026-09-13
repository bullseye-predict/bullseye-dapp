import { getWalletProviderRegistry, type BaseWalletAccount } from '@dynamic-labs-sdk/client/core'
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
import { base58 } from '@scure/base'
import { Check, Copy, ExternalLink, LoaderCircle, LogOut, WalletCards } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
import type { ISolana } from '@dynamic-labs/solana-core'
import type { LiveArenaWalletPort } from './liveArenaAdapter'
import { SolanaWalletBalances } from '../home/SolanaWalletBalances'
import { profileHref } from '../portfolio/profileRoute'
import {
  ensureSolanaWaasAccount,
  hasDynamicAuthentication,
  initializePredictionDynamicClient,
  predictionDynamicClient,
  signDynamicMessage,
  signInWithTelegram,
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

function compactAddress(address: string) {
  return address.length > 11 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address
}

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
  const installedSolana = providers.filter(provider => provider.chain === 'SOL').slice(0, 4)
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
      getConnection: async () => new Connection('https://api.devnet.solana.com', 'confirmed'),
      getSigner: async () => signer,
    }
  }, [client, selectedWallet])

  async function finishLogin(action: () => Promise<unknown>) {
    setError('')
    try {
      await action()
      await ensureSolanaWaasAccount(client)
      setLoginOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Dynamic login did not finish.')
    }
  }

  const walletControl = selectedWallet ? (
    <div className="arena-wallet-status">
      <SolanaWalletBalances address={selectedWallet.address} apiUrl={predictionApiUrl}/>
      <details className="arena-wallet-menu">
        <summary aria-label={`${selectedProviderName} account ${compactAddress(selectedWallet.address)}`}><i /><span>{selectedProviderName} · {compactAddress(selectedWallet.address)}</span></summary>
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
                <span><b>{name}</b><small>{compactAddress(account.address)}</small></span>
              </button>
            })}
            <p>Orders, positions, and payouts use the selected wallet.</p>
          </div>}
          <a href={profileHref('solana', 'devnet', selectedWallet.address)}>Profile</a>
          <button type="button" onClick={() => void navigator.clipboard.writeText(selectedWallet.address).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1_600) })}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? 'Copied' : 'Copy address'}</button>
          <a href={`https://solscan.io/account/${selectedWallet.address}?cluster=devnet`} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" /> Solscan</a>
          <button type="button" disabled={logoutPending} onClick={() => void logout().then(() => queryClient.clear())}><LogOut size={14} aria-hidden="true" /> Log out</button>
        </div>
      </details>
    </div>
  ) : initStatus === 'in-progress' || initStatus === 'uninitialized' ? (
    <button className="arena-wallet-button" type="button" disabled><LoaderCircle className="spin" size={15} aria-hidden="true" /> Loading login…</button>
  ) : (
    <div className="arena-wallet-recovery">
      <button className="arena-wallet-button" type="button" disabled={busy} onClick={() => setLoginOpen(value => !value)}><WalletCards size={15} aria-hidden="true" />{setupPending ? 'Preparing Dynamic wallet…' : authenticated ? 'Restore Dynamic wallet' : 'Log in / Connect'}</button>
      {loginOpen && <div className="arena-wallet-login-options" role="group" aria-label="Dynamic login options">
        <button type="button" disabled={busy} onClick={() => void finishLogin(() => socialLogin({ provider: 'google' }))}>Continue with Google</button>
        <button type="button" disabled={busy} onClick={() => void finishLogin(() => signInWithTelegram(client))}>Continue with Telegram</button>
        {installedSolana.map(provider => <button type="button" key={provider.key} disabled={busy} onClick={() => void finishLogin(() => connectWallet({ walletProviderKey: provider.key }))}>Connect {provider.metadata.displayName}</button>)}
      </div>}
      {(error || initStatus === 'failed') && <span role="alert">{error || initError?.message || 'Dynamic account restoration failed.'}</span>}
    </div>
  )

  return children({ wallet, evmWallet: null, walletAddress: wallet?.address, walletReady: Boolean(wallet), walletControl })
}

export default function DynamicWaasSolanaSessionClient({ children, environmentId, predictionApiUrl }: Props) {
  const client = useMemo(() => predictionDynamicClient(environmentId), [environmentId])
  useEffect(() => { void initializePredictionDynamicClient(client) }, [client])
  return <QueryClientProvider client={queryClient}><DynamicProvider client={client}><ModularSession client={client} environmentId={environmentId} predictionApiUrl={predictionApiUrl}>{children}</ModularSession></DynamicProvider></QueryClientProvider>
}
