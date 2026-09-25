/**
 * What a trade is about to ask the wallet to sign, before it asks.
 *
 * A first trade on a fresh question is five wallet prompts, a limit buy can be
 * eight more, and until now the only warning of that was the prompts arriving
 * one after another. This plans the run up front — how many signatures, what
 * each one is for, and what it takes out of the wallet — so the count is on
 * screen before the first prompt rather than discovered through it.
 *
 * One transaction is one wallet prompt is one step. Nothing here batches or
 * splits that: every entry corresponds to exactly one ManifestBrowserWallet.send
 * call, which is exactly one signature request.
 *
 * Pure. No RPC, no React, no clock — every fact it needs is passed in, so the
 * whole thing is testable against a literal.
 */
import { ACCOUNT_SIZE, MINT_SIZE } from '@solana/spl-token'

/**
 * Every wallet-prompt label a trade can carry, in one table.
 *
 * A live stage is joined onto a planned step by this string and nothing else —
 * the stage carries no id — so a literal reworded in browser.ts would leave one
 * node stuck at "Not started" beside an unplanned twin of itself. Import these;
 * never retype one.
 */
export const TRADE_STEPS = {
  question: 'Creating the on-chain question',
  book: (outcome: Outcome) => `Opening the ${outcome === 0 ? 'YES' : 'NO'} order book`,
  accounts: 'Preparing your trading accounts',
  fundBook: (symbol: string) => `Funding the book with ${symbol}`,
  fundRemaining: 'Funding your remaining order',
  submit: 'Submitting your order',
  match: 'Matching your order',
  rest: 'Placing the unfilled limit order',
  /** Names the side being bought. browser.ts emits this from the OPPOSITE
   *  binding, so the two are complements: an opposite of YES prints NO. */
  completeSet: (opposite: Outcome) => `Buying ${opposite === 0 ? 'NO' : 'YES'} through the opposite bids`,
  release: 'Moving your shares out of the position',
  deposit: 'Depositing your shares',
  sell: 'Selling your shares',
  offer: 'Placing your offer',
  cancelOrder: 'Cancelling your resting order',
  /** Manifest credits a cancellation to the book seat and transfers nothing.
   *  This is the second signature that actually moves it to the wallet. */
  withdrawSeat: (symbol: string) => `Withdrawing ${symbol} to your wallet`,
  withdrawShares: 'Withdrawing your shares to your wallet',
  /** A settled claim can hold shares on both books, and each side is its own
   *  signature. Named per outcome so two prompts in one run cannot collapse
   *  onto a single rail row. */
  withdrawClaims: (outcome: Outcome) => `Withdrawing your ${outcome === 0 ? 'YES' : 'NO'} shares from the book`,
  importClaims: (outcome: Outcome) => `Moving your ${outcome === 0 ? 'YES' : 'NO'} shares into your position`,
  redeem: 'Redeeming your settled payout',
  /** Deliberately not withdrawSeat: the venue seat and the prediction vault are
   *  different custodians, and planReleaseSteps already claims withdrawSeat in
   *  its `matches`, so sharing the string would let a vault withdrawal appear on
   *  a release rail as a seat withdrawal. */
  withdrawVault: (symbol: string) => `Withdrawing ${symbol} from your prediction vault`,
} as const

export type Outcome = 0 | 1

/**
 * Rent exemption: 3480 lamports per byte-year over a two-year threshold, on 128
 * bytes of per-account overhead plus the data. A pure function of size on every
 * cluster this app talks to, so no read has to happen in front of a wallet
 * prompt and the figure cannot go stale between the plan and the signature.
 *
 * Two anchors every Solana developer already knows pin the arithmetic, and the
 * test suite asserts both: an empty account is 0.00089088 SOL and an SPL token
 * account is 0.00203928 SOL.
 */
export const rentLamports = (bytes: number) => BigInt(128 + bytes) * 6960n

/**
 * One signature at the base fee. submit() appends only setComputeUnitLimit and
 * never setComputeUnitPrice, so nothing on this path pays a priority fee.
 */
export const SIGNATURE_LAMPORTS = 5_000n

/**
 * Passes placeBinaryLimitBuy makes before it gives up (./limit, the loop in
 * placeBinaryLimitBuy). One pass sends at most one account preparation, one
 * funding deposit and one order, so this bounds every repeating count on the
 * limit route. Exported so the loop and the plan cannot hold different numbers:
 * a plan that promises fewer signatures than the loop can send is the whole
 * defect this constant exists to prevent.
 */
export const LIMIT_LEGS = 8

/** Sizes this repository asserts when it decodes these accounts. */
const SIZE = {
  question: 263, // decodeMarket 'SOLZMKT3', ../accounts.ts
  binding: 204, // decodeBinding, ./wire.ts
  vault: 203, // decodeVault 'SOLZVLT2', ../accounts.ts
  position: 201, // decodePosition 'SOLZPOS1', ../accounts.ts
  /** The Manifest order book at activation. The Pinocchio activateBook handler
   *  allocates exactly this before it hands off to Manifest's CreateMarket
   *  (solz-prediction-backend/programs/prediction_market_pinocchio/src/
   *  manifest_tokens.rs, the a::create call under opcode 26), and the Manifest
   *  SDK's own createMarket allocates the same FIXED_MANIFEST_HEADER_SIZE.
   *  CreateMarket then ends with `expand_market_if_needed`, which adds one
   *  80-byte block ("Leave a free block on the market so takers can use and
   *  leave it", upstream create_market.rs at the pinned commit d218ba6), paid
   *  by the same signer in the same instruction. Leaving it out told the first
   *  trader 0.0258 SOL for an activation that costs 0.0269 SOL. Manifest grows
   *  the account further only as orders rest, which is why a traded book reads
   *  longer than this and why measuring a live one would overstate what
   *  activation costs. */
  book: 256 + 80,
  token: ACCOUNT_SIZE, // 165, imported rather than retyped
  mint: MINT_SIZE, // 82, imported rather than retyped
}

export type StepKind =
  | 'open-question'
  | 'open-book'
  | 'prepare-accounts'
  | 'fund-book'
  | 'complete-set'
  | 'submit-order'
  | 'match-leg'
  | 'rest-order'
  | 'release-claims'
  | 'deposit-claims'
  | 'sell-order'
  | 'rest-offer'
  | 'cancel-order'
  | 'withdraw-seat'
  | 'withdraw-claims'
  | 'import-claims'
  | 'redeem'
  | 'withdraw-vault'

