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
   *  Manifest grows the account later with its own Expand instruction, which is
   *  why a traded book reads longer than this and why measuring a live one
   *  would overstate what activation costs. */
  book: 256,
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

/**
 * What one transaction takes out of the wallet. `amount` is lamports when the
 * asset is SOL and collateral atoms otherwise.
 */
export type StepCost = {
  asset: 'SOL' | 'COLLATERAL'
  amount: bigint
  kind: 'rent' | 'fee' | 'fund' | 'upfront' | 'taker-fee'
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
  /** Present when one planned node stands for several confirmed legs. */
  repeats?: { most: number }
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
  /** The transaction count can grow: a repeating or uncertain step is present. */
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
 * during the wallet prompt.
 */
export type SkipReason = 'already-open' | 'not-needed'

export type StepRow = PlannedStep & {
  status: StepStatus
  /** Sends of this step so far. Above one after a retry or a second leg. */
  attempts: number
  /** Confirmed repeats of a repeating node, including the one in flight. */
  legs: number
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
  /** Collateral the order needs from the wallet beyond the seat balance. */
  fundingAtoms: bigint
  /** Complete-set upfront in atoms. Zero on the direct route. */
  upfrontAtoms: bigint
  /** Bound taker fee in atoms. */
  maxFeeAtoms: bigint
  /** From planSellInventory(), on the sell route only. */
  sell?: { exportAtoms: bigint; depositAtoms: bigint; matched: boolean }
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
      // The book's own 256 bytes are exact, but Manifest creates its two vaults
      // itself and this repo never decodes them, so their size is assumed to be
      // a plain token account rather than asserted.
      costs: [sol(BOOK_RENT + SIGNATURE_LAMPORTS, 'rent', true)],
    })
  }

  const setup = plannedSetup(facts)
  if (setup) steps.push(setup)

  if (facts.side === 'sell') {
    const sell = facts.sell
    if (sell?.exportAtoms) {
      steps.push({
        id: 'release-claims',
        kind: 'release-claims',
        step: TRADE_STEPS.release,
        matches: [TRADE_STEPS.release],
        title: 'Release shares',
        detail: 'Moves the shares out of your prediction position so the order book can hold them.',
        certain: true,
        costs: [sol(SIGNATURE_LAMPORTS, 'fee')],
      })
    }
    if (sell?.depositAtoms) {
      steps.push({
        id: 'deposit-claims',
        kind: 'deposit-claims',
        step: TRADE_STEPS.deposit,
        matches: [TRADE_STEPS.deposit],
        title: 'Deposit shares',
        detail: 'Puts the shares on your book seat. Manifest only matches shares already deposited there.',
        certain: true,
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
    // placeBinaryLimitBuy re-reads both books after every confirmed leg and
    // re-picks the cheaper route, so the leg count does not exist until the
    // first confirmation. One repeating node, with the loop's real ceiling.
    if (facts.route === 'direct' && facts.fundingAtoms > 0n) {
      steps.push({
        id: 'fund-remaining',
        kind: 'fund-book',
        step: TRADE_STEPS.fundRemaining,
        matches: [TRADE_STEPS.fundRemaining],
        title: 'Fund order',
        detail: `Moves ${symbol} onto your book seat to back the order. Each leg funds only what that leg needs.`,
        certain: false,
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
      detail:
        'Fills against the cheapest route available. A large order walks both books, and each switch between them is one more signature — up to eight.',
      certain: true,
      repeats: { most: 8 },
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

/**
 * The one-time account setup, or nothing.
 *
 * prepare() sends nothing at all when every account it tests already exists, so
 * a trader who has traded this venue before sees no step here rather than a
 * step that turns out to be unnecessary. All five accounts are read, so the
 * rent is the exact rent for the ones actually missing.
 */
function plannedSetup(facts: StepFacts): PlannedStep | null {
  const accounts = facts.accounts
  // A sell only prepares when something has to move into the seat.
  if (facts.side === 'sell' && !facts.sell?.exportAtoms && !facts.sell?.depositAtoms) return null
  if (
    accounts &&
    accounts.vault &&
    accounts.position &&
    accounts.walletQuote &&
    accounts.walletClaims &&
    accounts.venueQuote
  )
    return null

  const missing = accounts
    ? [
        accounts.vault ? 0n : VAULT_RENT,
        accounts.position ? 0n : rentLamports(SIZE.position),
        accounts.walletQuote ? 0n : rentLamports(SIZE.token),
        accounts.walletClaims ? 0n : rentLamports(SIZE.token),
        accounts.venueQuote ? 0n : rentLamports(SIZE.token),
      ].reduce((total, item) => total + item, 0n)
    : VAULT_RENT + rentLamports(SIZE.position) + 3n * rentLamports(SIZE.token)

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
    costs: [sol(missing + SIGNATURE_LAMPORTS, 'rent', accounts === null)],
  }
}

function summarise(steps: PlannedStep[], firstOpen: boolean): StepPlan {
  let lamports = 0n
  let collateralAtoms = 0n
  let estimated = false
  let approximate = false
  for (const step of steps) {
    if (step.repeats || !step.certain) approximate = true
    for (const cost of step.costs) {
      if (cost.estimated) estimated = true
      if (cost.asset === 'SOL') lamports += cost.amount
      // The complete-set upfront is deposited, split, sold and returned inside
      // one transaction. Adding it to a running total would make the largest
      // number in the dialog the one the trader never actually pays.
      else if (cost.kind !== 'upfront') collateralAtoms += cost.amount
    }
  }
  return { steps, firstOpen, lamports, estimated, approximate, collateralAtoms }
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
  const rows: StepRow[] = plan.steps.map(step => {
    const attempts = live
      .map((entry, index) => ({ entry, index }))
      .filter(item => step.matches.includes(item.entry.step))
    attempts.forEach(item => consumed.add(item.index))
    const latest = attempts[attempts.length - 1]?.entry
    if (!latest) {
      return {
        ...step,
        status: settled ? 'skipped' : 'planned',
        attempts: 0,
        legs: 0,
        unplanned: false,
        ...(settled ? { skipped: skipReason(step) } : {}),
      }
    }
    const failed = latest.status === 'failed'
    const unconfirmed = failed ? uncertainSignature(latest.error) : undefined
    return {
      ...step,
      // The label that actually arrived, so the detail can say whether the order
      // matched or rested rather than repeating what the plan guessed.
      step: latest.step,
      status: unconfirmed ? 'uncertain' : latest.status,
      attempts: attempts.length,
      legs: attempts.filter(item => item.entry.status === 'sent').length || (latest.status === 'sent' ? 1 : 0),
      ...(latest.signature || unconfirmed ? { signature: latest.signature ?? unconfirmed } : {}),
      ...(latest.error ? { error: latest.error } : {}),
      unplanned: false,
    }
  })

  // A run that stopped did not skip what came after the stop — it never got
  // there. Only a step passed over while the flow carried on is "not needed";
  // everything beyond the failure is still waiting for the retry.
  const stop = rows.findIndex(row => row.status === 'failed' || row.status === 'uncertain')
  if (stop !== -1)
    for (let index = stop + 1; index < rows.length; index++) {
      if (rows[index]!.attempts > 0) continue
      const { skipped: _skipped, ...rest } = rows[index]!
      rows[index] = { ...rest, status: 'planned' }
    }

  // A step the plan did not anticipate is still a wallet prompt the trader saw,
  // so it belongs on the rail rather than being silently dropped.
  live.forEach((entry, index) => {
    if (consumed.has(index)) return
    if (rows.some(row => row.unplanned && row.step === entry.step)) return
    const attempts = live.filter(item => item.step === entry.step)
    const latest = attempts[attempts.length - 1]!
    const unconfirmed = latest.status === 'failed' ? uncertainSignature(latest.error) : undefined
    rows.push({
      id: `unplanned-${entry.step}`,
      kind: 'submit-order',
      step: entry.step,
      matches: [entry.step],
      title: entry.step,
      detail: 'An extra transaction the preview could not see — the book or your accounts changed while the trade was running.',
      certain: true,
      costs: [],
      status: unconfirmed ? 'uncertain' : latest.status,
      attempts: attempts.length,
      legs: attempts.filter(item => item.status === 'sent').length,
      ...(latest.signature || unconfirmed ? { signature: latest.signature ?? unconfirmed } : {}),
      ...(latest.error ? { error: latest.error } : {}),
      unplanned: true,
    })
  })
  return rows
}

const skipReason = (step: PlannedStep): SkipReason =>
  step.kind === 'prepare-accounts' || step.kind === 'open-question' || step.kind === 'open-book'
    ? 'already-open'
    : 'not-needed'

/**
 * The signature browser.ts puts inside its own message when a confirmation is
 * unavailable. A transaction that was sent but never confirmed is not a failure
 * the trader can act on without a link to it, so the link is recovered here.
 */
export const uncertainSignature = (message: string | undefined) =>
  message?.match(/^Check transaction ([1-9A-HJ-NP-Za-km-z]{32,90}) before retrying/)?.[1]
