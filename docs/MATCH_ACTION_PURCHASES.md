# Match action purchases

## Approved product rules

- Every quote, payment, entitlement, activation and input belongs to one exact canonical match ID. No rollover, transfer to another match, or ranked-player seat is granted.
- Snake control costs 10,000 SOLZ per second initially. Seconds are purchased in integer units; there are no mandatory three/five-second bundles. The MVP has one exclusive snake-control slot per room, targeting an enabled snake. First accepted activation wins; there is no automatic queue. Busy activation does not consume a ticket.
- All purchases are final. No refunds or recredits, including late payments, unused actions, ended matches and execution failures. Checkout must explicitly acknowledge this policy before creating a payment. Unused rights expire at match end.
- Treasury may be an ordinary wallet address. Payments use the associated SPL token account for that treasury and mint. No new Solana program, NFT, escrow or ranked balance change is part of this release.
- Prompt pricing and gameplay pricing are independent. Gameplay uses configured fixed token amounts. Prompts use a bounded USD base cost, a configurable default 5x markup, and a separately configurable 1.5x Fast factor applied once, then convert USD to token atomic units using a fresh price API observation.
- The current product Fast label maps to reasoning effort `none`. It is not evidence of an upstream priority service tier or an existing 1.5x provider charge. The Fast price factor is an explicit product setting.
- Admin on port 3101 owns enabled state, mint, symbol, decimals/token program, treasury, prompt cost/markup/Fast factor, fixed snake/bomb prices and price-source configuration. Missing payment configuration disables sales; no destination is invented.
- Configuration revisions affect new quotes only. Quotes snapshot the mint, token program, recipient, price observation, amount, policy, action payload and match deadline. Old payments must be checked against their own snapshot.

## Payment protocol

1. Authenticate a commerce-capable account with a verified Solana wallet. Apply IP, account/wallet, outstanding-quote and global concurrency limits before expensive work. Bound body and prompt sizes.
2. Confirm the exact match is active and the requested mechanic is supported. Persist a unique purchase intent and quote. Purchase APIs expose prompt text only to its owner and trusted services, and it cannot change after payment. Executed prompts still appear in the existing public agent activity feed.
3. Return an unsigned checked-token-transfer transaction and memo `solz-action:v1:<matchId>:<purchaseId>`. The match ID alone cannot distinguish multiple purchases.
4. Client signs and submits. Server independently fetches the transaction from its configured Solana RPC and requires finalized, successful execution, exact payer authority, mint/program, destination, amount and memo. Deduplicate the transaction globally and the purchase individually.
5. Match chain inclusion time against quote validity. An expired quote or ended match never executes. A verified but unusable payment is retained as a terminal record without refund. An indexer/reconciliation pass recovers missing client acknowledgments.
6. Successful funding grants a durable entitlement. A prompt submits its immutable text for execution; bombs and controllers are activated by the buyer during that same match.

## Execution authority

- Elysia/Postgres owns configuration, immutable purchase records, payment verification and one-time entitlement consumption.
- Colyseus interaction rooms authenticate a match-scoped session and relay allowlisted requests. They do not create competitive players or simulate a second copy of the match.
- The match simulation owns capacity, target availability, accepted actions and exclusive control leases. Every key input checks the active account, connection, activation ID, sequence, controller kind and server deadline. No database query runs per keypress.
- Controller kind follows the purchased interaction. Snake directional inputs cannot become player movement, a bomb, or another character's controls.
- Match end and lease expiry revoke inputs. Disconnect clears held input. Stale packets and duplicate activations cannot extend time. Server crashes must not replay a consumed effect or restart its purchased duration.
- Watch remains mounted on `/game/watch`; public broadcast supplies state, a separate authenticated connection supplies interactions. Active control requires fresh authoritative state, not delayed video.
- Consumption and simulation cannot share a database transaction. Reserve capacity before the durable consume call, use stable activation IDs and idempotent result recording, and fail closed on uncertain outcomes. No refund is introduced as compensation.

## UI contract

Show exact match, action, amount/symbol, quote expiry, payment/activation state, remaining tickets, availability and server countdown. Require explicit acceptance of: "Only for this match. All purchases are final. Unused actions expire when this match ends. No refunds or credits."

Loading keeps the shape of settings and purchase controls. Match switches dispose interaction connections and controller input handlers without disturbing broadcast playback.

## Verification and rollout

Test pricing and rounding; independent prompt/game prices; configuration rotation; wrong mint/payer/amount/memo/network; failed/unfinalized/replayed transactions; late funding; account and match isolation; concurrent activation; disconnect, expiry and stale input; and no-refund terminal states. Run repository checks and browser verification for admin and watch controls.

