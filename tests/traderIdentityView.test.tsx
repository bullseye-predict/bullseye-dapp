import { beforeEach, describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TraderAvatar, TraderIdentity } from '../src/components/identity/TraderIdentity'
import { resetTraderProfiles } from '../src/components/identity/store'
import { createSolzDataSource } from '../src/components/solz/solzDataSource'
import { EventCommunity } from '../src/components/events/EventCommunity'
import type { ArenaMarket } from '../src/components/solz/model'

const OWNER = '4qMhJ42sCexUkXgqEkPt9nsyK93d92QeNGKZNyNYPGUb'
const IMAGE = 'https://socialimages.pump.fun/profile-images/pumpatar/2/Indigo.webp'

const known = () => resetTraderProfiles({
  [OWNER]: { status: 'ready', at: Date.now(), profile: { address: OWNER, source: 'pump', username: 'vosum', imageUrl: IMAGE } },
})

beforeEach(() => resetTraderProfiles())

describe('trader identity', () => {
  test('an unknown wallet reads as its address, once', () => {
    const html = renderToStaticMarkup(<TraderIdentity address={OWNER}/>)
    expect(html).toContain('4qMh…PGUb')
    expect(html).toContain('<svg')
    // No screen-reader restatement when the name already is the address.
    expect(html).not.toContain('(4qMh…PGUb)')
  })

  test('a known wallet reads as its handle, with the address still on the row', () => {
    known()
    const html = renderToStaticMarkup(<TraderIdentity address={OWNER}/>)
    expect(html).toContain('vosum')
    // The handle replaces the address on screen but never hides it: the full
    // address is the hover title and the short form is read out.
    expect(html).toContain(`title="${OWNER}"`)
    expect(html).toContain('(4qMh…PGUb)')
    expect(html).toContain(IMAGE)
  })

  test('the avatar falls back to an identicon rather than a broken image', () => {
    expect(renderToStaticMarkup(<TraderAvatar address={OWNER}/>)).toContain('<svg')
    known()
    expect(renderToStaticMarkup(<TraderAvatar address={OWNER}/>)).toContain(`src="${IMAGE}"`)
  })

  test('a name links only where the caller says it should', () => {
    known()
    expect(renderToStaticMarkup(<TraderIdentity address={OWNER}/>)).not.toContain('<a ')
    expect(renderToStaticMarkup(<TraderIdentity address={OWNER} href="/solana/devnet/x"/>)).toContain('href="/solana/devnet/x"')
  })
})

const solanaMarket = (market: ArenaMarket): ArenaMarket => ({
  ...market,
  outcomes: market.outcomes.slice(0, 2),
  onchain: {
    family: 'SOLANA',
    marketId: '9zQkS3s1bFhQrRcqgV3UZqW7mM8u2p6rYb3TnMSEE4Qd',
    rpcUrl: 'https://api.devnet.solana.com',
    genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    predictionProgram: '6mDjQ1kEwJqPfzTqmqsEbWUkHrbwDCqxLQeAcwpaDcVf',
    manifestProgram: 'MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms',
    collateralMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    collateralDecimals: 6,
    tradingStartsAt: 0,
    tradingLocksAt: Date.now() + 60_000,
  } as ArenaMarket['onchain'],
})

describe('event community panels', () => {
  const render = async (onChain: boolean) => {
    const source = createSolzDataSource()
    const snapshot = await source.load()
    const match = snapshot.matches[0]!
    const base = snapshot.markets.find((item) => item.matchId === match.id && item.outcomes.length === 2)
      ?? snapshot.markets.find((item) => item.matchId === match.id)!
    const market = onChain ? solanaMarket(base) : { ...base, outcomes: base.outcomes.slice(0, 2), onchain: undefined }
    return renderToStaticMarkup(
      <EventCommunity snapshot={snapshot} match={match} source={source} market={market} priced={[market]}
        collateral="fUSDC" apiUrl="https://api.test.invalid" hideComments/>,
    )
  }

  test('no panel is labelled SIMULATION any more', async () => {
    expect(await render(true)).not.toContain('SIMULATION')
    expect(await render(false)).not.toContain('SIMULATION')
  })

  test('a market with a venue is marked on-chain', async () => {
    expect(await render(true)).toContain('ON-CHAIN')
  })

  test('positions on a venue ask for a wallet instead of showing nothing', async () => {
    const html = await render(true)
    // The old panel read the local play account, so a signed-out visitor and a
    // trader with real positions saw the same empty column.
    expect(html).toContain('Connect a wallet to see your positions')
    expect(html).toContain('replayed from your own confirmed fills')
  })

  test('a market with no venue still shows the local preview, and says so', async () => {
    const html = await render(false)
    expect(html).toContain('Positions from the local arena preview')
    expect(html).not.toContain('Connect a wallet to see your positions')
  })
})
