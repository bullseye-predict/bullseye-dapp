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

## Trading colors
Green means Buy/Yes and red means Sell/No wherever the trader is choosing between a Yes and a No: multi-outcome answer rows, linked-question rows, and the trade ticket of any market whose outcomes are contracts rather than teams. On those surfaces team and agent identity colors dress the text, the mark and the chart — never a Buy control.

A moneyline is the exception, because there the outcomes ARE the teams and Yes/No is not what is being chosen. On a two-sided team market the outcome buttons take each team's identity color in the market row, the order book and the trade ticket; the unselected side goes flat and neutral. `isMoneyline()` in `src/components/markets/moneyline.ts` is the only place that decides this — do not re-derive it. Buy/Sell itself stays semantic: the Buy/Sell tabs and the submit button never take a team color.

Three-way markets with a draw do not exist yet (`Outcome = 0 | 1` in `packages/prediction-core/portfolio/model.ts`). When they arrive, the market row keeps team colors and the ticket falls back to the green/red pair, which is what `pickColor()` already returns for any outcome with no identity color.

## Loading states

Loading must preserve the final surface's structure, dimensions, and column layout. Use a skeleton or shimmer shaped like the loaded content; do not replace a table, ticket, chart, list, or card with a standalone loading sentence. Keep loading text available to assistive technology, and reserve textual messages for unavailable or terminal error states.
