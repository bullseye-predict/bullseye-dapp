import type { ArenaMarketOutcome } from './model'

const nameSeed = (value: string) => {
  let hash = [...value].reduce((sum, char) => Math.imul(sum, 31) + char.charCodeAt(0) >>> 0, 7)
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b)
  return (hash ^ (hash >>> 16)) >>> 0
}

export type DepthRow = { price: number; shares: number; total: number; depth: number }
export function sampleOrderBook(outcome: ArenaMarketOutcome): { asks: DepthRow[]; bids: DepthRow[]; spread: number } {
  const middle = Math.max(2, Math.min(98, Math.round(outcome.probability * 100)))
  const rows = (side: 'ask' | 'bid') => {
    let cumulative = 0
    let cumulativeShares = 0
    const available = side === 'ask' ? 99 - middle : middle - 1
    const result = Array.from({ length: Math.min(5, available) }, (_, index) => {
      const price = (middle + (side === 'ask' ? 1 : -1) * (index + 1)) / 100
      const shares = 120 + nameSeed(`${outcome.id}:${side}:${index}`) % 3400
      cumulative += shares * price
      cumulativeShares += shares
      return { price, shares, total: cumulative, depth: cumulativeShares }
    })
    const max = Math.max(cumulativeShares, 1)
    return result.map((row) => ({ ...row, depth: row.depth / max * 100 }))
  }
  return { asks: rows('ask').reverse(), bids: rows('bid'), spread: .02 }
}
