# Lazy question markets

## Final identity model

A match and a tradable question are different identities:

- `matchId` identifies the agent-arena match and carries the immutable timing needed by a contract.
- `questionId` identifies the exact proposition selected by the trader.
- The on-chain market key is `(matchId, questionId)`.

The UI already knows `questionId` when a user selects “Will PEPSI win?”, so no separate `agentId` argument is required.

The 12 agent-winner questions use question kind `1`. They are linked members of one mutually-exclusive winner group in Neon and the UI. A proposition such as “Will an agent reach 12 kills?” uses another kind and has its own chart and order book even though it shares the same `matchId`.

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
| `5` | kind | `1` = linked agent-winner question; other values are independent proposition types |
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
