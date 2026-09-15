import { expect, test } from 'bun:test'
import {
  applyStage,
  planTradeSteps,
  reconcileSteps,
  rentLamports,
  SIGNATURE_LAMPORTS,
  TRADE_STEPS,
  uncertainSignature,
  type LiveStep,
  type StepFacts,
} from './steps'

const open: StepFacts['accounts'] = { vault: true, position: true, walletQuote: true, walletClaims: true, venueQuote: true, seat: true }

const facts = (over: Partial<StepFacts> = {}): StepFacts => ({
  side: 'buy',
  type: 'market',
  route: 'direct',
  outcome: 0,
  collateralSymbol: 'fUSDC',
  books: [true, true],
  accounts: open,
  fundingAtoms: 0n,
  upfrontAtoms: 0n,
  maxFeeAtoms: 3_000n,
  ...over,
})

const fresh: StepFacts['accounts'] = {
  vault: false,
  position: false,
  walletQuote: false,
  walletClaims: false,
  venueQuote: false,
  seat: false,
}

const ids = (over: Partial<StepFacts> = {}) => planTradeSteps(facts(over)).steps.map(step => step.id)

test('rent matches the figures Solana has always charged', () => {
  // An empty account and an SPL token account. If either of these moves, the
  // constant is wrong, not the test.
  expect(rentLamports(0)).toBe(890_880n)
  expect(rentLamports(165)).toBe(2_039_280n)
})

test('a repeat trader on a live question signs exactly once', () => {
  const plan = planTradeSteps(facts())
  // Every setup account already exists, so prepare() sends nothing and the plan
  // says so rather than showing a step that turns out to be unnecessary.
  expect(plan.steps.map(step => step.id)).toEqual(['submit-order'])
  expect(plan.lamports).toBe(SIGNATURE_LAMPORTS)
  expect(plan.firstOpen).toBe(false)
  expect(plan.estimated).toBe(false)
  expect(plan.approximate).toBe(false)
})

test('a fresh wallet on a live question pays rent for its own accounts only', () => {
  const plan = planTradeSteps(facts({ accounts: { ...open, vault: false, position: false, walletClaims: false } }))
  const setup = plan.steps.find(step => step.id === 'prepare-accounts')!
  expect(setup.certain).toBe(true)
  const expected =
    rentLamports(203) + rentLamports(165) + rentLamports(201) + rentLamports(165) + SIGNATURE_LAMPORTS
  expect(setup.costs[0]!.amount).toBe(expected)
  expect(setup.costs[0]!.estimated).toBe(false)
  // No question and no book rent: someone else already paid those.
  expect(plan.lamports).toBe(expected + SIGNATURE_LAMPORTS)
})

test('the first trader on a fresh question opens the market and both books', () => {
  expect(ids({ books: [false, false], questionExists: false, accounts: fresh })).toEqual([
    'open-question',
    'open-book-0',
    'open-book-1',
    'prepare-accounts',
    'submit-order',
  ])
})

test('an unread question account leaves the opening step uncertain rather than guessed', () => {
  const plan = planTradeSteps(facts({ books: [false, false] }))
  expect(plan.steps[0]!.certain).toBe(false)
  expect(plan.approximate).toBe(true)
})

test('a question already created is not offered for creation again', () => {
  expect(ids({ books: [false, false], questionExists: true, accounts: fresh })).toEqual([
    'open-book-0',
    'open-book-1',
    'prepare-accounts',
    'submit-order',
  ])
})

test('one open book leaves only the other to activate', () => {
  const plan = planTradeSteps(facts({ books: [true, false], accounts: fresh }))
  expect(plan.steps.map(step => step.id)).toEqual(['open-book-1', 'prepare-accounts', 'submit-order'])
  // One side being open proves the question exists, so it is never asked about.
  expect(plan.firstOpen).toBe(false)
})

test('funding appears only when the seat is short of the order', () => {
  expect(ids({ fundingAtoms: 0n })).not.toContain('fund-book')
  const plan = planTradeSteps(facts({ fundingAtoms: 5_000_000n }))
  expect(plan.steps.map(step => step.id)).toEqual(['fund-book', 'submit-order'])
  expect(plan.collateralAtoms).toBe(5_000_000n + 3_000n)
})

