import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProbabilityChart, windowPoints, type ProbabilitySeries } from '../src/components/markets/ProbabilityChart'

const series = (over: Partial<ProbabilitySeries> & { id: string }): ProbabilitySeries =>
  ({ label: over.id, color: '#51b6ff', points: [], ...over })

const paths = (html: string) => [...html.matchAll(/<path class="market-chart-line" d="([^"]+)"/g)].map(m => m[1]!)
const render = (nodes: ProbabilitySeries[], props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<ProbabilityChart title="Who will win?" series={nodes} {...props} />)

describe('a chart draws every line it is given', () => {
  test('a binary market shows BOTH sides at once, with no toggle to find', () => {
    // The chart this replaced passed `focusOnly` here and drew one line, so a
    // head-to-head showed one team and the other was simply absent.
    const html = render([
      series({ id: 'brute', label: 'Brute', points: [{ at: 1_000, probability: .71 }, { at: 2_000, probability: .69 }] }),
      series({ id: 'g2a', label: 'G2 Ares', points: [{ at: 1_000, probability: .29 }, { at: 2_000, probability: .31 }] }),
    ])
    expect(paths(html)).toHaveLength(2)
    expect(html).toContain('Brute')
    expect(html).toContain('G2 Ares')
    expect(html).not.toContain('Quotes')
    expect(html).not.toContain('Trades')
  })

  test('a twelve-answer field draws twelve lines, not four', () => {
    // The old cap was `.slice(0, 4)`, so eight answers of a twelve-answer event
    // were silently missing from their own question's chart.
    const field = Array.from({ length: 12 }, (_, index) => series({
      id: `genesis-${index}`, label: `GENESIS-${index}`,
      points: [{ at: 1_000, probability: .1 + index / 40 }, { at: 2_000, probability: .1 + index / 40 }],
    }))
    expect(paths(render(field))).toHaveLength(12)
  })

  test('a legend replaces end labels rather than printing every line twice', () => {
    // With a legend on, an end label repeats it verbatim — same name, same
    // price, same colour — and costs 124px of plot to do it.
    const field = Array.from({ length: 12 }, (_, index) => series({
      id: `g${index}`, label: `GENESIS-${index}`,
      points: [{ at: 1_000, probability: .05 + index / 30 }, { at: 2_000, probability: .05 + index / 30 }],
    }))
    const withLegend = render(field)
    expect([...withLegend.matchAll(/class="market-chart-end-name"/g)]).toHaveLength(0)
    // …and every answer is still named, in the legend.
    for (let index = 0; index < 12; index += 1) expect(withLegend).toContain(`GENESIS-${index}`)

    // Without a legend the labels ARE the naming, and are capped: twelve at
    // 30px apart is 360px of stack in a ~300px canvas.
    const noLegend = render(field, { legend: false })
    expect([...noLegend.matchAll(/class="market-chart-end-name"/g)]).toHaveLength(6)
  })
})

describe('the plot starts where the data starts', () => {
  test('38 seconds of data fills the window instead of starting a third of the way across', () => {
    // The reported bug: `allStart` floored the window at 60s while the series
    // spanned 38s, and the carry-forward refused to anchor to a start with no
    // point at or before it, so every line began at 36.7% of the plot.
    const html = render([series({ id: 'a', points: [{ at: 1_000_000, probability: .4 }, { at: 1_038_000, probability: .42 }] })])
    const [path] = paths(html)
    const firstX = Number(path!.match(/^M ([\d.]+)/)![1])
    // The plot's left gutter at the default canvas width — the line begins AT
    // the edge of the plot, not a third of the way across an empty one.
    expect(firstX).toBe(54)
  })

  test('a window never reaches back further than the data it has', () => {
    // windowPoints is the whole carry-forward rule: it extends a series to the
    // RIGHT edge, and never invents a point to the left of the first
    // observation.
    const points = [{ at: 5_000, probability: .5 }]
    expect(windowPoints(points, 1_000, 9_000)).toEqual([{ at: 5_000, probability: .5 }, { at: 9_000, probability: .5 }])
    // A point at or before `start` DOES anchor the left edge, carried forward.
    expect(windowPoints([{ at: 500, probability: .3 }], 1_000, 9_000))
      .toEqual([{ at: 1_000, probability: .3 }, { at: 9_000, probability: .3 }])
    expect(windowPoints([], 1_000, 9_000)).toEqual([])
  })

  test('a single observation still strokes rather than painting a bare dot', () => {
    const [path] = paths(render([series({ id: 'a', points: [{ at: 1_000, probability: .42 }] })]))
    expect(path).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/)
  })
})

