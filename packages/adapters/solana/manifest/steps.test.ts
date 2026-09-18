import { expect, test } from 'bun:test'
import {
  applyStage,
  planReleaseSteps,
  planTradeSteps,
  reconcileSteps,
  rentLamports,
  SIGNATURE_LAMPORTS,
  TRADE_STEPS,
  uncertainSignature,
  LIMIT_LEGS,
  type LiveStep,
  type ReleaseFacts,
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
  expect(leg.repeats).toEqual({ least: 1, most: LIMIT_LEGS })
  expect(leg.step).toBe(TRADE_STEPS.match)
  expect(plan.approximate).toBe(true)
  // Prompts, not nodes. Two nodes stand for up to sixteen signatures, and
  // counting the nodes is what announced "Up to 2 transactions" to a trader who
  // was then asked to approve four.
  expect(plan.steps).toHaveLength(2)
  expect({ least: plan.least, most: plan.most }).toEqual({ least: 2, most: 2 * LIMIT_LEGS })
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
    ['Extra transaction', true],
    ['Fund order', false],
    ['Execute order', false],
  ])
  // The label is not lost by giving the row a title the width of every other
  // row's: it moves to `step`, which the detail pane prints.
  expect(rows[0]!.step).toBe(TRADE_STEPS.accounts)
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

const release = (over: Partial<ReleaseFacts> = {}): ReleaseFacts => ({
  side: 'BUY',
  collateralSymbol: 'fUSDC',
  releasedAtoms: 40_000_000n,
  releasedShares: 0n,
  seatAtoms: 0n,
  ...over,
})

test('a release is two signatures, because the cancellation moves nothing', () => {
  const plan = planReleaseSteps(release())
  expect(plan.steps.map(step => step.id)).toEqual(['cancel-order', 'withdraw-seat'])
  expect(plan.lamports).toBe(2n * SIGNATURE_LAMPORTS)
  expect(plan.approximate).toBe(false)
})

test('the withdrawal shows the whole seat, not only this order', () => {
  const plan = planReleaseSteps(release({ releasedAtoms: 40_000_000n, seatAtoms: 1_600_000n }))
  const returned = plan.steps[1]!.costs.find(cost => cost.kind === 'return')
  expect(returned?.amount).toBe(41_600_000n)
  // Money coming back is never added to what the run costs.
  expect(plan.collateralAtoms).toBe(0n)
})

test('an empty seat leaves the withdrawal uncertain rather than promising it', () => {
  const plan = planReleaseSteps(release({ releasedAtoms: 0n, seatAtoms: 0n }))
  expect(plan.steps[1]!.certain).toBe(false)
  expect(plan.steps[1]!.costs.some(cost => cost.kind === 'return')).toBe(false)
  expect(plan.approximate).toBe(true)
})

test('a resting offer releases shares, and never labels them as collateral', () => {
  const plan = planReleaseSteps(release({ side: 'SELL', releasedAtoms: 0n, releasedShares: 120_000_000n }))
  expect(plan.steps[1]!.step).toBe(TRADE_STEPS.withdrawShares)
  expect(plan.steps[1]!.costs.some(cost => cost.asset === 'COLLATERAL')).toBe(false)
})

test('an order already off the book marks only the cancellation not needed', () => {
  const plan = planReleaseSteps(release())
  const live = applyStage(
    applyStage([], { step: TRADE_STEPS.withdrawSeat('fUSDC'), status: 'preparing' }),
    { step: TRADE_STEPS.withdrawSeat('fUSDC'), status: 'sent', signature: 'x' },
  )
  const rows = reconcileSteps(plan, live, true)
  expect(rows[0]!.status).toBe('skipped')
  expect(rows[0]!.skipped).toBe('already-done')
  expect(rows[1]!.status).toBe('sent')
  expect(rows.some(row => row.unplanned)).toBe(false)
})