/**
 * What one transaction takes out of the wallet. `amount` is lamports when the
 * asset is SOL and collateral atoms otherwise.
 */
export type StepCost = {
  asset: 'SOL' | 'COLLATERAL'
  amount: bigint
  /** 'return' is the one inbound figure: collateral this transaction pays back
   *  to the wallet. It is never added to a running cost. */
  kind: 'rent' | 'fee' | 'fund' | 'upfront' | 'taker-fee' | 'return'
  /** An account this repo cannot size exactly is inside the figure. Renders
   *  with a leading ≈, never as an exact number. */
  estimated: boolean
}

export type PlannedStep = {
  /** Stable within one plan: the React key and the reconciliation handle. */
  id: string
  kind: StepKind
  /** The label this node is named by, and what it reports when nothing has
   *  happened yet. */
  step: string
  /** Every label this node absorbs, `step` included.
   *
   *  One planned step is not always one string. A limit buy's execute leg sends
   *  "Matching your order" when the book is marketable, "Placing the unfilled
   *  limit order" when it is not, and the complete-set label when the opposite
   *  book is the cheaper route — and it re-decides that per leg, after each
   *  confirmation. Pinning the node to one of the three put the other two on the
   *  rail as unplanned extras while the real step sat at Waiting for ever. */
  matches: readonly string[]
  /** Two or three words, for the rail. */
  title: string
  /** One or two sentences, for the detail. */
  detail: string
  /** False when the flow may pass this transaction without sending it. */
  certain: boolean
  /** Present when one planned node stands for several confirmed transactions.
   *
   *  `least` is what it sends if the books and the accounts stay as the preview
   *  read them; `most` is the ceiling the loop behind it cannot pass. They are
   *  separate from `certain`, which says the flow may skip the node entirely:
   *  a node can be uncertain and still expect one send once it runs. */
  repeats?: { least: number; most: number }
  costs: StepCost[]
}

export type StepPlan = {
  steps: PlannedStep[]
  /** Neither order book is activated: this trader opens the market. */
  firstOpen: boolean
  /** Lamports this plan can cost, one signature fee per step included. */
  lamports: bigint
  /** Some lamport figure includes an account this repo cannot size exactly. */
  estimated: boolean
  /** Wallet prompts this plan raises if the books and the accounts stay as the
   *  preview read them. A floor, not a promise: a step the flow passes over
   *  makes the run shorter. */
  least: number
  /** Wallet prompts this plan can raise at all. Every loop behind it is
   *  bounded, so this is those bounds added up and the run cannot pass it.
   *
   *  Prompts, never nodes. Counting nodes is what told a trader "up to 2" and
   *  then asked them to approve four: one limit-buy node stands for up to
   *  LIMIT_LEGS signatures, and the invoice counted it once. */
  most: number
  /** The count is a range rather than one number: `least !== most`. */
  approximate: boolean
  /** Collateral atoms the plan takes out of the wallet. Excludes the
   *  complete-set upfront, which returns in the same transaction. */
  collateralAtoms: bigint
}

/**
 * Structurally the SolanaTransactionStage of ./browser. Declared here rather
 * than imported, because browser.ts imports TRADE_STEPS back from this module
 * and a cycle is avoidable in one line.
 */
export type StepStage = {
  step: string
  status: 'preparing' | 'signing' | 'sent' | 'failed'
  signature?: string
  error?: string
}

/**
 * One send attempt, in arrival order. Never merged and never rewritten: a
 * retried step appends, so the failure being retried survives on screen.
 */
export type LiveStep = {
  step: string
  status: StepStage['status']
  signature?: string
  error?: string
}

export type StepStatus =
  | 'planned'
  | 'preparing'
  | 'signing'
  | 'sent'
  | 'failed'
  | 'uncertain'
  | 'skipped'

/**
 * Why a planned step sent nothing. 'already-open' is prepare() finding all its
 * accounts present and emitting no stage at all; 'not-needed' is a leg that
 * funded and then posted nothing because the opposite book turned marketable
 * during the wallet prompt; 'already-done' is a release finding the order gone
 * from the book or the seat already empty; 'nothing-held' is a claim custody
 * move finding the seat, the wallet claim account or the prediction vault empty
 * by the time it ran.
 */
export type SkipReason = 'already-open' | 'not-needed' | 'already-done' | 'nothing-held'

export type StepRow = PlannedStep & {
  status: StepStatus
  /** Sends of this step so far. Above one after a retry or a second leg. */
  attempts: number
  /** How many rows this planned step has on the rail, legs it has not sent yet
   *  included. */
  legs: number
  /** Which of them this row is, when there is more than one. A repeating step
   *  is one wallet prompt per leg, so it is one row per leg — collapsing five
   *  signatures into a single cell labelled "leg 5" hid four transactions the
   *  trader had already approved. */
  leg?: number
  signature?: string
  error?: string
  skipped?: SkipReason
  /** A live step the plan did not anticipate. */
  unplanned: boolean
}

/**
 * Existence of the five accounts prepare() tests, for one binding, plus the
 * book seat. `venueQuote` is the venue's own fee collateral account: it belongs
 * to the venue rather than the trader, but prepare() creates it too, so without
 * it the setup rent could only ever be a guess.
 */
export type SetupAccounts = {
  vault: boolean
  position: boolean
  walletQuote: boolean
  walletClaims: boolean
  venueQuote: boolean
  seat: boolean
}

/** Everything the plan needs. Every field is already on screen except
 *  `questionExists`, which costs one read and only when both books are absent. */
