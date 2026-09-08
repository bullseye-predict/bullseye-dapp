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
