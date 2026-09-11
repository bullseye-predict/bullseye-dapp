import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MatchViewer } from '../src/components/home/MatchViewer'
import { TradeContextBar } from '../src/components/home/TradeContextBar'
import { MarketSourceControls } from '../src/components/home/MarketSourceControls'
import { unpricedMarkets } from '../src/components/home/useVenueMarketPrices'
import { createSolzDataSource } from '../src/components/solz/solzDataSource'

describe('highlight livestream navigation', () => {
  test('labels real and simulated match counts accurately', () => {
    const live = renderToStaticMarkup(<TradeContextBar
      simulation={false}
      onSimulationChange={() => {}}
      liveMatchCount={1}
      networkControls={<span>Networks</span>}
    />)
    const sample = renderToStaticMarkup(<TradeContextBar
      simulation
      onSimulationChange={() => {}}
      liveMatchCount={4}
      networkControls={<span>Networks</span>}
    />)

    expect(live).toContain('1 LIVE MATCH')
    expect(live).not.toContain('SAMPLE MATCH')
    expect(sample).toContain('4 SAMPLE MATCHES')
  })

  for (const state of ['match', 'intermission', 'pinned-season'] as const) {
    test(`keeps the livestream tab and panel available during ${state}`, async () => {
      const source = createSolzDataSource()
      const snapshot = await source.load()
      const match = snapshot.matches.find((item) => item.id === snapshot.highlightMatchId)!
      const season = state !== 'match'
      if (state === 'intermission') match.phase = 'settled'
      const markets = snapshot.markets.filter((item) => season ? !item.matchId : item.matchId === match.id)
      const market = markets[0]
      for (const view of ['live', 'market', 'options'] as const) {
        const html = renderToStaticMarkup(<MatchViewer
          match={match} market={market} markets={markets} snapshot={snapshot} source={source}
          view={view} onView={() => {}} outcome={market.outcomes[0]} onSelect={() => {}}
          liveHref="/live" onChat={() => {}} onPrompt={() => {}} season={season}
          pinned={state === 'pinned-season'} onPin={() => {}}
        />)
        const tab = html.match(/<button[^>]*id="highlight-view-live-tab"[^>]*>/)?.[0]
        expect(tab).toBeDefined()
        expect(tab).toContain(`aria-selected="${view === 'live'}"`)
        expect(tab).not.toContain('disabled')
        const panel = html.match(/<div[^>]*id="highlight-view-live-panel"[^>]*>/)?.[0]
        expect(panel).toBeDefined()
        expect(panel?.includes('hidden')).toBe(view !== 'live')
        expect(html).toContain('ARENA EMBED')
        expect(html).toContain('title="SOLZ agent arena livestream"')
        expect(html).toContain('>Arena</button>')
        expect(html).toContain('disabled="" aria-pressed="false">Video</button>')
        if (state === 'intermission') expect(html).toContain('MATCH COMPLETE')
      }
    })
  }

  test('keeps empty prediction and market panels mounted when the prediction feed is unavailable', async () => {
    const source = createSolzDataSource()
    const snapshot = await source.load()
    const match = snapshot.matches.find((item) => item.id === snapshot.highlightMatchId)!
    const market = snapshot.markets.find((item) => item.matchId === match.id)!
    const html = renderToStaticMarkup(<MatchViewer
      match={match} market={market} markets={[]} snapshot={snapshot} source={source}
      view="options" onView={() => {}} outcome={market.outcomes[0]} onSelect={() => {}}
      liveHref="https://solz.fun/watch/live/agent-arena" onChat={() => {}} onPrompt={() => {}}
      season={false} pinned={false} onPin={() => {}} simulation={false}
    />)
    expect(html).toContain('Predictions <span>0</span>')
    expect(html).toContain('No prediction questions yet.')
    expect(html).toContain('No match market yet.')
    expect(html).toContain('src="https://solz.fun/watch/live/agent-arena?back=false"')
  })

  test('shows the reserved next match and all twelve entrants over the persistent arena iframe', async () => {
    const source = createSolzDataSource()
    const snapshot = await source.load()
    const original = snapshot.matches.find((item) => item.id === snapshot.highlightMatchId)!
    const match = {
      ...original,
      id: 'arena-cab581e3-5e79-4251-9756-b9350ed87e22',
      phase: 'countdown' as const,
      roster: snapshot.agents.slice(0, 12).map((agent, index) => ({
        ...(original.roster[index % original.roster.length]!), agentId: agent.id, codename: agent.codename,
      })),
    }
    const market = snapshot.markets.find((item) => item.matchId === original.id)!
    const html = renderToStaticMarkup(<MatchViewer
      match={match} market={market} markets={[market]} snapshot={snapshot} source={source}
      view="live" onView={() => {}} outcome={market.outcomes[0]} onSelect={() => {}}
      liveHref="https://solz.fun/watch/live/agent-arena?room=current" onChat={() => {}} onPrompt={() => {}}
      season={false} pinned={false} onPin={() => {}} simulation={false}
    />)
    expect(html).toContain('5-MINUTE INTERMISSION')
    expect(html).toContain('Next match <b>#A-CAB5</b>')
    expect(html).toContain('12 / 12 AGENTS CONFIRMED')
    expect(html).toContain('src="https://solz.fun/watch/live/agent-arena?room=current&amp;back=false"')
    for (const agent of snapshot.agents.slice(0, 12)) expect(html).toContain(agent.codename.replace('&', '&amp;'))
  })

  test('offers separate simulation, Solana, and Somnia sources with Somnia testnet selected', () => {
    const html = renderToStaticMarkup(<MarketSourceControls
      source="SOMNIA" onSource={() => {}} solana="devnet" onSolana={() => {}}
      somnia="50312" onSomnia={() => {}} status="TESTNET · 0 / 12 BOUND"
    />)
    expect(html).toContain('>Simulation</button>')
    expect(html).toContain('>Solana</button>')
    expect(html).toContain('aria-selected="true" tabindex="0">Somnia</button>')
    expect(html).toContain('aria-pressed="true">Testnet</button>')
    expect(html).toContain('TESTNET · 0 / 12 BOUND')
  })

  test('never reuses simulation history for an unbound on-chain source', async () => {
    const source = createSolzDataSource()
    const snapshot = await source.load()
    const priced = snapshot.markets.find((market) => market.outcomes.some((outcome) => outcome.priceHistory?.length))!
    const [empty] = unpricedMarkets([priced])
    expect(empty.volume.COOLA).toBe(0)
    expect(empty.outcomes.every((outcome) => outcome.probability === .5 && outcome.priceHistory?.length === 0)).toBe(true)
  })

  test('shows one match market containing all twelve agent winner questions without fake prices', async () => {
    const source = createSolzDataSource()
    const snapshot = await source.load()
    const match = snapshot.matches.find((item) => item.id === snapshot.highlightMatchId)!
    const template = snapshot.markets.find((item) => item.matchId === match.id)!
    const markets = Array.from({ length: 12 }, (_, index) => ({
      ...template,
      id: `winner-${index + 1}`,
      kind: 'match-winner' as const,
      title: `Will AGENT ${index + 1} win?`,
      outcomes: template.outcomes.map((item) => ({ ...item, id: item === template.outcomes[0] ? 'yes' : 'no', priceHistory: [] })),
      volume: { SOL: 0, COOLA: 0 },
    }))
    const independent = {
      ...template,
      id: 'first-to-twelve-kills',
      kind: 'kill-total' as const,
      title: 'First to 12 kills?',
      outcomes: template.outcomes.map((item) => ({ ...item, priceHistory: [] })),
      volume: { SOL: 0, COOLA: 0 },
    }
    const allMarkets = [...markets, independent]
    const html = renderToStaticMarkup(<MatchViewer
      match={match} market={markets[0]} markets={allMarkets} snapshot={snapshot} source={source}
      view="market" onView={() => {}} outcome={markets[0].outcomes[0]} onSelect={() => {}}
      liveHref="https://solz.fun/watch/live/agent-arena" onChat={() => {}} onPrompt={() => {}}
      season={false} pinned={false} onPin={() => {}} simulation={false}
    />)
    expect(html).toContain('Match winner · all 12 agents')
    for (let index = 1; index <= 12; index += 1) expect(html).toContain(`AGENT ${index}`)
    expect(html).toContain('No match prices yet.')
    expect(html).toContain('AWAITING PRICES')
    expect(html).not.toContain('REFERENCE SAMPLE')
    expect(html).toContain('Predictions <span>13</span>')
    const marketPanel = html.slice(html.indexOf('id="highlight-view-market-panel"'), html.indexOf('id="highlight-view-options-panel"'))
    expect(marketPanel).not.toContain('First to 12 kills?')
  })
})