Purchases remain disabled until treasury, token configuration, prices, migrated storage and live interaction support are configured and verified. Local fixture verification is not an end-to-end wallet payment test. Do not commit, push or deploy externally as part of this request.

## Implementation record

- Elysia: migration `0040_viewer_actions.sql`, versioned admin settings/history, immutable purchase ledger, quote/payment/session APIs, finalized SPL transfer verification, and payment reconciliation worker. The additive migration was applied to the already configured database during this task; no treasury configuration or sales-enable change was made.
- Colyseus: `ViewerInteractionRoom`, source-owned `ViewerActionController`, paid agent prompts, exclusive snake leases, and bomb placement. The old agent-arena free-prompt/staging override cannot bypass payment. Ordinary player admission and ranked stake authority are unchanged.
- Game: watch-page purchase panel, primary-wallet signing, payment status, match-bound tickets, bomb placement, snake keyboard/touch inputs, server countdown and authoritative terrain poses. Switching account/match disposes the interaction session. Broadcast playback remains separate.
- Initial bomb mechanics: a two-second fuse, three-metre radius, 25 HP damage against agent bots, and one accepted placement per room per second. These are gameplay defaults, not token prices. Bomb token prices default to zero (unavailable) pending configuration.
- Prompt conversion uses DEX Screener with a 15-second observation cache, configured minimum liquidity, and recent-hour trading activity. This is API-observation freshness, not a guarantee of oracle integrity or instantaneous market price. Quotes default to 60 seconds; the admin may select 15-120 seconds.
- SOLZ control defaults to 10,000 per second. COLACAT gameplay prices and prompt base USD default to zero. Markup defaults to 5 and Fast factor to 1.5, independently editable. No fixed USD value was invented for the user.

## Operating boundaries

- The development admin on port 3101 intentionally uses memory storage and does not read the shared production database. It displays read-only purchase defaults. Saving requires the existing durable-storage admin runtime with the intended database; do not remove the development isolation rule merely to enable this panel.
- Public API, worker and admin must use the same durable database. Elysia and Colyseus must share the existing service credential; the payment RPC must be the wallet's intended Solana network. Keep the worker running independently of the browser.
- Interaction admission requires an authenticated, commerce-capable account with a verified purchase for the exact match/source. Admission never grants a player seat. Every activation rechecks owner, match, target, payment and expiry.
- Reconciliation is a bounded safety net: scans every 15 seconds, at most 50 outstanding quotes from the last ten minutes, eight recipients and 100 recent signatures per recipient. It is not a complete historical indexer or a high-volume settlement guarantee. The owner can submit a transaction signature to the payment endpoint after that scan window. High-volume rollout needs indexed/paginated chain ingestion and operational monitoring.
- A consumed effect with a missing terminal receipt is uncertain, not automatically replayable. No refund, credit, rollover or restored control duration is issued after failure or process loss.
- Token-2022 support is restricted to extension-free mints. Transfer-fee/hook tokens are not silently accepted. Mint rotation affects new quotes only; existing receipts keep their original mint, treasury, amount and network.
- No NFT tickets, reserved-ranked-balance deductions, Solana-program upgrade, prediction-fee accounting change or external deployment was performed. These purchases are services, not withdrawable viewer balances.

## Verification record

- Elysia pricing/payment/storage/API and existing LLM instruction tests pass, including mint rotation, duplicate funding/consumption, account/match isolation, invalid receipts and finalized/network checks.
- Colyseus controller tests and asynchronous prompt/WebSocket relay tests pass, covering concurrent activation, bounded control, disconnect, paid-prompt gating and player-seat isolation.
- Focused totals: 28 Elysia tests, six Colyseus controller/admission tests, and 15 game terrain/snake/state tests pass (49 total), plus asynchronous prompt and WebSocket relay assertion suites. Game production build and Elysia/Colyseus server builds pass. Desktop/mobile admin and watch layouts were inspected; bomb geometry was inspected with same-frame nonblank canvas pixel checks using a temporary fixture, then the fixture was removed.
- Repository-wide checks are not clean: prediction frontend reports 133 existing errors; game application typecheck reports unrelated existing errors; Elysia full typecheck reports two existing `agent-colosseum.test.ts` type errors. No viewer-action diagnostics remain in those checks.
- The normal admin output path is blocked by filesystem permissions on `.output/server/node_modules`. An isolated production build passed using `node_modules/.nitro-viewer-actions-verify` for build intermediates and `/tmp/solz-viewer-admin-20260916` for output. Existing output was not deleted or permissions changed.
- No live wallet transfer, funded control activation in a production match, or end-to-end paid LLM execution was performed. Sales remain disabled until configuration and that live verification are completed.
