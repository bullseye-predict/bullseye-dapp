import { expect, test } from 'bun:test'
import { unpricedMarkets } from '../src/components/home/useVenueMarketPrices'
import type { ArenaMarket } from '../src/components/solz/model'

const base = { id: 'q', matchId: 'm', kind: 'match-winner', title: 'Will COKE win?', description: '', status: 'indicative', closesAt: 1, rules: '', volume: { SOL: 0, COOLA: 0 }, outcomes: [] } as unknown as ArenaMarket

const solana = { family: 'SOLANA', marketId: '3aNvkpRet3FJMoHbfSqp9HPprNLtPvjW6cJX96Fv6g8D', rpcUrl: 'https://api.devnet.solana.com', genesisHash: 'g', predictionProgram: 'p', manifestProgram: 'm', collateralMint: 'c', collateralDecimals: 6, tradingStartsAt: 1, tradingLocksAt: 2 }
const dreamdex = { family: 'DREAMDEX', chainId: '50312', marketId: '0xabc', oracleQuestionId: '1', voidPolicy: 0, indexerUrl: 'https://i', wsRpcUrl: 'wss://w', tradingStartsAt: 1, tradingLocksAt: 2 }

test('a Solana binding survives, because this is the path the Solana source renders through', () => {
  const [market] = unpricedMarkets([{ ...base, onchain: solana } as ArenaMarket])
  // Dropping this made every activated question report "no market opened" with an
  // empty book, however many trades had settled against it.
  expect(market!.onchain).toEqual(solana as never)
})

test('a DreamDEX binding is still cleared, since its pricing is what is absent', () => {
  const [market] = unpricedMarkets([{ ...base, onchain: dreamdex } as ArenaMarket])
  expect(market!.onchain).toBeUndefined()
})

test('pricing is always cleared regardless of venue', () => {
  const priced = { ...base, volume: { SOL: 9, COOLA: 9 }, outcomes: [{ id: 'yes', label: 'YES', detail: '', probability: .9, priceHistory: [{ at: 1, probability: .9 }] }] } as unknown as ArenaMarket
  const [market] = unpricedMarkets([{ ...priced, onchain: solana } as ArenaMarket])
  expect(market!.volume).toEqual({ SOL: 0, COOLA: 0 })
  expect(market!.outcomes[0]!.probability).toBe(.5)
  expect(market!.outcomes[0]!.priceHistory).toEqual([])
})
