# Genesis agent identity — name, sub-name and can wrap

How a Genesis agent's identity gets from the database onto the can you see in a
match, every place it can break, and how to check each hop.

Written because "the agent is still wrong" was diagnosed five times and had a
different cause each time.

## Folder legend

| Folder | Port | Role |
|---|---|---|
| `/Users/Shared/march-2026/_solz-elysia` | 3100 | API + Neon migrations. Owns `genesis_agents` and both match schedules. |
| `/Users/Shared/march-2026/_solz-colyseus` | 2567 | Game server. Seats bots, resolves their loadouts. Keeps its **own fork** of the loadout catalogue. |
| `/Users/Shared/march-2026/sol-zero-engine-mainnet` | 9000 | The 3D client. Owns the GLBs, the wrap textures and the material binding. |
| `/Users/Shared/march-2026/solz-prediction-market` | 4321 | The 2D web app. No 3D at all. |

## The twelve

Slot order is the numeral each agent carries. `genesis_agents.slot`, the seed
list in `src/components/solz/solzDataSource.ts` and `GENESIS_SKIN_SLUGS` in
`src/components/home/HomePrimitives.tsx` are all the same sequence.

| Slot | Codename | Sub-name | `skin_slug` | Accent |
|---|---|---|---|---|
| 0 | c0ke | C-ZEROKE | `c0ke` | `#d51115` |
| 1 | peps1 | pepsONE | `peps1` | `#0142a4` |
| 2 | 2UP | two-up | `2up` | `#54be43` |
| 3 | Monst3r | Monsthree | `monst3r` | `#aff904` |
| 4 | fant4 | FANTQUAD | `fant4` | `#f95b02` |
| 5 | 5prite | pentaprite | `5prite` | `#049a3c` |
| 6 | 6uiness | SIXUINESS | `6uiness` | `#cca258` |
| 7 | 7iger | SEVENIGER | `7iger` | `#eb9b3b` |
| 8 | bintan8 | bintanlapan | `bintan8` | `#b40a15` |
| 9 | hei9ken | HEI-NINEKEN | `hei9ken` | `#1f923a` |
| 10 | MOUN10-DEW | MOUNTEN DEW | `moun10-dew` | `#4ebc25` |
| 11 | 12ed 13u11 | 12-13-11 | `12ed-13u11` | `#e7ce2c` |

Any of `COKE, PEPSI, SPRITE, FANTA, DR PEPPER, MTN DEW, 7UP, SUNKIST, CRUSH,
A&W, SCHWEPPES, JARRITOS` on screen means you are looking at **pre-migration
data**, not a rendering bug. Those are the old seed and no code produces them.

## The chain

```
genesis_agents (codename, subname, skin_slug, accent_color)   ← migration 0048
      │
      ├── API  /api/v1/genesis-agents ──────────► web app (cards, rosters)
      │        current() JOINs live, so the site is always current
      │
      └── SCHEDULE — roster is FROZEN into the row at plan time
          ├── genesis_arena_matches.reservation.participants[]     (agent-arena)
          └── agent_colosseum_matches.participants[]               (agent-colosseum)
                    │
                    ▼
          Colyseus SodaStakeElysiaGateway → sodaStake.participants
                    → MatchRoom.setPersistentRoster({id, name, skinSlug})
                    → botRegistry.skinSlugBySlotId
                    → resolveDefaultBotCapability(id, type, slug)
                    → LoadoutDraft.bodySkinSlug
                    → resolver → ResolvedLoadout.bodySkinTextureUrl
                    │
                    ▼
          engine: enemy appearance manifest → EnemyCoreBodyPresentation
                    → <CoreBodySkin> → applyCoreBodySkin() → PepsiWrapperSideOnly
```

**The frozen roster is the thing that bites.** A schedule row keeps whatever the
database said when it was planned. The day-ahead programme builds ~24h ahead, so
a rename is invisible in game for a full day unless the existing rows are
rewritten. The website updates instantly because it never reads the frozen copy.

### Two schedules, not one

`agent-arena` and `agent-colosseum` are separate tables with separate stores and
separate roster builders. Fixing one does nothing for the other:

- `_solz-elysia/src/domain/agent-arena.ts` → `buildAgentArenaRoster`
- `_solz-elysia/src/db/agent-colosseum-store.ts` → `roster()`

Both emit `{ agentId, actorId, name, skinSlug }`. Seats are named
`server-bot-0-<slot>`, and **that slot IS the Genesis slot** — which is how a
roster missing `agentId` can still be repaired.

## Which body each bot wears

`_solz-colyseus/src/loadout/ownership.ts` → `BOT_STARTER_CORE_BODY`:

| Bot type | Core Body | Why |
|---|---|---|
| melee | `core.soda-full` | KayKit blade in a restored hand. Has `body_can_wrapper`. |
| range | `core.soda-gun-only` | Full ships no cannon any more. Also has `body_can_wrapper`. |

