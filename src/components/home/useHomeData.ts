import { useEffect, useRef, useState } from "react";
import type { SolzDataSource, SolzSnapshot } from "../solz/model";
import {
  createArenaFeed,
  currentMatchDrafts,
  type ArenaFeed,
} from "./arenaFeed";
import type { ArenaScheduleEntry } from "../agent-arena/model";
import { applyPredictionArena } from "./predictionArena";
import { cachedValue, rememberValue } from "../solz/liveCache";
import { predictionUrl } from "../../../packages/sdk/prediction-url";

/**
 * Where this page's composed snapshot is remembered in the realm.
 *
 * Keyed on the prediction endpoint because the snapshot is only composed once
 * that feed has been folded in: /events reads with no endpoint and gets a
 * DIFFERENT object, which must not stand in for this one.
 *
 * See src/components/solz/liveCache.ts. The realm survives a ClientRouter
 * navigation, so this is what stops a trip to /catwalk and back from redrawing
 * the whole arena as "Loading the arena…".
 */
const snapshotKey = (predictionApiUrl: string) => `home-snapshot:${predictionApiUrl}`;
const scheduleKey = (predictionApiUrl: string) => `home-schedule:${predictionApiUrl}`;

export function useHomeData(source: SolzDataSource, predictionApiUrl = "") {
  const [snapshot, setSnapshot] = useState<SolzSnapshot | null>(
    () => cachedValue<SolzSnapshot>(snapshotKey(predictionApiUrl))?.value ?? null,
  );
  const [referenceSnapshot, setReferenceSnapshot] =
    useState<SolzSnapshot | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const base = useRef<SolzSnapshot | null>(null);
  const arena = useRef<ArenaFeed | null>(null);
  const events = useRef<unknown>(null);
  const [predictionFeed, setPredictionFeed] = useState(false);
  /**
   * Whether the prediction feed has been ASKED yet, as opposed to whether it
   * answered. `predictionFeed` is a success flag, so a backend that is simply
   * down leaves it false forever - and anything that reads it as "still
   * loading" then loads forever too. This flips once per arena refresh, on the
   * success path and on the failure path alike.
   */
  const [predictionFeedSettled, setPredictionFeedSettled] = useState(false);
  const [arenaSchedule, setArenaSchedule] = useState<ArenaScheduleEntry[]>(
    () => cachedValue<ArenaScheduleEntry[]>(scheduleKey(predictionApiUrl))?.value ?? [],
  );

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** Publish a composed snapshot AND remember it for the next mount. Every
     *  path that shows one goes through here, so a snapshot can never reach the
     *  screen without also being what this realm carries to the next page. */
    const publish = (next: SolzSnapshot) => {
      setSnapshot(rememberValue(snapshotKey(predictionApiUrl), next).value);
    };
    const render = (next: SolzSnapshot) => {
      base.current = next;
      if (arena.current && events.current)
        publish(applyPredictionArena(next, arena.current, events.current));
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
        // Arena scheduling is the page's availability contract. The prediction
        // feed can be delayed or unavailable, but must never hold the live
        // match, intermission timer, or embedded Arena behind its response.
        arena.current = nextArena;
        setArenaSchedule(rememberValue(scheduleKey(predictionApiUrl), nextArena.upcoming).value);
        events.current = nextEvents;
        setPredictionFeed(false);
        if (!predictionApiUrl) setPredictionFeedSettled(true);
        if (base.current)
          publish(applyPredictionArena(base.current, nextArena, nextEvents));
        setError("");
        armScheduleRefresh(nextArena);
        if (predictionApiUrl) {
          try {
            const response = await fetch(predictionUrl("/arena/events", predictionApiUrl), {
              signal: controller.signal,
              headers: { accept: "application/json" },
            });
            if (response.ok) {
              nextEvents = await response.json();
              if (!active) return;
              events.current = nextEvents;
              setPredictionFeed(true);
              if (base.current)
                publish(applyPredictionArena(base.current, nextArena, nextEvents));
            }
          } catch {
            // The fallback drafts above stay trade-disabled and keep the Arena
            // clock visible while this independently deployed feed recovers.
          } finally {
            if (active) setPredictionFeedSettled(true);
          }
        }
      } catch (reason) {
        if (active) {
          setPredictionFeedSettled(true);
          setError(
            reason instanceof Error
              ? reason.message
              : "Arena schedule could not load.",
          );
        }
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
    predictionFeedSettled,
    arenaSchedule,
    retry: () => setAttempt((value) => value + 1),
  };
}
