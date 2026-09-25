# Bullseye

A transparent AI agent for pre-stock and stock prediction and trading.

**Watch first. Follow later.** Bullseye publishes what its agent looks at, what changes its mind, and how its conviction moves over time. Users watch the record before they decide to follow it.

This repository is the Bullseye web app: Vite + React + TanStack Router. The product specification is [docs/STOCK_PREDICTION_SYSTEM.md](docs/STOCK_PREDICTION_SYSTEM.md).

## How it works

1. **Pre-stock question.** Each question is about a pre-stock (OpenAI, Polymarket, Anthropic, SpaceX) or a stock, for example `OpenAI PreStock above ___ on October 31?`. Each price is its own Yes/No market.
2. **Agent sub-question.** Each main question has a linked `Agent: <question>` event. The agent publishes one locked call per window. Users trade on how many calls it gets right, in accuracy bands (`80–99% · 12–13 of 14`).
3. **Resolution.** Our oracle scores every call and every question from frozen rules and measured price data. The agent never edits a published call and never decides a result.

Questions are created only in `solz-prediction-backend`. This app shows the published rows. The first trader opens a market on chain through the stake API.

## Repository legend

| Folder | Role | Local port |
| --- | --- | --- |
| `solz-prediction-market-vite` (this repo) | Web app | `4321` |
| `solz-prediction-backend` | Stake API, question builders, oracle, settler | `8788` |
| `solz-prediction-solana` | Solana programs, deploy scripts | — |

## On-chain programs (submodule)

The Solana order-book programs are a git submodule at `programs/onchain-prediction-clob`, from [bullseye-predict/onchain-prediction-clob](https://github.com/bullseye-predict/onchain-prediction-clob).

| Program | Role |
| --- | --- |
| `prediction_market_pinocchio` | Markets, orders, fills, positions, collateral vaults, settlement |
| `manifest_guard` | Customized Manifest order book. Every entry checks a binding owned by the prediction program. |

Get the source after you clone:

```sh
git submodule update --init programs/onchain-prediction-clob
```

The submodule is pinned to one commit. Program changes and deploys happen in `solz-prediction-solana`.

## Routes

| Route | Page |
| --- | --- |
| `/` | Markets (home) |
| `/markets` | Market directory, including PANTA markets |
| `/markets/propose`, `/markets/create` | Propose a market, or create one on PANTA |
| `/events/...` | Event detail: price ladder, agent thinking, agent performance |
| `/profile` | Portfolio and positions |
| `/pitch-deck` | Bullseye pitch deck (7 slides, illustrative data) |
| `/highlight`, `/live`, `/demo` | Arena views |

The brand is set by `ACTIVE_BRAND` in `src/components/solz/brand.ts`. ColaCat sections are hidden from the navigation but their routes still work.

## Environment

Copy `.env.example` to `.env` and set:

- `PUBLIC_PREDICTION_API_URL` — stake API origin (`http://127.0.0.1:8788` locally).
- `PUBLIC_PREDICTION_CLUSTER`, `PUBLIC_PREDICTION_PROGRAM_ID`, `PUBLIC_PREDICTION_MANIFEST_PROGRAM_ID` — Solana cluster and program IDs.
- `PUBLIC_PREDICTION_COLLATERAL_MINT`, `_DECIMALS`, `_SYMBOL` — collateral token.
- `VITE_DYNAMIC_ENVIRONMENT_ID` — Dynamic wallet environment.
- `VITE_SOLANA_RPC_ENDPOINT` — Solana RPC.
- `PUBLIC_ARENA_MARKET_SOURCES`, `PUBLIC_LIVESTREAM_HLS_URL` — arena sources and livestream.
- `SOLZ_COLYSEUS_SERVER_URL`, `SOLZ_CHAT_SERVER_URL`, `SOLZ_GAME_ORIGIN`, `SOLZ_GAME_API_ORIGIN` — server-side game settings.

Never put a server secret in a `PUBLIC_` or `VITE_` variable.

## Commands

```sh
bun install
bun run dev        # http://localhost:4321
bun run check      # TypeScript
bun run test       # host tests
bun run test:frontend
bun run build
bun run start      # production server
```

## Contact

Telegram [@dellwatson](https://t.me/dellwatson)
