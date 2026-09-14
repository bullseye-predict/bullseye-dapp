import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import BN from 'bn.js'
import { PublicKey } from '@solana/web3.js'
import { FillLog, genAccDiscriminator } from '@bonasa-tech/manifest-sdk'
import { bidEscrow, type ManifestOutcomeHolding, type ManifestPortfolio, type ManifestQuestionHolding } from '../src/components/portfolio/solanaPortfolio'
import { decodeTraderFills, fillCashFlow, manifestProgramData } from '../src/components/portfolio/solanaFills'
import { claimableSolanaRows, closedSolanaRows, markToBid, solanaCollateral, solanaEvents, solanaIdentity, solanaOrderRows, solanaPositionRows, solanaRowMatches } from '../src/components/portfolio/solanaRows'
import { SolanaOrdersTable, SolanaPositionsTable } from '../src/components/portfolio/SolanaPositions'
import { sameProfileAddress, solanaNetwork } from '../src/components/portfolio/profileRoute'
import type { ReservedSolanaQuestion } from '../src/components/home/solanaQuestionMarkets'

const MARKET = 'AUYPm7tjLSXZpDgVfacnVEHcKmR7ssx6TiZBaLqdXWXd'
const BOOK = 'GK8P1dbosqYtAeyCjQ9GgZWecDX1dZBeeFDkBG6L35qo'
const ALICE = 'EKGGkpWWhSjksrKQW8EadTbsvmg1uGrpwg33fTXZTDmA'
const BOB = 'BrZ7WeDARopFAtiA3DP6c8F3eQFJnb4X8q1P5CaLQMjK'
const MANIFEST = '7aqCiXX3JFKGvXDHdmaJBxNaveT7bVHt1bpj5Upb1JiJ'

const question: ReservedSolanaQuestion = {
  eventId: 'arena-534f4c5a01010014000000006aa75db1bce6f55299f57ab5f577d80f80356b7b',
  matchId: '0x534f4c5a01010014000000006aa75db1bce6f55299f57ab5f577d80f80356b7b',
  questionId: '0x51554553010102f9dcc2247b7e613c796cc77d8b9f9ea35780c6ed6181582207',
  marketId: MARKET, label: 'Will genesis-01 win?', outcomes: ['YES', 'NO'],
  scheduledStartAt: '2026-09-14T02:36:33.000Z', status: 'live',
}

const outcome = (overrides: Partial<ManifestOutcomeHolding> = {}, id: 0 | 1 = 0): ManifestOutcomeHolding => {
  const base: ManifestOutcomeHolding = { outcome: id, opened: true, walletShares: 0n, seatShares: 0n, reservedShares: 0n, vaultShares: 0n, totalShares: 0n, seatCollateral: 0n, reservedCollateral: 0n, quoteVolume: 0n, orders: [], ...overrides }
  return { ...base, totalShares: base.walletShares + base.seatShares + base.reservedShares + base.vaultShares }
}
const holding = (overrides: Partial<ManifestQuestionHolding> = {}): ManifestQuestionHolding => ({
  marketId: MARKET, opened: true, status: 1, winningOutcome: 255, paused: false,
  startsAt: 1_000, locksAt: 9_000, outcomes: [outcome(), outcome({}, 1)], ...overrides,
})
const portfolio = (overrides: Partial<ManifestPortfolio> = {}): ManifestPortfolio => ({
  owner: ALICE, now: 5_000, discovered: [], walletCollateral: 0n, vaultCollateral: 0n, vaultExists: true, questions: [holding()], failures: 0, ...overrides,
})

