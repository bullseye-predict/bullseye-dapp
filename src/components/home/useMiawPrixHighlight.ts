import { useEffect, useMemo, useRef, useState } from 'react'
import { matchState } from '../miawprix/board'
import { miawPrixEventView } from '../miawprix/miawPrixEventView'
import { miawPrixBoardKey, miawPrixSource, type MiawPrixBoard, type MiawPrixMatch, type MiawPrixSeason } from '../miawprix/miawPrixSource'
import { cachedValue, useCacheSeed } from '../solz/liveCache'
import { useLogoPalette } from '../markets/logoIdentity'
import { teamIdentityColor } from '../markets/moneyline'
import { resolvedTokenLogo } from '../solz/tokenIcon'
import { useTokenMeta, type TokenMeta } from '../solz/tokenMeta'
import type { ArenaMarket, SolzMatch } from '../solz/model'

/**
 * THE MIAW PRIX PROGRAMME, AS THE HOME PAGE'S HIGHLIGHT.
 *
 * The home hero used to be the Agent Arena free-for-all, where a match is
 * twelve agents and a question is "will this agent win?". MIAW PRIX is the
 * other programme Agent Colosseum runs: two COINS per match, so the match is a
 * pairing and the question is which of the two coins wins. A team here is not a
 * squad flying a token — it IS the token, identified by its mint.
 *
 * This module reads the programme and answers two questions for the page:
 * which card the hero is about, and which cards come after it. It does not
 * price anything. The executable market for a card is the canonical Solana
 * question that shares its matchId, which the page joins separately; the
 * moneyline built here is a DISPLAY row for a card that has no question yet.
 */

/** What the schedule uses when a card does not declare its own room length.
 *  MIAW PRIX rooms are five minutes; the Agent Arena's twenty-minute match is a
 *  different programme and must never be the fallback here. */
const DEFAULT_MATCH_MS = 5 * 60_000

/** The scheduled gap between two MIAW PRIX rooms, used only when the payload
 *  carries no preceding card to measure one from. */
const DEFAULT_BREAK_MS = 2 * 60_000

/** How many cards the UP NEXT rail asks for. The rail itself is a fixed five
 *  wide and spends one on the highlight. */
export const RAIL_MATCHES = 4

/** The programme publishes a day of cards at a time and the rooms roll every
 *  few minutes, so the board is re-read on a slow beat and, precisely, at the
 *  moment the card on screen ends. */
const POLL_MS = 60_000

/** The selection tick. Coarse on purpose: the hero's own clock ticks per second
 *  off the chosen card, and re-picking a card is only interesting when one
 *  starts or ends. */
const SELECT_MS = 5_000

/** When this card's room closes. A card with no declared duration is given the
 *  programme's standard room rather than being treated as instantaneous. */
export function matchWindowEnd(match: MiawPrixMatch): number {
  return (match.scheduledStartAt || 0) + Math.max(1, match.matchDurationMs || DEFAULT_MATCH_MS)
}

/**
 * The cards the programme still has ahead of it, kickoff first.
 *
 * A card with no pairing is excluded: CATWALK binds the two coins twelve hours
 * before kickoff, and before that the opponents genuinely do not exist. A rail
 * card is a fixture, so publishing one with invented sides — or with no sides
 * at all — would state something the programme has not decided.
 *
 * A past kickoff is eligible only once the game has marked its room live.
 * A planned row can remain in the database for the entire nominal room window
 * after a missed launch. Treating that row as open claimed a live highlight
 * when neither region had a room to watch.
 */
export function programmeOrder(matches: readonly MiawPrixMatch[], now: number): MiawPrixMatch[] {
  return matches
    .filter((match) => match.sides.length === 2)
    .filter((match) => {
      const state = matchState(match, now)
      return (state === 'live' || match.scheduledStartAt > now)
        && state !== 'final' && state !== 'cancelled'
        && matchWindowEnd(match) > now
    })
    .sort((a, b) => a.scheduledStartAt - b.scheduledStartAt)
}

/**
 * The card the hero is about: the one being broadcast, or else the next one up.
 *
 * Colosseum hosts one programme match at a time, so a reported `live` card wins
 * outright. Without one the earliest open room is the answer, which is the card
 * whose kickoff the broadcast is counting down to.
 */
export function chooseHighlight(matches: readonly MiawPrixMatch[], now: number): MiawPrixMatch | null {
  const open = programmeOrder(matches, now)
  return open.find((match) => matchState(match, now) === 'live') ?? open[0] ?? null
}

/**
 * WHEN THE BREAK BEFORE THIS CARD BEGAN.
 *
 * The programme is a 5-minute room and a ~2-minute scheduled gap, and neither
 * number is this page's to assume: the gap is simply the distance from the last
 * room's horn to this kickoff, and the schedule carries both. Reading it keeps
 * the hero on MIAW PRIX's cadence instead of the Agent Arena's 20-minute match
 * and 5-minute break, which is a different programme entirely.
 *
 * Every card counts, including settled and cancelled ones - the room before
 * this one is the room before it whatever its result was. A card with no
 * predecessor in the payload falls back to the gap the programme schedules.
 */
