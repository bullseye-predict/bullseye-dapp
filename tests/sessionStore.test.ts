import { expect, test } from 'bun:test'
import type { DynamicEvmWalletPort } from '../src/components/arena/DynamicSolanaSession'
import type { LiveArenaWalletPort } from '../src/components/arena/liveArenaAdapter'

async function load() {
  return await import(`../src/components/session/store?${Math.random()}`) as typeof import('../src/components/session/store')
}

const solana = { address: 'So1ana' } as unknown as LiveArenaWalletPort
const evm = { address: '0xabc' } as unknown as DynamicEvmWalletPort

test('the wallets are published for any consumer, which is the point of not drilling them', async () => {
  const { setSession, getSession } = await load()
  setSession({ solanaWallet: solana, evmWallet: evm, walletAddress: 'So1ana', walletReady: true })
  expect(getSession().solanaWallet).toBe(solana)
  expect(getSession().evmWallet).toBe(evm)
  expect(getSession().walletReady).toBe(true)
})

test('an unchanged session notifies nobody, because the provider republishes on every render', async () => {
  const { setSession, getSession } = await load()
  const session = { solanaWallet: solana, evmWallet: evm, walletAddress: 'So1ana', walletReady: true }
  setSession(session)
  const first = getSession()
  setSession({ ...session })
  // Same values, so the stored state must be the very same object: a new one
  // here would re-render every consumer on every provider render.
  expect(getSession()).toBe(first)
})

test('a reconnected wallet is published even at the same address, because the signer is new', async () => {
  const { setSession, getSession } = await load()
  setSession({ solanaWallet: solana, evmWallet: null, walletAddress: 'So1ana', walletReady: true })
  const reconnected = { address: 'So1ana' } as unknown as LiveArenaWalletPort
  setSession({ solanaWallet: reconnected, evmWallet: null, walletAddress: 'So1ana', walletReady: true })
  expect(getSession().solanaWallet).toBe(reconnected)
})

test('disconnecting clears the wallets rather than leaving the last one readable', async () => {
  const { setSession, getSession } = await load()
  setSession({ solanaWallet: solana, evmWallet: evm, walletAddress: 'So1ana', walletReady: true })
  setSession({ solanaWallet: null, evmWallet: null, walletReady: false })
  expect(getSession().solanaWallet).toBeNull()
  expect(getSession().evmWallet).toBeNull()
  expect(getSession().walletAddress).toBeUndefined()
})