export type StepFacts = {
  side: 'buy' | 'sell'
  type: 'market' | 'limit'
  route: 'direct' | 'complete-set'
  /** The outcome the trader picked; 0 is YES. */
  outcome: Outcome
  collateralSymbol: string
  /** Per outcome, whether that side's Manifest binding exists. */
  books: readonly [boolean, boolean]
  /** Whether the question's market account exists. `undefined` means not read,
   *  which is every case except both books being absent; the plan then marks
   *  the step uncertain rather than guessing either way. */
  questionExists?: boolean
  /** Setup accounts for the binding this route prepares: the opposite outcome
   *  on the complete-set route, the selected one otherwise. Null while holdings
   *  have not been read. */
  accounts: SetupAccounts | null
  /** The other outcome's setup accounts, on a limit buy.
   *
   *  placeBinaryLimitBuy prepares whichever binding the leg it is about to send
   *  uses, and re-picks that per leg, so one run can prepare both. Reading only
   *  one of them let a real prepare() arrive as an unplanned step. */
  accountsAlternate?: SetupAccounts | null
  /** Collateral the order needs from the wallet beyond the seat balance. */
  fundingAtoms: bigint
  /** Complete-set upfront in atoms. Zero on the direct route. */
  upfrontAtoms: bigint
  /** Bound taker fee in atoms. */
  maxFeeAtoms: bigint
  /** From planSellInventory(), on the sell route only. `null` is custody that
   *  has not been read, which is NOT the same as a sell with nothing to move:
   *  reading the two the same way planned a one-transaction market sell that
   *  really sent four. */
  sell?: { exportAtoms: bigint; depositAtoms: bigint; matched: boolean } | null
  /** What walkBinaryBuy (./limit) makes of the books, on a limit buy.
   *
   *  `legs` is the execute transactions those books support now, the resting
   *  remainder included; `funds` is how many of them have to move collateral
   *  onto the seat first. Absent when the books could not be read, and the plan
   *  then falls back to one of each rather than guessing the loop is idle. */
  run?: { legs: number; funds: number }
}

const sol = (amount: bigint, kind: StepCost['kind'], estimated = false): StepCost =>
  ({ asset: 'SOL', amount, kind, estimated })
const collateral = (amount: bigint, kind: StepCost['kind']): StepCost =>
  ({ asset: 'COLLATERAL', amount, kind, estimated: false })

/** Rent for accounts an activation creates, without the signature fee. */
const QUESTION_RENT = rentLamports(SIZE.question) + rentLamports(SIZE.token)
/** Binding, claim mint, the book itself, and the two vaults Manifest keeps for
 *  the outcome mint and the collateral mint. */
const BOOK_RENT =
  rentLamports(SIZE.binding) + rentLamports(SIZE.mint) + rentLamports(SIZE.book) + 2n * rentLamports(SIZE.token)
/** initializeVault creates the vault and its collateral escrow together. */
const VAULT_RENT = rentLamports(SIZE.vault) + rentLamports(SIZE.token)

/**
 * The run of transactions this trade will ask the wallet to sign.
 *
 * Emission order matches the order submit() actually sends in, because the
 * stepper is read top to bottom while the prompts arrive. The activation prefix
 * is shared by every route, sells included, since activateQuestion runs
 * unconditionally on any Solana trade.
 *
 * Account existence is monotonic on this path — these accounts are created and
 * never closed — so a stale fact can only make the plan predict a step that
 * turns out to be unnecessary. That renders as "Not needed", never as a
 * failure, which is why a slightly stale plan is safe to show.
 */
