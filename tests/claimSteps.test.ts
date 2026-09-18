import { expect, test } from 'bun:test'
import {
  applyStage,
  claimBlocker,
  claimPayout,
  planClaimSteps,
  reconcileSteps,
  TRADE_STEPS,
  type ClaimFacts,
  type ClaimSide,
} from '../packages/adapters/solana/manifest/steps'

const side = (over: Partial<ClaimSide> = {}): ClaimSide => ({
  seatShares: 0n, reservedShares: 0n, walletShares: 0n, positionShares: 0n, asks: 0, ...over,
})

const facts = (over: Partial<ClaimFacts> = {}): ClaimFacts => ({
  voided: false,
  winningOutcome: 0,
  collateralSymbol: 'fUSDC',
  sides: [side(), side()],
  vaultAtoms: 0n,
  ...over,
})

const ids = (plan: ReturnType<typeof planClaimSteps>) => plan.steps.map(step => step.id)

/** The common case: a winner whose shares are already inside the position. The
 *  custody moves are all skipped and only the two money transactions remain. */
test('shares already in the position plan a redeem and a withdrawal, nothing else', () => {
  const plan = planClaimSteps(facts({ sides: [side({ positionShares: 23_000_000n }), side()] }))
  expect(ids(plan)).toEqual(['redeem', 'withdraw-vault'])
  expect(plan.most).toBe(2)
  expect(plan.approximate).toBe(false)
})

/** The run that made a claim look like it failed. Redeem pays into the shared
 *  prediction vault; the withdrawal is what the trader is actually waiting for,
 *  so it is planned rather than left on another control. */
test('the last planned step is the one that reaches the wallet', () => {
  const plan = planClaimSteps(facts({ sides: [side({ positionShares: 1_000_000n }), side()] }))
  const last = plan.steps[plan.steps.length - 1]!
  expect(last.kind).toBe('withdraw-vault')
  expect(last.step).toBe(TRADE_STEPS.withdrawVault('fUSDC'))
  expect(last.detail).toContain('changes the balance you see')
  // And the redeem says, in the trader's words, that it does not.
  expect(plan.steps.find(step => step.kind === 'redeem')!.detail).toContain('does not reach your wallet yet')
})

/** A redeem credits the vault, so a 'return' chip beside it would repeat on the
 *  rail the exact thing the trader complained about. */
test('the redeem carries no inbound collateral figure', () => {
  const plan = planClaimSteps(facts({ sides: [side({ positionShares: 5_000_000n }), side()] }))
  const redeem = plan.steps.find(step => step.kind === 'redeem')!
  expect(redeem.costs.some(cost => cost.kind === 'return')).toBe(false)
  const withdraw = plan.steps.find(step => step.kind === 'withdraw-vault')!
  expect(withdraw.costs.find(cost => cost.kind === 'return')?.amount).toBe(5_000_000n)
})

/** A hedged trader holds both books. Every custody move is its own signature,
 *  and the old panel promised none of them. */
test('shares on both books plan eight signatures and name each side separately', () => {
  const plan = planClaimSteps(facts({
    sides: [side({ seatShares: 10_000_000n }), side({ seatShares: 4_000_000n })],
  }))
  expect(ids(plan)).toEqual([
    'prepare-accounts',
    'withdraw-claims-0', 'withdraw-claims-1',
    'import-claims-0', 'import-claims-1',
    'redeem', 'withdraw-vault',
  ])
  expect(plan.most).toBe(8)
  // Two prepares under one label, which the rail counts as legs of one step.
  expect(plan.steps[0]!.repeats).toEqual({ least: 2, most: 2 })
  expect(plan.steps[1]!.step).toBe(TRADE_STEPS.withdrawClaims(0))
  expect(plan.steps[2]!.step).toBe(TRADE_STEPS.withdrawClaims(1))
})

/** Two unlabelled sends in one run reconcile onto one row. The old claim path
 *  emitted 'Solana transaction' three times. */
test('every planned step carries a distinct wallet label', () => {
  const plan = planClaimSteps(facts({
    sides: [side({ seatShares: 1n }), side({ seatShares: 1n })],
  }))
  const labels = plan.steps.map(step => step.step)
  expect(new Set(labels).size).toBe(labels.length)
  expect(labels).not.toContain('Solana transaction')
})