describe('each line carries its own colour', () => {
  test('a series renders in its own colour, not the stylesheet default', () => {
    // The silent failure: `stroke={color}` is an SVG PRESENTATION ATTRIBUTE,
    // and arena.css sets `.market-chart-series .market-chart-line { stroke:
    // currentColor }` — a CSS rule, which wins. Every one of twelve lines
    // rendered lime. Setting `color` on the group is what makes currentColor
    // resolve per series.
    const html = render([
      series({ id: 'a', label: 'A', color: '#ff6b6b', points: [{ at: 1, probability: .3 }, { at: 2, probability: .4 }] }),
      series({ id: 'b', label: 'B', color: '#8aa4ff', points: [{ at: 1, probability: .7 }, { at: 2, probability: .6 }] }),
    ])
    expect(html).toContain('color:#ff6b6b')
    expect(html).toContain('color:#8aa4ff')
    // …and no per-line stroke attribute that a stylesheet would silently beat.
    expect(html).not.toMatch(/<path class="market-chart-line"[^>]*\sstroke="/)
  })

  test('the empty state carries no chart glyph to be inflated', () => {
    // `.market-chart-canvas svg { width:100%; height:100% }` matched the lucide
    // icon and blew a 21px glyph up to fill the whole panel.
    const html = render([])
    expect(html).toContain('No price history yet')
    expect(html).not.toContain('lucide-chart-no-axes-combined')
  })
})

describe('the plot is inset the same on both sides', () => {
  test('without end labels the right gutter matches the left', () => {
    // The left gutter holds the y-axis labels; the right only ever held end
    // labels. With those gone it matched nothing, so the plot ran into the
    // panel edge on one side and sat 54px in on the other.
    const pts: [number, number][] = [[1_000, .4], [2_000, .6]]
    const html = render([series({ id: 'a', points: pts.map(([at, probability]) => ({ at, probability })) })])
    const path = paths(html)[0]!
    const firstX = Number(path.match(/^M ([\d.]+)/)![1])
    const lastX = Number([...path.matchAll(/[HL] ([\d.]+)/g)].at(-1)![1])
    // Default canvas is 860 wide; 54 in on the left, 54 in on the right.
    expect(firstX).toBe(54)
    expect(860 - lastX).toBe(54)
  })

  test('with end labels the right gutter makes room for them instead', () => {
    const pts = [{ at: 1_000, probability: .4 }, { at: 2_000, probability: .6 }]
    const html = render([series({ id: 'a', points: pts })], { legend: false })
    const path = paths(html)[0]!
    const lastX = Number([...path.matchAll(/[HL] ([\d.]+)/g)].at(-1)![1])
    expect(860 - lastX).toBe(124)
  })
})

describe('the legend is a control, not a label', () => {
  test('every chip starts shown, and says so to assistive technology', () => {
    // The old chip only ever selected: there was no way to take a line back off
    // the plot, and aria-pressed described emphasis rather than visibility.
    const html = render([
      series({ id: 'a', label: 'A', color: '#ff6b6b', points: [{ at: 1, probability: .3 }] }),
      series({ id: 'b', label: 'B', color: '#8aa4ff', points: [{ at: 1, probability: .7 }] }),
    ], { onSelect: () => {} })
    // Scoped to the legend: the scale and range groups use aria-pressed too.
    const legend = html.match(/<div class="market-chart-legend"[^>]*>(.*?)<\/div><div/s)?.[1] ?? html
    expect([...legend.matchAll(/aria-pressed="true"/g)]).toHaveLength(2)
    expect(html).toContain('title="Hide A"')
    expect(html).toContain('title="Hide B"')
  })
})

describe('a market with no trades still draws its book', () => {
  test('the live sampled series is the fallback, and the chart says which it is', () => {
    // "Price history unavailable" over a panel that is quoting a spread two
    // rows above reads as a broken chart, not a quiet book.
    const html = render([series({
      id: 'a', label: 'A', points: [{ at: 1, probability: .2 }, { at: 2, probability: .21 }], sampled: true,
    })])
    expect(html).toContain('SAMPLED BOOK')
    expect(html).not.toContain('No price')
  })

  test('executed trades are named as such, so the two are never confused', () => {
    const html = render([series({ id: 'a', label: 'A', points: [{ at: 1, probability: .2 }, { at: 2, probability: .21 }] })])
    expect(html).toContain('EXECUTED TRADES')
  })
})

describe('what the chart says about itself', () => {
  test('the headline reads as a chance, not as an archaeological artifact', () => {
    // "Last trade 12¢" was the last point of whichever series won a race. This
    // is the live book price, and it is the same number whichever line is drawn.
    const html = render([series({ id: 'a', points: [{ at: 1_000, probability: .12 }] })], {
      headline: { label: 'GENESIS-01', chance: .62 },
    })
    expect(html).toContain('62% chance')
    expect(html).not.toContain('Last trade')
    expect(html).not.toContain('market price')
  })

  test('a field of answers is headlined by its volume, not by one answer', () => {
    // Twelve independent books have no single chance. Lifting one above a chart
    // of twelve lines described neither the chart nor the market — and the
    // per-answer chances are already in the legend and the rows below.
    const html = render([series({ id: 'a', points: [{ at: 1, probability: .16 }] })], {
      headline: { label: '12 answers', volume: '433.1K fUSDC Vol.' },
    })
    expect(html).toContain('433.1K fUSDC Vol.')
    expect(html).toContain('12 answers')
    expect(html).not.toContain('chance')
  })

  test('an unpriced market says so rather than inventing a coin flip', () => {
    const html = render([series({ id: 'a', points: [{ at: 1, probability: .5 }] })], { headline: { label: 'A', chance: undefined } })
    expect(html).toContain('No price yet')
    expect(html).not.toContain('50% chance')
  })

  test('the chart names the cluster its numbers came from', () => {
    // An unlabelled empty chart reads as broken on mainnet rather than as a
    // devnet market that has not traded.
    expect(render([series({ id: 'a', points: [{ at: 1, probability: .5 }] })], { source: 'SOLANA DEVNET' })).toContain('SOLANA DEVNET')
    expect(render([], { source: 'SOLANA DEVNET' })).toContain('SOLANA DEVNET · AWAITING PRICES')
  })

  test('a read still running is distinguishable from a market that never traded', () => {
    const loading = render([series({ id: 'a', status: 'pending' })], { empty: { title: 'Loading price history…', hint: 'x', loading: true } })
    expect(loading).toContain('Loading price history…')
    expect(loading).toContain('role="status"')
    const settled = render([series({ id: 'a', status: 'ready' })], { empty: { title: 'No price history yet.', hint: 'x' } })
    expect(settled).toContain('No price history yet.')
    expect(settled).not.toContain('Loading price history')
  })
})