describe('Solana holdings become portfolio rows', () => {
  test('every custodian counts toward one position and none is invented', () => {
    const rows = solanaPositionRows(portfolio({ questions: [holding({ outcomes: [
      outcome({ walletShares: 2_000_000n, seatShares: 3_000_000n, reservedShares: 1_000_000n, vaultShares: 4_000_000n, bestBid: 400_000n }),
      outcome({}, 1),
    ] })] }), [question], 6)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.quantity).toBe(10_000_000n)
    expect(rows[0]!.custody).toEqual({ wallet: 2_000_000n, seat: 3_000_000n, reserved: 1_000_000n, vault: 4_000_000n })
    // Ten shares marked at 0.40 is four collateral units, not ten.
    expect(rows[0]!.value).toBe(4_000_000n)
    expect(rows[0]!.state).toBe('Trading')
  })

  test('an outcome with nothing in it is not listed at all', () => {
    expect(solanaPositionRows(portfolio(), [question], 6)).toEqual([])
  })

  test('a fully exited outcome stays visible as closed through its matched volume', () => {
    const rows = solanaPositionRows(portfolio({ questions: [holding({ outcomes: [outcome({ quoteVolume: 5_000_000n }), outcome({}, 1)] })] }), [question], 6)
    expect(rows.map(row => row.state)).toEqual(['Closed'])
    expect(closedSolanaRows(rows)).toHaveLength(1)
  })

  test('settlement decides claims, and an unset winner byte never unlocks one', () => {
    const held: [ManifestOutcomeHolding, ManifestOutcomeHolding] = [outcome({ seatShares: 7n }), outcome({ seatShares: 3n }, 1)]
    const trading = solanaPositionRows(portfolio({ questions: [holding({ outcomes: held })] }), [question], 6)
    expect(trading.map(row => row.state)).toEqual(['Trading', 'Trading'])
    const resolved = solanaPositionRows(portfolio({ questions: [holding({ status: 3, winningOutcome: 0, outcomes: held })] }), [question], 6)
    expect(resolved.map(row => row.state)).toEqual(['Claim winnings', 'Lost'])
    expect(claimableSolanaRows(resolved)).toHaveLength(1)
    const voided = solanaPositionRows(portfolio({ questions: [holding({ status: 4, outcomes: held })] }), [question], 6)
    expect(voided.map(row => row.state)).toEqual(['Claim refund', 'Claim refund'])
    const locked = solanaPositionRows(portfolio({ now: 9_500, questions: [holding({ status: 2, outcomes: held })] }), [question], 6)
    expect(locked.map(row => row.state)).toEqual(['Awaiting result', 'Awaiting result'])
  })

  test('an unpriced book leaves the position unvalued rather than worthless', () => {
    const rows = solanaPositionRows(portfolio({ questions: [holding({ outcomes: [outcome({ seatShares: 5_000_000n }), outcome({}, 1)] })] }), [question], 6)
    expect(rows[0]!.value).toBeUndefined()
    expect(markToBid(5_000_000n, undefined, 6)).toBeUndefined()
  })

  test('a question the catalogue has dropped keeps its position and says so', () => {
    const rows = solanaPositionRows(portfolio({
      discovered: [BOOK],
      questions: [holding({ marketId: BOOK, status: 3, winningOutcome: 0, outcomes: [outcome({ walletShares: 9n }), outcome({}, 1)] })],
    }), [question], 6)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.state).toBe('Claim winnings')
    expect(rows[0]!.identity.listed).toBe(false)
    expect(rows[0]!.identity.eventId).toBeUndefined()
    expect(rows[0]!.identity.label).toContain(BOOK.slice(0, 4))
    expect(rows[0]!.identity.outcomeLabels).toEqual(['YES', 'NO'])
  })

  test('a listed question keeps the catalogue label and its own outcome names', () => {
    expect(solanaIdentity(MARKET, question)).toMatchObject({ label: 'Will genesis-01 win?', eventId: question.eventId, listed: true, outcomeLabels: ['YES', 'NO'] })
  })

  test('the event filter lists events from rows the catalogue no longer carries', () => {
    const rows = solanaPositionRows(portfolio({ questions: [holding({ outcomes: [outcome({ seatShares: 1n }), outcome({}, 1)] })] }), [question], 6)
    expect(solanaEvents(rows, []).map(event => event.eventId)).toEqual([question.eventId])
    expect(solanaRowMatches(rows[0]!.identity, question.eventId, 'genesis')).toBe(true)
    expect(solanaRowMatches(rows[0]!.identity, 'another-event', '')).toBe(false)
    expect(solanaRowMatches(rows[0]!.identity, '', MARKET)).toBe(true)
  })
})

