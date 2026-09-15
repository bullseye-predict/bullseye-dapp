# Prediction production plan

## Decision

Run two prediction deployments against the same real-game source:

| Deployment | Frontend | Backend | Solana target |
| --- | --- | --- | --- |
| Production | `astro-predict` production | `predict-backend-mainnet` | mainnet prediction program |
| Development | `astro-predict` devnet | `predict-backend-devnet` | devnet prediction program |

They have separate public backend URLs and separate Solana configuration. They may share the one combined production Neon database because it is the canonical off-chain game and question catalogue, not a source of Solana trading state.

`game-backend` (Elysia), Colyseus, and game Neon remain production-only. There is no need to deploy a development Elysia/Colyseus stack merely to display the same real matches in the devnet prediction product.

## Source of truth

| Data | Canonical owner | How prediction uses it |
| --- | --- | --- |
| Match creation, roster, lifecycle, winner, and match result | Elysia/Colyseus and combined Neon | Read by prediction as the match source and final oracle evidence |
| Scheduled agent-arena matches | Elysia scheduler and game Neon | Read as eligible future events |
| Live human ranked, casual, and stake matches | Game system and game Neon | Read as eligible events as soon as the match has a durable `matchId` |
| Approved general questions, options, timing, and resolution rule | Combined Neon / game-admin approval flow | Read as independent prediction catalogue entries |
| Market address, orders, positions, trades, settlement, and collateral | Respective Solana program and Manifest | Read directly from the configured Solana cluster |
| Historical fills and complete P/L | Future on-chain indexer | Optional derived data; never the source of truth |

Neon is required for off-chain information that does not exist in a market account yet: unopened market listings, labels, roster/options, scheduled times, and approved general-question detail. It remains useful after opening because it supplies human-readable market detail and the authoritative off-chain result source.

Solana stores the deterministic market identity and trading state once a market is opened. It cannot by itself enumerate future or unopened questions or reconstruct their display/options from a `matchId` without the catalogue.

## Catalogue model

`GET /market/list` should return the union of two canonical read-only sources.

### Match entries

Every durable match is eligible once it has a `matchId` and passes the trading-window policy:

- scheduled agent-arena matches;
- live human ranked matches;
- live human casual matches;
- live human stake matches;
- completed matches for result/settlement display, with trading disabled.

The prediction event route is `event/:matchId`; the corresponding game route remains its ordinary match route. A match event does **not** require a duplicate `prediction_question` row. The prediction backend derives its question layout from the live/scheduled canonical match record:

- two-sided/team match: team moneyline outcomes;
- FFA: one linked binary candidate market per participant for the initial launch;
- other match question types: deterministic `questionId` derived from the match and question type.

An eligible match is not automatically an on-chain market. The first trader requests a short-lived creation permit. The prediction backend reads the canonical match, confirms it is eligible and before cutoff, derives the question ID and market PDA, then signs the permit. The trader creates the market transaction on the target Solana cluster.

### General-question entries

General questions are unrelated to a single match, for example a season-wide “who has the most kills?” question. Each approved entry must have:

- stable `questionId`;
- title and description;
- answer options/outcome definition;
- opens/closes/resolution timestamps;
- oracle/resolution rule and evidence source;
- final answer when resolved;
- deterministic market identity inputs.

These entries remain in Neon because the pre-open catalogue and their detailed options are off-chain content. Their final answer is written by their approved resolution workflow; it is not inferred from an arbitrary on-chain market record.

## On-chain market design

For Solana, market identity is deterministic:

```text
market PDA = ["market", matchId, questionId, predictionProgramId]
```

Therefore Solana must not use the old Neon `market_binding` field to discover a market ID. The client/backend derives the PDA, fetches that account from the selected cluster, and reports “not opened yet” when it does not exist.

The existing `market_binding` code is retained only for legacy DreamDEX/EVM integrations, whose protocol creates a non-deterministic external market ID. It is not called by Elysia and is not part of the Solana creation or settlement path.

### FFA decision

The current lazy Solana creator only accepts two outcomes. The launch-safe FFA implementation is linked binary questions, one per candidate, generated on demand from the canonical participant roster.

