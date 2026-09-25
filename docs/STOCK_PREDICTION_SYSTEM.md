# Bullseye pre-stock prediction and trading system

Date: 2026-09-22. Updated: 2026-09-26 with the Bullseye product narrative and the pitch deck.

Status: Product and implementation specification. This document does not claim that integrations, live markets, token launches, or deployments have been completed. Sections 1 to 8 describe the Bullseye product and its pitch. Sections 9 to 22 are the data, question and resolution specification. The current question and agent state is in `solz-prediction-backend/docs/PRESTOCKS_QUESTIONS_AND_AGENT_PLAN.md`.

## 1. Bullseye in one line

Bullseye is a transparent AI agent for pre-stock and stock prediction and trading.

- Watch first. Follow later.
- Trust is earned, not given.

Bullseye starts with pre-stocks: tokens that give exposure to private companies before an IPO, such as OpenAI, Polymarket, Anthropic and SpaceX. The verified PreStocks assets are in `packages/prediction-core/prestocks.ts`. Listed stocks, for example tokenized NVIDIA, Tesla, Apple and Alphabet, use the same model.

## 2. Problem

More people use AI to help make investment decisions. Few let an AI agent manage their money.

- 30% of U.S. retail investors use AI tools to pick or change investments. That share grew 75% in one year (eToro Retail Investor Beat, 2025).
- 57% of U.S. affluent investors use AI for financial and investment tasks. Only 7% say AI was the main factor in their last major investment decision (HSBC, "The Trust Threshold", Ipsos survey of 1,128 U.S. investors, 2026).

The cause is visibility. Most AI trading products show only a final answer. They do not show:

- what the agent looked at,
- what information changed its mind,
- how its conviction changed over time,
- how often it was right before.

Without that, a user has no basis for trust.

## 3. What Bullseye shows

Bullseye publishes the agent's work, not only its final trade.

| Bullseye shows | Meaning |
| --- | --- |
| Inputs | What the agent follows: company news, market price, volume, momentum and other signals |
| Conviction timeline | Each change in conviction, with a timestamp. A published entry is never edited. |
| Reason for a change | What the agent knew, and what changed |
| Track record | Each call is scored against measured data by our oracle |

Illustrative example, as used in the pitch deck. In the morning the agent is 50% bullish on OpenAI. It then finds new information and sees trading volume accelerate. Its conviction moves to 67% and it calls BUY. The user sees both entries and the reason between them.

Users are not asked to trust the agent blindly. They watch its record first, then decide whether to follow it.

### Gap between the pitch and the current agent

The pitch describes the target product. The current forecast worker is a transparent 24-hour price-momentum baseline with a fixed, uncalibrated 55% confidence. It does not yet read news, external volume, market odds, spread, liquidity or fees. Do not describe the current calls as research-backed or trade-worthy until those inputs and a calibrated model exist. See `solz-prediction-backend/docs/PRESTOCKS_QUESTIONS_AND_AGENT_PLAN.md`.

## 4. Question structure: main question and agent sub-question

Every main pre-stock question has a linked agent sub-question.

| Level | Example title | Answers | Badge |
| --- | --- | --- | --- |
| Main pre-stock question | `OpenAI PreStock above ___ on October 31?` | One Yes/No market per price, titled only with the price: `$1,225`, `$1,275` | `PRESTOCKS · OUR VENUE` |
| Agent sub-question | `Agent: OpenAI PreStock above ___ on October 31?` | Accuracy bands of the agent's scheduled calls | `AGENT PERFORMANCE · OUR ORACLE` |

Agent sub-question rules (summary; the backend plan is authoritative):

1. The agent publishes one immutable forecast before each scheduled window, for example every 12 hours.
2. Each forecast is scored on the measured result of its own window, not on the final result of the main question.
3. A missing forecast counts as wrong.
4. At the main deadline, the oracle counts correct calls and resolves one band Yes and all other bands No.
5. There are at most four bands: under 50%, 50–79%, 80–99% and exactly 100%. Each label gives the rate, then the count range: `80–99% · 12–13 of 14`, `100% · 14 of 14`. A band that holds no count is dropped.
6. `accuracyBands()` in `solz-prediction-backend/apps/stake-api/general-events.ts` is the only place that builds the bands.
7. The agent never edits a published forecast and never supplies the oracle verdict.

Questions are created only in `solz-prediction-backend`, through its builders and guard. This frontend shows the published rows. The first trader opens a market through `POST /solana/market-permit` on the stake API.

### On-chain program

