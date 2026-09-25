# Stock prediction and launch intelligence system

Date: 2026-09-22

Status: Product and implementation specification. This document does not claim that integrations, live markets, token launches, or deployments have been completed.

## 1. Product decision

Extend the existing prediction-market engine with stock-token intelligence and prediction questions. Users can inspect measured activity, compare competing launches, trade forecasts, and inspect the evidence used to resolve questions.

Do not build a token launchpad for this feature. Read activity from existing Meteora DBC launches and from explicitly supported PreStocks token markets. Token creation, treasury purchases, and buybacks are not required.

There are two distinct data modules sharing the existing prediction engine:

1. **Meteora DBC intelligence:** discover stock-paired DBC launches, aggregate activity across their pools, compare weekly cohorts, and resolve launch-related predictions.
2. **PreStocks intelligence:** track verified PreStocks assets and explicitly selected markets, provide asset and ecosystem comparisons, and resolve price/volume predictions.

An optional COLACAT launch through ClawPump paired with a PreStocks asset is a separate integration. Its instant DAMM v2 pool is not a DBC launch.

## 2. The aggregate-volume requirement

The primary dashboard must show the combined activity of all qualifying tokens/pools in the selected scope, not merely separate token cards. Users should be able to answer: “How active was this entire stock-paired Meteora segment this week compared with last week?”

Use five explicit scopes:

| Scope | Definition | Example label |
| --- | --- | --- |
| Exact pool | Swaps executed in one identified pool | Volume in pool ABC |
| Token within selected venues | Deduplicated swaps involving one mint across the selected pools | POLYMARKET volume on tracked Meteora pools |
| Stock-pair group | All qualifying launches paired with one verified stock mint | Combined volume of launches paired with stock X |
| Weekly launch cohort | All qualifying launches first created during a specified week | This week's stock-paired DBC launches |
| Entire tracked segment | All qualifying pools active during the period, including older launches | Total tracked stock-paired DBC volume this week |

Default overview: entire tracked stock-paired DBC segment, current UTC week to date. Provide a separate “new this week” cohort filter. Never confuse weekly trading activity with activity only from newly launched tokens.

Example, using hypothetical amounts: pool A records $10,000, B $20,000, and C $5,000 of qualifying swaps. Combined pool-execution volume is $35,000. If A's token also trades elsewhere, those outside trades do not enter this total. If a routed trade executes through two selected pools, both executions count in pool-execution volume; this is not a measure of unique incoming capital.

Do not obtain the segment total by adding token-level totals: one swap can appear under both token mints and would be counted twice. Aggregate canonical swap records once per pool execution.

## 3. Metrics and interpretation

### Overview metrics

- Weekly cumulative USD swap volume across the full selected scope.
- Daily volume bars and cumulative week-to-date line.
- Previous-week comparison, using the same elapsed interval for an unfinished week.
- Number of newly launched distinct token mints and number of new pools, separately.
- Active pools, curve completions, and completed migrations, separately.
- Unique trading wallet addresses across the scope, when attribution is reliable.
- Transaction count, swap count, and distribution of volume between launches.
- Liquidity/reserve snapshots with timestamps, never summed across time as volume.
- Coverage, freshness, and missing-data indicators.

Wallet counts are not human counts. Routed transactions may require additional attribution; ambiguous traders must be marked unknown rather than counted as known users. Website visits are a separate analytics metric and cannot be inferred from on-chain transactions.

Volume measures turnover, not bullishness, net deposits, or organic demand. Show price changes, liquidity, and concentration alongside it. Label volume as observed gross volume unless a published filtering method defines an additional adjusted metric.

### USD conversion

Retain raw token amounts and decimals. Define swap notional using one documented side of the trade, preferably quote-side amount excluding swap fees where the protocol exposes it. Multiply by a timestamp-aligned USD price of the quote token. Do not add the USD values of both sides.

Store price source, timestamp, and valuation method. An unavailable or stale quote price produces incomplete USD coverage, not zero volume. Preserve native-quote totals so the missing conversion is visible. Never value an entire historical week using today's quote-token price.