A true single multi-outcome FFA market is a later program feature. It requires an explicit Pinocchio instruction/account-layout, matching Manifest/order routing, settlement, and UI upgrade. It must be backward compatible; existing binary Genesis/season questions continue to work.

## Resolution flow

1. Elysia/Colyseus writes the canonical match result to the game system.
2. `predict-backend-mainnet` and `predict-backend-devnet` read that same result.
3. Each backend signs/submits resolution only to its own configured Solana program.
4. The respective program settles its own market accounts.

For a general question, the approved general-question resolver supplies the canonical final answer instead of the match result. Both clusters can submit the same answer independently because their programs and market PDAs differ.

Neither backend needs to write a second match result into Neon. If both deployments see the same result, there is no overwrite: they submit to different chains.

## Neon rules

Both prediction backends may use the shared production Neon URL for reads of matches, schedules, results, and approved general questions.

The intended Solana runtime is read-only against game/question data. Existing legacy/cache features must not be treated as authoritative:

- `prediction_arena_events` is a compatibility cache, not truth. Identical source snapshots are a database-level no-op, including when a second backend replica starts.
- cached Solana portfolio/accounting records are optional and are no longer used by the frontend for holdings or open orders;
- `prediction_stake_events` and `market_binding` are legacy/DreamDEX-oriented data, not used to identify Solana PDAs;
- leaderboard, DreamDEX demo, dev faucet, and demo bookkeeping are optional features and must not be enabled in the mainnet runtime.

The devnet faucet is deliberately writable: it records wallets already funded so a sponsor cannot repeatedly fund the same wallet. It is devnet-only and must not be configured on mainnet.

## Frontend behavior

Each frontend targets exactly one prediction API URL:

- production frontend -> `predict-backend-mainnet` -> mainnet RPC/program;
- devnet frontend -> `predict-backend-devnet` -> devnet RPC/program.

The frontend reads live positions, order books, and collateral directly from the configured Solana RPC. It may use prediction backend/Neon only for catalogue and presentation data. Until an indexer is deployed, history and complete P/L are shown as unavailable rather than reconstructed from a backend cache.

## Required deployment configuration

Mainnet and devnet values must be distinct for:

- `SOLANA_RPC_URL`;
- Solana genesis hash / venue `chainId`;
- prediction program ID;
- Manifest program ID;
- collateral mint and decimals;
- network domain;
- permit/oracle signer;
- frontend prediction API URL and public network configuration.

The production permit signer is configured through `SOLANA_PERMIT_SECRET_KEY` (or its file variant). On backend boot, it verifies that the configured RPC genesis hash, mint, network domain, and signer match the on-chain prediction-program config. This is a required production safety check, not a devnet restriction.

The old demo secret can remain only as a devnet compatibility fallback. `SOLANA_DEMO_SECRET_KEY` enables the devnet-only faucet and must be absent from the mainnet deployment.

## Launch checklist

- [ ] Deploy the mainnet prediction program and record program/config/mint/domain values.
- [ ] Configure the mainnet backend with its own RPC, program, Manifest program, mint, domain, and permit signer.
- [ ] Verify the permit signer public key equals the oracle stored in the mainnet program config.
- [ ] Ensure no `SOLANA_DEMO_SECRET_KEY`, DreamDEX demo, or demo-funding configuration exists in mainnet.
- [ ] Deploy devnet backend with corresponding devnet values and its own public URL.
- [ ] Point each Astro frontend at the backend for its own cluster.
- [ ] Verify `market/list` returns the same production match/general catalogue to both clusters.
- [ ] Verify an unopened event displays as eligible and a first trader can create its deterministic PDA only on the selected cluster.
- [ ] Verify an Elysia final match result settles the corresponding market independently on devnet and mainnet.
- [ ] Verify portfolio holdings/open orders still render when the optional portfolio cache is unavailable.

## Remaining implementation work

The existing arena importer provides a match cache, but the final unified catalogue needs an explicit canonical read API/schema that returns all scheduled/live human and agent matches plus approved general questions. Its response must include the fields in the catalogue model above. Once that source contract exists, `predict-backend` can compose `/market/list` purely on demand and issue permits from the same canonical records without creating match-question rows in Neon.
