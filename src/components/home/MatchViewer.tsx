import {
  ArrowUpRight,
  ChartNoAxesCombined,
  Crosshair,
  Eye,
  ExternalLink,
  ListFilter,
  Maximize,
  MousePointerClick,
  Play,
  Radio,
  RotateCw,
  X,
} from "lucide-react";
import { animate } from "animejs";
import { memo, useEffect, useRef, useState } from "react";
import type {
  ArenaMarket,
  ArenaMarketOutcome,
  SolzDataSource,
  SolzMatch,
  SolzSnapshot,
} from "../solz/model";
import type { PredictionAnswer } from "../solz/predictionContracts";
import { CutoutCorner, Tabs, TabPanel, formatClock } from "../solz/ui";
import { AgentPortrait, compact, TeamMark } from "./HomePrimitives";
import { ProbabilityChart } from "../markets/ProbabilityChart";
import { chartHeadline, chartSeries } from "../markets/chartSeries";
import { emptyChart } from "../markets/chartEmpty";
import { PredictionOptions } from "./PredictionOptions";
import { HeroActivity } from "./HeroActivity";
import { StageChatCorner, StagePromptCorner } from "./StageCorners";
import type { PromptHint } from "./PromptComposer";
import { matchIdLabel, sideLabel, type HighlightView } from "./heroMarket";
import { needsIframeWarning, useArenaPerformance, type ArenaPerformance } from "./useArenaPerformance";

// Stable source identity keeps market ticks independent from playback.
type ArenaBroadcastStatus = {
  state: "preview" | "intermission" | "preparing" | "live" | "unavailable";
  endsAt: number | null;
  generatedAt: number;
  matchId: string | null;
  receivedAt: number;
};

type BroadcastContext = { state: string; time: string; detail: string };

type HlsInstance = {
  attachMedia: (element: HTMLVideoElement) => void;
  loadSource: (url: string) => void;
  startLoad: () => void;
  recoverMediaError: () => void;
  on: (event: string, handler: (event: string, data: HlsErrorData) => void) => void;
  destroy: () => void;
};
type HlsErrorData = { fatal?: boolean; type?: string; details?: string };
type HlsConstructor = (new (options?: Record<string, unknown>) => HlsInstance) & {
  isSupported?: () => boolean;
  Events: { ERROR: string; FRAG_BUFFERED: string };
  ErrorTypes: { NETWORK_ERROR: string; MEDIA_ERROR: string };
};
type HlsWindow = Window & { Hls?: HlsConstructor };
let hlsLoader: Promise<HlsConstructor | null> | null = null;

/**
 * A FAILED LOAD IS NOT CACHED. This script comes off a public CDN, so a shield,
 * an extension, a captive portal or one slow second can lose it. Holding the
 * null in `hlsLoader` made that single miss permanent: every later attempt
 * short-circuited to null and the stage never played video again for the rest
 * of the page's life. The promise is cleared on failure so the next mount asks
 * once more. It is not a loop - nothing re-calls this on a timer.
 */
