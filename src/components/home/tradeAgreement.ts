/**
 * The terms a trader accepts by confirming, as discrete terms rather than prose.
 *
 * These are the three paragraphs that used to sit between the invoice and the
 * confirm button. Nothing has been dropped — the complete-set routing, the
 * roll-back guarantee, the double book check, the reservation rule and what SOL
 * is actually for are all still here. What changed is that they are no longer
 * four hundred words of unbroken text under the number the trader is trying to
 * read, and that only the terms belonging to this trade's route are shown.
 *
 * Kept out of the component so the set can be asserted per route without
 * rendering anything.
 */
export type AgreementTerm = { id: string; title: string; body: string }

export type AgreementInput = {
  simulation: boolean
  network: 'SOLANA' | 'SOMNIA'
  side: 'buy' | 'sell'
  type: 'market' | 'limit'
  /** The route buys through the opposite outcome's bids. */
  completeSet: boolean
  collateralSymbol: string
}

export function tradeAgreement(input: AgreementInput): AgreementTerm[] {
  const terms: AgreementTerm[] = []

  if (input.completeSet) {
    terms.push({
      id: 'complete-set',
      title: 'Complete-set routing',
      body: "When the opposite outcome's bids are the cheaper route, one transaction creates a complete set, sells the opposite shares and keeps the ones you picked. The sale proceeds return to your wallet in that same transaction.",
    })
    terms.push({
      id: 'atomic',
      title: 'All of it, or none of it',
      body: 'If the minimum return cannot be met, the deposit, the split and the sale roll back together. A purchase is never left half done.',
    })
  }

  if (input.type === 'limit') {
    terms.push({
      id: 'reserved',
      title: 'Reserved until it resolves',
      body: `An unfilled order waits until the question closes. Your ${input.side === 'buy' ? 'funds' : 'shares'} stay reserved until it fills or you cancel it.`,
    })
    terms.push({
      id: 'recheck',
      title: 'Remainders are checked twice',
      body: 'Any unfilled remainder is posted to the book only after both books have been read again, so it cannot come to rest against a price that has already moved.',
    })
  }

  if (input.simulation) {
    terms.push({
      id: 'simulated',
      title: 'No wallet funds are used',
      body:
        input.type === 'market'
          ? 'Off-chain credits only. The final sample price is checked when you confirm.'
          : 'Off-chain credits only. Unfilled orders reserve credits or shares until they fill, are cancelled, or expire.',
    })
    return terms
  }

  terms.push({
    id: 'recorded',
    title: 'Everything is recorded',
    body: 'Every matched portion is recorded in Activity with the signature of the transaction that matched it.',
  })

  if (input.network === 'SOLANA') {
    terms.push({
      id: 'sol',
      title: 'What SOL pays for',
      body: `SOL covers the network fee and one-time account rent. The order itself settles in ${input.collateralSymbol}. Your wallet shows the exact amount before you approve each transaction.`,
    })
  } else {
    terms.push({
      id: 'approval',
      title: 'Approval is not a purchase',
      body: 'Approving a token does not buy shares. Only a confirmed order transaction does.',
    })
  }

  return terms
}