### Weeks and cohorts

Default week: Monday 00:00:00 UTC inclusive to the following Monday exclusive. Friday questions must specify their own exact UTC deadline. Display the user's local-time equivalent without changing the underlying boundary.

For comparative predictions, freeze eligible competitors and rules before trading begins. Discovery can continue for dashboards without silently changing an already-open market's candidate set.

## 4. Meteora DBC module

### Discovery and qualification

Read DBC pool initialization events and account state. Link pool to config, base mint, quote mint, creator, activation time, and canonical chain identifiers. Match quote mints against a reviewed stock-asset registry; ticker text alone is insufficient.

Track standard and transfer-hook pool paths where supported. Backfill history from a defined checkpoint, then ingest finalized activity continuously with resumable cursors.

Meteora documents initialization, swap, and curve-completion events, including `EvtInitializePool`, `EvtInitializePoolWithTransferHook`, `EvtSwap2`, and `EvtCurveComplete`. Decode according to the pinned program/SDK version; do not infer DBC prices from generic transfer logs.

### Lifecycle

Maintain distinct states: discovered, not yet active, trading on DBC, curve complete, migrated, unavailable.

Curve completion is not proof of completed DAMM v2 migration. Store the destination pool mapping after verification. Default DBC volume excludes post-migration swaps. An optional “launch lifetime” view can combine DBC and destination DAMM v2 activity, clearly split by phase.

### Example predictions

| Template | Resolution metric |
| --- | --- |
| Will pool A complete its curve before Friday? | Verified curve-completion event before the specified deadline |
| Will tracked stock-paired DBC weekly volume exceed $X? | Sum of qualifying valued swaps within the fixed interval |
| Will at least N distinct stock-paired tokens launch this week? | Distinct qualifying base mints initialized within the interval |
| Which of these launches has the highest Friday volume? | Fixed candidate set; identical pool scope and measurement interval |
| Which launch has the highest return by Friday? | Defined opening/closing average prices, USD conversion, and sample requirements |

Start with curve-completion questions. Add volume questions after valuation and completeness checks are proven. Launch counts and return rankings require explicit spam and manipulation treatment. Avoid subjective labels such as “most bullish” without a numerical definition.

### Value for issuers and users

Issuers see competitor activity, weekly demand, launch completion rates, and where their launch ranks. Users see historical outcomes alongside current forecasts. Agents can produce evidence-linked weekly explanations and track their forecasting performance.

No agent is allowed to decide settlement from narrative judgment. Forecasting and deterministic resolution remain separate.

## 5. PreStocks module

### Asset registry

Retrieve and verify official PreStocks product metadata. Store provider, referenced company, exact mint, token program, decimals, applicable extensions, metadata provenance, and last verification time. Names such as OPENAI or POLYMARKET are not sufficient identity checks.

The referenced company, its PreStocks exposure token, and any agent token paired with that exposure token are three different entities. UI labels must preserve that distinction.

### Data surfaces

- Entire tracked PreStocks segment volume for the week.
- Per-asset volume and share of the tracked segment.
- Exact pool drilldowns and explicit venue filters.
- USD price history and source freshness.
- Launches paired with a PreStocks asset, shown separately from the asset's broader trading activity.
- Current predictions, settled history, and settlement evidence.

For example, COLACAT/POLYMARKET pool volume is turnover in that pair. It is not all POLYMARKET-token volume and is not betting volume on the Polymarket prediction platform.

Default to a small verified set of pools with complete coverage. Expand to other venues only through named adapters and published scope changes. Avoid an unsupported claim of “all-market volume.”

### Question templates

1. Will a specific PreStocks token's defined closing average price exceed $X on Friday?
2. Which of a fixed set of PreStocks assets records the highest volume on the specified tracked venues during the week?
3. Will the entire tracked PreStocks segment exceed $X in weekly volume?
4. Will volume of the tracked PreStocks segment exceed the previous completed week?
5. Will a named PreStocks-paired pool exceed $X of volume by the deadline?

