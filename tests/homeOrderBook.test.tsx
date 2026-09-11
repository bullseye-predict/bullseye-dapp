import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { depthRows, OrderBookTable } from '../src/components/home/LiveOrderBook'
import { activityRows } from '../packages/adapters/dreamdex/activity'
const asks = [{ price: 100_000n, quantity: 25_000_000n }, { price: 550_000n, quantity: 10_000_000n }]

test('asks display high to low with cumulative totals measured from the best ask', () => {
  expect(depthRows(asks, 'ask', 6).map(row => [row.price, row.total])).toEqual([[550_000n, 8_000_000n], [100_000n, 2_500_000n]])
  const html = renderToStaticMarkup(<OrderBookTable asks={asks} bids={[]} decimals={6} last={.45} label="YES"/>)
  expect(html.indexOf('55¢')).toBeLessThan(html.indexOf('10¢'))
  expect(html).toContain('Last: 45¢')
  expect(html).toContain('Spread: —')
  expect(html).toContain('No bids')
  expect(html).not.toContain('<select')
})

test('no executed trade or opposite quote does not fabricate a last price or zero spread', () => {
  const html = renderToStaticMarkup(<OrderBookTable asks={[]} bids={[]} decimals={6} label="NO"/>)
  expect(html).toContain('Last: —')
  expect(html).toContain('No asks')
  expect(html).toContain('No bids')
})

test('activity is newest first, correctly inverts NO fills, and excludes another match', () => {
  const base = { market: '0x01', fillPrice: '450000', quantity: '5000000', taker: 'wallet', takerSide: 'BUY_NO' as const, timestamp: '1000', txHash: '0xab' }
  const rows = activityRows('0x01', [{ ...base, id: '10_1' }, { ...base, id: '12_4', txHash: '0xcd' }, { ...base, id: '13_1', market: '0x02' }, { ...base, id: '12_6', txHash: '0xef' }], [])
  expect(rows.map(row => row.id)).toEqual(['fill:12_6', 'fill:12_4', 'fill:10_1'])
  expect(rows[0].label).toBe('Buy NO filled')
  expect(rows[0].detail).toContain('5 shares at 55¢')
})