test('a limit buy is one repeating execute step with the loop ceiling on it', () => {
  const plan = planTradeSteps(facts({ type: 'limit', fundingAtoms: 1n }))
  const leg = plan.steps.find(step => step.id === 'match-leg')!
  expect(leg.repeats).toEqual({ most: 8 })
  expect(leg.step).toBe(TRADE_STEPS.match)
  expect(plan.approximate).toBe(true)
})

test('a complete-set buy pays upfront collateral that is not counted as spend', () => {
  const plan = planTradeSteps(facts({ route: 'complete-set', upfrontAtoms: 10_000_000n }))
  expect(plan.steps.map(step => step.id)).toEqual(['complete-set'])
  expect(plan.steps[0]!.step).toBe(TRADE_STEPS.completeSet(1))
  // The upfront returns inside the same transaction, so only the fee is spend.
  expect(plan.collateralAtoms).toBe(3_000n)
})

test('a sell moves shares only when they are not already on the seat', () => {
  expect(ids({ side: 'sell', sell: { exportAtoms: 0n, depositAtoms: 0n, matched: true } })).toEqual(['sell-order'])
  expect(ids({ side: 'sell', sell: { exportAtoms: 4n, depositAtoms: 4n, matched: true }, accounts: fresh })).toEqual([
    'prepare-accounts',
    'release-claims',
    'deposit-claims',
    'sell-order',
  ])
})

test('an unmatched sell rests an offer instead of selling', () => {
  const plan = planTradeSteps(facts({ side: 'sell', sell: { exportAtoms: 0n, depositAtoms: 0n, matched: false } }))
  expect(plan.steps[0]!.step).toBe(TRADE_STEPS.offer)
})

test('every planned step names a label the wallet actually emits', () => {
  const emitted = new Set<string>([
    TRADE_STEPS.question,
    TRADE_STEPS.book(0),
    TRADE_STEPS.book(1),
    TRADE_STEPS.accounts,
    TRADE_STEPS.fundBook('fUSDC'),
    TRADE_STEPS.fundRemaining,
    TRADE_STEPS.submit,
    TRADE_STEPS.match,
    TRADE_STEPS.rest,
    TRADE_STEPS.completeSet(0),
    TRADE_STEPS.completeSet(1),
    TRADE_STEPS.release,
    TRADE_STEPS.deposit,
    TRADE_STEPS.sell,
    TRADE_STEPS.offer,
  ])
  const routes: Partial<StepFacts>[] = [
    { books: [false, false], questionExists: false, fundingAtoms: 1n, accounts: fresh },
    { type: 'limit', fundingAtoms: 1n },
    { type: 'limit', route: 'complete-set' },
    { route: 'complete-set' },
    { side: 'sell', sell: { exportAtoms: 1n, depositAtoms: 1n, matched: true } },
    { side: 'sell', sell: { exportAtoms: 0n, depositAtoms: 0n, matched: false } },
  ]
  for (const route of routes)
    for (const step of planTradeSteps(facts(route)).steps) expect(emitted.has(step.step)).toBe(true)
})

test('a stage that arrives before its plan still lands on the rail', () => {
  const plan = planTradeSteps(facts())
  const live = applyStage([], { step: 'Something unforeseen', status: 'sent', signature: 'sig' })
  const rows = reconcileSteps(plan, live, true)
  // It goes where it happened: the transaction that ran sorts before the
  // planned step that never did, rather than being appended after it.
  expect(rows.map(row => row.unplanned)).toEqual([true, false])
  expect(rows[0]!.status).toBe('sent')
  expect(rows[1]!.status).toBe('skipped')
})

test('an unplanned step lands where it ran, not at the end', () => {
  const plan = planTradeSteps(facts({ type: 'limit', fundingAtoms: 3_400_000n }))
  let live: LiveStep[] = []
  for (const stage of [
    // prepare() fires first inside the limit loop, before any funding.
    { step: TRADE_STEPS.accounts, status: 'preparing' as const },
    { step: TRADE_STEPS.accounts, status: 'sent' as const, signature: 'p' },
    { step: TRADE_STEPS.fundRemaining, status: 'preparing' as const },
    { step: TRADE_STEPS.fundRemaining, status: 'sent' as const, signature: 'f' },
    { step: TRADE_STEPS.rest, status: 'preparing' as const },
    { step: TRADE_STEPS.rest, status: 'sent' as const, signature: 'r' },
  ])
    live = applyStage(live, stage)
  const rows = reconcileSteps(plan, live, true)
  // The unplanned prepare ran first, so it sits first — not appended third,
  // which is what made a transaction that ran before the others look like a
  // fourth step spawned at the end.
  expect(rows.map(row => [row.title, row.unplanned])).toEqual([
    [TRADE_STEPS.accounts, true],
    ['Fund order', false],
    ['Execute order', false],
  ])
  expect(rows.every(row => row.status === 'sent')).toBe(true)
})