Linked questions can render one Yes/No market per candidate using existing binary contracts. Do not imply that independently traded linked markets form one automatically normalized multi-outcome book. Ties, no qualifying activity, and invalid data need explicit shared resolution rules.

### ClawPump relationship

The pictured ClawPump route selects a PreStocks asset and an instant DAMM v2 pool. It can support the separate stock-paired agent-token launch concept. The launch is not required to read PreStocks data or create prediction questions.

The selected screenshot asset charges a 1% transfer fee. Current reviewed DBC documentation requires zero current/scheduled transfer fees for quote assets, including token-badge cases. Therefore that pictured instant pool cannot be represented as the DBC demonstration. Recheck exact mint compatibility before future implementation rather than assuming every PreStocks asset always has identical properties.

Prediction collateral, stock-pool liquidity, and agent-token holdings remain separately accounted. Do not change prediction collateral or redirect user deposits to stock pools as part of this feature.

## 6. Eligibility boundaries

Interpretations below are based on the supplied challenge screenshots, not written sponsor approval.

| Track | Proposed contribution | Limitation |
| --- | --- | --- |
| Meteora DBC | Stock-paired DBC discovery, segment analytics, and evidence-resolved prediction markets | Plausible DBC use case; data-only bounty eligibility and judging remain sponsor decisions |
| PreStocks | Actual PreStocks token data and useful price/volume prediction markets | Must respect the exclusion of non-PreStocks pre-IPO-token integrations |
| ClawPump | Separate agent-token launch with a stock-paired Meteora pool | Analytics alone does not satisfy a launch requirement |
| Tessera | Alternative module using its OpenAI or Kalshi T-Tokens | Integrating competing pre-IPO tokens conflicts with the stated PreStocks exclusion |

Do not add Tessera to the proposed PreStocks-focused submission by default. An asset from another provider is not automatically pre-IPO; classify the actual instrument. Public-stock tokens require separate assessment and should not be mislabeled as prohibited pre-IPO tokens solely because of their issuer.

A whole-protocol DBC feed can include competing pre-IPO tokens. For a PreStocks-focused product, use an explicitly reviewed scope; do not assume that displaying competitors' data is exempt from “integration.” A separate page or feature flag is not guaranteed to make the project exempt.

Existing volume dashboards already exist. The differentiator is the combination of well-defined stock-paired weekly aggregates, competitor comparison, tradable forecasts, and reproducible resolution evidence. Do not claim that no competing product has this combination without a broader market audit.

## 7. Prediction lifecycle and resolution

1. Discover a pool or scheduled period.
2. Generate a draft from a versioned question template.
3. Verify registry membership, source coverage, freshness, and supported resolution path.
4. Publish immutable rules and candidate/scope manifest; activate trading through the existing authorized market path.
5. Lock trading at the declared server-authoritative cutoff.
6. Wait for measurement end and finalized, complete indexed data.
7. Build a deterministic evidence bundle and submit through the existing authorized settlement mechanism.
8. Display outcome, calculation, source transactions, rule version, and any void reason.

Discovery alone must not automatically create unlimited funded markets. Apply draft quotas and explicit qualification criteria. Missing sources do not become zero measurements. If data cannot be restored within the published grace period, use the predefined void/unavailable policy.

An evidence bundle should contain market ID, template version, exact pool/mint scope, measurement bounds, finality policy, indexed slot coverage, included event identifiers or content-addressed export, price observations, calculation version, result, and evidence hash. A hash supports integrity; it does not make an authority-based settlement trustless.

Publish tie rules before opening a market. For “highest volume” linked questions, one possible policy is that all tied leaders resolve Yes; another is void on a tie. Select one product policy before implementation and test it consistently. Never choose after the result is known.

## 8. Proposed architecture

Preserve the existing React application and prediction engine. Names below describe proposed responsibilities, not claims about deployed components.

