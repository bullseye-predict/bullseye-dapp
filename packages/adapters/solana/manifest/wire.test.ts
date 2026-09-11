import { expect, test } from 'bun:test'
import { takerFee } from './wire'

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