export function planTradeSteps(facts: StepFacts): StepPlan {
  const steps: PlannedStep[] = []
  const firstOpen = !facts.books[0] && !facts.books[1]
  const symbol = facts.collateralSymbol

  if (firstOpen && facts.questionExists !== true) {
    steps.push({
      id: 'open-question',
      kind: 'open-question',
      step: TRADE_STEPS.question,
      matches: [TRADE_STEPS.question],
      title: 'Open market',
      detail:
        'Creates this question on chain, once and for all. Every later trade on it — yours and everyone else\'s — reuses this account.',
      certain: facts.questionExists === false,
      costs: [sol(QUESTION_RENT + SIGNATURE_LAMPORTS, 'rent')],
    })
  }

  for (const outcome of [0, 1] as const) {
    if (facts.books[outcome]) continue
    steps.push({
      id: `open-book-${outcome}`,
      kind: 'open-book',
      step: TRADE_STEPS.book(outcome),
      matches: [TRADE_STEPS.book(outcome)],
      title: outcome === 0 ? 'Open YES book' : 'Open NO book',
      detail: `Activates the ${outcome === 0 ? 'YES' : 'NO'} order book and the account that holds its shares. Done once per question; every trader after you skips it.`,
      certain: true,
      // The book's own 336 bytes are exact, but Manifest creates its two vaults
      // itself and this repo never decodes them, so their size is assumed to be
      // a plain token account rather than asserted.
      costs: [sol(BOOK_RENT + SIGNATURE_LAMPORTS, 'rent', true)],
    })
  }

  const setup = plannedSetup(facts)
  if (setup) steps.push(setup)

  if (facts.side === 'sell') {
    const sell = facts.sell ?? null
    // Custody that has not been read yet. Both custody moves are planned, and
    // both are uncertain, because a sell of shares already sitting on the book
    // seat sends neither. Treating the unread case as "nothing to move" is what
    // announced one transaction for a run that sends four.
    if (!sell || sell.exportAtoms) {
      steps.push({
        id: 'release-claims',
        kind: 'release-claims',
        step: TRADE_STEPS.release,
        matches: [TRADE_STEPS.release],
        title: 'Release shares',
        detail: 'Moves the shares out of your prediction position so the order book can hold them.',
        certain: sell !== null,
        costs: [sol(SIGNATURE_LAMPORTS, 'fee')],
      })
    }
    if (!sell || sell.depositAtoms) {
      steps.push({
        id: 'deposit-claims',
        kind: 'deposit-claims',
        step: TRADE_STEPS.deposit,
        matches: [TRADE_STEPS.deposit],
        title: 'Deposit shares',
        detail: 'Puts the shares on your book seat. Manifest only matches shares already deposited there.',
        certain: sell !== null,
        costs: [sol(SIGNATURE_LAMPORTS, 'fee', !facts.accounts?.seat)],
      })
    }
    const matched = sell?.matched ?? false
    steps.push({
      id: 'sell-order',
      kind: matched ? 'sell-order' : 'rest-offer',
      step: matched ? TRADE_STEPS.sell : TRADE_STEPS.offer,
      // Quoted again immediately before submitting, so the book can move
      // between this preview and the order. Either outcome is this step.
      matches: [TRADE_STEPS.sell, TRADE_STEPS.offer],
      title: matched ? 'Sell shares' : 'Rest offer',
      detail: matched
        ? 'Sells into the best bids on the book. Proceeds land on your book seat.'
        : 'Rests your offer on the book. It stays until it fills, you cancel it, or the question closes.',
      certain: true,
      costs: [sol(SIGNATURE_LAMPORTS, 'fee'), collateral(facts.maxFeeAtoms, 'taker-fee')],
    })
    return summarise(steps, firstOpen)
  }

  if (facts.type === 'limit') {
    // What the books support right now, from walkBinaryBuy. Unread books are
    // one leg and one funding deposit rather than none: a plan that assumes the
    // loop is idle is the plan that under-counts.
    const run = facts.run ?? { legs: 1, funds: facts.fundingAtoms > 0n ? 1 : 0 }
    if (facts.fundingAtoms > 0n) {
      steps.push({
        id: 'fund-remaining',
        kind: 'fund-book',
        step: TRADE_STEPS.fundRemaining,
        matches: [TRADE_STEPS.fundRemaining],
        title: 'Fund order',
        detail: `Moves ${symbol} onto your book seat to back the order. Each leg funds only what that leg needs, and a leg that fills through the opposite book funds nothing.`,
        // placeBinaryLimitBuy re-picks its route per leg and funds inside the
        // same loop, so a run that opens through the opposite bids can still
        // deposit on a later leg. Planning this only for a first leg that
        // already routed direct is what made that deposit arrive as an
        // unplanned "extra transaction the preview could not see".
        certain: run.funds > 0,
        repeats: { least: run.funds, most: LIMIT_LEGS },
        costs: [sol(SIGNATURE_LAMPORTS, 'fee', !facts.accounts?.seat), collateral(facts.fundingAtoms, 'fund')],
      })
    }
    const complete = facts.route === 'complete-set'
    steps.push({
      id: 'match-leg',
      kind: complete ? 'complete-set' : 'match-leg',
      step: complete ? TRADE_STEPS.completeSet(opposite(facts.outcome)) : TRADE_STEPS.match,
      // placeBinaryLimitBuy re-reads both books after every confirmed leg and
      // re-picks the route, so a single run can send all three of these.
      matches: [TRADE_STEPS.match, TRADE_STEPS.rest, TRADE_STEPS.completeSet(opposite(facts.outcome))],
      title: 'Execute order',
      // A leg ends where the cheaper of the two books changes, not at a price
      // level: one order takes every level of one book that beats the other
      // book's best price, so a run of levels on one side is a single
      // signature.
      detail:
        'Fills against the cheaper of the two books. One signature takes every price level on that book at or under your limit; the next starts where the other book becomes cheaper. An unfilled remainder rests as one more signature.',
      certain: true,
      repeats: { least: Math.max(1, run.legs), most: LIMIT_LEGS },
      costs: [
        sol(SIGNATURE_LAMPORTS, 'fee'),
        ...(complete ? [collateral(facts.upfrontAtoms, 'upfront')] : []),
        collateral(facts.maxFeeAtoms, 'taker-fee'),
      ],
    })
    return summarise(steps, firstOpen)
  }

  if (facts.route === 'complete-set') {
    steps.push({
      id: 'complete-set',
      kind: 'complete-set',
      step: TRADE_STEPS.completeSet(opposite(facts.outcome)),
      matches: [TRADE_STEPS.completeSet(opposite(facts.outcome))],
      title: 'Execute order',
      detail:
        'Buys by minting both outcomes and selling the one you did not pick, in a single transaction. The sale returns what you did not spend to your wallet immediately.',
      certain: true,
      costs: [
        sol(SIGNATURE_LAMPORTS, 'fee'),
        collateral(facts.upfrontAtoms, 'upfront'),
        collateral(facts.maxFeeAtoms, 'taker-fee'),
      ],
    })
    return summarise(steps, firstOpen)
  }

  if (facts.fundingAtoms > 0n) {
    steps.push({
      id: 'fund-book',
      kind: 'fund-book',
      step: TRADE_STEPS.fundBook(symbol),
      matches: [TRADE_STEPS.fundBook(symbol)],
      title: 'Fund order',
      detail: `Moves ${symbol} from your wallet onto your book seat, which is where the order spends from.`,
      certain: true,
      costs: [sol(SIGNATURE_LAMPORTS, 'fee', !facts.accounts?.seat), collateral(facts.fundingAtoms, 'fund')],
    })
  }
  steps.push({
    id: 'submit-order',
    kind: 'submit-order',
    step: TRADE_STEPS.submit,
    matches: [TRADE_STEPS.submit],
    title: 'Execute order',
    detail: 'Sends the order. Only shares that match are bought; any remainder is cancelled rather than left resting.',
    certain: true,
    costs: [sol(SIGNATURE_LAMPORTS, 'fee'), collateral(facts.maxFeeAtoms, 'taker-fee')],
  })
  return summarise(steps, firstOpen)
}

const opposite = (outcome: Outcome): Outcome => (outcome === 0 ? 1 : 0)

/** Everything the release plan needs, all of it already on the order row. */
export type ReleaseFacts = {
  /** False when there is no order to take off the book and the seat balance is
   *  being withdrawn on its own — which is where an order cancelled earlier
   *  leaves its collateral, with no order row left to reach it from. */
  cancels?: boolean
  /** A resting bid escrows collateral; a resting offer escrows shares. Which
   *  one it is decides what the second transaction withdraws. */
  side: 'BUY' | 'SELL'
  collateralSymbol: string
  /** Collateral atoms this order returns to the seat, on a BUY. */
  releasedAtoms: bigint
  /** Shares this order returns to the seat, on a SELL. */
  releasedShares: bigint
  /** What the seat already holds, before the cancellation lands: collateral
   *  atoms on a BUY, shares on a SELL. Both are withdrawn together, because
   *  one signature can take the whole balance rather than only this order's
   *  part of it. */
  seatAtoms: bigint
}

