import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PredictionDetail } from '../src/components/home/PredictionDetail'
import type { ArenaMarket, SolzSnapshot } from '../src/components/solz/model'

/** TabPanel renders every tab's children even while hidden, so one render
 *  carries the Order Book, Graph, Activity and Info copy at once. */
const snapshot = { updatedAt: 1_700_000_000_000, agents: [], teams: [], matches: [], markets: [], limitOrders: [], account: { balances: { SOL: 0, COOLA: 0 }, positions: [], promptCount: 0 } } as unknown as SolzSnapshot

const market = (onchain: ArenaMarket['onchain'], status: ArenaMarket['status'] = 'open'): ArenaMarket => ({
  id: 'question-1', matchId: 'event-1', kind: 'match-winner', title: 'Will genesis-01 finish with the most kills?',
  description: 'A canonical question.', status, closesAt: 1_700_000_900_000, volume: { SOL: 0, COOLA: 0 },
  rules: 'YES pays if the recorded answer is YES.',
  outcomes: [
    { id: 'yes', label: 'YES', detail: 'Pays if yes.', probability: .5, priceHistory: [] },
    { id: 'no', label: 'NO', detail: 'Pays if no.', probability: .5, priceHistory: [] },
  ],
  onchain,
})

const solana: ArenaMarket['onchain'] = {
  family: 'SOLANA', marketId: '11111111111111111111111111111112', rpcUrl: 'https://example.invalid',
  genesisHash: 'genesis', predictionProgram: '11111111111111111111111111111113',
  manifestProgram: '11111111111111111111111111111114', collateralMint: '11111111111111111111111111111115',
  collateralDecimals: 6, tradingStartsAt: 1_700_000_000_000, tradingLocksAt: 1_700_000_900_000,
}

const dreamDex: ArenaMarket['onchain'] = {
  family: 'DREAMDEX', chainId: '50312', marketId: '0xabc', oracleQuestionId: '0xdef', voidPolicy: 0,
  indexerUrl: 'https://indexer.invalid', wsRpcUrl: 'wss://rpc.invalid',
  tradingStartsAt: 1_700_000_000_000, tradingLocksAt: 1_700_000_900_000,
}

const render = (onchain: ArenaMarket['onchain'], collateral = 'fUSDC', status: ArenaMarket['status'] = 'open') =>
  renderToStaticMarkup(
    <PredictionDetail market={market(onchain, status)} outcome={market(onchain).outcomes[0]!} snapshot={snapshot}
      simulation={false} collateral={collateral} active={false} onSelect={() => {}}/>,
  )

test('a Solana question is never described in DreamDEX terms', () => {
  const html = render(solana)
  expect(html).not.toContain('DreamDEX')
  expect(html).not.toContain('oracle question ID')
  expect(html).not.toContain('event contract ID')
  expect(html).toContain('guarded Manifest YES and NO book activations')
})

test('a DreamDEX question keeps its own copy', () => {
  const html = render(dreamDex, 'tUSDC')
  expect(html).toContain('DreamDEX question with tUSDC')
  expect(html).not.toContain('guarded Manifest')
})

test('the venue collateral symbol reaches the settlement line instead of the word "collateral"', () => {
  expect(render(solana)).toContain('Up to 1 fUSDC per share')
  expect(render(solana)).not.toContain('Up to 1 collateral per share')
})

test('the Activity tab does not claim to be loading on a venue it cannot read', () => {
  // The DreamDEX-only hook returned loading:true forever for a Solana binding,
  // so the tab was a permanent spinner rather than an empty state.
  expect(render(solana)).not.toContain('Loading market activity…')
})

test('an unbound market promises first-trade activation only while it is indicative', () => {
  expect(render(undefined, 'fUSDC', 'indicative')).toContain('Not opened on-chain yet.')
  // A binding can also be missing while venue config is still loading for a
  // question that has traded for hours; that must not read as "never opened".
  const open = render(undefined, 'fUSDC', 'open')
  expect(open).toContain('Market activity unavailable.')
  expect(open).not.toContain('Not opened on-chain yet.')
})

test('the empty market-setup drawer is not advertised when there are no receipts', () => {
  expect(render(solana)).not.toContain('Market setup')
})