describe('resting orders and collateral custody', () => {
  // The venue prices in 1e18 fixed point; 0.5 collateral per share is 5e17.
  const HALF = 500_000_000_000_000_000n
  const order = { sequence: '1', side: 'BUY' as const, price: 500_000n, quantity: 66_000_000n, reserved: bidEscrow(66_000_000n, HALF), lastValidSlot: 10 }

  test('bid escrow rounds up the way the venue reserves it', () => {
    expect(bidEscrow(66_000_000n, HALF)).toBe(33_000_000n)
    // A price finer than a whole micro-unit still reserves a whole atom.
    expect(bidEscrow(1n, 1n)).toBe(1n)
    expect(bidEscrow(3n, HALF + 1n)).toBe(2n)
  })

  test('each resting order is its own row and expiry follows the cutoff', () => {
    const open = solanaOrderRows(portfolio({ questions: [holding({ outcomes: [outcome({ orders: [order, { ...order, sequence: '2' }] }), outcome({}, 1)] })] }), [question])
    expect(open.map(row => row.id)).toEqual([`${MARKET}:0:1`, `${MARKET}:0:2`])
    expect(open.every(row => !row.expired)).toBe(true)
    const past = solanaOrderRows(portfolio({ now: 9_500, questions: [holding({ outcomes: [outcome({ orders: [order] }), outcome({}, 1)] })] }), [question])
    expect(past[0]!.expired).toBe(true)
  })

  test('collateral is totalled per custodian across every question', () => {
    const funds = solanaCollateral(portfolio({
      walletCollateral: 80n, vaultCollateral: 5n,
      questions: [holding({ outcomes: [outcome({ seatCollateral: 2n, reservedCollateral: 33n }), outcome({ seatCollateral: 1n, reservedCollateral: 33n }, 1)] })],
    }))
    expect(funds).toEqual({ wallet: 80n, vault: 5n, seat: 3n, reserved: 66n, total: 154n })
  })
})

const fillLog = (args: { maker: string; taker: string; takerIsBuy: boolean; base: bigint; quote: bigint; market?: string }) => {
  const log = FillLog.fromArgs({
    market: new PublicKey(args.market ?? BOOK), maker: new PublicKey(args.maker), taker: new PublicKey(args.taker),
    baseMint: PublicKey.default, quoteMint: PublicKey.default,
    price: { inner: new BN(0) } as never, baseAtoms: { inner: new BN(args.base.toString()) } as never, quoteAtoms: { inner: new BN(args.quote.toString()) } as never,
    makerSequenceNumber: new BN(1), takerSequenceNumber: new BN(2), takerIsBuy: args.takerIsBuy, isMakerGlobal: false, padding: new Array(14).fill(0),
  })
  return `Program data: ${Buffer.concat([Buffer.from(genAccDiscriminator('manifest::logs::FillLog')), log.serialize()[0]]).toString('base64')}`
}
const logs = (...data: string[]) => [`Program ${MANIFEST} invoke [1]`, ...data, `Program ${MANIFEST} success`]
const book = { address: BOOK, marketId: MARKET, outcome: 0 as const }