test('a release that stops after the cancellation keeps the withdrawal waiting', () => {
  const plan = planReleaseSteps(release())
  let live: LiveStep[] = applyStage([], { step: TRADE_STEPS.cancelOrder, status: 'preparing' })
  live = applyStage(live, { step: TRADE_STEPS.cancelOrder, status: 'sent', signature: 'a' })
  live = applyStage(live, { step: TRADE_STEPS.withdrawSeat('fUSDC'), status: 'preparing' })
  live = applyStage(live, { step: TRADE_STEPS.withdrawSeat('fUSDC'), status: 'failed', error: 'User rejected' })
  const rows = reconcileSteps(plan, live, true)
  expect(rows[0]!.status).toBe('sent')
  expect(rows[1]!.status).toBe('failed')
  expect(rows[1]!.error).toBe('User rejected')
})

test('a seat balance with no order behind it is one signature, not two', () => {
  const plan = planReleaseSteps(release({ cancels: false, releasedAtoms: 0n, seatAtoms: 40_000_000n }))
  expect(plan.steps.map(step => step.id)).toEqual(['withdraw-seat'])
  expect(plan.lamports).toBe(SIGNATURE_LAMPORTS)
  expect(plan.steps[0]!.costs.find(cost => cost.kind === 'return')?.amount).toBe(40_000_000n)
})

/**
 * The recording this count model was rewritten for. A 2000-share CLAW limit buy
 * at 50.0c was announced as "Up to 2 transactions" and then asked the wallet for
 * four: prepare, a complete-set leg through the opposite bids, a funding deposit
 * for the leg after it, and a direct leg. Two of the four arrived as rows the
 * plan had no slot for.
 */
test('the recorded limit buy plans every transaction it actually sent', () => {
  const plan = planTradeSteps(facts({
    type: 'limit',
    // The first leg quoted through the opposite bids, which is what suppressed
    // the funding step: it was planned only for a first leg routed direct.
    route: 'complete-set',
    accounts: { ...open, walletClaims: false },
    accountsAlternate: open,
    fundingAtoms: 1_000_000_000n,
    upfrontAtoms: 2_000_000_000n,
    // Two execute legs and one of them funded, from walking the books.
    run: { legs: 2, funds: 1 },
  }))
  expect(plan.steps.map(step => step.id)).toEqual(['prepare-accounts', 'fund-remaining', 'match-leg'])
  // The floor is what the run actually sent. The trader is never asked for a
  // transaction outside the range they read before the first prompt.
  expect({ least: plan.least, most: plan.most }).toEqual({ least: 4, most: 1 + 2 * LIMIT_LEGS })

  let live: LiveStep[] = []
  for (const stage of [
    { step: TRADE_STEPS.accounts, status: 'preparing' as const },
    { step: TRADE_STEPS.accounts, status: 'sent' as const, signature: 'a' },
    { step: TRADE_STEPS.completeSet(1), status: 'preparing' as const },
    { step: TRADE_STEPS.completeSet(1), status: 'sent' as const, signature: 'b' },
    { step: TRADE_STEPS.fundRemaining, status: 'preparing' as const },
    { step: TRADE_STEPS.fundRemaining, status: 'sent' as const, signature: 'c' },
    { step: TRADE_STEPS.match, status: 'preparing' as const },
    { step: TRADE_STEPS.match, status: 'sent' as const, signature: 'd' },
  ])
    live = applyStage(live, stage)
  const rows = reconcileSteps(plan, live, true)
  // Four transactions, four rows, and not one of them an "extra transaction the
  // preview could not see".
  expect(rows).toHaveLength(4)
  expect(rows.some(row => row.unplanned)).toBe(false)
  expect(rows.every(row => row.status === 'sent')).toBe(true)
})