export function breakStartedAt(matches: readonly MiawPrixMatch[], card: MiawPrixMatch): number {
  const previous = matches
    .filter((match) => match.matchId !== card.matchId && match.scheduledStartAt > 0
      && match.scheduledStartAt < card.scheduledStartAt)
    .sort((a, b) => b.scheduledStartAt - a.scheduledStartAt)[0]
  const horn = previous ? matchWindowEnd(previous) : 0
  // A horn after this kickoff means the two rooms overlap in the schedule,
  // which is not a break at all; fall back rather than publish a negative one.
  return horn > 0 && horn < card.scheduledStartAt ? horn : card.scheduledStartAt - DEFAULT_BREAK_MS
}

/**
 * The card the hero is waiting on, expressed as THE BREAK BEFORE IT.
 *
 * A pending card's clock is `startedAt = kickoff`, `endsAt = kickoff + room`,
 * which is the room's window and is the right shape for the UP NEXT rail - it
 * counts to a kickoff. On the stage it is the wrong question: the panel behind
 * BREAK TIME counts to `endsAt`, so it was announcing `kickoff + 5:00 - now`,
 * a SIX MINUTE break on a two-minute gap.
 *
 * Re-seating the pending hero card on its break window puts it in exactly the
 * shape the Genesis arena's own intermission card already has - start of the
 * break to the next kickoff - so the stage needs no special case for it and the
 * number it prints is the gap the programme actually scheduled.
 */
export function breakView(view: { match: SolzMatch; market: ArenaMarket }, breakAt: number) {
  const kickoff = view.match.startedAt
  if (view.match.phase !== 'countdown' || breakAt >= kickoff) return view
  return {
    ...view,
    match: { ...view.match, startedAt: breakAt, endsAt: kickoff, durationMs: kickoff - breakAt },
  }
}

export type MiawPrixHighlight = {
  /** The hero card as the page's own event model, plus its display moneyline. */
  highlight: { match: SolzMatch; market: ArenaMarket } | null
  /** The cards after it, already in rail order. */
  upcoming: SolzMatch[]
  season: MiawPrixSeason | null
  /**
   * THE WHOLE PROGRAMME, exactly as it was read.
   *
   * One request answers with the season, the standings and every card, so a
   * second panel on this page that wants results or a season table takes them
   * from here rather than asking the control plane the same question again.
   * Null until the first read lands and this realm has nothing remembered.
   */
  board: MiawPrixBoard | null
  /** False until the first read settles, so the page can tell "no programme"
   *  from "not read yet" and does not flash the arena fallback on every load. */
  loaded: boolean
  /** A read is in flight over a board that is already on screen - carried in
   *  from another route, or from the last poll. Panels draw a badge, never a
   *  skeleton, while this is true. */
  refreshing: boolean
  error: string
  retry: () => void
}

/**
 * Board identity, laid over the programme's own.
 *
 * The board names each side by mint and carries whatever the game's registry
 * recorded beside it, which for a freshly listed coin is the ticker twice over
 * and a root-relative logo that 404s on this origin. THE TICKER IS NEVER
 * OVERRULED — on this site a coin is called what the game calls it — so only
 * the name and the crest are filled in, exactly as the MIAW PRIX pages do it.
 *
 * THE COLOUR IS EACH COIN'S OWN, and it is the reason a rail of fixtures is
 * readable at a glance. The programme reports `color: null` for every coin, so
 * a card fell back to a fixed cyan-and-orange pair and EVERY card in the rail
 * was painted identically — the gradient said nothing about who was playing.
 * `teamIdentityColor` is the site's one answer to "what colour is this side":
 * it samples the crest's own dominant hue and re-seats it on the board's vivid
 * band, so PURR is PURR-coloured on the rail, in the ticket and on the market
 * directory alike. The sample is asynchronous, which is what `useLogoPalette`
 * below is for.
 */
export function identify(match: MiawPrixMatch, meta: Map<string, TokenMeta>): MiawPrixMatch {
  return {
    ...match,
    sides: match.sides.map((side) => {
      const token = meta.get(side.mint)
      const logoUrl = resolvedTokenLogo(side.logoUrl, token?.icon) || undefined
      return {
        ...side,
        name: side.name === side.symbol && token?.name ? token.name : side.name,
        logoUrl,
        color: side.color || teamIdentityColor(side.symbol || side.mint, logoUrl),
      }
    }),
  }
}