| Component | Responsibility |
| --- | --- |
| Asset registry | Verified issuers, stock classifications, mints, and scope versions |
| DBC source adapter | Pool discovery, event decoding, state reconciliation, migration mapping |
| PreStocks source adapter | Product metadata and verification |
| Pool adapters | Exact-pool swaps and state for supported venues, initially the relevant Meteora pools |
| Price adapter | Timestamped quote-token USD observations and stale-data policy |
| Analytics worker | Idempotent ingestion and incremental period aggregates |
| Question generator | Bounded drafts from approved templates |
| Resolution calculator | Pure deterministic calculations over frozen rules and evidence |
| Settlement adapter | Existing authenticated/authorized prediction resolution interface |
| React features | Overview, weekly cohorts, asset/pool pages, question lists, evidence views |

Domain calculations remain plain TypeScript. Networking, persistence, wallet access, and chain decoding belong in adapters. Host configuration is injected; no secrets enter client props. Existing routes and provider ownership should be inspected at implementation time because architecture notes may describe older milestones.

### Proposed records

- `Asset`: issuer, company, mint, chain, decimals, classification, verification provenance.
- `Pool`: address, protocol/program, base mint, quote mint, config, creation slot, activation, migration mapping.
- `Swap`: signature, outer/inner instruction identity, pool, slot, timestamp, raw amounts, fees, direction, trader attribution.
- `Valuation`: swap reference, USD amount, price reference, method version, completeness.
- `PeriodAggregate`: scope version, time bucket, volume, swaps, counts, coverage, update time.
- `QuestionRules`: metric, thresholds/candidates, scope manifest, time bounds, tie/data-gap policy, version.
- `ResolutionEvidence`: rules reference, data coverage, calculation result, source manifest, submission status.

Deduplicate events with chain identity plus transaction and instruction/event position. A transaction signature alone is insufficient because one transaction can contain multiple swaps.

## 9. UI requirements

### Main overview

At the top: selected segment, week, precise protocol scope, cumulative volume, comparable previous-period change, new launches, curve completions, and data freshness.

Below: daily/cumulative chart, competitor table, and related predictions. Include segment-wide totals even when the table is paginated. Filters must say whether they change the total or only table presentation.

### Drilldown

Segment → stock-pair group → launch/token → exact pool → source transactions.

Show DBC and DAMM v2 phases separately. A “lifetime” toggle must explain when migration changes the venue. Show prediction-market trading volume in a separately labeled field from underlying token/pool volume.

### Question presentation

Every question includes measured progress, deadline, rules, data scope, and evidence access. A forecast price is not an oracle measurement; measured volume and prediction odds must use distinct labels.

Use green/red for Yes/No and Buy/Sell according to existing project rules. Preserve table/chart structure during loading. Display unknown metrics as unavailable, not zero. Agents cite source measurements and dates in their commentary.

## 10. Compute and reliability constraints

Index once for all users. Do not poll every pool from each browser or rescan chain history on dashboard requests.

- Batch event writes and update aggregates incrementally.
- Query precomputed scoped aggregates; avoid queries inside pool loops.
- Persist cursors atomically with processed batches where applicable.
- Deduplicate retries and reconcile uncertain settlement submissions before rebroadcast.
- Use bounded exponential retry backoff with jitter; proposed sequence starts at 5 seconds and caps at 5 minutes, with outage alerts and circuit breaking.
- Run bounded backfills separately from request handlers and live ingestion budgets.
- Use shared caches and compact payloads; keep large evidence blobs off overview responses.
- Track index lag, queue size, database round trips, response bytes, and retry rates.

Proposed acceptance targets, not measurements: cached overview p95 under 500 ms; uncached aggregate overview p95 under 1.5 seconds; at most two sequential database round trips for overview; freshness lag visible whenever data misses the configured ingestion target. Measure these in the actual runtime before marking implementation complete. Existing caller deadlines, including the documented 4.5-second director budget, take precedence if a shared path is involved.

## 11. Delivery phases

### Phase 0 — verify the data universe

