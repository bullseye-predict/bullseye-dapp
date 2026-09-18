import { getWallets } from '@wallet-standard/app'
import { solanaRpcEndpoint, solanaWalletChain } from './solanaRpc'
import type { Wallet, WalletAccount } from '@wallet-standard/base'
import { StandardConnect, StandardDisconnect, type StandardConnectFeature, type StandardDisconnectFeature } from '@wallet-standard/features'
import { SolanaSignMessage, SolanaSignTransaction, type SolanaSignMessageFeature, type SolanaSignTransactionFeature } from '@solana/wallet-standard-features'
import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
import type { ISolana } from '@dynamic-labs/solana-core'
import type { LiveArenaWalletPort } from './liveArenaAdapter'

type CompatibleWallet = Wallet & StandardConnectFeature & SolanaSignTransactionFeature & SolanaSignMessageFeature

export type DirectSolanaSession = {
  name: string
  port: LiveArenaWalletPort
  disconnect(): Promise<void>
}

export function compatibleSolanaWallets(wallets: readonly Wallet[] = getWallets().get()): CompatibleWallet[] {
  return wallets.filter((wallet): wallet is CompatibleWallet =>
    wallet.chains.some(chain => chain.startsWith('solana:')) &&
    StandardConnect in wallet.features &&
    SolanaSignTransaction in wallet.features &&
    SolanaSignMessage in wallet.features,
  )
}

function solanaAccount(accounts: readonly WalletAccount[]) {
  const account = accounts.find(value => value.chains.some(chain => chain.startsWith('solana:')))
  if (!account) throw new Error('This wallet did not expose a Solana account.')
  return account
}

function unsignedBytes(transaction: Transaction | VersionedTransaction) {
  return transaction instanceof Transaction
    ? transaction.serialize({ requireAllSignatures: false, verifySignatures: false })
    : transaction.serialize()
}

/** Some injected wallets restore accounts before initializing site metadata.
 * Recover only this pre-signing error, using the exact connected wallet; never
 * select another account, retry a rejected approval, or broadcast here. */
export function withWalletMetadataRecovery(signer: ISolana, name: string, wallets = () => getWallets().get()): ISolana {
  const wrapped = Object.create(signer) as ISolana
  wrapped.signTransaction = async <T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> => {
    try { return await signer.signTransaction(transaction) }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      if (message !== 'Incorrect metadata') throw reason
      const address = (signer.publicKey ? new PublicKey(signer.publicKey.toBytes()).toBase58() : undefined)
      const wallet = wallets().find(candidate => candidate.name === name && candidate.accounts.some(account => account.address === address))
      const feature = wallet?.features[StandardConnect] as StandardConnectFeature[typeof StandardConnect] | undefined
      if (!address || !feature) throw new Error('Wallet site session expired. Reconnect this wallet on the current page before retrying.')
      const connected = await feature.connect({ silent: true })
      if (!connected.accounts.some(account => account.address === address) || (signer.publicKey ? new PublicKey(signer.publicKey.toBytes()).toBase58() : undefined) !== address)
        throw new Error('Wallet account changed. Reconnect the intended account before trading.')
      return signer.signTransaction(transaction)
    }
  }
  return wrapped
}

export async function connectStandardSolanaWallet(wallet: CompatibleWallet, rpcUrl = solanaRpcEndpoint()): Promise<DirectSolanaSession> {
  const connect = wallet.features[StandardConnect] as StandardConnectFeature[typeof StandardConnect]
  const connected = await connect.connect()
  const account = solanaAccount(connected.accounts.length ? connected.accounts : wallet.accounts)
  const owner = new PublicKey(account.publicKey)
  if (owner.toBase58() !== account.address) throw new Error('Wallet account address does not match its public key.')
  const signer = {
    isConnected: true,
    publicKey: owner,
    async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
      const feature = wallet.features[SolanaSignTransaction] as SolanaSignTransactionFeature[typeof SolanaSignTransaction]
      const [result] = await feature.signTransaction({ account, transaction: unsignedBytes(transaction), chain: solanaWalletChain(rpcUrl) })
      if (!result) throw new Error('The wallet did not return a signed transaction.')
      return (transaction instanceof Transaction ? Transaction.from(result.signedTransaction) : VersionedTransaction.deserialize(result.signedTransaction)) as T
    },
    async signMessage(message: Uint8Array) {
      const feature = wallet.features[SolanaSignMessage] as SolanaSignMessageFeature[typeof SolanaSignMessage]
      const [result] = await feature.signMessage({ account, message })
      if (!result) throw new Error('The wallet did not return a message signature.')
      return { signature: result.signature }
    },
  } as unknown as ISolana
  return {
    name: wallet.name,
    port: { address: account.address, getConnection: async () => new Connection(rpcUrl, 'confirmed'), getSigner: async () => withWalletMetadataRecovery(signer, wallet.name) },
    async disconnect() {
      signer.isConnected = false
      const feature = wallet.features[StandardDisconnect] as StandardDisconnectFeature[typeof StandardDisconnect] | undefined
      await feature?.disconnect()
    },
  }
}
