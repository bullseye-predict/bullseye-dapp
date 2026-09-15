import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { HighlightChart, resolveHistoryMode } from '../src/components/home/HighlightChart'
import { createSolzDataSource } from '../src/components/solz/solzDataSource'
import type { ArenaMarket, ArenaMarketOutcome } from '../src/components/solz/model'

const outcome = (over: Partial<ArenaMarketOutcome>): ArenaMarketOutcome =>
  ({ id: 'yes', label: 'GENESIS-01', detail: '', probability: .5, priceHistory: [], ...over })

// closesAt in the past pins `end` to the cutoff, so the window is the same on
// every run however long ago the fixture was written.
const market = (outcomes: ArenaMarketOutcome[]): ArenaMarket => ({
  id: 'genesis-01', matchId: 'match-1', kind: 'match-winner', title: 'Who will win?',
  status: 'open', closesAt: 60_000, description: '', rules: '', volume: { SOL: 0, COOLA: 0 }, outcomes,
})

const paths = (html: string) => [...html.matchAll(/<path d="([^"]+)"[^>]*stroke="/g)].map(match => match[1]!)

describe('live probability chart', () => {
  test('a book that has not moved since page load draws a line across the window, not one dot', async () => {
    const snapshot = await createSolzDataSource().load()
    const outcomes = [
      outcome({ id: 'a', label: 'GENESIS-01', probability: .88, quoteHistory: [{ at: 1_000, probability: .88 }] }),
      outcome({ id: 'b', label: 'GENESIS-02', probability: .7, quoteHistory: [{ at: 1_000, probability: .7 }] }),
    ]
    const html = renderToStaticMarkup(<HighlightChart market={market(outcomes)} outcome={outcomes[0]!} snapshot={snapshot} simulation={false} collateral="fUSDC" onOutcome={() => {}} onMarket={() => {}}/>)
    // The regression: a one-point series used to emit `M x,y` and nothing else,
    // which SVG never strokes — only the endpoint circle painted.
    const drawn = paths(html)
    expect(drawn).toHaveLength(2)
    expect(drawn.every(path => /^M[\d.]+,[\d.]+ H[\d.]+ V[\d.]+$/.test(path))).toBe(true)
    // …and it reaches the right edge of the plot rather than sitting on it.
    expect(drawn.every(path => Number(path.match(/H([\d.]+)/)![1]) > Number(path.match(/^M([\d.]+),/)![1]) + 100)).toBe(true)
    expect(html).toContain('Quotes have not moved since this page opened.')
  })

  test('the axis resolves a short window instead of printing one label five times', async () => {
    const snapshot = await createSolzDataSource().load()
    const outcomes = [outcome({ quoteHistory: [{ at: 1_000, probability: .5 }] })]
    const html = renderToStaticMarkup(<HighlightChart market={market(outcomes)} outcome={outcomes[0]!} snapshot={snapshot} simulation={false} collateral="fUSDC" onOutcome={() => {}} onMarket={() => {}}/>)
    // Five ticks fifteen seconds apart are indistinguishable in HH:mm, which is
    // what made the axis read 06:28, 06:29, 06:29, 06:29, 06:29.
    for (const second of [':15', ':30', ':45']) expect(html).toContain(second)
  })

  test('the legend prices each book in cents rather than summing to 318% beside a CHANCE column', async () => {
    const snapshot = await createSolzDataSource().load()
    const outcomes = [
      outcome({ id: 'a', label: 'GENESIS-01', probability: .88, quoteHistory: [{ at: 1_000, probability: .88 }] }),
      outcome({ id: 'b', label: 'GENESIS-02', probability: .7, quoteHistory: [{ at: 1_000, probability: .7 }] }),
    ]
    const html = renderToStaticMarkup(<HighlightChart market={market(outcomes)} outcome={outcomes[0]!} snapshot={snapshot} simulation={false} collateral="fUSDC" onOutcome={() => {}} onMarket={() => {}}/>)
    expect(html).toContain('88¢')
    expect(html).toContain('70¢')
    expect(html).not.toContain('88%')
  })

  test('an unquoted answer reads as no price, and the axis speaks the same unit as the series', async () => {
    const snapshot = await createSolzDataSource().load()
    const outcomes = [
      outcome({ id: 'a', label: 'GENESIS-01', probability: .6, quoteHistory: [{ at: 1_000, probability: .6 }] }),
      outcome({ id: 'b', label: 'GENESIS-05', probability: .5, indicative: true }),
    ]
    const html = renderToStaticMarkup(<HighlightChart market={market(outcomes)} outcome={outcomes[0]!} snapshot={snapshot} simulation={false} collateral="fUSDC" onOutcome={() => {}} onMarket={() => {}}/>)
    expect(html).toContain('—')
    expect(html).toContain('fUSDC quote observations')
    // The grid ladder moved to cents with the legend: a percent axis behind
    // cents-priced series is two units for one number on one chart.
    for (const tick of ['0¢', '25¢', '50¢', '75¢', '100¢']) expect(html).toContain(tick)
    expect(html).not.toContain('100%')
  })

  test('a series whose only point lands on the right edge still strokes', async () => {
    const snapshot = await createSolzDataSource().load()
    // The point is newer than the market's own cutoff, so `end` is pinned to it
    // and the carry-forward has nowhere to carry — the degenerate case that would
    // otherwise emit a lone moveto and paint nothing but the endpoint dot.
    const outcomes = [outcome({ quoteHistory: [{ at: 120_000, probability: .42 }] })]
    const html = renderToStaticMarkup(<HighlightChart market={market(outcomes)} outcome={outcomes[0]!} snapshot={snapshot} simulation={false} collateral="fUSDC" onOutcome={() => {}} onMarket={() => {}}/>)
    const drawn = paths(html)
    expect(drawn).toHaveLength(1)
    expect(drawn[0]).toMatch(/^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+$/)
    expect(html).toContain('stroke-linecap="round"')
  })
})

