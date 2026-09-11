import type { BinarySide } from '@somnia-chain/markets-sdk'

export type MarketActivity = { id: string; at: number; hash: string; label: string; detail: string; owner?: string; kind: 'fill' | 'order' | 'cancel'; block: bigint }
export type IndexedTrade = { id: string; market: string; fillPrice: string; quantity: string; timestamp: string; txHash: string; taker: string | null; takerSide: BinarySide | null }
export type IndexedOrder = { orderId: string; market: string; owner: string; side: BinarySide | null; price: string; fullQuantity: string; quantityRemaining: string; filledQuantity: string; status: string; placedAtTimestamp: string; placedAtBlock: string; placedTxHash: string }
export const sideLabel = (side: BinarySide) => `${side.startsWith('BUY') ? 'Buy' : 'Sell'} ${side.endsWith('YES') ? 'YES' : 'NO'}`
const units = (value: string) => Number(BigInt(value)) / 1_000_000

export function activityRows(market: string, trades: IndexedTrade[], orders: IndexedOrder[]): MarketActivity[] {
  const fills = trades.filter(row => row.market.toLowerCase() === market.toLowerCase()).map(row => ({
    id: `fill:${row.id}`, at: Number(row.timestamp) * 1000, block: BigInt(row.id.split('_')[0]), hash: row.txHash,
    owner: row.taker ?? undefined, kind: 'fill' as const,
    label: row.takerSide ? `${sideLabel(row.takerSide)} filled` : 'Trade filled',
    detail: `${units(row.quantity).toLocaleString()} shares at ${((row.takerSide?.endsWith('NO') ? 1 - units(row.fillPrice) : units(row.fillPrice)) * 100).toLocaleString()}¢${row.takerSide ? '' : ' (YES price)'}`,
  }))
  const placements = orders.filter(row => row.market.toLowerCase() === market.toLowerCase() && !fills.some(fill => fill.hash === row.placedTxHash)).map(row => ({
    id: `order:${row.orderId}`, at: Number(row.placedAtTimestamp) * 1000, block: BigInt(row.placedAtBlock), hash: row.placedTxHash,
    owner: row.owner, kind: 'order' as const,
    label: `${row.side ? sideLabel(row.side) : 'Order'} placed`,
    detail: `${units(row.fullQuantity).toLocaleString()} shares · ${units(row.filledQuantity).toLocaleString()} filled · ${row.status.toLowerCase()}`,
  }))
  return [...fills, ...placements].filter(row => Number.isSafeInteger(row.at)).sort((a, b) => a.block === b.block ? b.at - a.at || (a.kind === 'fill' && b.kind === 'fill' ? Number(BigInt(b.id.split('_').at(-1)!) - BigInt(a.id.split('_').at(-1)!)) : a.id.localeCompare(b.id)) : a.block > b.block ? -1 : 1)
}

/** Exact immutable market scope, never pool-wide history from another match. */
export async function readMarketActivity(indexerUrl: string, market: string, signal?: AbortSignal) {
  const response = await fetch(indexerUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: signal ?? AbortSignal.timeout(10000),
    body: JSON.stringify({ query: 'query Activity($market:String!){Fill(where:{market_id:{_eq:$market}},order_by:{timestamp:desc},limit:100){id market:market_id fillPrice quantity timestamp txHash taker takerSide} Order(where:{market_id:{_eq:$market}},order_by:{placedAtTimestamp:desc},limit:100){orderId market:market_id owner side price fullQuantity quantityRemaining filledQuantity status placedAtTimestamp placedAtBlock placedTxHash}}', variables: { market: market.toLowerCase() } }),
  })
  const result = await response.json()
  if (!response.ok || result.errors || !Array.isArray(result.data?.Fill) || !Array.isArray(result.data?.Order)) throw Error('Trade activity is temporarily unavailable.')
  return activityRows(market, result.data.Fill, result.data.Order)
}
