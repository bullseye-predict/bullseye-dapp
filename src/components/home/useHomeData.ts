import { useEffect, useRef, useState } from "react";
import type { SolzDataSource, SolzSnapshot } from "../solz/model";
import {
  createArenaFeed,
  currentMatchDrafts,
  type ArenaFeed,
} from "./arenaFeed";
import type { ArenaScheduleEntry } from "../agent-arena/model";
import { applyPredictionArena } from "./predictionArena";
import { predictionUrl } from "../../../packages/sdk/prediction-url";

export function useHomeData(source: SolzDataSource, predictionApiUrl = "") {
  const [snapshot, setSnapshot] = useState<SolzSnapshot | null>(null);
  const [referenceSnapshot, setReferenceSnapshot] =
    useState<SolzSnapshot | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const base = useRef<SolzSnapshot | null>(null);
  const arena = useRef<ArenaFeed | null>(null);
  const events = useRef<unknown>(null);
  const [predictionFeed, setPredictionFeed] = useState(false);
  const [arenaSchedule, setArenaSchedule] = useState<ArenaScheduleEntry[]>([]);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const render = (next: SolzSnapshot) => {
      base.current = next;
      if (arena.current && events.current)
        setSnapshot(applyPredictionArena(next, arena.current, events.current));
      // The local source is a reference fixture, not public market inventory.
      // Wait for the authoritative arena before publishing any visible snapshot.
    };
    const armScheduleRefresh = (feed: ArenaFeed) => {
      const current = feed.current;
      if (!current) return;
      const now = Date.now();
      const duration = current.matchDurationMs ?? current.definition?.matchDurationMs ?? 0;
      const started = Date.parse(current.startedAt ?? current.scheduledStartAt ?? '');
      const next = Date.parse(current.nextMatchAt ?? '');
      const boundary = current.status === 'live' && Number.isFinite(started) && duration > 0
        ? started + duration
        : current.status === 'settled' && Number.isFinite(next)
          ? next
          : current.status === 'reserved'
            ? Date.parse(current.scheduledStartAt ?? '')
            : NaN;
      if (!Number.isFinite(boundary) || boundary <= now) return;
      // The server is read once at startup and once at the persisted schedule
      // boundary. The local countdown supplies the seconds in between, so an
      // open prediction page cannot become a 15-second Neon polling client.
      timer = setTimeout(() => void refreshArena(), Math.max(500, boundary - now + 500));
    };
    const refreshArena = async () => {
      const controller = new AbortController();
      try {
        // Elysia's public schedule is the only source allowed to control the
        // arena clock. The prediction backend owns tradability, but it may be
        // unavailable or delayed and must never substitute a stale five-minute
        // sample for the live 20-minute / five-minute-break programme.
        const nextArena = await createArenaFeed(
          "/api/agent-arena",
          fetch,
          "",
          true,
        )(controller.signal);
        let nextEvents = currentMatchDrafts(nextArena);
        let feedAvailable = false;
        if (predictionApiUrl) {
          const response = await fetch(predictionUrl("/arena/events", predictionApiUrl), {
            signal: controller.signal,
            headers: { accept: "application/json" },
          });
          if (response.ok) {
            nextEvents = await response.json();
            feedAvailable = true;
          }
        }
        if (!active) return;
        arena.current = nextArena;
        setArenaSchedule(nextArena.upcoming);
        events.current = nextEvents;
        setPredictionFeed(feedAvailable);
        if (base.current)
          setSnapshot(
            applyPredictionArena(base.current, nextArena, nextEvents),
          );
        setError("");
        armScheduleRefresh(nextArena);
      } catch (reason) {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Arena schedule could not load.",
          );
      }
    };
    setError("");
    source
      .load()
      .then((initial) => {
        if (!active) return;
        render(initial);
        setReferenceSnapshot(initial);
        unsubscribe = source.subscribe(render);
        void refreshArena();
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "The arena could not load.",
          );
      });
    return () => {
      active = false;
      unsubscribe?.();
      if (timer) clearTimeout(timer);
    };
  }, [source, predictionApiUrl, attempt]);

  return {
    snapshot,
    referenceSnapshot,
    error,
    predictionFeed,
    arenaSchedule,
    retry: () => setAttempt((value) => value + 1),
  };
}