describe('which series the graph draws', () => {
  const resolve = (series: ArenaMarketOutcome[], over: Partial<Parameters<typeof resolveHistoryMode>[1]> = {}) =>
    resolveHistoryMode(series, { focusOnly: true, simulation: false, ...over })

  // The two-window report: one browser drew a stepped quote line reading
  // "18.5¢ market price", the other a trade line reading "12¢", same market and
  // same moment. The mode was picked from whether the receipt backfill had
  // landed yet, so whichever tab had held the question longer won.
  test('the series does not depend on whether the receipt backfill has finished', () => {
    const traded = [outcome({ historyStatus: 'ready', marketQuote: { mid: .185 }, quoteHistory: [{ at: 1_000, probability: .185 }], priceHistory: [{ at: 900, probability: .12 }] })]
    const backfilling = [outcome({ historyStatus: 'pending', marketQuote: { mid: .185 }, quoteHistory: [{ at: 1_000, probability: .185 }], priceHistory: [] })]
    expect(resolve(traded)).toBe('trades')
    expect(resolve(backfilling)).toBe('trades')
  })

  test('a panel whose candles are never read falls back to quotes rather than sitting blank', () => {
    // 'unavailable' is terminal, not slow: candles are read for the focused
    // market only, so the other eleven answers of an event would wait forever.
    expect(resolve([outcome({ historyStatus: 'unavailable', marketQuote: { mid: .4 }, quoteHistory: [{ at: 1_000, probability: .4 }] })])).toBe('quotes')
  })

  test('the mode holds when focus moves away from a market whose trades are already decoded', () => {
    const points = [{ at: 900, probability: .12 }]
    expect(resolve([outcome({ historyStatus: 'ready', priceHistory: points })])).toBe('trades')
    expect(resolve([outcome({ historyStatus: 'ready', quoteHistory: [{ at: 1_000, probability: .2 }], priceHistory: points })])).toBe('trades')
  })

  test("an arena market's seeded priceHistory is never promoted to a trade series", () => {
    // No marketQuote, no quoteHistory, no historyStatus — nothing the venue
    // produced. Flipping here put "LIVE MARKET" over fabricated data.
    const seeded = [outcome({ priceHistory: [{ at: 1_000, probability: .6 }, { at: 2_000, probability: .7 }] })]
    expect(resolve(seeded, { focusOnly: false })).toBe('quotes')
  })

  test('an explicit pick beats the derived mode', () => {
    expect(resolve([outcome({ historyStatus: 'ready', priceHistory: [{ at: 900, probability: .12 }] })], { override: 'quotes' })).toBe('quotes')
  })
})

