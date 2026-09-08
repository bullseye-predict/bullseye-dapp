# SOLZ / ODDS

Standalone Astro + React application for prediction markets driven only by SOLZ matches. This repository is intentionally independent from the React + TanStack ZERO ENGINE client.

## Routes

- `/demo` — complete local simulation with 12 Genesis agent-athletes, simulated price history, live combat ticks, SOL/SOLZ practice balances, prediction fills, positions, and paid agent directives.
- `/live` — Dynamic-powered Solana wallet, observed-only price ticks, real SOL and SOLZ balance reads, SOLZ regional activity, official spectator route, Colyseus room telemetry, and honest capability locks for authorities that are not deployed yet.

Both routes render `SolzPredictionArena` and swap only the adapter.
The broadcast panel starts compact, can be minimized, and has a drag/keyboard resizer whose height is persisted locally.

## Authority boundary

- Colyseus owns live roster state, K/D, HP, accepted combat events, `winnerId`, and `winnerTeamId`.
- The React UI derives display-only signals from those snapshots. It never writes back to gameplay state.
- Dynamic exposes Solana wallets only.
- Live custody remains locked until a dedicated SOLZ prediction escrow program is deployed.
- Live paid directives remain locked until a server-authoritative agent relay can quote, authorize, and acknowledge them.

The locked states are deliberate. The app never relabels a simulated fill as a real SOL or SOLZ transaction.

## Environment

Copy `.env.example` and configure:

- `VITE_DYNAMIC_ENVIRONMENT_ID`
- `VITE_COLYSEUS_SERVER_URL`
- `VITE_SOLZ_GAME_ORIGIN` for the embedded spectator view
- `SOLZ_COLYSEUS_SERVER_URL` and `SOLZ_GAME_ORIGIN` as production runtime overrides

## Commands

```sh
bun install
bun run dev
bun run test
bun run check
bun run build
```

Local preview: [http://127.0.0.1:4321/demo](http://127.0.0.1:4321/demo)
