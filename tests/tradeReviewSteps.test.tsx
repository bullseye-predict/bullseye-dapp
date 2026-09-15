import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TradeReviewDialog } from '../src/components/home/TradeReviewDialog'
import { tradeAgreement } from '../src/components/home/tradeAgreement'
import {
  applyStage,
  planTradeSteps,
  reconcileSteps,
  TRADE_STEPS,
  type StepFacts,
} from '../packages/adapters/solana/manifest/steps'

const accounts = { vault: true, position: true, walletQuote: true, walletClaims: true, venueQuote: true, seat: true }

const facts = (over: Partial<StepFacts> = {}): StepFacts => ({
  side: 'buy',
  type: 'market',
  route: 'direct',
  outcome: 0,
  collateralSymbol: 'fUSDC',
  books: [true, true],
  accounts,
  fundingAtoms: 0n,
  upfrontAtoms: 0n,
  maxFeeAtoms: 3_000n,
  ...over,
})

function render(over: Partial<Parameters<typeof TradeReviewDialog>[0]> = {}, factsOver: Partial<StepFacts> = {}, live: Parameters<typeof applyStage>[1][] = [], settled = false) {
  const plan = planTradeSteps(facts(factsOver))
  const rows = live.reduce<ReturnType<typeof applyStage>>((acc, stage) => applyStage(acc, stage), [])
  return renderToStaticMarkup(
    <TradeReviewDialog
      open
      onClose={() => {}}
      onConfirm={() => {}}
      pending={false}
      disabled={false}
      title="Who will win: JUP or ANSEM?"
      label="JUP"
      side="buy"
      type="market"
      price={0.68}
      quantity={1}
      fee={0}
      total={0.68}
      expiry="close"
      onExpiry={() => {}}
      simulation={false}
      network="SOLANA"
      collateralSymbol="fUSDC"
      plan={plan}
      steps={reconcileSteps(plan, rows, settled)}
      settled={settled}
      devnet
      {...over}
    />,
  )
}

