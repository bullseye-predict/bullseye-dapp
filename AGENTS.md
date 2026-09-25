# Local agent instructions

## File creation
Do not create new Markdown files unless the current user message explicitly requests them. Keep documentation in the response otherwise.

## Browser testing
Reuse one test tab. Open a second only for a direct comparison, never exceed two, and close temporary tabs afterward.

## Protected external actions
- Never authenticate with Vercel, open a Vercel authorization flow, link this repository to Vercel, change Vercel configuration, call the Vercel API, or deploy to Vercel unless the **current user message** explicitly authorizes that exact Vercel action.
- Never create a Git commit or push a Git branch or tag unless the **current user message** explicitly authorizes that exact Git action.
- Authorization from an earlier message or turn does not carry forward. Requests such as “finish it,” “deploy it,” “make it live,” or “complete it” do not authorize Vercel or Git operations unless Vercel or the exact Git operation is named in the current message.
- A request to deploy a Solana program, contract, backend, or another named target authorizes only that named target. Do not infer a frontend or Vercel deployment from it.
- Local builds, local previews, and local browser testing are allowed. If a requested deployment target is ambiguous, keep the work local and ask before performing any external deployment.

## Environment variables
- Before adding, removing, renaming, or changing the meaning of any environment variable, present the exact variable, repository, public or secret classification, and runtime effect to the user and get explicit permission. Do not make that change automatically.

## Architecture
Read ARCHITECTURE.md before changing application boundaries.
Keep all product UI and interactive behavior in React and ordinary TypeScript. Astro files may contain route entry points, redirects, document metadata, and server endpoint bindings only. Do not move product logic into Astro components.
Keep React components independent of Astro, Cloudflare bindings, and framework-specific routers. Read environment variables in the host and pass public configuration through typed props. Never pass server secrets into client props.
Keep domain models and business rules in plain TypeScript. Use adapters for networking, wallet SDKs, persistence, and real-time transports. Inject endpoint configuration; do not scatter URLs through UI components.
Keep one React provider tree for the arena. Keep styles with the portable React entry points. A new host should mount those entry points without rewriting feature components.
For larger refactors, split components along feature responsibilities and extract hooks for lifecycle/state logic. Avoid a broad rewrite solely to reorganize files. Preserve behavior and public contracts.
For future TanStack integration, put router-specific hooks and links in host wrappers and pass navigation callbacks and route state into features. Do not add TanStack dependencies until migration is requested.
Keep video playback lifecycle independent of odds updates. Dispose player instances, subscriptions, timers, and connections on unmount. Use authoritative server timing for prediction cutoffs.
Validate changes with bun run check and relevant bun tests. Report limitations honestly; do not claim a framework migration or end-to-end wallet test was completed without performing it.

## Linked question copy

For a price ladder, put the complete question once in the shared event title, for example `OpenAI PreStock above ___ on September 30?`. Each linked answer title and catalogue row label is only its formatted price (`$1,225`, `$1,275`, etc.); its separate Yes/No buttons are the contracts. Do not repeat the question, date, or asset name in every option. For a company comparison, use the company or token name alone as each answer title. Keep the detailed measurement and resolution rules in the rules panel rather than the option label. PreStocks company logos are compact icons, never full-width banners.

## Agent performance linked questions

Each main PreStocks event has a separate agent performance event with the same measured horizon. Prefix the child shared title with `Agent: ` and repeat the parent question title; link the child card and detail page back to the main event. The child has linked answer rows for the agent's hit rate over its scheduled forecasts, not one “over half” Yes/No question and not one row per count. Use at most four accuracy bands: under 50%, 50–79%, 80–99%, and exactly 100%. Each label is the rate, then the count range out of the total (`Under 50% · 0–6 of 14`, `80–99% · 12–13 of 14`, `100% · 14 of 14`); a band that holds one count shows its exact rate (`50% · 1 of 2`). A short schedule drops a band that rounds to no count. The bands must cover every possible score without overlap; one answer resolves Yes and all others No. `accuracyBands()` in `solz-prediction-backend/apps/stake-api/general-events.ts` is the only place that builds them. Forecasts are scored in the separate agent database; the general catalogue stays in the existing prediction database.

## Creating and opening questions

Questions are created only in `solz-prediction-backend`, through the builders and the guard. Read "Create and open a general question" in `solz-prediction-backend/AGENTS.md` first. Do not create a question from this repository, and do not write question rows by hand. This frontend only shows the published rows. The first trader opens a market through `POST /solana/market-permit` on the stake API. If a page shows answer copy that breaks the rules above, run `bun run general:event -- audit` in `solz-prediction-backend`. Do not correct the copy in the UI.

## Trading colors
Green means Buy/Yes and red means Sell/No wherever the trader is choosing between a Yes and a No: multi-outcome answer rows, linked-question rows, and the trade ticket of any market whose outcomes are contracts rather than teams. On those surfaces team and agent identity colors dress the text, the mark and the chart — never a Buy control.

A moneyline is the exception, because there the outcomes ARE the teams and Yes/No is not what is being chosen. On a two-sided team market the outcome buttons take each team's identity color in the market row, the order book and the trade ticket; the unselected side goes flat and neutral. `isMoneyline()` in `src/components/markets/moneyline.ts` is the only place that decides this — do not re-derive it. Buy/Sell itself stays semantic: the Buy/Sell tabs and the submit button never take a team color.

Three-way markets with a draw do not exist yet (`Outcome = 0 | 1` in `packages/prediction-core/portfolio/model.ts`). When they arrive, the market row keeps team colors and the ticket falls back to the green/red pair, which is what `pickColor()` already returns for any outcome with no identity color.

## Loading states

Loading must preserve the final surface's structure, dimensions, and column layout. Use a skeleton or shimmer shaped like the loaded content; do not replace a table, ticket, chart, list, or card with a standalone loading sentence. Keep loading text available to assistive technology, and reserve textual messages for unavailable or terminal error states.

## Compute cost — CRITICAL

Every database here is Neon in us-east-1. One round trip is ~250 ms and bills
compute. Correct code that burns compute is still defective.

**Retry loops must back off.** Any journal, outbox, sweep, poller or reconciler
needs exponential backoff and a maximum interval. A flat retry turns one failing
record into a permanent load generator. On 2026-09-18 a settlement journal
retrying every 30 s with no ceiling produced 3,360 calls an hour for eight hours,
saturated a 3-connection pool, and took Agent Arena and Agent Colosseum down as
bystanders. `SodaStakeOutbox` had the right curve; the journal beside it did not.

**Count round trips and bytes, not query plans.** These tables are small and plan
in under a millisecond. Cost is `sequential round trips × 250 ms` plus payload.
No query inside a loop over items — read once before it, write one batched
statement after it. Project only the columns that are read; a jsonb blob
dominates the wire.

**No repair work on a hot path.** `next()` is waited on by a director with a
4.5 s timeout. Rebuilds, reconciliation and self-healing belong in a bounded
one-shot migration, never in a handler. A self-healing branch that re-triggers
each call is an outage.

**Budgets are part of the contract.** Measure the call against the caller's
timeout and state the measured number before calling the work done.

**Stop the bleeding before diagnosing.** Pause or back off a running storm first;
do not investigate while it burns.

## Prefer the alternative that is safe to implement

Take the route that reaches the same outcome with the least risk, and keep the
drastic one for when the safe ones are genuinely exhausted.

- Back off a loop before deleting its rows; pause work before abandoning it.
- Change a constant before rewriting a subsystem.
- Reproduce a failure through the real call path before naming its cause.
- Never propose taking a running service down, deploying, or dropping data as
  the first move. State the safe alternative first.