function loadHls(): Promise<HlsConstructor | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const existing = (window as HlsWindow).Hls;
  if (existing) return Promise.resolve(existing);
  if (hlsLoader) return hlsLoader;
  hlsLoader = new Promise((resolve) => {
    const current = document.querySelector<HTMLScriptElement>('script[data-solz-hls]');
    if (current) {
      current.addEventListener("load", () => resolve((window as HlsWindow).Hls ?? null), { once: true });
      current.addEventListener("error", () => resolve(null), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js";
    script.async = true;
    script.dataset.solzHls = "true";
    script.onload = () => resolve((window as HlsWindow).Hls ?? null);
    script.onerror = () => { hlsLoader = null; script.remove(); resolve(null); };
    document.head.appendChild(script);
  });
  return hlsLoader;
}

/* RECOVERING A LIVE STREAM, WITH A CEILING.
   The relay publishes a six-segment window at two seconds a segment, so the
   live edge is about twelve seconds wide. A throttled tab, a sleeping laptop
   or one slow request drops a viewer off that edge and the segments it still
   wants are already gone. hls.js reports that as a fatal error and expects the
   page to call startLoad()/recoverMediaError(); nothing did, so one ordinary
   hiccup ended playback for the rest of the session.
   Recovery is bounded on three axes, because an unbounded retry against a dead
   origin is just a load generator: the wait doubles, it never exceeds
   RECOVERY_MAX_MS, consecutive failures stop at RECOVERY_LIMIT, and total
   recoveries over the whole mount stop at RECOVERY_TOTAL. Past any of those the
   viewer gets the unavailable card and an explicit Try again. */
const RECOVERY_LIMIT = 4;
const RECOVERY_TOTAL = 12;
const RECOVERY_BASE_MS = 1_000;
const RECOVERY_MAX_MS = 15_000;

const BroadcastMedia = memo(function BroadcastMedia({
  source,
  iframeSrc,
  onArenaStatus,
  context,
}: {
  source?: string;
  iframeSrc: string;
  onArenaStatus?: (status: ArenaBroadcastStatus) => void;
  context: BroadcastContext;
}) {
  const [failed, setFailed] = useState(false);
  // Clearing `failed` re-mounts the <video>, but the attach effect keys on
  // [iframeActive, source] and neither changes on a same-mode retry, so it
  // would never run again and the fresh element would sit empty. This nonce is
  // what makes Try again actually try.
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<"iframe" | "video">("video");
  // The embedded game swallows every click it is given, including the ones
  // meant for the page around it, so it starts inert and the viewer opts in.
  const [interactive, setInteractive] = useState(false);
  const [iframeWarning, setIframeWarning] = useState<ArenaPerformance | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const performanceDialog = useRef<HTMLDialogElement>(null);
  const { inspect } = useArenaPerformance();

  useEffect(() => {
    if (iframeWarning && !performanceDialog.current?.open) performanceDialog.current?.showModal();
  }, [iframeWarning]);

  const chooseMode = (next: "iframe" | "video") => {
    setMode(next);
    setFailed(false);
    setInteractive(false);
    setAttempt((value) => value + 1);
  };
  const requestMode = async (next: "iframe" | "video") => {
    if (next === "video") { chooseMode(next); return; }
    const profile = await inspect();
    if (needsIframeWarning(profile)) { setIframeWarning(profile); return; }
    chooseMode(next);
  };

  useEffect(() => {
    if (!onArenaStatus || typeof window === "undefined") return;
    let expectedOrigin = "";
    try {
      expectedOrigin = new URL(iframeSrc, window.location.href).origin;
    } catch {
      return;
    }
    const receive = (event: MessageEvent) => {
      if (
        event.source !== iframe.current?.contentWindow ||
        event.origin !== expectedOrigin
      )
        return;
      const value = event.data as Partial<ArenaBroadcastStatus> & {
        type?: string;
        version?: number;
      };
      if (
        value?.type !== "solz:agent-arena-status" ||
        value.version !== 1 ||
        !["preview", "intermission", "preparing", "live", "unavailable"].includes(
          String(value.state),
        )
      )
        return;
      const generatedAt = Number(value.generatedAt);
      const endsAt = value.endsAt === null ? null : Number(value.endsAt);
      if (
        !Number.isFinite(generatedAt) ||
        (endsAt !== null && !Number.isFinite(endsAt))
      )
        return;
      onArenaStatus({
        state: value.state!,
        generatedAt,
        endsAt,
        matchId: typeof value.matchId === "string" ? value.matchId : null,
        receivedAt: Date.now(),
      });
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [iframeSrc, onArenaStatus]);
  // DECLARED BEFORE THE EFFECT THAT DEPENDS ON THEM. A dependency array is
  // evaluated during render, not inside the callback, so `[iframeActive,
  // source]` below read `iframeActive` at its own line. With the const still
  // further down the body that is the temporal dead zone: the render threw
  // "Cannot access 'y' before initialization" from the minified bundle, the
  // whole HomeApp island unmounted, and colacat.solz.fun served a blank page
  // under its header. `astro build` does not type-check, so nothing caught it.
  const videoAvailable = Boolean(source) && !failed;
  const iframeActive = mode === "iframe";
  useEffect(() => {
    if (iframeActive || !source || !video.current) return;
    const element = video.current;
    let hls: HlsInstance | null = null;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let streak = 0;
    let total = 0;
    element.removeAttribute("src");
    if (element.canPlayType("application/vnd.apple.mpegurl")) {
      element.src = source;
      void element.play().catch(() => undefined);
    } else {
      void loadHls().then((Constructor) => {
        if (cancelled || !Constructor) return;
        // hls.js loaded but this engine cannot play MSE at all. Say so rather
        // than leaving an empty player that never fills.
        if (!Constructor.isSupported?.()) {
          setFailed(true);
          return;
        }
        const instance = new Constructor({ enableWorker: true });
        hls = instance;
        // A buffered fragment means the stream came back. Clearing the streak
        // is what lets a long session survive several separate hiccups; `total`
        // is not cleared, so the ceiling still holds over the whole mount.
        instance.on(Constructor.Events.FRAG_BUFFERED, () => {
          streak = 0;
        });
        instance.on(Constructor.Events.ERROR, (_event, data) => {
          if (cancelled || !data?.fatal) return;
          if (streak >= RECOVERY_LIMIT || total >= RECOVERY_TOTAL) {
            setFailed(true);
            return;
          }
          const wait = Math.min(RECOVERY_BASE_MS * 2 ** streak, RECOVERY_MAX_MS);
          streak += 1;
          total += 1;
          clearTimeout(retry);
          retry = setTimeout(() => {
            if (cancelled) return;
            if (data.type === Constructor.ErrorTypes.MEDIA_ERROR) instance.recoverMediaError();
            else instance.startLoad();
          }, wait);
        });
        instance.attachMedia(element);
        instance.loadSource(source);
      });
    }
    return () => {
      cancelled = true;
      clearTimeout(retry);
      hls?.destroy();
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, [iframeActive, source, attempt]);
  return (
    <>
      {iframeActive ? (
        <iframe
          ref={iframe}
          className="sh-broadcast-image sh-broadcast-frame"
          style={{ pointerEvents: interactive ? "auto" : "none" }}
          src={iframeSrc}
          title="SOLZ agent arena livestream"
          allow="autoplay; fullscreen"
        />
      ) : videoAvailable ? (
        <video
          ref={video}
          className="sh-broadcast-image"
          controls
          playsInline
          autoPlay
          muted
          onError={() => {
            setFailed(true);
            setMode("video");
          }}
        />
      ) : (
        <div className="sh-broadcast-fallback" role="status">
          <div>
            <span className="sh-broadcast-fallback-play" aria-hidden="true">
              <Play size={21} fill="currentColor" />
            </span>
            <strong>Video stream is unavailable.</strong>
            <p>
              The broadcast dropped out. Try it again, or proceed with iframe
              streaming, which opens the game stream directly and can use more
              device performance. Only continue if your device can handle the
              load.
            </p>
            <div>
              {Boolean(source) && (
                <button type="button" onClick={() => chooseMode("video")}>
                  <RotateCw size={13} aria-hidden="true" />
                  Try the video again
                </button>
              )}
              <button
                type="button"
                className={source ? "sh-fallback-secondary" : undefined}
                onClick={() => void requestMode("iframe")}
              >
                <Play size={13} fill="currentColor" aria-hidden="true" />
                Use iframe streaming
              </button>
              {iframeSrc && (
                <a href={iframeSrc} target="_blank" rel="noreferrer">
                  Open the game <ExternalLink size={13} aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="sh-broadcast-context" aria-live="polite">
        <span>{context.state}</span>
        <strong>{context.time}</strong>
        <small>{context.detail}</small>
      </div>
      {iframeActive && (
        <div className="sh-broadcast-interact">
          <button
            type="button"
            aria-pressed={interactive}
            onClick={() => {
              setInteractive(!interactive);
              if (!interactive) iframe.current?.focus();
            }}
          >
            <MousePointerClick size={13} aria-hidden="true" />
            {interactive ? "Release the game" : "Click to control the game"}
          </button>
        </div>
      )}
      <div
        className="sh-broadcast-source"
        role="group"
        aria-label="Broadcast source"
      >
        <button
          type="button"
          aria-pressed={iframeActive}
          onClick={() => void requestMode("iframe")}
        >
          Iframe
        </button>
        <button
          type="button"
          aria-pressed={!iframeActive}
          onClick={() => void requestMode("video")}
        >
          Video
        </button>
      </div>
      <dialog ref={performanceDialog} className="ch-event-dialog ch-performance-dialog" onClose={() => setIframeWarning(null)} aria-labelledby="iframe-performance-title">
        {iframeWarning && <>
          <div><span className="ch-simulation">PERFORMANCE CHECK</span><button aria-label="Keep video source" onClick={() => performanceDialog.current?.close()}><X size={20}/></button></div>
          <h2 id="iframe-performance-title">Iframe may reduce playback quality.</h2>
          <p>Your GPU benchmark is {iframeWarning.fps === null ? 'below the recommended tier' : `${Math.round(iframeWarning.fps)} FPS`}. The direct game iframe can add rendering work and may cause dropped frames.</p>
          <dl><div><dt>GPU tier</dt><dd>{iframeWarning.tier} / 3</dd></div><div><dt>Detected GPU</dt><dd>{iframeWarning.gpu ?? 'Unavailable'}</dd></div><div><dt>Benchmark</dt><dd>{iframeWarning.type.replaceAll('_', ' ')}</dd></div></dl>
          <div className="ch-performance-actions"><button type="button" onClick={() => performanceDialog.current?.close()}>Stay on video</button><button type="button" onClick={() => { chooseMode('iframe'); performanceDialog.current?.close() }}>Continue to iframe</button></div>
        </>}
      </dialog>
    </>
  );
});

export function arenaEmbedUrl(value: string) {
  try {
    const absolute = /^[a-z][a-z\d+.-]*:/i.test(value);
    const url = new URL(value, "http://arena.local");
    url.searchParams.set("back", "false");
    return absolute
      ? url.toString()
      : `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

export function matchClock(
  match: Pick<SolzMatch, "startedAt" | "endsAt" | "durationMs" | "timingType">,
  now: number,
  deadline = match.endsAt,
) {
  if (match.timingType === "open-ended")
    return {
      elapsedMs: Math.max(0, now - match.startedAt),
      remainingMs: null,
      durationMs: null,
    };
  const durationMs =
    match.durationMs ?? Math.max(0, match.endsAt - match.startedAt);
  const remainingMs = Math.max(0, deadline - now);
  return {
    elapsedMs: Math.min(durationMs, Math.max(0, durationMs - remainingMs)),
    remainingMs,
    durationMs,
  };
}

function matchWinnerBoard(
  markets: ArenaMarket[],
  selected: ArenaMarket,
): ArenaMarket {
  const outcomes = markets.flatMap((item) => {
    const yes =
      item.outcomes.find((outcome) => outcome.id === "yes") ?? item.outcomes[0];
    return yes
      ? [
          {
            ...yes,
            id: item.id,
            label: item.title.replace(/^Will (.+) win\?$/, "$1"),
            detail: `YES on ${item.title}`,
            priceHistory: yes.priceHistory ?? [],
          },
        ]
      : [];
  });
  return {
    ...selected,
    id: `${selected.matchId}:winner-board`,
    title: `Match winner · all ${outcomes.length} agents`,
    description: `${outcomes.length} linked YES/NO winner questions for this one match.`,
    outcomes,
  };
}

type Props = {
  match: SolzMatch;
  market: ArenaMarket;
  markets: ArenaMarket[];
  /** True while the question sources this list is built from are still in
   *  flight. A count published before they answer is not a small count, it is
   *  a WRONG one, and the tab prints it as fact. */
  marketsPending?: boolean;
  snapshot: SolzSnapshot;
  source: SolzDataSource;
  view: HighlightView;
  onView: (view: HighlightView) => void;
  outcome: ArenaMarketOutcome;
  onSelect: (
    market: ArenaMarket,
    outcome: ArenaMarketOutcome,
    answer?: PredictionAnswer,
  ) => void;
  liveHref: string;
  livestreamUrl?: string;
  onChat: () => void;
  onPrompt: () => void;
  season: boolean;
  broadcastOnly?: boolean;
  referenceMarkets?: ArenaMarket[];
  simulation?: boolean;
  answer?: PredictionAnswer;
  marketSourceLabel?: string;
  collateralSymbol?: string;
  /** Pre-selects a recipient in the stage prompt corner and focuses its field. */
  promptAgentId?: string;
  promptWarning?: string;
  /** The bottom-left chat field stays hidden until the CHAT HIGHLIGHTS rail asks for it. */
  chatOpen?: boolean;
  onChatClose?: () => void;
  onBroadcastState?: (state: ArenaBroadcastStatus["state"] | null) => void;
  onBroadcastMatchId?: (matchId: string | null) => void;
};

export function broadcastBelongsToMatch(
  broadcastMatchId: string | null,
  match: Pick<SolzMatch, "id" | "roomId" | "displayMatchId">,
) {
  if (!broadcastMatchId) return false;
  const normalized = broadcastMatchId
    .toLowerCase()
    .replace(/^arena-/, "")
    .replace(/^0x/, "");
  return [match.id, match.roomId, match.displayMatchId]
    .filter((value): value is string => Boolean(value))
    .some(
      (value) =>
        value
          .toLowerCase()
          .replace(/^arena-/, "")
          .replace(/^0x/, "") === normalized,
    );
}

export function MatchViewer({
  match,
  market,
  markets,
  snapshot,
  source,
  view,
  onView,
  outcome,
  marketsPending = false,
  onSelect,
  liveHref,
  livestreamUrl,
  onChat,
  onPrompt,
  season,
  broadcastOnly = false,
  simulation = true,
  answer = "yes",
  referenceMarkets,
  marketSourceLabel,
  collateralSymbol,
  promptAgentId,
  promptWarning,
  chatOpen = false,
  onChatClose,
  onBroadcastState,
  onBroadcastMatchId,
}: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const livestreamChip = useRef<HTMLSpanElement>(null);
  const livestreamTab = useRef<HTMLSpanElement>(null);
  const [fullscreenError, setFullscreenError] = useState("");
  const [broadcastStatus, setBroadcastStatus] =
    useState<ArenaBroadcastStatus | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  // The composer's sentence, held here because the plate that writes it and the
  // rail that shows it are siblings. See PromptComposer's `onHint`.
  const [promptHint, setPromptHint] = useState<PromptHint | null>(null);
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await frame.current?.requestFullscreen();
    } catch {
      setFullscreenError("Full screen is unavailable in this browser.");
    }
  }
  // A MIAW PRIX card is TWO COINS AND NO ROSTER: the programme's competitors
  // are the coins themselves, and the agents that play the room are not part of
  // the fixture. Every panel below that counts agents reads this first, so a
  // real pairing is never announced as "0 AGENTS CONFIRMED" beside an empty
  // grid. The mint is the test, not the team count: a Genesis team match also
  // has two sides.
  const coinSides =
    match.teams.length === 2 && match.teams.every((team) => team.mint)
      ? match.teams
      : null;
  const winnerMarkets = markets.filter((item) => item.kind === "match-winner");
  const board = matchWinnerBoard(
    winnerMarkets,
    winnerMarkets.find((item) => item.id === market.id) ??
      winnerMarkets[0] ??
      market,
  );
  const boardOutcome =
    board.outcomes.find((item) => item.id === market.id) ?? board.outcomes[0];
  // matchWinnerBoard folds each match-winner market into one synthetic market,
  // taking that market's YES leg as its line — so this is a field of answers,
  // and `chartShape` reads it as one.
  const boardChart = chartSeries(board, snapshot, {
    selectedId: boardOutcome?.id,
  });
  // THE BROADCAST OUTRANKS THE STORED SLOT.
  //
  // A planned row keeps `countdown` until its own kickoff time passes, and that
  // time drifts whenever a slot is replanned or a room starts late. The arena
  // is the only thing that knows a match is actually running, so a `live`
  // status ends the question: without this, a stale slot put a full-stage
  // BREAK TIME card over a match that was already being played.
  const intermission =
    broadcastStatus?.state === "live"
      ? false
      : match.phase === "countdown" ||
        broadcastStatus?.state === "preview" ||
        broadcastStatus?.state === "intermission" ||
        broadcastStatus?.state === "preparing";
  const publicMatchLabel = matchIdLabel(match);
  const matchCode =
    publicMatchLabel !== "MATCH —"
      ? publicMatchLabel
      : `#A-${match.id
          .replace(/^arena-/, "")
          .replace(/-/g, "")
          .slice(0, 4)
          .toUpperCase()}`;
  useEffect(() => {
    setBroadcastStatus(null);
  }, [match.id]);
  useEffect(() => {
    onBroadcastState?.(broadcastStatus?.state ?? null);
  }, [broadcastStatus?.state, onBroadcastState]);
  useEffect(() => {
    onBroadcastMatchId?.(broadcastStatus?.matchId ?? null);
  }, [broadcastStatus?.matchId, onBroadcastMatchId]);
  useEffect(() => {
    if (match.phase === "settled") return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [match.id, match.phase]);
  const serverDeadline = broadcastStatus?.endsAt
    ? broadcastStatus.receivedAt +
      Math.max(0, broadcastStatus.endsAt - broadcastStatus.generatedAt)
    : match.endsAt;
  const timing = matchClock(match, clock, serverDeadline);
  const elapsed = formatClock(timing.elapsedMs);
  const remaining =
    timing.remainingMs === null ? null : formatClock(timing.remainingMs);
  const duration =
    timing.durationMs === null ? null : formatClock(timing.durationMs);
  // BREAK TIME IS A COUNTDOWN, NOT EVERY STATE THAT IS NOT LIVE.
  //
  // `preparing` is what the arena posts whenever it has no match selected AND
  // no break clock either - connecting, resolving a route, or sitting between
  // rooms. It means "not known yet", and covering the stage with PREPARING
  // MATCH announced a break the programme was not in. `preview` is the
  // fifteen-second pre-roll, which is too short to hide the stage for.
  //
  // So the full-stage card is reserved for a real break window: the arena says
  // `intermission`, or - when the arena has posted nothing at all, which is
  // every Colosseum card, because LiveBroadcastPage only posts for the
  // `agent-arena` channel - the stored slot is counting down to its own
  // kickoff. Either way there has to be time left to put on it.
  const breakTime =
    intermission &&
    Boolean(remaining) &&
    (broadcastStatus
      ? broadcastStatus.state === "intermission"
      : match.phase === "countdown");
  const broadcastContext: BroadcastContext = breakTime
    ? {
        state: "BREAK TIME",
        time: `${remaining} LEFT`,
        detail: `NEXT ${matchCode}`,
      }
    : intermission
      ? {
          // Says what is true - the stage is waiting - without claiming a break
          // window that has no clock behind it.
          state: "STANDING BY",
          time: remaining ? `${remaining} LEFT` : "PREPARING MATCH",
          detail: `NEXT ${matchCode}`,
        }
    : match.phase === "live"
      ? timing.remainingMs === 0
        ? {
            state: "ENDING",
            time: `${duration ?? elapsed} / ${duration ?? "OPEN"}`,
            detail: `AWAITING FINAL · ${match.mode}`,
          }
        : {
            state: "LIVE MATCH",
            time: duration ? `${elapsed} / ${duration}` : elapsed,
            detail: remaining
              ? `${remaining} LEFT · ${match.mode}`
              : `OPEN-ENDED · ${match.mode}`,
          }
      : {
          state: "MATCH COMPLETE",
          time: "FINAL",
          detail: "AWAITING NEXT MATCH",
        };
  // A stored slot can still read `countdown` while the arena is playing, so
  // the broadcast's own word counts as live on its own.
  const isLiveBroadcast =
    broadcastStatus?.state === "live" || (match.phase === "live" && !intermission);
  useEffect(() => {
    if (!isLiveBroadcast || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const targets = [livestreamChip.current, livestreamTab.current].filter((element): element is HTMLSpanElement => Boolean(element));
    if (!targets.length) return;
    const pulse = animate(targets, {
      scale: [1, 1.055, 1],
      opacity: [1, 0.72, 1],
      duration: 1200,
      ease: "inOutSine",
      loop: true,
    });
    return () => { pulse.cancel(); };
  }, [isLiveBroadcast]);
  return (
    <section className="ch-viewer" aria-label="Highlighted event viewer">
      <div className="ch-viewer-body">
        <div className={`ch-screen ${season ? "is-season" : ""}`}>
          {/* The view switch is a plate notched into the stage's top-left
              corner, so it reads as part of the frame rather than a bar above
              it. Its two wedges carry the plate's own colour. */}
          {!broadcastOnly && (
            <div className="ch-stage-tabs ch-stage-plate">
              <Tabs
                label="Highlight view"
                idPrefix="highlight-view"
                value={view}
                onChange={onView}
                tabs={[
                  {
                    id: "options",
                    label: (
                      <>
                        <ListFilter size={14} /> Predictions{" "}
                        {/* No number until the sources behind it have
                            answered. An ellipsis says "counting"; a digit
                            says "this is how many there are". */}
                        <span>{marketsPending ? "…" : markets.length}</span>
                      </>
                    ),
                  },
                  {
                    id: "market",
                    label: (
                      <>
                        <ChartNoAxesCombined size={14} /> Market
                      </>
                    ),
                  },
                  {
                    id: "live",
                    label: (
                      <span ref={livestreamTab} className={`ch-livestream-tab ${isLiveBroadcast ? "is-live" : ""}`}>
                        <Radio size={14} /> Livestream
                      </span>
                    ),
                  },
                ]}
              />
              <CutoutCorner size={28} className="ch-stage-cut ch-stage-cut--tl-side" />
              <CutoutCorner size={28} className="ch-stage-cut ch-stage-cut--tl-below" />
            </div>
          )}
          <TabPanel
            id="live"
            idPrefix="highlight-view"
            active={view === "live"}
          >
            <div className="sh-broadcast" ref={frame}>
              <BroadcastMedia
                key={`${match.streamUrl ?? livestreamUrl ?? "iframe"}:${liveHref}`}
                source={match.streamUrl ?? livestreamUrl}
                iframeSrc={arenaEmbedUrl(liveHref)}
                onArenaStatus={(status) =>
                  setBroadcastStatus(
                    broadcastBelongsToMatch(status.matchId, match)
                      ? status
                      : null,
                  )
                }
                context={broadcastContext}
              />
              <div className="sh-broadcast-shade" aria-hidden="true" />
              <div className="sh-broadcast-top">
                <span ref={livestreamChip} className={`sh-preview-chip ${isLiveBroadcast ? "is-live" : ""}`}>
                  {isLiveBroadcast && <i aria-hidden="true" />}
                  {breakTime
                    ? "NEXT MATCH RESERVED"
                    : isLiveBroadcast
                      ? "LIVE BROADCAST"
                      : intermission
                        ? "STANDING BY"
                        : "VIDEO UNAVAILABLE"}
                </span>
                <span>
                  <Eye size={13} />
                  {compact(match.viewers)} watching
                </span>
              </div>
              {!breakTime && (
                <div
                  className={`ch-scoreboard ${match.teams.length > 2 ? "is-ffa" : ""}`}
                >
                  {match.teams.map((team, index) => (
                    <div key={team.teamId} style={{ color: team.color }}>
                      <TeamMark id={team.teamId} color={team.color} logoUrl={team.logoUrl} />
                      <strong>{sideLabel(team)}</strong>
                      <b>{String(team.score).padStart(2, "0")}</b>
                      {index === 0 && match.teams.length === 2 && (
                        <span className="ch-score-center">
                          <small>{match.round}</small>
                          <strong>{elapsed}</strong>
                          <small>{match.mode}</small>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {breakTime ? (
                <div className="ch-intermission" role="status">
                  <div className="ch-intermission-copy">
                    <span>BREAK TIME</span>
                    <h2>
                      Preparing match <b>{matchCode}</b>
                    </h2>
                    {remaining && (
                      <div className="ch-intermission-time">
                        <span>TIME LEFT</span>
                        <strong>{remaining}</strong>
                        <small>BREAK WINDOW</small>
                      </div>
                    )}
                    <p>
                      {coinSides
                        ? "The pairing is locked and the room is reserved. Prediction sides remain visible at 50:50 until live pricing begins."
                        : "The room is reserved and the match system is preparing the next round. Prediction sides remain visible at 50:50 until live pricing begins."}
                    </p>
                    <strong>
                      {coinSides
                        ? coinSides.map((team) => sideLabel(team)).join(" VS ")
                        : `${match.roster.length} AGENTS CONFIRMED`}
                    </strong>
                  </div>
                  {coinSides ? (
                    <div
                      className="ch-intermission-roster ch-intermission-roster--coins"
                      aria-label="Next match coin pairing"
                    >
                      {coinSides.map((team) => (
                        <div key={team.teamId} style={{ color: team.color }}>
                          <TeamMark
                            id={team.teamId}
                            color={team.color}
                            logoUrl={team.logoUrl}
                          />
                          <span>
                            <strong>{sideLabel(team)}</strong>
                            <small>{team.name}</small>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                  <div
                    className="ch-intermission-roster"
                    aria-label="Next match agent roster"
                  >
                    {match.roster.map((entry) => {
                      const agent = snapshot.agents.find(
                        (item) => item.id === entry.agentId,
                      );
                      return (
                        <div key={entry.agentId}>
                          <AgentPortrait
                            number={
                              agent?.number ??
                              Number(entry.agentId.split("-")[1])
                            }
                          />
                          <span>
                            <strong>{entry.codename}</strong>
                            <small>{agent?.archetype ?? "GENESIS AGENT"}</small>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  )}
                  <small className="ch-intermission-lock">
                    CHECK THE TRADE PANEL FOR THIS EVENT’S ON-CHAIN CUTOFF
                  </small>
                </div>
              ) : (
                <div className="sh-broadcast-bottom">
                  <div>
                    <span className="sh-map-label">
                      <Crosshair size={14} />{" "}
                      {coinSides ? "MIAW PRIX / AGENT COLOSSEUM" : "COOLA / GENESIS SERIES"}
                    </span>
                    <h2>
                      {match.phase === "settled" ? "MATCH COMPLETE" : match.map}
                    </h2>
                    <div className="ch-broadcast-roster">
                      {coinSides
                        ? coinSides.map((team) => (
                            <span title={team.name} key={team.teamId}>
                              <TeamMark
                                id={team.teamId}
                                color={team.color}
                                logoUrl={team.logoUrl}
                              />
                            </span>
                          ))
                        : match.roster.map((entry) => (
                            <span title={entry.codename} key={entry.agentId}>
                              <AgentPortrait
                                number={Number(entry.agentId.split("-")[1])}
                              />
                            </span>
                          ))}
                      <span>
                        {coinSides
                          ? coinSides.map((team) => sideLabel(team)).join(" VS ")
                          : `${match.roster.length} CAN AGENTS`}{" "}
                        <span>
                          /{" "}
                          {match.phase === "settled"
                            ? "INTERMISSION"
                            : match.mode}
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="ch-broadcast-actions">
                    <a href={liveHref}>
                      Live arena <ArrowUpRight size={12} />
                    </a>
                    <button
                      className="sh-icon-button"
                      onClick={fullscreen}
                      aria-label="Full screen broadcast"
                    >
                      <Maximize size={17} />
                    </button>
                  </div>
                </div>
              )}
              {/* Mounted inside the livestream panel on purpose: leaving this
                  tab hides the panel and takes both corners with it, which is
                  the "only available in livestream" rule with no extra state. */}
              {!broadcastOnly && (
                <StagePromptCorner
                  source={source}
                  snapshot={snapshot}
                  match={match}
                  promptAgentId={promptAgentId}
                  intermission={intermission}
                  simulation={simulation}
                  warning={promptWarning}
                  onHint={setPromptHint}
                />
              )}
              {!broadcastOnly && chatOpen && (
                <StageChatCorner
                  source={source}
                  matchId={match.id}
                  onClose={() => onChatClose?.()}
                />
              )}
              {fullscreenError && (
                <p className="sh-fullscreen-error" role="status">
                  {fullscreenError}
                </p>
              )}
            </div>
          </TabPanel>
          <TabPanel
            id="market"
            idPrefix="highlight-view"
            active={view === "market"}
          >
            {boardOutcome ? (
              <ProbabilityChart
                key={board.id}
                title={board.title}
                series={boardChart.series}
                unit={boardChart.unit}
                headline={chartHeadline(board, { selectedId: boardOutcome.id, collateral: collateralSymbol })}
                source={marketSourceLabel}
                empty={emptyChart(boardChart.series)}
                onSelect={(id: string) => {
                  const next = winnerMarkets.find(
                    (candidate) => candidate.id === id,
                  );
                  const yes =
                    next?.outcomes.find(
                      (candidate) => candidate.id === "yes",
                    ) ?? next?.outcomes[0];
                  if (next && yes) onSelect(next, yes);
                }}
              />
            ) : (
              <div className="ch-market-empty ch-panel-empty" role="status">
                <strong>No match market yet.</strong>
                <span>
                  The arena and controls stay available while prediction
                  questions are loading.
                </span>
              </div>
            )}
          </TabPanel>
          <TabPanel
            id="options"
            idPrefix="highlight-view"
            active={view === "options"}
          >
            {markets.length ? (
              <PredictionOptions
                collateral={collateralSymbol}
                match={match}
                sourceLabel={marketSourceLabel}
                answer={answer}
                key={`${match.id}-${season}`}
                pending={marketsPending}
                markets={markets}
                market={market}
                outcome={outcome}
                snapshot={snapshot}
                onSelect={onSelect}
                referenceMarkets={referenceMarkets}
                simulation={simulation}
              />
            ) : (
              <div className="ch-options ch-options-empty" role="status">
                <div className="ch-options-heading">
                  <div>
                    <h2>Make your call.</h2>
                    <p>
                      {marketsPending
                        ? "Reading this match’s questions…"
                        : "0 predictions · waiting for the prediction feed"}
                    </p>
                  </div>
                  <span className="ch-simulation">
                    {marketsPending ? "LOADING" : "FEED UNAVAILABLE"}
                  </span>
                </div>
                <div className="ch-market-empty">
                  <strong>
                    {marketsPending
                      ? "Loading prediction questions."
                      : "No prediction questions yet."}
                  </strong>
                  <span>
                    Livestream, chat, and agent controls remain available
                    independently.
                  </span>
                </div>
              </div>
            )}
          </TabPanel>
        </div>

        {!broadcastOnly && (
          <HeroActivity
            simulation={simulation}
            source={source}
            snapshot={snapshot}
            match={match}
            onChat={onChat}
            onPrompt={onPrompt}
            promptHint={promptHint}
          />
        )}
      </div>
    </section>
  );
}