test('the rail shows every leg from the first frame, so the list cannot grow', () => {
  const plan = planTradeSteps(facts({ type: 'limit', fundingAtoms: 5_000_000n, run: { legs: 3, funds: 2 } }))
  // Nothing signed yet: the rail already holds one row per leg the books say
  // this order takes. Materialising a leg only once its transaction had been
  // signed is what put "2 of 2 done" on screen with two prompts still queued.
  const empty = reconcileSteps(plan, [], false)
  expect(empty).toHaveLength(5)
  expect(empty.every(row => row.status === 'planned')).toBe(true)
  expect(empty.map(row => row.leg)).toEqual([1, 2, 1, 2, 3])

  // One leg in, and the row count has not moved.
  let live: LiveStep[] = []
  for (const stage of [
    { step: TRADE_STEPS.fundRemaining, status: 'preparing' as const },
    { step: TRADE_STEPS.fundRemaining, status: 'sent' as const, signature: 'f' },
  ])
    live = applyStage(live, stage)
  expect(reconcileSteps(plan, live, false)).toHaveLength(5)
})

test('a leg the run turned out not to need reads as not needed, never as missing', () => {
  const plan = planTradeSteps(facts({ type: 'limit', fundingAtoms: 5_000_000n, run: { legs: 2, funds: 1 } }))
  let live: LiveStep[] = []
  for (const stage of [
    { step: TRADE_STEPS.match, status: 'preparing' as const },
    { step: TRADE_STEPS.match, status: 'sent' as const, signature: 'm' },
  ])
    live = applyStage(live, stage)
  const rows = reconcileSteps(plan, live, true)
  expect(rows.map(row => row.status)).toEqual(['skipped', 'sent', 'skipped'])
})

/**
 * The same defect as the limit buy, and worse: a market sell announced ONE
 * transaction while the real flow sends up to four. The ticket sizes a sell from
 * the typed shares, but the plan was reading a buy-only quote that is always
 * null on a sell, so the custody facts were dropped and every custody step with
 * them.
 */
test('a sell whose custody has not been read still plans the custody moves', () => {
  const plan = planTradeSteps(facts({ side: 'sell', accounts: { ...open, walletClaims: false }, sell: null }))
  expect(plan.steps.map(step => step.id)).toEqual([
    'prepare-accounts',
    'release-claims',
    'deposit-claims',
    'sell-order',
  ])
  // The preparation and the order itself are certain — a named account is
  // missing and the sell always sends. The two custody moves are planned but
  // not promised, because shares already on the book seat move nothing.
  expect({ least: plan.least, most: plan.most }).toEqual({ least: 2, most: 4 })

  // Read custody with nothing to move is still the one-transaction sell it was.
  const ready = planTradeSteps(facts({ side: 'sell', sell: { exportAtoms: 0n, depositAtoms: 0n, matched: true } }))
  expect(ready.steps.map(step => step.id)).toEqual(['sell-order'])
  expect({ least: ready.least, most: ready.most }).toEqual({ least: 1, most: 1 })
})

test('an extra signature fee is counted once per leg, and rent only once', () => {
  const plan = planTradeSteps(facts({ type: 'limit', fundingAtoms: 1n }))
  // Two nodes, each repeating up to LIMIT_LEGS. Only the signature fee repeats:
  // a collateral figure is bound to the whole order and rent is paid once.
  expect(plan.lamports).toBe(2n * BigInt(LIMIT_LEGS) * SIGNATURE_LAMPORTS)
})

test('a sell never plans the other outcome, because it never prepares one', () => {
  // A trader who bought YES direct has no NO claim account, and the ticket used
  // to hand that fact to every limit plan, sell included. The sell path prepares
  // the selected binding once, so the extra set was a firm promise of a
  // transaction that only ever ended as "Not needed".
  const half = { ...open, walletClaims: false }
  const plan = planTradeSteps(facts({
    side: 'sell', type: 'limit', accounts: open, accountsAlternate: half,
    sell: { exportAtoms: 5_000_000n, depositAtoms: 5_000_000n, matched: true },
  }))
  expect(plan.steps.map(step => step.id)).toEqual(['release-claims', 'deposit-claims', 'sell-order'])
  expect({ least: plan.least, most: plan.most }).toEqual({ least: 3, most: 3 })
  expect(plan.lamports).toBe(3n * SIGNATURE_LAMPORTS)
})

