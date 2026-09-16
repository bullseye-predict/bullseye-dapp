import { lockFace as lockFaceSync } from '../src/components/catwalk/CatwalkLockFace'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseCatwalkCycle, parseCatwalkCycles } from '../src/components/solz/catwalkSource'
import { CatwalkCycleBanner, CatwalkCyclePicker, cycleLabel } from '../src/components/catwalk/CatwalkCyclePicker'

const MINT_A = 'So11111111111111111111111111111111111111112'
const MINT_B = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

const header = (cycleIndex: number, startsAt: number) => ({
  cycleIndex, seasonId: 'solz-00', matchCount: 12, lineupSize: 36,
  startsAt, endsAt: startsAt + 3_600_000, lockedAt: startsAt - 43_200_000,
})

describe('the recorded walks index', () => {
  test('parses headers and keeps the server order', () => {
    const rows = parseCatwalkCycles({ ok: true, cycles: [header(4, 1e12), header(3, 9e11)] })
    expect(rows.map((row) => row.cycleIndex)).toEqual([4, 3])
    expect(rows[0]!.lineupSize).toBe(36)
  })

  test('a payload that is not ok is a refusal, never an empty history', () => {
    // An empty list says "this board has never locked". A failed read says
    // nothing at all. Collapsing them would publish the first on every blip.
    expect(() => parseCatwalkCycles({ ok: false })).toThrow()
    expect(() => parseCatwalkCycles({ ok: true })).toThrow()
  })

  /** CATWALK #1 IS CYCLE INDEX 0. The wire counts from zero because it is an
   *  index; the owner asked for the list as "CATWALK#1, #2". The offset lives
   *  in the label and never in the value sent back. */
  test('the label counts walks from one, not from the index', () => {
    expect(cycleLabel(header(0, Date.UTC(2026, 8, 14)))).toBe('CATWALK #1 — 14 SEP')
    expect(cycleLabel(header(11, Date.UTC(2026, 8, 2)))).toBe('CATWALK #12 — 02 SEP')
  })
})

describe('one recorded board', () => {
  const payload = {
    ok: true,
    cycle: {
      ...header(2, 1e12), activeSlots: 1,
      lineup: [
        { spot: 1, mint: MINT_A, lane: 'outbid', active: true, team: { mint: MINT_A, symbol: 'SOL', name: 'Solana' } },
        { spot: 2, mint: MINT_B, lane: 'ranked', active: false, team: { mint: MINT_B, symbol: 'USDC', name: 'USD Coin' } },
      ],
    },
  }

  test('reads the snapshot verbatim, in spot order', () => {
    const cycle = parseCatwalkCycle(payload)
    expect(cycle.cycleIndex).toBe(2)
    expect(cycle.lineup.map((row) => row.mint)).toEqual([MINT_A, MINT_B])
    expect(cycle.lineup[0]!.lane).toBe('outbid')
  })

  /**
   * A PAST BOARD CARRIES NO PRICE AND NO MARKET CAP, and this is the assertion
   * that keeps it that way. The snapshot recorded who stood where and nothing
   * else; a figure read off today's ladder would hang a live price on a board
   * that locked weeks ago, which is the one thing a history view must not do.
   */
  test('carries no price and no market cap', () => {
    const cycle = parseCatwalkCycle(payload)
    for (const row of cycle.lineup) {
      expect(row.paidUsdMicros).toBeNull()
      expect(row.marketCapUsd).toBeNull()
    }
  })

  test('an entry with no mint is dropped rather than drawn as a nameless row', () => {
    const cycle = parseCatwalkCycle({ ok: true, cycle: { ...payload.cycle, lineup: [{ spot: 1, lane: 'outbid' }] } })
    expect(cycle.lineup).toEqual([])
  })
})