Each Yes/No market trades on the Bullseye Solana order book (CLOB). Its source is [bullseye-predict/onchain-prediction-clob](https://github.com/bullseye-predict/onchain-prediction-clob). This repository holds it as a git submodule at `programs/onchain-prediction-clob`. The local working copy is `solz-prediction-solana`.

| Program | Folder | Role |
| --- | --- | --- |
| `prediction_market_pinocchio` | `programs/onchain-prediction-clob/programs/prediction_market_pinocchio` | Markets, orders, fills, positions, collateral vaults and settlement |
| `manifest_guard` | `programs/onchain-prediction-clob/programs/manifest_guard` | Customized Manifest order book (GPL-3.0). Every entry checks a binding owned by the prediction program. Global and reverse orders are disabled. Upstream audit claims do not cover these changes. |

Get the program source after you clone this repository:

```bash
git submodule update --init programs/onchain-prediction-clob
```

The submodule is pinned to one commit. It does not follow the program repository by itself. To move it to the newest `main`, run `git submodule update --remote programs/onchain-prediction-clob` and commit the new pointer. Program changes are made and deployed in `solz-prediction-solana`, not in this folder.

## 5. Why the agent question can add pre-stock volume

The pitch asks: how many times will Bullseye hit the bullseye?

1. Bullseye publishes its calls.
2. Traders who doubt the agent take the other side on the agent sub-question.
3. A trader who wants to prove the agent wrong also trades the pre-stock itself.
4. Pre-stock trading volume increases.

This is a product hypothesis. It is not measured. Measure agent-question volume and pre-stock pool volume separately, and label them separately, before making this claim in public (see section 17).

The agent must never trade a pool to move an outcome that it forecasts.

## 6. Roadmap

| Stage | User action | Precondition |
| --- | --- | --- |
| Today | Watch the agent's conviction, calls and record | Published forecasts and oracle scoring |
| Tomorrow | Follow the agents they trust, per company, market or strategy | A public track record per agent |
| Later | Let an agent trade for them | Paper trading first; then user-scoped authorization, maximum capital, order, exposure and loss limits, a market allowlist, a stop control and durable intent reconciliation |

Report forecast accuracy, simulated return and realized return separately. A high hit rate does not prove trading profitability.

## 7. Demand evidence

People already follow traders who have a visible record.

- eToro had 4.07 million funded accounts on April 30, 2026. Copy trading volume reached an all-time high in Q1 2026. More than 5,000 traders were in its Pro Investor program on March 31, 2026 (eToro Q1 2026 results).
- On September 30, 2024, 12 eToro Popular Investors each had more than $10 million of assets copying them (eToro Group Ltd. Form F-1, 2025).
- eToro Pro Investors build a public track record and share their strategy with the people who copy them (eToro Pro Investor Program guiding principles, 2026).
- The CFA Institute warns that opaque AI decisions in finance can reduce trust, and asks for AI systems that are transparent and auditable (Explainable AI in Finance, 2025).

Bullseye connects three behaviors: social trading, AI agents and pre-stock markets.

## 8. Pitch deck

The pitch deck is the `/pitch-deck` route in this repository (`solz-prediction-market-vite`). It has 7 slides:

1. Cover: Bullseye, a transparent AI agent for pre-stock and stock prediction and trading.
2. Problem: people ask AI about investing, few let it trade their money.
3. Desktop view: the OpenAI pre-stock question and its agent sub-question, with conviction from 50% to 67%.
4. Product: a public AI trader, with pre-stock and stock logos and the agent thinking feed in a phone.
5. Trust is earned, not given.
6. Predict the agent: the accuracy-band question in a phone, and the volume loop from section 5.
7. Close: today watch, tomorrow follow, and the contact.

Files:

| File | Content |
| --- | --- |
| `src/routes/pitch-deck.tsx` | Route. The slide number is in the URL, for example `/pitch-deck?slide=3`. |
| `src/components/pitch/PitchDeckApp.tsx` | Deck frame, navigation and speaker notes |
| `src/components/pitch/PitchSlides.tsx` | Slide content. The phones and the desktop frame render the real `AgentThinkingFeed` and `OutcomeRow` components. |
| `src/components/pitch/pitchDeck.ts` | Illustrative prices, conviction values, agent thoughts, logos, speaker script and contact |
| `src/components/pitch/pitch-deck.css` | Deck styles |

Controls: arrow keys, Space and Page Up/Down change the slide. Home and End go to the first and last slide. N shows the speaker notes. F sets full screen. Swipe works on a phone.

All prices, conviction values and agent thoughts in the deck are illustrative. They are not a live record.

Contact: Telegram [@dellwatson](https://t.me/dellwatson).

## 9. Product decision

Extend the existing prediction-market engine with stock-token intelligence and prediction questions. Users can inspect measured activity, compare competing launches, trade forecasts, and inspect the evidence used to resolve questions.

Do not build a token launchpad for this feature. Read activity from existing Meteora DBC launches and from explicitly supported PreStocks token markets. Token creation, treasury purchases, and buybacks are not required.

There are two distinct data modules sharing the existing prediction engine:

1. **Meteora DBC intelligence:** discover stock-paired DBC launches, aggregate activity across their pools, compare weekly cohorts, and resolve launch-related predictions.
2. **PreStocks intelligence:** track verified PreStocks assets and explicitly selected markets, provide asset and ecosystem comparisons, and resolve price/volume predictions.

An optional COLACAT launch through ClawPump paired with a PreStocks asset is a separate integration. Its instant DAMM v2 pool is not a DBC launch.

## 10. The aggregate-volume requirement

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

## 11. Metrics and interpretation

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

## 12. Meteora DBC module

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

## 13. PreStocks module

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

## 14. Eligibility boundaries

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

## 15. Prediction lifecycle and resolution

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

## 16. Proposed architecture

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

## 17. UI requirements

### Main overview

At the top: selected segment, week, precise protocol scope, cumulative volume, comparable previous-period change, new launches, curve completions, and data freshness.

Below: daily/cumulative chart, competitor table, and related predictions. Include segment-wide totals even when the table is paginated. Filters must say whether they change the total or only table presentation.

### Drilldown

Segment → stock-pair group → launch/token → exact pool → source transactions.

Show DBC and DAMM v2 phases separately. A “lifetime” toggle must explain when migration changes the venue. Show prediction-market trading volume in a separately labeled field from underlying token/pool volume.

### Question presentation

Every question includes measured progress, deadline, rules, data scope, and evidence access. A forecast price is not an oracle measurement; measured volume and prediction odds must use distinct labels.

Use green/red for Yes/No and Buy/Sell according to existing project rules. Preserve table/chart structure during loading. Display unknown metrics as unavailable, not zero. Agents cite source measurements and dates in their commentary.

## 18. Compute and reliability constraints

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

## 19. Delivery phases

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

## 20. Acceptance tests

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

## 21. Open decisions

1. Which verified public-stock quote assets and DBC pools form the first eligible segment?
2. Which PreStocks tokens and exact pools have enough historical data and liquidity?
3. Which source supplies historical USD prices with sufficient coverage?
4. What market cutoff, measurement window, minimum activity, tie rule, and data-gap grace period will each template use?
5. What historical start date defines complete coverage?
6. Does the sponsor accept this data-and-prediction use case, and is the full selected asset scope compatible with PreStocks rules?

These questions do not require a launchpad or buyback feature. They are the prerequisites for trustworthy analytics and resolution.

## 22. Sources and evidence limits

- Meteora DBC events: https://docs.meteora.ag/developer-guides/dbc/program/events
- Meteora DBC SDK: https://docs.meteora.ag/developer-guides/dbc/typescript-sdk/getting-started
- DBC quote-token rules: https://docs.meteora.ag/core-products/dbc/token-2022-support
- PreStocks products: https://prestocks.com/products
- PreStocks product API referenced by bounty: https://prestocks.com/api/prestocks
- ClawPump launch interface: https://clawpump.tech/launch
- Tessera docs, for alternative-track assessment: https://docs.tessera.pe
- Existing analytics examples: https://edge.meteora.ag/ and https://memefees.com/launchpads/meteora-dbc
- eToro, US retail investors and AI tools, 2025: https://www.etoro.com/en-us/news-and-analysis/latest-news/press-release/us-retail-investors-flock-to-ai-tools-with-usage-surging-75-in-one-year/
- eToro Q1 2026 results: https://www.etoro.com/en-us/news-and-analysis/latest-news/press-release/etoro-reports-q1-2026-results/
- eToro Group Ltd. Form F-1: https://www.sec.gov/Archives/edgar/data/1493318/000101376225001589/ea0223534-08.htm
- eToro Pro Investor Program guiding principles: https://www.etoro.com/wp-content/uploads/2026/01/pro_investor-Program_Starter.pdf
- HSBC, The Trust Threshold, 2026: https://www.about.us.hsbc.com/newsroom/press-releases/the-trust-threshold-the-majority-of-us-investors-use-ai-to-explore
- CFA Institute, Explainable AI in Finance, 2025: https://rpc.cfainstitute.org/research/reports/2025/explainable-ai-in-finance

The challenge descriptions and ClawPump screenshots supplied in this conversation are the basis for bounty and UI interpretations. Public documentation confirms relevant protocol capabilities but does not grant bounty eligibility. Exact active pools, mint compatibility, API behavior, source coverage, and production contracts still require verification during implementation.