test('a limit buy plans setup when either binding still needs it', () => {
  const half = { ...open, walletClaims: false }
  // The selected side is ready; the opposite one, which a complete-set leg
  // would prepare, is not. One step, not an unplanned surprise mid-run.
  const plan = planTradeSteps(facts({ type: 'limit', accounts: open, accountsAlternate: half }))
  const setup = plan.steps.find(step => step.id === 'prepare-accounts')
  expect(setup).toBeDefined()
  expect(setup!.costs[0]!.amount).toBe(rentLamports(165) + SIGNATURE_LAMPORTS)
  // Both ready is still no step at all.
  expect(planTradeSteps(facts({ type: 'limit', accounts: open, accountsAlternate: open })).steps.map(s => s.id))
    .toEqual(['match-leg'])
})

test('a retry keeps the failure it is retrying', () => {
  let live: LiveStep[] = []
  for (const stage of [
    { step: TRADE_STEPS.submit, status: 'preparing' as const },
    { step: TRADE_STEPS.submit, status: 'failed' as const, error: 'Blockhash not found' },
    { step: TRADE_STEPS.submit, status: 'preparing' as const },
    { step: TRADE_STEPS.submit, status: 'sent' as const, signature: 'second' },
  ])
    live = applyStage(live, stage)
  expect(live.map(entry => entry.status)).toEqual(['failed', 'sent'])
  const row = reconcileSteps(planTradeSteps(facts()), live, true).find(item => item.id === 'submit-order')!
  expect(row.attempts).toBe(2)
  expect(row.status).toBe('sent')
  expect(row.signature).toBe('second')
})

test('a repeating step becomes one row per leg, not one row saying leg 3', () => {
  let live: LiveStep[] = []
  for (const signature of ['a', 'b', 'c']) {
    live = applyStage(live, { step: TRADE_STEPS.match, status: 'preparing' })
    live = applyStage(live, { step: TRADE_STEPS.match, status: 'sent', signature })
  }
  const plan = planTradeSteps(facts({ type: 'limit' }))
  const legs = reconcileSteps(plan, live, true).filter(item => item.kind === 'match-leg')
  // Three signatures the trader approved are three rows on the rail.
  expect(legs).toHaveLength(3)
  expect(legs.map(row => row.leg)).toEqual([1, 2, 3])
  expect(legs.map(row => row.signature)).toEqual(['a', 'b', 'c'])
  expect(new Set(legs.map(row => row.id)).size).toBe(3)
})

test('a retry stays inside the leg it is retrying', () => {
  let live: LiveStep[] = []
  live = applyStage(live, { step: TRADE_STEPS.match, status: 'preparing' })
  live = applyStage(live, { step: TRADE_STEPS.match, status: 'sent', signature: 'a' })
  live = applyStage(live, { step: TRADE_STEPS.match, status: 'preparing' })
  live = applyStage(live, { step: TRADE_STEPS.match, status: 'failed', error: 'Blockhash not found' })
  live = applyStage(live, { step: TRADE_STEPS.match, status: 'preparing' })
  live = applyStage(live, { step: TRADE_STEPS.match, status: 'sent', signature: 'b' })
  const legs = reconcileSteps(planTradeSteps(facts({ type: 'limit' })), live, true).filter(row => row.kind === 'match-leg')
  // Two transactions, not three: the failure and the retry are one leg.
  expect(legs).toHaveLength(2)
  expect(legs.map(row => [row.attempts, row.status])).toEqual([[1, 'sent'], [2, 'sent']])
})

test('a planned step is only called skipped once the flow has finished', () => {
  const plan = planTradeSteps(facts({ fundingAtoms: 5n }))
  const live = applyStage([], { step: TRADE_STEPS.submit, status: 'sent', signature: 'sig' })
  expect(reconcileSteps(plan, live, false).find(row => row.id === 'fund-book')!.status).toBe('planned')
  const done = reconcileSteps(plan, live, true).find(row => row.id === 'fund-book')!
  expect(done.status).toBe('skipped')
  expect(done.skipped).toBe('not-needed')
})

