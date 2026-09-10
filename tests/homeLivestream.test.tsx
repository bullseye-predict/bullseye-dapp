import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MatchViewer } from '../src/components/home/MatchViewer'
import { createSolzDataSource } from '../src/components/solz/solzDataSource'

describe('highlight livestream navigation', () => {
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
        expect(html).toContain('BROADCAST PREVIEW')
        if (state === 'intermission') expect(html).toContain('MATCH COMPLETE')
      }
    })
  }
})
