# Local agent instructions

## File creation
Do not create new Markdown files unless the current user message explicitly requests them. Keep documentation in the response otherwise.

## Browser testing
Reuse one test tab. Open a second only for a direct comparison, never exceed two, and close temporary tabs afterward.

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