describe('executed Solana trade history', () => {
  test('only data logged inside the venue program frame is read as a fill', () => {
    const other = 'LxJWNhngdcizZ4A859H66XFnd3W9iPMn5S9nnX3f4cs'
    const messages = [
      `Program ${other} invoke [1]`, 'Program data: bm90LWEtZmlsbA==',
      `Program ${MANIFEST} invoke [2]`, 'Program data: aW5zaWRl', `Program ${MANIFEST} success`,
      `Program ${other} success`,
    ]
    expect(manifestProgramData(messages, MANIFEST)).toEqual(['aW5zaWRl'])
  })

  test('the maker takes the side the taker did not', () => {
    const bought = decodeTraderFills(logs(fillLog({ maker: BOB, taker: ALICE, takerIsBuy: true, base: 4_000_000n, quote: 1_600_000n })), MANIFEST, ALICE, book, 'sig', 1_000)
    expect(bought.map(fill => [fill.side, fill.shares, fill.collateral])).toEqual([['BUY', 4_000_000n, 1_600_000n]])
    expect(fillCashFlow(bought[0]!).amount).toBe(-1_600_000n)
    const sold = decodeTraderFills(logs(fillLog({ maker: ALICE, taker: BOB, takerIsBuy: true, base: 4_000_000n, quote: 1_600_000n })), MANIFEST, ALICE, book, 'sig', 1_000)
    expect(sold.map(fill => fill.side)).toEqual(['SELL'])
    expect(fillCashFlow(sold[0]!).amount).toBe(1_600_000n)
    const takerSold = decodeTraderFills(logs(fillLog({ maker: BOB, taker: ALICE, takerIsBuy: false, base: 1n, quote: 1n })), MANIFEST, ALICE, book, 'sig', 1_000)
    expect(takerSold.map(fill => fill.side)).toEqual(['SELL'])
  })

  test('another trader’s fill, another book’s fill and a self-match are all excluded', () => {
    const elsewhere = decodeTraderFills(logs(fillLog({ maker: BOB, taker: BOB, takerIsBuy: true, base: 1n, quote: 1n })), MANIFEST, ALICE, book, 'sig', 1_000)
    expect(elsewhere).toEqual([])
    const otherBook = decodeTraderFills(logs(fillLog({ maker: BOB, taker: ALICE, takerIsBuy: true, base: 1n, quote: 1n, market: MARKET })), MANIFEST, ALICE, book, 'sig', 1_000)
    expect(otherBook).toEqual([])
    const self = decodeTraderFills(logs(fillLog({ maker: ALICE, taker: ALICE, takerIsBuy: true, base: 1n, quote: 1n })), MANIFEST, ALICE, book, 'sig', 1_000)
    expect(self).toEqual([])
  })

  test('fills in one transaction keep distinct ids so the chart cannot double count', () => {
    const two = decodeTraderFills(
      logs(fillLog({ maker: BOB, taker: ALICE, takerIsBuy: true, base: 1n, quote: 1n }), fillLog({ maker: BOB, taker: ALICE, takerIsBuy: true, base: 1n, quote: 1n })),
      MANIFEST, ALICE, book, 'sig', 1_000,
    )
    expect(new Set(two.map(fill => fill.id)).size).toBe(2)
  })

  test('truncated logs do not attribute the rest of a transaction to the venue', () => {
    expect(manifestProgramData([`Program ${MANIFEST} invoke [1]`, 'Program other111 success', 'Program data: dHJ1bmNhdGVk'], MANIFEST)).toEqual([])
  })
})

describe('Solana profile identity and presentation', () => {
  test('base58 addresses are compared exactly, EVM addresses are not', () => {
    expect(sameProfileAddress(ALICE, ALICE.toLowerCase(), 'solana')).toBe(false)
    expect(sameProfileAddress(ALICE, ALICE, 'solana')).toBe(true)
    expect(sameProfileAddress('0xAbC', '0xabc')).toBe(true)
    expect(sameProfileAddress(undefined, ALICE, 'solana')).toBe(false)
  })

  test('a cluster is named by its genesis hash, and an unknown one is not guessed', () => {
    expect(solanaNetwork('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')).toBe('devnet')
    expect(solanaNetwork('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')).toBe('mainnet')
    expect(solanaNetwork('something-else')).toBeUndefined()
  })

  test('the positions table shows where shares sit instead of one unexplained total', () => {
    const rows = solanaPositionRows(portfolio({ questions: [holding({ outcomes: [
      outcome({ seatShares: 3_000_000n, reservedShares: 1_000_000n, bestBid: 500_000n, bestAsk: 600_000n }), outcome({}, 1),
    ] })] }), [question], 6)
    const html = renderToStaticMarkup(<SolanaPositionsTable rows={rows} decimals={6} symbol="fUSDC"/>)
    expect(html).toContain('Will genesis-01 win?')
    expect(html).toContain('On the venue seat')
    expect(html).toContain('Reserved in sell orders')
    expect(html).toContain('0.5 fUSDC')
    expect(html).toContain('2 fUSDC')
    expect(html).not.toContain('In your wallet')
  })

  test('the orders table states the escrow a resting order still holds', () => {
    const rows = solanaOrderRows(portfolio({ questions: [holding({ outcomes: [
      outcome({ orders: [{ sequence: '1', side: 'BUY', price: 500_000n, quantity: 66_000_000n, reserved: 33_000_000n, lastValidSlot: 10 }] }),
      outcome({ orders: [{ sequence: '2', side: 'SELL', price: 700_000n, quantity: 2_000_000n, reserved: 0n, lastValidSlot: 10 }] }, 1),
    ] })] }), [question])
    const html = renderToStaticMarkup(<SolanaOrdersTable rows={rows} decimals={6} symbol="fUSDC"/>)
    expect(html).toContain('33 fUSDC')
    expect(html).toContain('2 shares')
    expect(html).toContain('Resting')
  })
})