describe('the focused graph states what it is showing', () => {
  const focused = async (over: Partial<ArenaMarketOutcome>) => {
    const snapshot = await createSolzDataSource().load()
    const outcomes = [outcome({ id: 'yes', ...over })]
    return renderToStaticMarkup(<HighlightChart market={market(outcomes)} outcome={outcomes[0]!} snapshot={snapshot} simulation={false} collateral="fUSDC" focusOnly historyPicker={false} onOutcome={() => {}} onMarket={() => {}}/>)
  }

  test('a market still decoding receipts says so, instead of claiming there are none', async () => {
    const html = await focused({ historyStatus: 'pending', marketQuote: { mid: .2 }, priceHistory: [] })
    expect(html).toContain('Loading trade history')
    expect(html).not.toContain('No trades recorded yet.')
    // The skeleton keeps the chart's shape, and the message stays announceable.
    expect(html).toContain('ch-empty-chart-grid')
    expect(html).toContain('role="status"')
  })

  test('a read that cannot produce candles falls back to the quote line, not an error', async () => {
    // 'unavailable' covers both "not the focused market" and "the read failed",
    // and from the outcome alone they are the same fact: no candles are coming.
    // A book that still quotes has something honest to draw, so draw it.
    const html = await focused({ historyStatus: 'unavailable', marketQuote: { mid: .2 }, quoteHistory: [{ at: 30_000, probability: .2 }] })
    expect(html).toContain('quote observations')
    expect(html).not.toContain('Trade history unavailable.')
    expect(html).not.toContain('role="status"')
  })

  test('with no quotes to fall back on, an unavailable read says so rather than loading forever', async () => {
    const html = await focused({ historyStatus: 'unavailable', priceHistory: [] })
    expect(html).toContain('Trade history unavailable.')
    expect(html).not.toContain('Loading trade history')
  })

  test('a market that has been read and has no fills says there are none', async () => {
    const html = await focused({ historyStatus: 'ready', marketQuote: { mid: .2 }, priceHistory: [] })
    expect(html).toContain('No trades recorded yet.')
    expect(html).not.toContain('Loading trade history')
  })

  test('the headline names its series and its age rather than claiming a market price', async () => {
    // "12¢ market price" sat directly under a row quoting Yes 20¢ / No 83¢,
    // because it was the last executed fill and nothing said so.
    const html = await focused({ historyStatus: 'ready', marketQuote: { mid: .2 }, priceHistory: [{ at: 30_000, probability: .12 }] })
    expect(html).toContain('Last trade 12¢')
    expect(html).not.toContain('market price')
    expect(html).toContain('ch-chart-focus-at')
  })

  test('a quoting book that has not traded says so, rather than reading as unpriced', async () => {
    // The headline is the drawn series' last point, and while the backfill runs
    // there is not one. "No price yet" would contradict the row directly above,
    // which is quoting the live book.
    const html = await focused({ historyStatus: 'pending', marketQuote: { mid: .2 }, quoteHistory: [{ at: 30_000, probability: .2 }], priceHistory: [] })
    expect(html).toContain('No trades yet')
    expect(html).not.toContain('No price yet')
  })

  test('a quote series is labelled as a quote, on the same headline', async () => {
    const html = await focused({ historyStatus: 'unavailable', marketQuote: { mid: .185 }, quoteHistory: [{ at: 20_000, probability: .185 }, { at: 30_000, probability: .185 }] })
    expect(html).toContain('Last quote 18.5¢')
    expect(html).not.toContain('market price')
  })
})

describe('the quote series says where it was recorded', () => {
  test('a moving quote series names the browser that sampled it', async () => {
    const snapshot = await createSolzDataSource().load()
    const outcomes = [outcome({ quoteHistory: [{ at: 1_000, probability: .4 }, { at: 30_000, probability: .42 }] })]
    const html = renderToStaticMarkup(<HighlightChart market={market(outcomes)} outcome={outcomes[0]!} snapshot={snapshot} simulation={false} collateral="fUSDC" onOutcome={() => {}} onMarket={() => {}}/>)
    // The series is this tab's own recording, so ALL means "all of this tab's
    // lifetime" and two browsers hold different lines for one book.
    expect(html).toContain('sampled in this browser')
    expect(html).toContain('All quotes recorded in this browser')
  })
})
