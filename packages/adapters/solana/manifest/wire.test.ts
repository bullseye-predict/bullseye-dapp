import { expect, test } from 'bun:test'
import { Keypair } from '@solana/web3.js'
import { vaultAddress } from '../wire'
import { claimManifestAgentSeat, manifestAgentIoc, manifestAgentTraderAddress, moveManifestAgentInventory, takerFee, type ManifestBinding } from './wire'

test('taker fees round upward on actual notional without floating point loss', () => {
  expect(takerFee(0n, 30)).toBe(0n)
  expect(takerFee(1n, 30)).toBe(1n)
  expect(takerFee(5_000_000n, 30)).toBe(15_000n)
  expect(takerFee(490_000n, 30)).toBe(1_470n)
  expect(takerFee(9_007_199_254_740_993n, 30)).toBe(27_021_597_764_223n)
  expect(() => takerFee(-1n, 30)).toThrow()
  expect(() => takerFee(1n, 0)).toThrow()
  expect(() => takerFee(1n, 1.5)).toThrow()
})

const key = () => Keypair.generate().publicKey
const binding = (): ManifestBinding => ({ question: key(), program: key(), venue: key(), mint: key(), collateral: key(), recipient: key(), bps: 30, outcome: 0 })

test('delegated Manifest instructions bind the canonical vault and stay IOC-only', () => {
  const program = key(), owner = key(), agent = key(), b = binding()
  const claim = claimManifestAgentSeat(program, agent, owner, b)
  expect(claim.data).toEqual(Buffer.from([31]))
  expect(claim.keys[3]!.pubkey.equals(vaultAddress(program, owner))).toBe(true)
  expect(claim.keys).toHaveLength(14)
  expect(claim.keys[10]!.pubkey.equals(manifestAgentTraderAddress(program, owner))).toBe(true)
  expect(claim.keys[0]!.isSigner).toBe(true)
  expect(claim.keys[3]!.isSigner).toBe(false)

  const order = manifestAgentIoc(program, agent, owner, b, { side: 'BUY', quantity: 5_000_000n, priceMicros: 450_000n, lastValidSlot: 1234, maxFeeAtoms: 7_000n })
  expect(order.data).toHaveLength(30)
  expect([...order.data.subarray(0, 2)]).toEqual([33, 0])
  expect(order.data.readBigUInt64LE(2)).toBe(5_000_000n)
  expect(order.data.readBigUInt64LE(10)).toBe(450_000n)
  expect(order.data.readUInt32LE(18)).toBe(1234)
  expect(order.data.readBigUInt64LE(22)).toBe(7_000n)
  expect(order.keys).toHaveLength(15)
  expect(order.keys[11]!.pubkey.equals(manifestAgentTraderAddress(program, owner))).toBe(true)
  expect(() => manifestAgentIoc(program, agent, owner, b, { side: 'BUY', quantity: 1n, priceMicros: 1_000_000n, lastValidSlot: 1, maxFeeAtoms: 0n })).toThrow()

  const quote = moveManifestAgentInventory(program, owner, b, 'USDC', 10n, 'deposit')
  const claims = moveManifestAgentInventory(program, owner, b, 'claims', 10n, 'withdraw')
  expect(quote.keys).toHaveLength(17)
  expect(claims.keys).toHaveLength(17)
  expect([...quote.data.subarray(0, 3)]).toEqual([32, 0, 0])
  expect([...claims.data.subarray(0, 3)]).toEqual([32, 1, 1])
})
