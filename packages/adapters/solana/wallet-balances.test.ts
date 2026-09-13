import { afterEach, expect, test } from 'bun:test'
import { Keypair } from '@solana/web3.js'
import { readSolanaWalletBalances, SOLANA_DEVNET_WALLET_ASSETS } from './wallet-balances'

const servers: Array<ReturnType<typeof Bun.serve>> = []
afterEach(() => { while (servers.length) servers.pop()!.stop(true) })

test('wallet balance overview reads every SPL asset in one token-account request', async () => {
  const methods: string[] = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as { id: string; method: string }
    methods.push(body.method)
    const result = body.method === 'getBalance'
      ? { context: { slot: 1 }, value: 74_800_000 }
      : { context: { slot: 1 }, value: SOLANA_DEVNET_WALLET_ASSETS.map((asset, index) => ({
          pubkey: Keypair.generate().publicKey.toBase58(),
          account: {
            data: { program: 'spl-token', parsed: { type: 'account', info: { mint: asset.mint, tokenAmount: { amount: index ? '1800000000000000' : '2500000', decimals: asset.decimals } } }, space: 165 },
            executable: false,
            lamports: 2_039_280,
            owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            rentEpoch: 0,
            space: 165,
          },
        })) }
    return Response.json({ jsonrpc: '2.0', id: body.id, result })
  } })
  servers.push(server)

  const value = await readSolanaWalletBalances(
    `http://127.0.0.1:${server.port}`,
    Keypair.generate().publicKey.toBase58(),
    SOLANA_DEVNET_WALLET_ASSETS,
  )

  expect(value.nativeLamports).toBe(74_800_000n)
  expect(value.tokens.fUSDC).toBe(2_500_000n)
  expect(value.tokens.fSOLZ22).toBe(1_800_000_000_000_000n)
  expect(methods.sort()).toEqual(['getBalance', 'getTokenAccountsByOwner'])
})