export function useMiawPrixHighlight(arenaEndpoint = '/api/agent-arena', predictionApiUrl = ''): MiawPrixHighlight {
  const source = useMemo(() => miawPrixSource(arenaEndpoint, predictionApiUrl), [arenaEndpoint, predictionApiUrl])
  const [board, setBoard] = useState<MiawPrixBoard | null>(null)
  const [loaded, setLoaded] = useState(false)
  // True only while the FIRST read of this mount is in flight over rows carried
  // in from another route. An ordinary poll sets nothing: a badge that returns
  // every sixty seconds over current rows says nothing.
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  // THE LAST GOOD READ, AS SOON AS THIS ISLAND IS LIVE. Home, /catwalk and
  // /miaw-prix are three islands over one <ClientRouter /> document and they
  // read the SAME programme URL, so arriving from any of them paints the
  // schedule immediately instead of flashing the arena fallback while the
  // identical request goes out again. Applied after the first commit and before
  // paint, so this island's markup never disagrees with the server's - see
  // `useCacheSeed` in src/components/solz/liveCache.ts.
  useCacheSeed(() => {
    const seed = cachedValue<MiawPrixBoard>(miawPrixBoardKey(arenaEndpoint))
    if (!seed) return
    setBoard(seed.value)
    setLoaded(true)
    setRefreshing(true)
  }, [arenaEndpoint])
  const [attempt, setAttempt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const boundary = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), SELECT_MS)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let poll: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const next = await source.board('', controller.signal)
        if (controller.signal.aborted) return
        setBoard(next)
        setError('')
        setNow(Date.now())
        // Re-read exactly when the card on screen closes, which is when the
        // next room opens. The slow poll alone would leave a finished match in
        // the hero for up to a minute.
        const current = chooseHighlight(next.matches, Date.now())
        const ends = current ? matchWindowEnd(current) - Date.now() : 0
        if (boundary.current) clearTimeout(boundary.current)
        if (ends > 0 && ends < POLL_MS) boundary.current = setTimeout(() => void read(), ends + 1_500)
      } catch (reason) {
        if (controller.signal.aborted) return
        // The programme keeps whatever it last read. A schedule that cannot be
        // refreshed is still the schedule; only a first read that fails has
        // nothing to show.
        setError(reason instanceof Error ? reason.message : 'The MIAW PRIX programme is unavailable.')
      } finally {
        if (!controller.signal.aborted) {
          setLoaded(true)
          setRefreshing(false)
          // One chain, never two. A boundary read lands inside the slow poll's
          // window, and without this each of them would leave its own timer
          // behind and the page would read the programme twice as often after
          // every match change.
          if (poll) clearTimeout(poll)
          poll = setTimeout(() => void read(), POLL_MS)
        }
      }
    }
    void read()
    return () => {
      controller.abort()
      if (poll) clearTimeout(poll)
      if (boundary.current) clearTimeout(boundary.current)
    }
  }, [source, attempt])

  const selected = useMemo(() => chooseHighlight(board?.matches ?? [], now), [board, now])
  const queued = useMemo(
    () => programmeOrder(board?.matches ?? [], now)
      .filter((match) => match.matchId !== selected?.matchId)
      .slice(0, RAIL_MATCHES),
    [board, now, selected],
  )
  // Only the coins actually on screen are looked up. The board carries a day of
  // cards; asking the registry about every mint in it would be a large read for
  // rows nobody is being shown.
  const mints = useMemo(
    () => [...(selected ? [selected] : []), ...queued].flatMap((match) => match.sides.map((side) => side.mint)),
    [selected, queued],
  )
  const tokenMeta = useTokenMeta(mints)
  // A crest's hue is read off the image after it downloads. This is what makes
  // the cards repaint when it lands, instead of keeping the name-hash colour
  // they were first drawn with.
  const palette = useLogoPalette()
  const highlight = useMemo(
    () => {
      if (!selected) return null
      const view = miawPrixEventView(identify(selected, tokenMeta))
      return view ? breakView(view, breakStartedAt(board?.matches ?? [], selected)) : null
    },
    // `now` moves on every tick and the view only reads it to decide a state
    // the board already carries, so it is deliberately not a dependency here:
    // rebuilding the hero match object every five seconds remounts the trade
    // console keyed on its id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, tokenMeta, palette, board],
  )
  const upcoming = useMemo(
    () => queued.flatMap((match) => {
      const view = miawPrixEventView(identify(match, tokenMeta))
      return view ? [view.match] : []
    }),
    [queued, tokenMeta, palette],
  )

  return useMemo(
    () => ({
      highlight,
      upcoming,
      season: board?.season ?? null,
      board,
      loaded,
      // Carried-in rows with the read that replaces them still in flight. A
      // first read with nothing behind it is `loaded: false` and says so with a
      // skeleton instead.
      refreshing: refreshing && Boolean(board),
      error,
      retry: () => { setRefreshing(true); setAttempt((value) => value + 1) },
    }),
    [highlight, upcoming, board, loaded, refreshing, error],
  )
}
