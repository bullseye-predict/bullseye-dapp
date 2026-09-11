import { useEffect, useRef, useState } from "react";
import type { SolzDataSource, SolzSnapshot } from "../solz/model";
import {
  createArenaFeed,
  currentMatchDrafts,
  type ArenaFeed,
} from "./arenaFeed";
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

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const render = (next: SolzSnapshot) => {
      base.current = next;
      if (arena.current && events.current)
        setSnapshot(applyPredictionArena(next, arena.current, events.current));
      else setSnapshot(next);
    };
    const refreshArena = async () => {
      if (!predictionApiUrl) return;
      const controller = new AbortController();
      try {
        const [nextArena, response] = await Promise.all([
          createArenaFeed(
            "/api/agent-arena",
            fetch,
            predictionApiUrl,
          )(controller.signal),
          fetch(predictionUrl("/arena/events", predictionApiUrl), {
            signal: controller.signal,
            headers: { accept: "application/json" },
          }),
        ]);
        if (!response.ok)
          throw Error(`Prediction events could not load (${response.status}).`);
        const nextEvents = await response.json();
        if (!active) return;
        arena.current = nextArena;
        events.current = nextEvents;
        setPredictionFeed(true);
        if (base.current)
          setSnapshot(
            applyPredictionArena(base.current, nextArena, nextEvents),
          );
      } catch (reason) {
        // Keep the real arena visible if the independent prediction importer
        // is restarting or unavailable. This direct game read is view-only;
        // it cannot enable trading or mutate prediction records.
        try {
          const gameFeed = await createArenaFeed(
            "/api/agent-arena",
            fetch,
            "",
            true,
          )(controller.signal);
          if (!active) return;
          arena.current = gameFeed;
          events.current = currentMatchDrafts(gameFeed);
          setPredictionFeed(true);
          if (base.current)
            setSnapshot(
              applyPredictionArena(base.current, gameFeed, events.current),
            );
          setError("");
        } catch {
          if (active)
            setError(
              reason instanceof Error
                ? reason.message
                : "Prediction event catalogue could not load.",
            );
        }
      } finally {
        if (active && predictionApiUrl)
          timer = setTimeout(() => void refreshArena(), 15_000);
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
    retry: () => setAttempt((value) => value + 1),
  };
}
