# Portable React application architecture

## Decision
Use Astro as the current host, with React owning the application. The intended migration target is Vite + React with TanStack routing/query tools as needed. Migration should reuse feature components and adapters; host setup and backend deployment still require work.

Not every Astro file needs conversion: HTML document metadata, route mounting, redirects, and HTTP endpoint bindings are host responsibilities. All product UI belongs in React.

## Current boundaries
- `src/pages/demo.astro` and `src/pages/live.astro`: mount client-only React entry points and supply the public Dynamic environment ID.
- `src/layouts/SiteLayout.astro`: HTML document and metadata only.
- `src/components/arena/DemoArenaApp.tsx` and `LiveArenaApp.tsx`: portable React composition roots, including CSS imports.
- `DynamicSolanaSession.tsx` and `DynamicSolanaSessionClient.tsx`: wallet provider integration; environment ID arrives through props.
- `SolzPredictionArena.tsx` and `MarketProbabilityChart.tsx`: React application UI.
- `model.ts`: shared application contracts.
- `demoArenaAdapter.ts` and `liveArenaAdapter.ts`: data and operation adapters. Live accepts a configurable overview URL.
- `src/pages/api/solz/overview.ts`: current Astro/Cloudflare backend endpoint. This is not portable client code.

## Module rules
Dependency direction is host -> React composition -> features -> domain contracts. Adapters implement those contracts. Features must not import host modules.

Pass public runtime configuration explicitly. Keep server credentials in backend bindings. Do not import Astro APIs, Cloudflare bindings, or environment globals into reusable React components.

As features grow, extract focused components and hooks for match viewing, market selection, prediction entry, positions, wallet controls, and live subscriptions. The arena currently remains a large component; this change establishes host boundaries rather than claiming that all feature extraction is complete.

Browser URL access currently exists in SolzPredictionArena. It works in either browser host, but must be wrapped behind route-state inputs/navigation callbacks when adopting TanStack Router so the router remains the owner of navigation state.

## Live video
Implement the future player as a React feature with explicit stream source and match identity. Use a streaming backend/CDN for delivery. Keep the player mounted through odds and score updates; recreate only when its source requires it. Clean up transport/player resources. Choose latency requirements independently of the frontend framework. Server match timing governs prediction cutoffs, not the delayed video frame.

## Migration to Vite + React + TanStack
1. Copy the React arena directory, styles, required public assets, and compatible dependencies into the new host.
2. Mount DemoArenaApp or LiveArenaApp under the new route tree. Supply environmentId explicitly; supply overviewUrl for the live app when its endpoint differs.
3. Replace Astro document metadata and redirects with the new host equivalents. Preserve any required SEO/server rendering separately.
4. Keep the overview backend deployed, or port its request handler and configuration to a separate server or TanStack Start server route. Vite alone does not replace that endpoint. Configure same-origin proxying or CORS as appropriate.
5. Adapt URL state and navigation at the route boundary. Keep Dynamic under a stable provider tree; verify route transitions do not unintentionally reset playback or wallet state.
6. Validate demo interactions, API failures, live subscriptions, wallet sign-in, cleanup, and stream behavior in the new host.

## Validation
Run bun run check and bun test for this boundary refactor. Actual wallet authentication requires browser verification and the correct Dynamic environment; portability does not resolve authentication failures by itself.

## Prediction backend and settlement foundation

The prediction services are separate from Astro and Colyseus. `apps/api/main.ts` is a standalone Bun host for REST and resumable, read-only WebSocket feeds. Runtime configuration and secrets stay in that host. No game commands are exposed by the telemetry bridge.

- `packages/prediction-core`: market/order/position contracts, validation, integer arithmetic, serialization. Prices use 1,000,000 as one; quantities use atomic collateral units. Public JSON carries amounts as decimal strings. Application timestamps use milliseconds; chain encoders use seconds.
- `packages/venue-interface/PredictionVenue.ts`: account-scoped interface shared by manual trading and Hermes. Network and signer configuration stays in adapters.
- `packages/adapters`: actual EVM RPC reads/EIP712 validation and Solana RPC/account/PDA/Ed25519 validation; portable venue clients and transaction builders. DreamDEX has a separate SDK driver boundary with exact binary outcome conversion and tick/lot checks. It is not a connected DreamDEX deployment.
- `packages/telemetry`: authenticated, monotonic, freshness-checked game snapshots. The publisher signs the exact body with a separate server secret. Telemetry cannot resolve a market or mutate gameplay.
- `apps/matcher`: price/time orderbook, atomic reservation planning and confirmed-fill accounting. Submission uncertainty retains reservations; confirmed failure suppresses retrying the same signed pair. A relayer transport is explicitly injected.
- `apps/api/storage`: durable local SQLite/WAL adapter, normalized read models, matcher state, auth nonces, event log and Hermes execution journal. This is a single-host implementation; PostgreSQL/Redis distribution is not implemented.
- `apps/indexer`: finalized event projection with atomic cursor and duplicate-event protection. Chain event decoding and complete/fresh portfolio sources are injected; an unconfigured portfolio endpoint returns unavailable instead of an invented empty portfolio.
- `apps/settlement`: durable, authority-verified result queue; unknown submission outcomes are reconciled rather than blindly broadcast again. A chain-specific result transport must verify matching receipts.
- `apps/hermes-worker` and `packages/risk-engine`: structured decisions, immutable hard limits, event filtering, scoped tools, durable intent reservations and stop/cancel reconciliation. The reasoner receives serializable observations and user strategy text, never wallet keys or RPC access. Real reasoning and signer providers require host configuration.
- `contracts/evm`: shared Solidity factory, settlement, ERC1155 outcomes, result oracle and constrained vault. These deploy separately on each EVM chain. Markets currently open immediately; the PENDING scheduling contract remains an application concern on EVM.
- `programs/prediction_market_pinocchio`: separate Rust/Pinocchio implementation with classic SPL collateral, internal position PDAs and user-owned collateral vaults. Position and order nonce PDAs must exist before fills. Solana outcome labels come from explicitly configured metadata, not synthesized probability data.

Liquidity and funds remain independent per venue/chain. Both implementations support 2–16 outcomes, complete-set collateral, partial fills, cancellation, owner-only vault withdrawal, pauses that preserve exits, and timeout voids. Void redemption carries a global fractional remainder so all collateral can be returned; redemption order can shift at most one atomic unit between claimants. Fees are zero in this MVP, result settlement is immediate, and configured oracle authorities are trusted.

The existing React live screen remains capability-locked. This foundation does not claim a deployed wallet flow, funded liquidity, a live Hermes reasoner, a provisioned SOLZ DreamDEX event, or production indexer/relayer operations. Those must be connected and verified before enabling the live UI.
