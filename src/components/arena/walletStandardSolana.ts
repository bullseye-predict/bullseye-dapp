import { getWallets } from '@wallet-standard/app'
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

export async function connectStandardSolanaWallet(wallet: CompatibleWallet, rpcUrl = 'https://api.devnet.solana.com/'): Promise<DirectSolanaSession> {
  const connected = await wallet.features[StandardConnect].connect()
  const account = solanaAccount(connected.accounts.length ? connected.accounts : wallet.accounts)
  const owner = new PublicKey(account.publicKey)
  if (owner.toBase58() !== account.address) throw new Error('Wallet account address does not match its public key.')
  const signer = {
    isConnected: true,
    publicKey: owner,
    async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
      const [result] = await wallet.features[SolanaSignTransaction].signTransaction({ account, transaction: unsignedBytes(transaction), chain: 'solana:devnet' })
      if (!result) throw new Error('The wallet did not return a signed transaction.')
      return (transaction instanceof Transaction ? Transaction.from(result.signedTransaction) : VersionedTransaction.deserialize(result.signedTransaction)) as T
    },
    async signMessage(message: Uint8Array) {
      const [result] = await wallet.features[SolanaSignMessage].signMessage({ account, message })
      if (!result) throw new Error('The wallet did not return a message signature.')
      return { signature: result.signature }
    },
  } as unknown as ISolana
  return {
    name: wallet.name,
    port: { address: account.address, getConnection: async () => new Connection(rpcUrl, 'confirmed'), getSigner: async () => signer },
    async disconnect() {
      signer.isConnected = false
      const feature = wallet.features[StandardDisconnect] as StandardDisconnectFeature[typeof StandardDisconnect] | undefined
      await feature?.disconnect()
    },
  }
}