describe('trade review dialog', () => {
  test('the invoice pane shows the order and how many signatures it needs', () => {
    const markup = render()
    expect(markup).toContain('Review your trade')
    expect(markup).toContain('1 transaction')
    expect(markup).toContain('Agree and sign on Solana')
    // The one-signature case must not be hedged.
    expect(markup).not.toContain('Up to')
    expect(markup).toContain('under 0.0001 SOL')
    // The tray shows the order, not the rail: the rail is the tray after it.
    expect(markup).not.toContain('ch-tx-steps')
  })

  test('the long paragraphs are gone and live behind the agreement instead', () => {
    const markup = render()
    expect(markup).toContain('How this trade settles')
    expect(markup).toContain('Confirming accepts the terms')
    // The three paragraphs this replaced, by their opening words.
    expect(markup).not.toContain('Unfilled orders wait until market close')
    expect(markup).not.toContain('When matching bids on the opposite outcome')
    expect(markup).not.toContain('Your Solana wallet will sign the first-trader activation')
  })

  test('a first-open trade counts every activation and welcomes the trader', () => {
    const markup = render({}, { books: [false, false], questionExists: false, accounts: { ...accounts, vault: false, position: false, walletQuote: false, walletClaims: false, venueQuote: false } })
    expect(markup).toContain('You are opening this market')
    expect(markup).toContain('5 transactions')
    expect(markup).toContain('≈0.0386 SOL')
    // No network named anywhere in the copy, so mainnet needs no rewrite.
    expect(markup).not.toContain('Devnet')
    expect(markup).not.toContain('test SOL')
  })

  test('a limit buy says the count can grow rather than hiding the loop', () => {
    const markup = render({ type: 'limit' }, { type: 'limit', fundingAtoms: 5_000_000n })
    expect(markup).toContain('Up to 2 transactions')
    expect(markup).toContain('once per price level')
  })

  test('confirming swaps the invoice for the rail', () => {
    const markup = render({}, {}, [
      { step: TRADE_STEPS.submit, status: 'preparing' },
      { step: TRADE_STEPS.submit, status: 'signing' },
    ])
    expect(markup).toContain('Signing your trade')
    expect(markup).toContain('Approve in wallet')
    expect(markup).toContain('ch-tx-steps')
    // The whole dialog is the rail now: the invoice and the agreement are gone.
    expect(markup).not.toContain('Maximum order cost')
    expect(markup).not.toContain('Payout if correct')
    expect(markup).not.toContain('How this trade settles')
  })

  test('a finished run reports what confirmed and offers no second submit', () => {
    const markup = render({}, {}, [
      { step: TRADE_STEPS.submit, status: 'preparing' },
      { step: TRADE_STEPS.submit, status: 'sent', signature: 'sig' },
    ], true)
    expect(markup).toContain('Trade submitted')
    expect(markup).toContain('1 of 1 done')
    expect(markup).not.toContain('Agree and sign on Solana')
    expect(markup).toContain('Close')
  })

  test('a failure keeps the rail on screen and names the step that stopped', () => {
    const markup = render({ error: 'Transaction simulation failed: "AccountNotFound"' }, {}, [
      { step: TRADE_STEPS.submit, status: 'preparing' },
      { step: TRADE_STEPS.submit, status: 'failed', error: 'Transaction simulation failed' },
    ], true)
    expect(markup).toContain('Trade stopped')
    // The failure sits under the rail, naming the step and carrying its message.
    expect(markup).toContain('Stopped at step 1 · Execute order')
    expect(markup).toContain('ch-tx-stopped')
    expect(markup.indexOf('ch-tx-steps')).toBeLessThan(markup.indexOf('ch-tx-stopped'))
    expect(markup).toContain('Transaction simulation failed')
    // Retry lives beside the failure, and is not duplicated in the footer.
    expect(markup).toContain('Try again')
    expect(markup.split('Try again').length - 1).toBe(1)
  })

  test('a cleared run reopens on the invoice, not on the last receipt', () => {
    // What TradeTicket's reset-on-open effect relies on: with no live steps the
    // dialog is back on the order, even though `settled` is still carrying the
    // previous trade's flag for one render.
    const markup = render({ settled: true }, {}, [], true)
    expect(markup).toContain('Review your trade')
    expect(markup).toContain('Agree and sign on Solana')
    expect(markup).not.toContain('Trade submitted')
    expect(markup).not.toContain('ch-tx-steps')
  })
})

describe('trade agreement', () => {
  test('only the terms that apply to the route are shown', () => {
    const solanaMarket = tradeAgreement({ simulation: false, network: 'SOLANA', side: 'buy', type: 'market', completeSet: false, collateralSymbol: 'fUSDC' })
    expect(solanaMarket.map(term => term.id)).toEqual(['recorded', 'sol'])

    const completeSetLimit = tradeAgreement({ simulation: false, network: 'SOLANA', side: 'buy', type: 'limit', completeSet: true, collateralSymbol: 'fUSDC' })
    expect(completeSetLimit.map(term => term.id)).toEqual(['complete-set', 'atomic', 'reserved', 'recheck', 'recorded', 'sol'])
  })

  test('a simulated trade never claims a wallet is involved', () => {
    const terms = tradeAgreement({ simulation: true, network: 'SOLANA', side: 'buy', type: 'market', completeSet: false, collateralSymbol: 'COOLA' })
    expect(terms.map(term => term.id)).toEqual(['simulated'])
    expect(terms[0]!.title).toBe('No wallet funds are used')
    expect(terms[0]!.body).toContain('Off-chain credits only')
  })

  test('every term names itself and says something', () => {
    for (const network of ['SOLANA', 'SOMNIA'] as const)
      for (const type of ['market', 'limit'] as const)
        for (const completeSet of [true, false])
          for (const term of tradeAgreement({ simulation: false, network, side: 'buy', type, completeSet, collateralSymbol: 'fUSDC' })) {
            expect(term.title.length).toBeGreaterThan(3)
            expect(term.body.length).toBeGreaterThan(40)
          }
  })
})