/** A repeat trader's accounts already exist, so promising a preparation that
 *  can only end as "Not needed" overstates the run. */
test('a complete account set drops the preparation from the plan', () => {
  const set = { vault: true, position: true, walletQuote: true, walletClaims: true, venueQuote: true, seat: true }
  const plan = planClaimSteps(facts({
    sides: [side({ seatShares: 10_000_000n }), side()],
    accounts: [set, set],
  }))
  expect(ids(plan)).not.toContain('prepare-accounts')
  expect(ids(plan)).toEqual(['withdraw-claims-0', 'import-claims-0', 'redeem', 'withdraw-vault'])
  expect(plan.most).toBe(4)
  // Read accounts make the count exact rather than a range.
  expect(plan.approximate).toBe(false)
})

test('unread accounts leave the preparation uncertain and its rent estimated', () => {
  const plan = planClaimSteps(facts({ sides: [side({ walletShares: 2n }), side()] }))
  const prepare = plan.steps.find(step => step.kind === 'prepare-accounts')!
  expect(prepare.certain).toBe(false)
  expect(prepare.costs[0]!.estimated).toBe(true)
  expect(plan.estimated).toBe(true)
})

/** A voided question returns half of every share on both sides. */
test('a voided question pays both sides at half', () => {
  expect(claimPayout(facts({
    voided: true,
    sides: [side({ positionShares: 10_000_000n }), side({ positionShares: 6_000_000n })],
  }))).toBe(8_000_000n)
  expect(claimPayout(facts({
    winningOutcome: 1,
    sides: [side({ positionShares: 10_000_000n }), side({ positionShares: 6_000_000n })],
  }))).toBe(6_000_000n)
})

/** Discovered before the first prompt, not thrown after the preparation has
 *  already been signed and confirmed. */
test('a resting ask blocks the claim and names the side it rests on', () => {
  const block = claimBlocker(facts({
    sides: [side({ positionShares: 5n }), side({ reservedShares: 23_000_000n, asks: 2 })],
  }))
  expect(block).toEqual({ outcomes: [1], shares: 23_000_000n, orders: 2 })
})

/** A resting bid escrows collateral, never shares. Telling the trader to cancel
 *  it would send them after an order that is not in the way. */
test('a resting bid does not block a claim', () => {
  expect(claimBlocker(facts({ sides: [side({ positionShares: 5n }), side()] }))).toBeNull()
})

/** The rail joins a live stage onto a planned step by the label alone. */
test('the live run reconciles onto the planned rail rather than landing as extras', () => {
  const plan = planClaimSteps(facts({ sides: [side({ seatShares: 8_000_000n }), side()] }))
  let live = applyStage([], { step: TRADE_STEPS.accounts, status: 'sent', signature: 'a' })
  live = applyStage(live, { step: TRADE_STEPS.withdrawClaims(0), status: 'sent', signature: 'b' })
  live = applyStage(live, { step: TRADE_STEPS.importClaims(0), status: 'sent', signature: 'c' })
  live = applyStage(live, { step: TRADE_STEPS.redeem, status: 'sent', signature: 'd' })
  live = applyStage(live, { step: TRADE_STEPS.withdrawVault('fUSDC'), status: 'sent', signature: 'e' })
  const rows = reconcileSteps(plan, live, true)
  expect(rows.some(row => row.unplanned)).toBe(false)
  expect(rows.filter(row => row.status === 'sent')).toHaveLength(5)
  expect(rows.map(row => row.signature)).toEqual(['a', 'b', 'c', 'd', 'e'])
})

/** The vault withdrawal takes the whole balance, so an earlier payout still
 *  sitting there is part of what this run returns. */
test('a balance already in the vault is added to the expected return', () => {
  const plan = planClaimSteps(facts({
    vaultAtoms: 7_000_000n,
    sides: [side({ positionShares: 3_000_000n }), side()],
  }))
  const withdraw = plan.steps.find(step => step.kind === 'withdraw-vault')!
  expect(withdraw.costs.find(cost => cost.kind === 'return')?.amount).toBe(10_000_000n)
  expect(withdraw.certain).toBe(true)
})
