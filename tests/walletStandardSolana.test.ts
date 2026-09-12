import { describe, expect, test } from 'bun:test'
import { Keypair, SystemProgram, Transaction } from '@solana/web3.js'
import { StandardConnect } from '@wallet-standard/features'
import { SolanaSignMessage, SolanaSignTransaction } from '@solana/wallet-standard-features'
import { compatibleSolanaWallets, connectStandardSolanaWallet } from '../src/components/arena/walletStandardSolana'

describe('Wallet Standard Solana fallback', () => {
  test('connects and preserves the transaction message while adding the wallet signature', async () => {
    const owner = Keypair.generate()
    const account = { address: owner.publicKey.toBase58(), publicKey: owner.publicKey.toBytes(), chains: ['solana:devnet'], features: [SolanaSignTransaction, SolanaSignMessage] }
    const wallet = {
      version: '1.0.0', name: 'Test Wallet', icon: 'data:image/png;base64,' as const, chains: ['solana:devnet'], accounts: [account],
      features: {
        [StandardConnect]: { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
        [SolanaSignTransaction]: { version: '1.0.0', supportedTransactionVersions: ['legacy'], signTransaction: async (...inputs: readonly { transaction: Uint8Array }[]) => inputs.map(input => { const transaction = Transaction.from(input.transaction); transaction.partialSign(owner); return { signedTransaction: transaction.serialize() } }) },
        [SolanaSignMessage]: { version: '1.0.0', signMessage: async (...inputs: readonly { message: Uint8Array }[]) => inputs.map(input => ({ signedMessage: input.message, signature: new Uint8Array(64) })) },
      },
    }
    expect(compatibleSolanaWallets([wallet as never])).toHaveLength(1)
    const session = await connectStandardSolanaWallet(wallet as never)
    const signer = await session.port.getSigner()
    const transaction = new Transaction({ feePayer: owner.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }))
    const expected = transaction.serializeMessage()
    const signed = await signer.signTransaction(transaction)
    expect(signed.serializeMessage()).toEqual(expected)
    expect(signed.signatures[0]?.signature).not.toBeNull()
  })
})