/**
 * Cancelling a resting order and actually getting the money back.
 *
 * Manifest's cancellation transfers nothing. It credits the trader's seat
 * inside the market account, which is why a confirmed Release leaves the wallet
 * balance untouched and looks, from the outside, exactly like a release that
 * did not happen. The withdrawal is a second, separate signature, and the whole
 * point of planning it here is that the trader is told so before the first
 * prompt rather than after the second one fails to arrive.
 *
 * Neither transaction reads the question's trading window: `validate(binding,
 * false)` skips the lock check, so this plan is valid on an expired question,
 * a locked one and a resolved one alike.
 */
export function planReleaseSteps(facts: ReleaseFacts): StepPlan {
  const buy = facts.side === 'BUY'
  const returned = buy ? facts.seatAtoms + facts.releasedAtoms : facts.seatAtoms + facts.releasedShares
  const steps: PlannedStep[] = [
    ...(facts.cancels === false ? [] : [{
      id: 'cancel-order',
      kind: 'cancel-order' as const,
      step: TRADE_STEPS.cancelOrder,
      matches: [TRADE_STEPS.cancelOrder],
      title: 'Release order',
      detail: buy
        ? 'Takes the order off the book and credits its escrowed collateral to your seat on this market. Nothing reaches your wallet yet.'
        : 'Takes the offer off the book and credits its reserved shares to your seat on this market. Nothing reaches your wallet yet.',
      certain: true,
      costs: [sol(SIGNATURE_LAMPORTS, 'fee')],
    }]),
    {
      id: 'withdraw-seat',
      kind: 'withdraw-seat',
      step: buy ? TRADE_STEPS.withdrawSeat(facts.collateralSymbol) : TRADE_STEPS.withdrawShares,
      matches: [TRADE_STEPS.withdrawSeat(facts.collateralSymbol), TRADE_STEPS.withdrawShares],
      title: 'Withdraw to wallet',
      detail: buy
        ? `Moves the seat balance into your own ${facts.collateralSymbol} account. This is the transaction that changes the balance you see.`
        : 'Moves the seat shares into your own claim account, where they are yours to hold, sell or redeem.',
      // The seat is re-read after the cancellation confirms, so a balance that
      // was swept by something else in between is passed over rather than
      // sending a transaction that would only fail.
      certain: returned > 0n,
      costs: [
        sol(SIGNATURE_LAMPORTS, 'fee'),
        ...(buy && returned > 0n ? [collateral(returned, 'return')] : []),
      ],
    },
  ]
  return summarise(steps, false)
}

/** One outcome's share custody, as the claim plan needs it. Every field maps
 *  one-to-one off ManifestOutcomeHolding, so the plan costs no read: the row
 *  the trader clicked already carries all four. */
export type ClaimSide = {
  /** Shares withdrawable from the venue seat. */
  seatShares: bigint
  /** Shares committed to resting sell orders. These BLOCK the claim. */
  reservedShares: bigint
  /** Shares in the trader's own SPL claim account. */
  walletShares: bigint
  /** Shares already inside the prediction position PDA, where redeem reads. */
  positionShares: bigint
  /** How many resting SELL orders hold `reservedShares`. Asks only: a resting
   *  bid escrows collateral and does not block a claim, so counting the whole
   *  order list would tell the trader to cancel buys that are not in the way. */
  asks: number
}

/** Everything the claim plan needs, all of it already on the position row. */
export type ClaimFacts = {
  /** A voided question pays both sides at half, rather than the winner in full. */
  voided: boolean
  winningOutcome: Outcome
  collateralSymbol: string
  /** Indexed by outcome: sides[0] is YES. */
  sides: readonly [ClaimSide, ClaimSide]
  /** What the shared prediction vault already holds, before this payout lands.
   *  The withdrawal takes the whole balance, not only this question's part. */
  vaultAtoms: bigint
  /** Per-outcome account existence, when holdings have been read. Absent plans
   *  the preparation uncertain and its rent estimated, as the trade ticket does
   *  before its own holdings arrive. */
  accounts?: readonly [SetupAccounts | null, SetupAccounts | null]
}

/** Why a claim cannot start yet. */
export type ClaimBlock = {
  /** Outcomes holding shares against a resting ask. */
  outcomes: Outcome[]
  /** Shares those asks have reserved, across both sides. */
  shares: bigint
  /** How many resting sell orders hold them. */
  orders: number
}

/**
 * Resting asks that must come off the book before a claim can run.
 *
 * The redeem reads the prediction position, and shares committed to an ask are
 * held by the market rather than by the trader, so the withdrawal that would
 * move them cannot take them. This used to be discovered inside the run, after
 * the account preparation had already been signed and confirmed — a trader who
 * hit it had paid rent for a claim that then refused to continue. It is a pure
 * function of the row, so the dialog can say so before the first prompt.
 *
 * A resting BID reserves collateral, never shares, and does not block.
 */
export function claimBlocker(facts: ClaimFacts): ClaimBlock | null {
  const outcomes = ([0, 1] as const).filter(outcome => facts.sides[outcome].reservedShares > 0n)
  if (!outcomes.length) return null
  return {
    outcomes: [...outcomes],
    shares: outcomes.reduce((total, outcome) => total + facts.sides[outcome].reservedShares, 0n),
    orders: outcomes.reduce<number>((total, outcome) => total + facts.sides[outcome].asks, 0),
  }
}

/** Shares this outcome can still be redeemed for, wherever they currently sit. */
const redeemable = (side: ClaimSide) => side.positionShares + side.walletShares + side.seatShares

/** What the redeem pays, in collateral atoms. A resolved question pays the
 *  winning side in full; a voided one returns half of every share on both
 *  sides, which is the same arithmetic the positions table already shows. */
export const claimPayout = (facts: ClaimFacts) =>
  facts.voided
    ? (redeemable(facts.sides[0]) + redeemable(facts.sides[1])) / 2n
    : redeemable(facts.sides[facts.winningOutcome])

/**
 * Claiming a settled payout, all the way to the wallet.
 *
 * Four things make this longer than the trader expects, and all four are the
 * reason it is planned rather than described in a paragraph:
 *
 * 1. A settled question can hold shares on BOTH books — a trader who bought YES
 *    and later bought NO to hedge holds two claims — and each side's custody
 *    move is its own signature.
 * 2. Shares sitting on the venue seat are held by the market, not by the
 *    trader. The redeem reads the prediction position, so they have to come off
 *    the book and then into the position before the payout can see them.
 * 3. The redeem itself pays into the SHARED PREDICTION VAULT, never the wallet.
 *    This is the step that made a claim look finished while the wallet balance
 *    had not moved.
 * 4. Only the last signature, the vault withdrawal, changes the balance the
 *    trader is watching. It is the last node of this plan for that reason: a
 *    claim that stops at the redeem is a claim the trader believes failed.
 */
