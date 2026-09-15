# Market list API

## Purpose

`GET /market/list` is the prediction catalogue endpoint. It gives the frontend every item that is eligible to become a prediction market, whether an on-chain market has already been opened or not.

It combines two canonical off-chain sources:

1. **Match questions** from the game system: scheduled and live agent-arena, stake, ranked, and casual matches.
2. **General questions** from the approved question catalogue: propositions not attached to one match.

The endpoint is a catalogue read. It does not create an on-chain market, write a market binding, or infer settlement from venue state.

## Identity and on-chain relationship

An eligible catalogue item is not necessarily an open market.

- A match is identified by its canonical `matchId`.
- A proposition is identified by its canonical `questionId`.
- The deterministic Solana market address is derived from `(predictionProgramId, matchId, questionId)`.
- The frontend derives/queries that address on-chain. If the account does not exist, it displays **Not opened yet** and can request a short creation permit.

The same production catalogue is shown by both devnet and mainnet frontends. They query their own prediction backend because the backend issues a permit for exactly one configured Solana cluster/program. Market existence, orders, positions, and settlement transactions are consequently different on devnet and mainnet.

## Endpoint

```http
GET /market/list?status=eligible&limit=50&cursor=<opaque>
```

### Query parameters

| Parameter | Meaning |
|---|---|
| `status` | Optional. `eligible` returns scheduled/live items within their creation/trading policy. `all` may additionally include resolved, cancelled, or closed catalogue records for history. Default: `eligible`. |
| `limit` | Optional page size. Default and maximum are deployment-defined. |
| `cursor` | Optional opaque pagination cursor returned by the previous request. |
| `kind` | Optional filter: `match` or `general`. Omit for the unified list. |

### Response

```json
{
  "items": [
    {
      "kind": "match",
      "eventId": "match:0x534f4c5a...",
      "matchId": "0x534f4c5a...",
      "questionId": "0x51554553...",
      "status": "scheduled",
      "title": "GENESIS-01 vs GENESIS-02",
      "startsAt": "2026-09-20T12:00:00.000Z",
      "tradeLocksAt": "2026-09-20T12:29:00.000Z",
      "outcomes": [
        { "id": "genesis-01", "label": "GENESIS-01" },
        { "id": "genesis-02", "label": "GENESIS-02" }
      ],
      "resolution": {
        "source": "game-match-result",
        "status": "pending"
      }
    },
    {
      "kind": "general",
      "eventId": "general:most-kills-september-2026",
      "matchId": "0x000000...",
      "questionId": "0x51554553...",
      "status": "open",
      "title": "Who records the most kills in September 2026?",
      "tradeLocksAt": "2026-09-30T23:59:59.000Z",
      "outcomes": [
        { "id": "ansem", "label": "ANSEM" },
        { "id": "pump", "label": "PUMP" }
      ],
      "resolution": {
        "source": "approved-general-oracle",
        "status": "pending"
      }
    }
  ],
  "nextCursor": null,
  "asOf": "2026-09-16T00:00:00.000Z"
}
```

`eventId` is a stable UI/catalogue grouping identity. It is not an on-chain market ID.

## Match entries

Every canonical match is eligible as soon as it is created in the game system and has valid timing and participants. This includes:

- scheduled agent-arena or stake matches, before the match begins;
- live agent-arena matches;
- human-created ranked and casual matches, as soon as their `matchId` exists.

The prediction frontend route is `event/:matchId`. The game frontend independently uses its game route, for example `game/match/ranked-or-stake/:matchId`.

The market-list service constructs match questions on demand from the canonical match record. It must not create a duplicate off-chain `prediction_question` row merely to make a match tradable.

For a head-to-head match, the item exposes the two canonical team/agent outcomes. For FFA, it exposes the canonical player/agent field. The client and selected venue representation decide whether that field renders as a native multi-outcome market or linked binary markets.

Match settlement reads the canonical game result by `matchId`. The result may be published by Colyseus/Elysia, but the prediction service submits it only to markets that actually exist on the selected chain.

## General-question entries

General questions are not derived from a game-match row. Their approved catalogue record must contain:

- stable `questionId`;
- title and exact outcome set;
- creation and trading-cutoff times;
- immutable resolution policy/source;
- terminal result or void decision when resolved.

The general-question resolver writes or publishes the canonical answer once. Both devnet and mainnet prediction backends read that same answer, then independently submit settlement to markets that exist in their respective programs.

## Rules and safety properties

- Neon is the source for catalogue text, scheduled/live match details, approved general questions, and published canonical results.
- Solana is the source for market existence, order books, trades, positions, and redemption state.
- A Neon row cannot redirect a client to an arbitrary on-chain market address. Clients derive the PDA from the two canonical IDs and the configured program ID, then verify the account on-chain.
- The catalogue remains useful when no market has been opened: it is how the first trader discovers an eligible item.
- A backend may cache source reads as an optimization, but cache data is never the authority for an on-chain position, trade, or market address.
- Re-reading identical production match/general-question records from a devnet and mainnet backend is safe. Neither backend should write network-specific market state into the shared catalogue.

## Backend responsibilities

`predict-backend` implements the endpoint as a read-only composition over the game/general-question source. It may then issue a cluster-scoped permit after validating that the selected item is eligible.

The permit check must confirm:

1. the match or approved general question exists;
2. its canonical IDs, outcome set, and timing are valid;
3. the trading cutoff has not passed;
4. the configured program/oracle/network domain is the backend's own cluster;
5. any existing market at the derived PDA is compatible with those IDs.

It must not use Neon `market_binding` records for Solana. Those are legacy external-protocol metadata, not authoritative Solana market discovery.

## Out of scope

- On-chain portfolio history, P/L, and fills: those are direct RPC/indexer concerns, not catalogue data.
- Game schedule creation: the game scheduler/Elysia owns it.
- Market creation: the first trader's wallet transaction owns it.
- Cross-cluster synchronization: devnet and mainnet intentionally have separate on-chain state.