test('a stopped run leaves every untouched row waiting, above the stop as well as below', () => {
  // The plan lists both funding legs before both execute legs, but the run
  // interleaves them: fund, execute, fund, execute. A failure on the first
  // execute leaves the SECOND funding row — which sits above it on the list —
  // untouched, and a run that stopped never skipped it.
  const plan = planTradeSteps(facts({ type: 'limit', fundingAtoms: 5_000_000n, run: { legs: 2, funds: 2 } }))
  let live: LiveStep[] = []
  for (const stage of [
    { step: TRADE_STEPS.fundRemaining, status: 'preparing' as const },
    { step: TRADE_STEPS.fundRemaining, status: 'sent' as const, signature: 'f' },
    { step: TRADE_STEPS.match, status: 'preparing' as const },
    { step: TRADE_STEPS.match, status: 'failed' as const, error: 'Simulation failed' },
  ])
    live = applyStage(live, stage)
  const rows = reconcileSteps(plan, live, true)
  expect(rows.map(row => row.status)).toEqual(['sent', 'planned', 'failed', 'planned'])
  expect(rows.every(row => row.skipped === undefined)).toBe(true)
})

test('two unforeseen transactions under one label are two rows, not one', () => {
  const plan = planTradeSteps(facts())
  let live: LiveStep[] = []
  for (const stage of [
    { step: 'Something unforeseen', status: 'preparing' as const },
    { step: 'Something unforeseen', status: 'sent' as const, signature: 'one' },
    { step: 'Something unforeseen', status: 'preparing' as const },
    { step: 'Something unforeseen', status: 'sent' as const, signature: 'two' },
    { step: TRADE_STEPS.submit, status: 'preparing' as const },
    { step: TRADE_STEPS.submit, status: 'sent' as const, signature: 'order' },
  ])
    live = applyStage(live, stage)
  const rows = reconcileSteps(plan, live, true)
  // Folding them hid a signature the trader had already approved, which is the
  // same concealment the planned side of this function exists to prevent.
  expect(rows.map(row => [row.unplanned, row.signature])).toEqual([
    [true, 'one'],
    [true, 'two'],
    [false, 'order'],
  ])
  expect(new Set(rows.map(row => row.id)).size).toBe(3)
})

test('an unplanned transaction is placed by what ran, not by its step name', () => {
  // Two execute legs with an unforeseen transaction between them. Every leg row
  // shares one `matches` list, so reading the step's first live index put the
  // extra transaction ahead of the leg that had already confirmed before it.
  const plan = planTradeSteps(facts({ type: 'limit', run: { legs: 3, funds: 0 } }))
  let live: LiveStep[] = []
  for (const stage of [
    { step: TRADE_STEPS.match, status: 'preparing' as const },
    { step: TRADE_STEPS.match, status: 'sent' as const, signature: 'm1' },
    { step: 'Something unforeseen', status: 'preparing' as const },
    { step: 'Something unforeseen', status: 'sent' as const, signature: 'x' },
    { step: TRADE_STEPS.match, status: 'preparing' as const },
    { step: TRADE_STEPS.match, status: 'sent' as const, signature: 'm2' },
  ])
    live = applyStage(live, stage)
  const rows = reconcileSteps(plan, live, true)
  expect(rows.map(row => row.signature)).toEqual(['m1', 'x', 'm2', undefined])
  // The third planned leg never ran, so it sorts last rather than claiming a
  // place in a run it took no part in.
  expect(rows[3]!.status).toBe('skipped')
})