export function planClaimSteps(facts: ClaimFacts): StepPlan {
  const accounts = facts.accounts
  const working = ([0, 1] as const).filter(
    outcome => facts.sides[outcome].seatShares > 0n || facts.sides[outcome].walletShares > 0n,
  )
  // A side whose accounts are all present needs no preparation, the same test
  // plannedSetup makes. Without it a repeat trader is promised two prompts that
  // both end as "Not needed".
  const preparing = working.filter(outcome => {
    const set = accounts?.[outcome]
    return set === undefined || set === null || !complete(set)
  })
  const payout = claimPayout(facts)
  const steps: PlannedStep[] = [
    ...(preparing.length
      ? [{
          id: 'prepare-accounts',
          kind: 'prepare-accounts' as const,
          step: TRADE_STEPS.accounts,
          matches: [TRADE_STEPS.accounts],
          title: 'Prepare accounts',
          detail:
            'Creates the accounts this payout moves through. One claim account per outcome, and a settled question can hold shares on both books, so this can ask twice.',
          certain: accounts !== undefined,
          // The floor is the number of sides actually missing an account, never
          // 0: reconcileSteps seeds rows from `repeats.least`, so a floor below
          // the real count lets the rail grow by a row mid-run — the exact thing
          // the trader complained about.
          ...(preparing.length > 1 ? { repeats: { least: preparing.length, most: preparing.length } } : {}),
          // summarise adds the repeat signature fees itself, so this carries one.
          costs: [
            sol(
              setupRent(accounts?.[preparing[0]!] ?? null, false) +
                (preparing.length > 1 ? setupRent(accounts?.[preparing[1]!] ?? null, true) : 0n) +
                SIGNATURE_LAMPORTS,
              'rent',
              accounts === undefined,
            ),
          ],
        }]
      : []),
    ...([0, 1] as const)
      .filter(outcome => facts.sides[outcome].seatShares > 0n)
      .map(outcome => ({
        id: `withdraw-claims-${outcome}`,
        kind: 'withdraw-claims' as const,
        step: TRADE_STEPS.withdrawClaims(outcome),
        matches: [TRADE_STEPS.withdrawClaims(outcome)],
        title: `Withdraw ${outcome === 0 ? 'YES' : 'NO'} shares`,
        detail:
          'Takes the shares off your seat on the book and into your own claim account. The redeem reads your position, not the book, so they cannot stay here.',
        certain: true,
        costs: [sol(SIGNATURE_LAMPORTS, 'fee')],
      })),
    ...([0, 1] as const)
      .filter(outcome => facts.sides[outcome].seatShares + facts.sides[outcome].walletShares > 0n)
      .map(outcome => ({
        id: `import-claims-${outcome}`,
        kind: 'import-claims' as const,
        step: TRADE_STEPS.importClaims(outcome),
        matches: [TRADE_STEPS.importClaims(outcome)],
        title: `Move ${outcome === 0 ? 'YES' : 'NO'} shares in`,
        detail: 'Moves the shares from your claim account into your prediction position, which is where the payout is calculated from.',
        certain: true,
        costs: [sol(SIGNATURE_LAMPORTS, 'fee')],
      })),
    {
      id: 'redeem',
      kind: 'redeem',
      step: TRADE_STEPS.redeem,
      matches: [TRADE_STEPS.redeem],
      title: 'Redeem payout',
      detail:
        'Burns the settled shares and credits the payout to your shared prediction vault. This does not reach your wallet yet — the next signature is the one that does.',
      certain: true,
      // No 'return' chip here on purpose: StepCost documents 'return' as
      // collateral paid back TO THE WALLET, and this pays into the vault.
      // Printing it here would repeat on the rail the exact thing that made a
      // finished claim look like a lost one.
      costs: [sol(SIGNATURE_LAMPORTS, 'fee')],
    },
    {
      id: 'withdraw-vault',
      kind: 'withdraw-vault',
      step: TRADE_STEPS.withdrawVault(facts.collateralSymbol),
      matches: [TRADE_STEPS.withdrawVault(facts.collateralSymbol)],
      title: 'Withdraw to wallet',
      detail: `Moves your whole prediction vault balance into your own ${facts.collateralSymbol} account. This is the transaction that changes the balance you see.`,
      certain: facts.vaultAtoms + payout > 0n,
      costs: [
        sol(SIGNATURE_LAMPORTS, 'fee'),
        // The transaction re-reads the vault, so this is a preview of what is
        // expected to be there rather than a figure the plan can promise.
        ...(facts.vaultAtoms + payout > 0n ? [collateral(facts.vaultAtoms + payout, 'return')] : []),
      ],
    },
  ]
  return summarise(steps, false)
}

/**
 * The one-time account setup, or nothing.
 *
 * prepare() sends nothing at all when every account it tests already exists, so
 * a trader who has traded this venue before sees no step here rather than a
 * step that turns out to be unnecessary. All five accounts are read, so the
 * rent is the exact rent for the ones actually missing.
 */
const complete = (accounts: SetupAccounts) =>
  accounts.vault && accounts.position && accounts.walletQuote && accounts.walletClaims && accounts.venueQuote

/** Rent for the accounts this set is missing. The vault and its escrow are
 *  created together, and the two vault-wide accounts are only ever paid once
 *  however many bindings ask for them. */
const setupRent = (accounts: SetupAccounts | null, shared: boolean) =>
  accounts
    ? [
        accounts.vault || shared ? 0n : VAULT_RENT,
        accounts.position || shared ? 0n : rentLamports(SIZE.position),
        accounts.walletQuote || shared ? 0n : rentLamports(SIZE.token),
        accounts.walletClaims ? 0n : rentLamports(SIZE.token),
        accounts.venueQuote || shared ? 0n : rentLamports(SIZE.token),
      ].reduce((total, item) => total + item, 0n)
    : VAULT_RENT + rentLamports(SIZE.position) + 3n * rentLamports(SIZE.token)

