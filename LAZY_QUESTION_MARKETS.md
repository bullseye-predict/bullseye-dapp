# Lazy question markets

## Final identity model

A match and a tradable question are different identities:

- `matchId` identifies the agent-arena match and carries the immutable timing needed by a contract.
- `questionId` identifies the exact proposition selected by the trader.
- The on-chain market key is `(matchId, questionId)`.

The UI already knows `questionId` when a user selects “Will PEPSI win?”, so no separate `agentId` argument is required.

Question kind is a protocol identity field, not the page layout. Kind `1` is scoped to an arena match; kind `2` is an independently scheduled question. Presentation metadata describes the event, market, and outcomes independently.

## Event and question presentation

Use separate terms for three independent axes:

1. **Event topology** describes participants. A **head-to-head event** has exactly two parties. A **field event** has three or more parties. A **general event** is not defined by competing parties.
2. **Market or question** describes what settles. A **binary market** has two mutually exclusive, exhaustive answers. A **multi-outcome market** has three or more. A moneyline is the primary winner market and may be two-way (`JUP`, `ANSEM`), three-way (`Torino`, `Draw`, `Roma`), or a larger field. A head-to-head event may also own match props such as first to score or a kill total.
3. **Venue representation** describes how outcomes trade. A native categorical market can carry all outcomes under one collateralized condition. A **linked-outcome market** exposes every answer as its own binary YES/NO contract and order book, tied to one shared, mutually-exclusive and exhaustive resolution rule. Linked does not mean “three or more”; two answers can also use linked binary contracts.

The Genesis winner event is one linked-outcome moneyline with no sub-questions: `GENESIS-01`, `GENESIS-02`, and so on are answers, not questions in the page hierarchy. A multi-team fight is a field event whose moneyline may be native multi-outcome or linked-outcome depending on venue support. Do not call the two-party model a duel-question, versus-question, or team-question: those names mix participant count with market structure and become ambiguous when draw and match props are added.

Two-answer UI labels follow the question semantics. A proposition naturally uses `YES` / `NO`; a no-draw winner market uses `TEAM A` / `TEAM B`; a threshold can use `OVER` / `UNDER`; and two conditions can use their condition names. When a venue represents each named outcome as a binary contract, the event row still says `DRAW`, while the selected trade ticket may say `YES` / `NO` for “Will Draw happen?”.

Titles have separate jobs. `presentation.eventTitle` names the event once at page level. A linked answer uses `presentation.answer.label` (and optional image) instead of repeating the full binary question. A head-to-head market retains its question title beneath the event title. Charts inside event detail do not repeat the event title.

Probabilities and volume come from each market's live venue books and fills. An unopened market has no market probability or volume; a neutral order-entry seed is not presented as an observed quote. The detail page defaults to the real order book. Quote and trade histories are implementation sources for the chart, not competing product-level market types.

For an exhaustive outcome set, settlement pays exactly one answer `1` collateral unit and every other answer `0`. That payout identity does not require the displayed buy prices to sum to exactly `1.00`. The best asks are the current costs to buy every answer and normally sum above `1.00`; best bids normally sum below it. Spread, tick size, fees, thin liquidity, stale last trades, and independently updating books explain displays such as `0.14 + 0.23 + 0.65 = 1.02`. Midpoint or last-trade probabilities should be treated as estimates, not an accounting invariant.

If linked binary markets are used, the shared resolution and complete-set rules must enforce mutual exclusivity and exhaustiveness. Merely placing unrelated YES/NO markets next to each other does not create the `1.00` payout relationship or guarantee arbitrage convergence.

The current Solana lazy first-trader instruction creates binary questions only. Therefore a three-way moneyline on that path must currently use three linked binary questions with one shared resolution policy. Native three-to-sixteen-outcome settlement exists in the broader core architecture, but it should not be claimed for the lazy Manifest flow until its market creation, order routing, and UI adapters support it end to end.