- Identify actual active stock-paired DBC pools and their mints.
- Confirm enough real activity exists for useful weekly comparisons.
- Verify PreStocks asset metadata and exact tracked DAMM v2 pools.
- Decide source provider, historical coverage, price history, and dataset scope.
- Resolve sponsor eligibility questions before claiming a combined submission.

If real qualifying DBC activity is sparse, show that honestly. Do not fabricate pools, volume, or mainnet examples.

### Phase 1 — read-only intelligence

Implement exact-pool ingestion, weekly aggregates, segment totals, cohort comparison, PreStocks asset pages, source drilldowns, and freshness/coverage reporting. This phase is useful without prediction liquidity.

### Phase 2 — deterministic predictions

Start with a DBC curve-completion template and a verified PreStocks price/volume template. Reuse existing market creation and settlement capabilities only after their current contracts are checked. Add frozen-cohort volume rankings and segment thresholds after the first templates pass end-to-end verification.

### Phase 3 — agent explanations

Add evidence-linked summaries, competitor explanations, forecasts, and historical forecast scoring. Agents never override settlement rules or manipulate the pools whose outcomes they predict.

### Phase 4 — mainnet demonstration

Demonstrate real observed DBC activity, aggregate reconciliation, an operational prediction flow where authorized and funded, and reproducible settlement. Mainnet reads, mainnet prediction trading, and a mainnet token launch are separate milestones; report exactly which were performed.

## 12. Acceptance tests

- Segment volume equals the sum of canonical included pool executions without token-level double counting.
- Duplicate ingestion does not change aggregates.
- Multi-swap transactions retain every distinct execution once.
- Weekly boundaries and unfinished-week comparisons are correct.
- Quote decimals and timestamped USD conversion work without floating-point amount loss.
- Missing price/history coverage is visible and blocks affected settlement.
- DBC completion is distinguished from DAMM v2 migration.
- Post-migration volume is excluded from DBC-only totals.
- Linked outcomes apply the chosen shared tie policy consistently.
- Settlement evidence reproduces the displayed result.
- PreStocks token identity cannot be spoofed through names or tickers.
- Fees, prediction collateral, and stock-pool balances stay separately accounted.
- Retry storms are bounded and request paths do not perform repair/backfill work.

When code is implemented, run `bun run check`, relevant Bun tests, and local browser verification reusing one test tab. A documentation-only change does not demonstrate any runtime behavior.

## 13. Open decisions

1. Which verified public-stock quote assets and DBC pools form the first eligible segment?
2. Which PreStocks tokens and exact pools have enough historical data and liquidity?
3. Which source supplies historical USD prices with sufficient coverage?
4. What market cutoff, measurement window, minimum activity, tie rule, and data-gap grace period will each template use?
5. What historical start date defines complete coverage?
6. Does the sponsor accept this data-and-prediction use case, and is the full selected asset scope compatible with PreStocks rules?

These questions do not require a launchpad or buyback feature. They are the prerequisites for trustworthy analytics and resolution.

## 14. Sources and evidence limits

- Meteora DBC events: https://docs.meteora.ag/developer-guides/dbc/program/events
- Meteora DBC SDK: https://docs.meteora.ag/developer-guides/dbc/typescript-sdk/getting-started
- DBC quote-token rules: https://docs.meteora.ag/core-products/dbc/token-2022-support
- PreStocks products: https://prestocks.com/products
- PreStocks product API referenced by bounty: https://prestocks.com/api/prestocks
- ClawPump launch interface: https://clawpump.tech/launch
- Tessera docs, for alternative-track assessment: https://docs.tessera.pe
- Existing analytics examples: https://edge.meteora.ag/ and https://memefees.com/launchpads/meteora-dbc

The challenge descriptions and ClawPump screenshots supplied in this conversation are the basis for bounty and UI interpretations. Public documentation confirms relevant protocol capabilities but does not grant bounty eligibility. Exact active pools, mint compatibility, API behavior, source coverage, and production contracts still require verification during implementation.