function plannedSetup(facts: StepFacts): PlannedStep | null {
  const accounts = facts.accounts
  // Only a limit BUY re-picks its binding per leg and so prepares either of
  // them. Every other route prepares one, so the other outcome's accounts are
  // not this trade's business — reading them on a sell promised a preparation
  // the run never sends and then marked it "Not needed".
  const alternate = facts.side === 'buy' ? facts.accountsAlternate ?? null : null
  // A sell only prepares when something has to move into the seat — but only
  // once the custody has actually been read. `sell: null` is unread, and the
  // real flow prepares on it, so it keeps the step rather than dropping it.
  if (facts.side === 'sell' && facts.sell && !facts.sell.exportAtoms && !facts.sell.depositAtoms) return null
  if (accounts && complete(accounts) && (!alternate || complete(alternate))) return null

  // Only the outcome's own claim account differs between the two bindings;
  // everything else prepare() creates belongs to the wallet, not the outcome.
  const missing = setupRent(accounts, false) + (alternate && !complete(alternate) ? setupRent(alternate, true) : 0n)

  return {
    id: 'prepare-accounts',
    kind: 'prepare-accounts',
    step: TRADE_STEPS.accounts,
    matches: [TRADE_STEPS.accounts],
    title: 'Prepare accounts',
    detail:
      'Creates the accounts that hold your collateral and your shares on this venue. One time for your wallet — every later trade skips it.',
    // Unread holdings are the only reason this can turn out to be unnecessary.
    certain: accounts !== null,
    // Two bindings that both need work are two prompts under one label, which
    // the rail already counts as legs of this step.
    //
    // `least` is 2 rather than 1 on purpose, although a run that only ever takes
    // one route prepares only one of them. Both rows are on the rail from the
    // first frame, and the unused one ends as "Not needed": a floor that is one
    // too high finishes the run below the announced range, which the rail
    // explains, while a floor of 1 would let the list grow by a row mid-run,
    // which is the thing the trader complained about.
    ...(alternate && accounts && !complete(accounts) && !complete(alternate) ? { repeats: { least: 2, most: 2 } } : {}),
    costs: [sol(missing + SIGNATURE_LAMPORTS, 'rent', accounts === null)],
  }
}

/**
 * Wallet prompts one node stands for, at least and at most.
 *
 * No `repeats` is one prompt, or none at all when the flow may pass the node by.
 * This is the conversion the invoice never did: it printed how many nodes were
 * on the list, which is not how many times the wallet opens.
 */
const prompts = (step: PlannedStep) =>
  step.repeats ?? { least: step.certain ? 1 : 0, most: 1 }

function summarise(steps: PlannedStep[], firstOpen: boolean): StepPlan {
  let lamports = 0n
  let collateralAtoms = 0n
  let estimated = false
  let least = 0
  let most = 0
  for (const step of steps) {
    const count = prompts(step)
    least += count.least
    most += count.most
    // Only the signature fee repeats. A prepare cost already carries the rent
    // for both bindings, and every collateral figure is bound to the whole
    // order rather than to one leg, so multiplying either would charge the
    // trader eight times over for something they pay once.
    if (count.most > 1) lamports += SIGNATURE_LAMPORTS * BigInt(count.most - 1)
    for (const cost of step.costs) {
      if (cost.estimated) estimated = true
      if (cost.asset === 'SOL') lamports += cost.amount
      // The complete-set upfront is deposited, split, sold and returned inside
      // one transaction, and a 'return' is money coming back. Adding either to
      // a running total would make the largest number in the dialog one the
      // trader never actually pays.
      else if (cost.kind !== 'upfront' && cost.kind !== 'return') collateralAtoms += cost.amount
    }
  }
  // A range, not a hedge. `approximate` used to mean "a step might repeat or
  // might be skipped", which the invoice rendered as the word "Up to" in front
  // of a number that had counted neither.
  return { steps, firstOpen, least, most, lamports, estimated, approximate: least !== most, collateralAtoms }
}

/**
 * Fold one stage event into the live log.
 *
 * Appends a new attempt whenever a step reports `preparing`, and otherwise
 * updates that step's most recent attempt in place. That is what makes a retry
 * legible: the failed attempt keeps its row and the retry gets its own,
 * matching the toast identity rule that a settled attempt is never rewritten.
 */
export function applyStage(rows: readonly LiveStep[], stage: StepStage): LiveStep[] {
  const next = rows.slice()
  if (stage.status === 'preparing') {
    next.push({ step: stage.step, status: 'preparing' })
    return next
  }
  for (let index = next.length - 1; index >= 0; index--) {
    if (next[index]!.step !== stage.step) continue
    next[index] = {
      step: stage.step,
      status: stage.status,
      ...(stage.signature ? { signature: stage.signature } : {}),
      ...(stage.error ? { error: stage.error } : {}),
    }
    return next
  }
  next.push({
    step: stage.step,
    status: stage.status,
    ...(stage.signature ? { signature: stage.signature } : {}),
    ...(stage.error ? { error: stage.error } : {}),
  })
  return next
}

/**
 * The rows to render: the plan, overwritten by whatever actually happened.
 *
 * `settled` means the flow has finished. Only then can a planned step that
 * never reported be called skipped — before that it is simply still ahead.
 */