describe('the picker', () => {
  test('renders nothing until the index has been read', () => {
    // An empty picker and a picker that has not loaded look identical and mean
    // opposite things, so the unread one draws no control at all.
    for (const state of ['unread', 'unreadable'] as const) {
      expect(renderToStaticMarkup(
        <CatwalkCyclePicker cycles={[header(0, 1e12)]} state={state} selected={null} onSelect={() => {}} />,
      )).toBe('')
    }
  })

  test('renders nothing when the board has never locked', () => {
    expect(renderToStaticMarkup(
      <CatwalkCyclePicker cycles={[]} state="read" selected={null} onSelect={() => {}} />,
    )).toBe('')
  })

  test('offers the live board first, and every recorded walk after it', () => {
    const html = renderToStaticMarkup(
      <CatwalkCyclePicker cycles={[header(1, 1e12), header(0, 9e11)]} state="read" selected={null} onSelect={() => {}} />,
    )
    expect(html.indexOf('LIVE BOARD')).toBeLessThan(html.indexOf('CATWALK #2'))
    expect(html).toContain('CATWALK #1')
  })
})

describe('the banner', () => {
  test('names the walk and says the sale is over', () => {
    const html = renderToStaticMarkup(
      <CatwalkCycleBanner cycle={{ ...header(0, Date.UTC(2026, 8, 14)), activeSlots: 12 }} onLive={() => {}} />,
    )
    expect(html).toContain('CATWALK #1')
    expect(html).toContain('36 positions')
    expect(html).toContain('12 matches')
    // The one sentence that stops a recorded board reading as a buyable one.
    expect(html).toContain('Nothing here is for sale')
    expect(html).toContain('BACK TO THE LIVE BOARD')
  })
})

/**
 * THE CLOCK KEEPS COUNTING ONCE THE PAIRING WINDOW HAS OPENED.
 *
 * `nextCatwalkLock` answers 'open' when every scheduled rotation is already
 * inside its twelve-hour window - there is no future LOCK left to count to. The
 * face used to render a static LOCKED and no clock at all, so the page could sit
 * for hours with no countdown anywhere on it, which is exactly what the owner
 * kept reporting.
 *
 * There is always something ahead: 'open' is only ever reached for a kickoff
 * that has not happened yet, so the walk itself is a real future instant.
 */
describe('the lock face once pairing has begun', () => {
  test('counts down to the walk, and names the walk rather than the lock', async () => {
    const { lockFace } = await import('../src/components/catwalk/CatwalkLockFace')
    const now = Date.UTC(2026, 8, 16, 12, 0, 0)
    const face = lockFace({ state: 'open', startsAt: now + 4 * 3_600_000 }, now, false, 12 * 3_600_000)!
    // The heading used to be a hardcoded BOARD LOCKS IN over every state, which
    // printed a pairing deadline above a kickoff.
    expect(face.label).toBe('THE WALK BEGINS IN')
    expect(face.timer).toBe(true)
    expect(String(face.value)).toContain('04')
  })

  test('still counts to the LOCK while the window is ahead', () => {
    // The ordinary case must not have moved: before the window opens the clock
    // is a pairing deadline and says so.
    const now = Date.UTC(2026, 8, 16, 12, 0, 0)
    const face = lockFaceSync(
      { state: 'counting', locksAt: now + 2 * 3_600_000, startsAt: now + 14 * 3_600_000 },
      now, false, 12 * 3_600_000,
    )!
    expect(face.label).toBe('BOARD LOCKS IN')
    // STATED FROM THE SERVER'S OWN LEAD. The copy was a literal "12H" whatever
    // `lockLeadMs` was configured to, so a board with a six-hour lead published
    // a rule it does not keep.
    expect(face.note).toBe('PAIRINGS BIND 12H BEFORE THE WALK')
    const six = lockFaceSync(
      { state: 'counting', locksAt: now + 2 * 3_600_000, startsAt: now + 8 * 3_600_000 },
      now, false, 6 * 3_600_000,
    )!
    expect(six.note).toBe('PAIRINGS BIND 6H BEFORE THE WALK')
    // And with nothing published it drops the number rather than guessing one.
    const silent = lockFaceSync({ state: 'counting', locksAt: now + 2 * 3_600_000, startsAt: now + 14 * 3_600_000 }, now, false, null)!
    expect(silent.note).toBe('PAIRINGS BIND BEFORE THE WALK')
  })
})
