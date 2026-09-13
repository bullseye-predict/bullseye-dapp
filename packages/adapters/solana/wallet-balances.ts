import { address, createSolanaRpc } from '@solana/kit'

const SPL_TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

export type SolanaWalletAsset = {
  symbol: string
  mint: string
  decimals: number
}

export type SolanaWalletBalances = {
  nativeLamports: bigint
  tokens: Record<string, bigint>
}

export const SOLANA_DEVNET_WALLET_ASSETS = [
  {
    symbol: 'fUSDC',
    mint: '6TTTa6dXV7CojyrSwX1TZkwMqHKbtN9ezmgSdVgKr3UP',
    decimals: 6,
  },
  {
    symbol: 'fSOLZ22',
    mint: '4N7d177zYPmGZeEhvsUaV9u8KCEPaW64L4YBtMf4ZTNf',
    decimals: 9,
  },
] as const satisfies readonly SolanaWalletAsset[]

function tokenAmount(value: unknown, expectedDecimals: number): bigint {
  if (!value || typeof value !== 'object') return 0n
  const account = (value as { account?: unknown }).account
  if (!account || typeof account !== 'object') return 0n
  const data = (account as { data?: unknown }).data
  if (!data || typeof data !== 'object') return 0n
  const parsed = (data as { parsed?: unknown }).parsed
  if (!parsed || typeof parsed !== 'object') return 0n
  const info = (parsed as { info?: unknown }).info
  if (!info || typeof info !== 'object') return 0n
  const amount = (info as { tokenAmount?: unknown }).tokenAmount
  if (!amount || typeof amount !== 'object') return 0n
  const atomic = (amount as { amount?: unknown }).amount
  const decimals = (amount as { decimals?: unknown }).decimals
  return typeof atomic === 'string' && /^\d+$/.test(atomic) && decimals === expectedDecimals
    ? BigInt(atomic)
    : 0n
}

function tokenMint(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const account = (value as { account?: unknown }).account
  if (!account || typeof account !== 'object') return ''
  const data = (account as { data?: unknown }).data
  if (!data || typeof data !== 'object') return ''
  const parsed = (data as { parsed?: unknown }).parsed
  if (!parsed || typeof parsed !== 'object') return ''
  const info = (parsed as { info?: unknown }).info
  if (!info || typeof info !== 'object') return ''
  const mint = (info as { mint?: unknown }).mint
  return typeof mint === 'string' ? mint : ''
}

/** Read-only Kit RPC adapter. It never asks the wallet to sign. */
export async function readSolanaWalletBalances(
  rpcUrl: string,
  owner: string,
  assets: readonly SolanaWalletAsset[],
): Promise<SolanaWalletBalances> {
  const rpc = createSolanaRpc(rpcUrl)
  const wallet = address(owner)
  const [native, tokenAccounts] = await Promise.all([
    rpc.getBalance(wallet, { commitment: 'confirmed' }).send(),
    rpc
      .getTokenAccountsByOwner(
        wallet,
        { programId: SPL_TOKEN_PROGRAM },
        { commitment: 'confirmed', encoding: 'jsonParsed' },
      )
      .send(),
  ])
  return {
    nativeLamports: native.value,
    tokens: Object.fromEntries(
      assets.map((asset) => [
        asset.symbol,
        tokenAccounts.value.reduce(
          (sum, account) => tokenMint(account) === asset.mint ? sum + tokenAmount(account, asset.decimals) : sum,
          0n,
        ),
      ]),
    ),
  }
}