## Canonical 32-byte match ID

The display form may look like `GM-BR_DR-20_TS-1800000000_ID-000000AB`, but contracts consume a fixed 32-byte value rather than parsing that text.

| Bytes | Field | Meaning |
|---|---|---|
| `0..3` | `SOLZ` | format marker |
| `4` | version | currently `1` |
| `5` | game mode | deployment-defined numeric code |
| `6..7` | duration minutes | unsigned 16-bit, big-endian |
| `8..15` | kickoff | Unix seconds, unsigned 64-bit, big-endian |
| `16..31` | nonce | nonzero unique 128-bit value |

Encoding kickoff and duration lets the contract derive the trading lock and expiry without asking the first trader for arbitrary timestamps.

## Canonical 32-byte question ID

| Bytes | Field | Meaning |
|---|---|---|
| `0..3` | `QUES` | format marker |
| `4` | version | currently `1` |
| `5` | kind | `1` = arena-match-scoped question; `2` = independently scheduled question |
| `6..31` | subject | nonzero canonical agent/proposition identifier |

Neon remains the source for display text, agent details, and group membership. The chain only needs the stable identity and kind.

## First-trader flow

1. Arena creation writes the match and its 12 question drafts to Neon. This costs no blockchain gas.
2. If nobody trades a question, no on-chain market exists for it and nothing is resolved on-chain.
3. The first trader selects a question. The transaction includes its existing `matchId` and `questionId`.
4. The contract validates both IDs, derives fixed market parameters, and creates only that question's binary YES/NO market. The trader pays creation/rent gas.
5. The trade is submitted against that market. Buying YES or NO supplies the buyer's required trading collateral when the order fills; creation gas and trading collateral are different costs.
6. The other 11 questions remain Neon-only unless a trader selects them.
7. Any question that was created on-chain must later be resolved or voided. Neon-only drafts require no on-chain resolution.

Concurrent first requests are safe because the market address/ID is deterministic. One creation succeeds; later requests find the same market instead of creating a duplicate. Clients should simulate/read immediately before sending and retry the trade path after an already-created response.

## One-time configuration

The trader must not choose collateral, oracle, or timing. Those are fixed by deployment configuration:

- collateral mint/token;
- result oracle;
- network/domain;
- settlement window after the encoded match duration;
- supported identity version and game-mode codes.

This configuration is one-time venue setup, not one registration transaction per match or per question.

## EVM and Somnia

`PredictionMarketFactory.createQuestionMarket(matchId, questionId)` implements permissionless, deterministic binary-market creation for the repository's EVM settlement contract. `configureLazyMarkets` can succeed only once and fixes collateral, oracle, and settlement window for all lazy markets. Duplicate protection is per `(matchId, questionId)`.

Somnia DreamDEX is an external protocol, not this repository's EVM settlement contract. Its Oracle Hub question definition also includes sources and resolution policy. A production DreamDEX router must deterministically construct those fields from the fixed venue configuration plus `matchId` and `questionId`, call DreamDEX's deployed creation entry point, and then route the order. It must use the exact deployed DreamDEX ABI; the locally installed SDK currently exposes creation-cost reads but not the creation write ABI. Consequently, the identity and policy contract are finalized here, but a production DreamDEX atomic create-and-buy router must not be deployed until that write interface is obtained and tested against Shannon.

## Solana

Instruction `27` creates a binary question market permissionlessly. Its PDA seeds are:

`["market", matchId, questionId]`

The payer funds account rent. The program reads collateral and oracle from its global config and derives lock/expiry from `matchId`. Legacy admin-created markets retain their old match-only PDA; new question markets use the `SOLZMKT3` account layout and store both IDs.

As with EVM, market creation does not invent liquidity. A buy can fill only when a matching order or market maker exists. Creation and the first order may be placed in one outer wallet transaction only when the venue's order path supports those instructions atomically.