`core.soda-plain` is **not** used for agents: it has no wrapper mesh at all, so a
can seated on it can never wear a label however the database is set.

Because a slug resolves against its **own** body's skin directory, every wrap is
published under **both** packages. A ranged agent whose wrap only existed under
`body_soda-core-full` would 404.

Bot movement is deliberately held independent of the seat in
`botCapabilities.ts` → `BOT_ATTACK_MOVEMENT`. Swapping the model must not
re-tune combat; `recoilDistance` is read as the melee **lunge** distance, so
inheriting the body's authored `0` silently deletes the bot opener.

## The wrap textures

Built by `sol-zero-engine-mainnet/scripts/build-genesis-skins.sh` from the
source art, published to both bodies plus the web app.

- **WebP, 1024 wide, q80** — 60–108 KB each, from 1.4–2.4 MB PNG sources.
  Twelve uncompressed labels was ~10 MB before an arena drew a frame.
- `validate-loadout-assets.py` has a `SKINS` list and a `validate_skin` that
  rejects anything over 200 KB, so this cannot quietly regress.
- The slug→URL resolver takes its extension from `skin.defaultTextureUrl`, so
  changing format is a one-line change, not a hunt.

### Five traps in the material binding

All of these produce a wrong-looking can rather than an error:

1. `SkeletonUtils.clone` copies the object graph but **shares materials** with
   the cached GLTF scene. Writing a map in place repaints every body using that
   GLB — twelve agents would all wear whichever wrap bound last. Each body takes
   its own copy, marked in `userData`.
2. Match on **material** name, never node name. The `defeated` and `showcase`
   exports carry `PepsiWrapperSideOnly` on unnamed nodes.
3. `flipY = false`. The UVs are glTF-authored; `useTexture` defaults to `true`
   and flips the label upside down.
4. The wrapper's `baseColorFactor` is `0.62` grey and multiplies the artwork
   down ~38% unless the material colour is forced to white.
5. A body with no `skin` block resolves to `undefined` and renders the authored
   placeholder — which reads as "the skin system is broken" rather than "this
   body has no skin contract".

## Verifying, hop by hop

```bash
# 1. Database
cd /Users/Shared/march-2026/_solz-elysia
# expect: subname, skin_slug, accent_color present; slot 0 = c0ke / C-ZEROKE / c0ke

# 2. API — both should be 200 and show the new identity
curl -s localhost:3100/api/v1/genesis-agents | head -c 300
curl -s localhost:3100/api/v1/agent-arena | head -c 200
```

Note `/agent-arena` without `/api/v1` is **not a route** and returns a 500
`control_plane_error`. That is a wrong URL, not an outage.

```bash
# 3. Schedules — legacyNames and missingSkinSlug must both be 0 for
#    genesis_arena_matches AND agent_colosseum_matches on
#    status IN ('planned','reserved','live') / ('planned','launching','live')

# 4. Loadout resolution
cd /Users/Shared/march-2026/_solz-colyseus
# resolveDefaultBotCapability('server-bot-0-0', 'melee', 'c0ke')
#   → core.soda-full  /assets/loadout/body_soda-core-full/skins/c0ke.webp
#   → range + '7iger' → core.soda-gun-only /…/body_soda-core-gun-only/skins/7iger.webp

# 5. Assets exist
cd /Users/Shared/march-2026/sol-zero-engine-mainnet
python3 scripts/validate-loadout-assets.py   # ok:true, skinCount 26
```

## After any rename

1. Run the migration.
2. **Rewrite both schedules.** A rename alone changes nothing in game — the
   planned rows already hold the old roster. Rewrite `name`, `agentId` and
   `skinSlug` on every row with `status IN ('planned','reserved','live')` in
   both tables, matching by `agentId` or by the slot in `server-bot-0-<slot>`.
3. Restart Colyseus so it reloads the catalogue and gateway.
4. The room already running keeps its roster until it ends — its reservation was
   handed over at launch. The next room picks up the change.

Prefer rewriting rows over cancelling them: cancelling throws away a day of
publicly committed match IDs and timings, and regeneration only happens on the
next programme tick.

## Known gap

Nothing stamps a schedule row with the agent-identity revision it was built
from, so a rename silently serves a stale roster for up to a day until someone
notices. `ensureProgramme` could record that revision and rebuild `planned` rows
when it changes. Until then step 2 above is manual.

## Related

- `docs/PREDICTION_PRODUCTION_PLAN.md`
- Room status values are `planned | reserved | live | settled | cancelled`.
  `planned` arrived in migration 0046 and the client parsers did not learn it
  until the day-ahead scheduler filled a full day of them and took the Agents
  page down. `tests/agent-arena.test.ts` now asserts every status the schema
  admits survives `parseMatch`.