export function reconcileSteps(plan: StepPlan, live: readonly LiveStep[], settled: boolean): StepRow[] {
  const consumed = new Set<number>()
  /** Where each row's own first attempt sits in the live log. A row that never
   *  ran records nothing, so it cannot claim to have happened before anything. */
  const ran = new Map<string, number>()
  const rows: StepRow[] = plan.steps.flatMap<StepRow>(step => {
    const attempts = live
      .map((entry, index) => ({ entry, index }))
      .filter(item => step.matches.includes(item.entry.step))
    attempts.forEach(item => consumed.add(item.index))
    /** A confirmed send closes a leg: anything after it is a different
     *  transaction and gets its own row. A failure does not — the attempt that
     *  follows one is a retry of the same transaction, and belongs in the row
     *  whose error it is retrying. */
    const legs: (typeof attempts)[] = []
    for (const item of attempts) {
      const current = legs[legs.length - 1]
      if (!current || current[current.length - 1]!.entry.status === 'sent') legs.push([item])
      else current.push(item)
    }

    /**
     * Rows this step shows, legs it has not sent yet included.
     *
     * The rail is read as the list of what is still coming, so materialising a
     * leg only once its transaction had been signed made the list grow under
     * the trader: "2 of 2 done" stood on screen, looking finished, while two
     * more wallet prompts were still queued behind it. A repeating step now
     * shows every leg the books say it takes from the first frame, and a leg
     * the run turns out not to need ends as "Not needed" rather than never
     * having been admitted to.
     */
    const total = Math.max(legs.length, step.repeats?.least ?? 1, 1)

    return Array.from({ length: total }, (_, index): StepRow => {
      const tries = legs[index]
      // One row per leg needs one key per leg, and the plan's id is shared.
      const id = total > 1 ? `${step.id}#${index + 1}` : step.id
      const place = total > 1 ? { leg: index + 1 } : {}
      if (!tries)
        return {
          ...step,
          id,
          ...place,
          status: settled ? 'skipped' : 'planned',
          attempts: 0,
          legs: total,
          unplanned: false,
          ...(settled ? { skipped: skipReason(step) } : {}),
        }
      const latest = tries[tries.length - 1]!.entry
      const unconfirmed = latest.status === 'failed' ? uncertainSignature(latest.error) : undefined
      ran.set(id, tries[0]!.index)
      return {
        ...step,
        id,
        ...place,
        // The label that actually arrived, so the detail can say whether the
        // order matched or rested rather than repeating what the plan guessed.
        step: latest.step,
        status: unconfirmed ? 'uncertain' : latest.status,
        attempts: tries.length,
        legs: total,
        ...(latest.signature || unconfirmed ? { signature: latest.signature ?? unconfirmed } : {}),
        ...(latest.error ? { error: latest.error } : {}),
        unplanned: false,
      }
    })
  })

  // A run that stopped did not skip what it never reached. Only a step passed
  // over while the flow carried on is "not needed"; everything a stopped run
  // left untouched is still waiting for the retry.
  //
  // Every unattempted row, not only the ones below the stopped one: the plan's
  // order is not the run's send order. placeBinaryLimitBuy interleaves one
  // prepare, one deposit and one order per leg, while the plan lists all the
  // deposits before all the legs — so a leg that never ran can sit ABOVE the
  // failure and was being reported as "Not needed" for a trade that had simply
  // stopped before it.
  if (rows.some(row => row.status === 'failed' || row.status === 'uncertain'))
    for (let index = 0; index < rows.length; index++) {
      if (rows[index]!.attempts > 0) continue
      const { skipped: _skipped, ...rest } = rows[index]!
      rows[index] = { ...rest, status: 'planned' }
    }

  // A step the plan did not anticipate is still a wallet prompt the trader saw,
  // so it belongs on the rail rather than being silently dropped — and at the
  // point in the run where it actually happened. Appending it to the end put a
  // transaction that ran first in third place, which reads as a different bug.
  // Each row is placed by ITS OWN first attempt, not by its step's. Every leg
  // row of a repeating step shares one `matches` list, so reading the step's
  // first live index put an unplanned transaction ahead of legs that ran after
  // it — and ahead of pre-seeded legs that never ran at all.
  const firstLive = (row: StepRow) => ran.get(row.id) ?? Number.POSITIVE_INFINITY
  live.forEach((entry, index) => {
    if (consumed.has(index)) return
    if (rows.some(row => row.unplanned && row.matches.includes(entry.step))) return
    const mine = live.map((item, at) => ({ item, at })).filter(row => row.item.step === entry.step)
    /** Two unforeseen transactions under one label are two transactions. Folding
     *  them into one row hid a signature the trader had already approved, which
     *  is the same concealment the planned side of this function exists to
     *  prevent. Legs close on a confirmed send, exactly as they do above. */
    const legs: (typeof mine)[] = []
    for (const row of mine) {
      const current = legs[legs.length - 1]
      if (!current || current[current.length - 1]!.item.status === 'sent') legs.push([row])
      else current.push(row)
    }
    legs.forEach((tries, leg) => {
      const latest = tries[tries.length - 1]!.item
      const unconfirmed = latest.status === 'failed' ? uncertainSignature(latest.error) : undefined
      const id = legs.length > 1 ? `unplanned-${entry.step}#${leg + 1}` : `unplanned-${entry.step}`
      const at = rows.filter(row => firstLive(row) < tries[0]!.at).length
      ran.set(id, tries[0]!.at)
      rows.splice(at, 0, {
        id,
        kind: 'submit-order',
        step: entry.step,
        matches: [entry.step],
        title: 'Extra transaction',
        // The raw label was the title here, which is why one row carried a whole
        // sentence where every other row carries two words, and why the same row
        // looked like it had changed identity once a later plan did match it. The
        // label is not lost: `step` still holds it and the detail pane prints it.
        detail: 'The book or your accounts changed while the trade was running, so the flow added this transaction.',
        certain: true,
        costs: [],
        status: unconfirmed ? 'uncertain' : latest.status,
        attempts: tries.length,
        legs: legs.length,
        ...(legs.length > 1 ? { leg: leg + 1 } : {}),
        ...(latest.signature || unconfirmed ? { signature: latest.signature ?? unconfirmed } : {}),
        ...(latest.error ? { error: latest.error } : {}),
        unplanned: true,
      })
    })
  })
  return rows
}

const skipReason = (step: PlannedStep): SkipReason =>
  step.kind === 'prepare-accounts' || step.kind === 'open-question' || step.kind === 'open-book'
    ? 'already-open'
    : step.kind === 'cancel-order' || step.kind === 'withdraw-seat'
      ? 'already-done'
      : step.kind === 'withdraw-claims' || step.kind === 'import-claims' || step.kind === 'withdraw-vault'
        ? 'nothing-held'
        : step.kind === 'redeem'
          ? 'already-done'
          : 'not-needed'

/**
 * The signature browser.ts puts inside its own message when a confirmation is
 * unavailable. A transaction that was sent but never confirmed is not a failure
 * the trader can act on without a link to it, so the link is recovered here.
 */
export const uncertainSignature = (message: string | undefined) =>
  message?.match(/^Check transaction ([1-9A-HJ-NP-Za-km-z]{32,90}) before retrying/)?.[1]