test('a sent transaction that never confirmed is uncertain, not failed, and keeps its link', () => {
  const signature = '4kj9ZQrTvW2mXsB7YnHgFdCeAuPqRtSvNbMwLkJhGfDsQaZxCvBnMkLjHgFdSaQw'
  const live = applyStage([], {
    step: TRADE_STEPS.submit,
    status: 'failed',
    error: `Check transaction ${signature} before retrying: confirmation unavailable`,
  })
  const row = reconcileSteps(planTradeSteps(facts()), live, true).find(item => item.id === 'submit-order')!
  expect(row.status).toBe('uncertain')
  expect(row.signature).toBe(signature)
})

test('an ordinary failure carries no signature', () => {
  expect(uncertainSignature('Transaction simulation failed: "AccountNotFound"')).toBeUndefined()
  expect(uncertainSignature(undefined)).toBeUndefined()
})

test('a run that stopped did not skip what it never reached', () => {
  const plan = planTradeSteps(facts({ books: [false, false], questionExists: false, accounts: fresh }))
  let live: LiveStep[] = []
  for (const stage of [
    { step: TRADE_STEPS.question, status: 'preparing' as const },
    { step: TRADE_STEPS.question, status: 'sent' as const, signature: 'a' },
    { step: TRADE_STEPS.book(0), status: 'preparing' as const },
    { step: TRADE_STEPS.book(0), status: 'failed' as const, error: 'Simulation failed' },
  ])
    live = applyStage(live, stage)
  const rows = reconcileSteps(plan, live, true)
  expect(rows.map(row => row.status)).toEqual(['sent', 'failed', 'planned', 'planned', 'planned'])
  // Nothing past the stop may claim it was unnecessary.
  expect(rows.slice(2).every(row => row.skipped === undefined)).toBe(true)
})

test('a limit buy that rests instead of matching stays one execute step', () => {
  // The screenshot case: fund confirmed, then the book was not marketable, so
  // placeBinaryLimitBuy sent "Placing the unfilled limit order" rather than
  // "Matching your order". That must land on the planned execute step, not
  // appear beside it while the real one waits for ever.
  const plan = planTradeSteps(facts({ type: 'limit', fundingAtoms: 3_400_000n }))
  let live: LiveStep[] = []
  for (const stage of [
    { step: TRADE_STEPS.fundRemaining, status: 'preparing' as const },
    { step: TRADE_STEPS.fundRemaining, status: 'sent' as const, signature: 'a' },
    { step: TRADE_STEPS.rest, status: 'preparing' as const },
    { step: TRADE_STEPS.rest, status: 'signing' as const },
  ])
    live = applyStage(live, stage)
  const rows = reconcileSteps(plan, live, false)
  expect(rows).toHaveLength(2)
  expect(rows.some(row => row.unplanned)).toBe(false)
  expect(rows[1]!.title).toBe('Execute order')
  expect(rows[1]!.status).toBe('signing')
  expect(rows[1]!.step).toBe(TRADE_STEPS.rest)
})

test('one limit run can match, route through the opposite book and rest on one step', () => {
  const plan = planTradeSteps(facts({ type: 'limit' }))
  let live: LiveStep[] = []
  for (const step of [TRADE_STEPS.match, TRADE_STEPS.completeSet(1), TRADE_STEPS.rest]) {
    live = applyStage(live, { step, status: 'preparing' })
    live = applyStage(live, { step, status: 'sent', signature: step })
  }
  const rows = reconcileSteps(plan, live, true)
  expect(rows.some(row => row.unplanned)).toBe(false)
  const execute = rows.filter(row => row.title === 'Execute order')
  expect(execute).toHaveLength(3)
  expect(execute.every(row => row.status === 'sent')).toBe(true)
})

test('a sell that rests instead of filling stays one execute step', () => {
  const plan = planTradeSteps(facts({ side: 'sell', sell: { exportAtoms: 0n, depositAtoms: 0n, matched: true } }))
  const live = applyStage(applyStage([], { step: TRADE_STEPS.offer, status: 'preparing' }), {
    step: TRADE_STEPS.offer,
    status: 'sent',
    signature: 'x',
  })
  const rows = reconcileSteps(plan, live, true)
  expect(rows).toHaveLength(1)
  expect(rows[0]!.unplanned).toBe(false)
  expect(rows[0]!.status).toBe('sent')
})
