import { expect, test } from 'bun:test'
import type { WalletClient } from 'viem'
import { dynamicEvmProvider } from './dynamicEvmProvider'

test('DreamDEX transport uses the Dynamic wallet and forwards contract requests', async () => {
  const address = `0x${'12'.repeat(20)}` as const
  const calls: unknown[] = []
  let requestedChain: string | undefined
  const provider = await dynamicEvmProvider({ address, async getWalletClient(chain) {
    requestedChain = chain
    return { getAddresses: async () => [address], request: async (args: unknown) => { calls.push(args); return '0xabc' } } as unknown as WalletClient
  } }, '50312')
  expect(requestedChain).toBe('50312')
  expect<unknown>(await provider.request({ method: 'eth_requestAccounts' })).toEqual([address])
  expect(calls).toEqual([])
  expect<unknown>(await provider.request({ method: 'eth_chainId' })).toBe('0xabc')
  expect(calls).toEqual([{ method: 'eth_chainId' }])
})

test('rejects a stale Dynamic account before connecting DreamDEX', async () => {
  const source = { address: `0x${'12'.repeat(20)}`, getWalletClient: async () => ({ getAddresses: async () => [`0x${'34'.repeat(20)}`] }) as unknown as WalletClient }
  await expect(dynamicEvmProvider(source, '50312')).rejects.toThrow('Dynamic wallet changed')
})
