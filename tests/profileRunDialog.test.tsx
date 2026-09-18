import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProfileRunDialog } from '../src/components/portfolio/ProfileRunDialog'
import { applyStage, planReleaseSteps, reconcileSteps, TRADE_STEPS } from '../packages/adapters/solana/manifest/steps'

const plan = planReleaseSteps({
  side: 'BUY', collateralSymbol: 'fUSDC', releasedAtoms: 40_000_000n, releasedShares: 0n, seatAtoms: 1_600_000n,
})

const releaseHeadings = {
  idle: 'Release this order',
  running: 'Releasing your order',
  stopped: 'Release stopped',
  done: 'Release finished',
}

const dialog = (over: Partial<Parameters<typeof ProfileRunDialog>[0]> = {}) =>
  renderToStaticMarkup(
    <ProfileRunDialog
      open onClose={() => {}} onConfirm={() => {}} pending={false} disabled={false}
      title="PURR vs ZCAT" label="Release · NO" headings={releaseHeadings}
      recap={[
        { term: 'Returns to wallet', value: '41.6 fUSDC' },
        { term: 'Shares released', value: '80' },
        { term: 'Order', value: '#2' },
      ]}
      note="Cancelling credits your venue seat. The second signature is what moves it to your wallet."
      plan={plan} steps={reconcileSteps(plan, [], false)} settled={false}
      collateralSymbol="fUSDC" collateralDecimals={6} network="DEVNET"
      {...over}
    />,
  )

/** Every rule in TradeSteps.css is scoped under `.ch-trade-dialog`. A stepper
 *  rendered outside it is an unstyled list, which is what a rail dropped into
 *  the profile side panel actually was. */
test('a profile run uses the trade dialog shell, so the stepper is styled at all', () => {
  const html = dialog()
  expect(html).toContain('ch-event-dialog ch-trade-dialog')
  expect(html).toContain('ch-tx-steps')
  expect(html).toContain('ch-trade-recap')
})

test('the amount coming back is named before the first prompt', () => {
  const html = dialog()
  expect(html).toContain('Returns to wallet')
  expect(html).toContain('41.6 fUSDC')
  // The rail repeats it as an inbound figure, never as a cost.
  expect(html).toContain('+41.6 fUSDC')
  expect(html).toContain('Sign 2 transactions')
  expect(html).toContain('The second signature is what moves it to your wallet')
})

test('an untouched run shows the tray, never a stepper mid-run', () => {
  expect(dialog()).toContain('Release this order')
})

test('once a prompt has been raised the heading follows the run', () => {
  const live = applyStage([], { step: TRADE_STEPS.cancelOrder, status: 'sent', signature: 'a' })
  const steps = reconcileSteps(plan, live, true)
  expect(dialog({ steps, settled: true })).toContain('Release finished')
  expect(dialog({ steps, settled: true, error: 'User rejected' })).toContain('Release stopped')
})

test('a settled run drops the confirm button rather than offering it twice', () => {
  const live = applyStage([], { step: TRADE_STEPS.cancelOrder, status: 'sent', signature: 'a' })
  const html = dialog({ steps: reconcileSteps(plan, live, true), settled: true })
  expect(html).not.toContain('Sign 2 transactions')
  expect(html).toContain('Close')
})

/** An order cancelled before this flow existed leaves collateral on the seat
 *  and no order row to reach it from. That balance gets its own entry point. */
test('a seat-only withdrawal drops the cancellation from the dialog entirely', () => {
  const seat = planReleaseSteps({
    cancels: false, side: 'BUY', collateralSymbol: 'fUSDC',
    releasedAtoms: 0n, releasedShares: 0n, seatAtoms: 40_000_000n,
  })
  const html = dialog({
    headings: {
      idle: 'Withdraw from your seat', running: 'Withdrawing your balance',
      stopped: 'Withdrawal stopped', done: 'Withdrawal finished',
    },
    label: 'Withdraw · NO',
    recap: [{ term: 'Returns to wallet', value: '40 fUSDC' }, { term: 'Held on', value: 'Venue seat' }],
    note: 'This balance was credited to your seat by an earlier cancellation. One signature moves it to your wallet.',
    plan: seat,
    steps: reconcileSteps(seat, [], false),
  })
  expect(html).toContain('Withdraw from your seat')
  expect(html).toContain('Sign 1 transaction<')
  expect(html).toContain('40 fUSDC')
  expect(html).not.toContain('Release order')
  expect(html).toContain('credited to your seat by an earlier cancellation')
})

/** The footer used to promise `plan.most` flat. An empty seat plans least 1 and
 *  most 2, so it asked for two signatures and raised one. */
test('an approximate plan is confirmed as a range, not as its ceiling', () => {
  const empty = planReleaseSteps({
    side: 'BUY', collateralSymbol: 'fUSDC', releasedAtoms: 0n, releasedShares: 0n, seatAtoms: 0n,
  })
  expect(empty.approximate).toBe(true)
  const html = dialog({ plan: empty, steps: reconcileSteps(empty, [], false) })
  expect(html).toContain('Sign 1 to 2 transactions')
})

/** The precondition a claim used to discover mid-run, after the trader had
 *  already signed the account preparation. */
test('a blocker is shown before the rail and takes the confirm out of reach', () => {
  const html = dialog({
    blocker: { message: 'Cancel your open sell order for this question first.', detail: '23 shares are reserved.' },
  })
  expect(html).toContain('Cancel your open sell order for this question first.')
  expect(html).toContain('23 shares are reserved.')
  expect(html).toMatch(/class="ch-submit-trade"[^>]*disabled/)
})
