import {
  ArrowUpRight,
  ChartNoAxesCombined,
  Crosshair,
  Eye,
  ExternalLink,
  ListFilter,
  Maximize,
  Pin,
  Play,
  Radio,
  X,
} from "lucide-react";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  ArenaMarket,
  ArenaMarketOutcome,
  SolzDataSource,
  SolzMatch,
  SolzSnapshot,
} from "../solz/model";
import type { PredictionAnswer } from "../solz/predictionContracts";
import { Tabs, TabPanel, formatClock } from "../solz/ui";
import { AgentPortrait, compact, TeamMark } from "./HomePrimitives";
import { HighlightChart } from "./HighlightChart";
import { PredictionOptions } from "./PredictionOptions";
import { HeroActivity } from "./HeroActivity";
import { matchIdLabel, teamLabel, type HighlightView } from "./heroMarket";

// Stable source identity keeps market ticks independent from playback.
type ArenaBroadcastStatus = {
  state: "intermission" | "preparing" | "live" | "unavailable";
  endsAt: number | null;
  generatedAt: number;
  matchId: string | null;
  receivedAt: number;
};

type BroadcastContext = { state: string; time: string; detail: string };

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
  const [mode, setMode] = useState<"iframe" | "video">("video");
  const iframe = useRef<HTMLIFrameElement>(null);
  const iframePreference = "solz:agent-arena:iframe-enabled";

  useEffect(() => {
    if (source || typeof window === "undefined") return;
    if (window.localStorage.getItem(iframePreference) === "true")
      setMode("iframe");
  }, [source]);

  const chooseMode = (next: "iframe" | "video") => {
    setMode(next);
    setFailed(false);
    if (typeof window !== "undefined")
      window.localStorage.setItem(iframePreference, String(next === "iframe"));
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
        !["intermission", "preparing", "live", "unavailable"].includes(
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
  const videoAvailable = Boolean(source) && !failed;
  const iframeActive = mode === "iframe";
  return (
    <>
      {iframeActive ? (
        <iframe
          ref={iframe}
          className="sh-broadcast-image sh-broadcast-frame"
          src={iframeSrc}
          title="SOLZ agent arena livestream"
          allow="autoplay; fullscreen"
        />
      ) : videoAvailable ? (
        <video
          className="sh-broadcast-image"
          src={source}
          controls
          playsInline
          autoPlay
          muted
          onError={() => {
            setFailed(true);
            setMode("video");
            if (typeof window !== "undefined")
              window.localStorage.setItem(iframePreference, "false");
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
              Do you want to proceed with iframe streaming? It opens the game
              stream directly and can use more device performance. Only continue
              if your device can handle the load.
            </p>
            <div>
              <button type="button" onClick={() => chooseMode("iframe")}>
                <Play size={13} fill="currentColor" aria-hidden="true" />
                Use iframe streaming
              </button>
              <a
                href="https://solz.fun/watch/live/agent-arena"
                target="_blank"
                rel="noreferrer"
              >
                Open the game <ExternalLink size={13} aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
      )}
      <div className="sh-broadcast-context" aria-live="polite">
        <span>{context.state}</span>
        <strong>{context.time}</strong>
        <small>{context.detail}</small>
      </div>
      <div
        className="sh-broadcast-source"
        role="group"
        aria-label="Broadcast source"
      >
        <button
          type="button"
          aria-pressed={iframeActive}
          onClick={() => chooseMode("iframe")}
        >
          Iframe
        </button>
        <button
          type="button"
          aria-pressed={!iframeActive}
          onClick={() => chooseMode("video")}
        >
          Video
        </button>
      </div>
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
    title: "Match winner · all 12 agents",
    description: "Twelve linked YES/NO winner questions for this one match.",
    outcomes,
  };
}

type Props = {
  match: SolzMatch;
  market: ArenaMarket;
  markets: ArenaMarket[];
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
  onChat: () => void;
  onPrompt: () => void;
  season: boolean;
  pinned: boolean;
  onPin: () => void;
  broadcastOnly?: boolean;
  detailHref?: string;
  referenceMarkets?: ArenaMarket[];
  simulation?: boolean;
  answer?: PredictionAnswer;
  marketSourceLabel?: string;
  heading?: ReactNode;
  onBroadcastState?: (state: ArenaBroadcastStatus["state"] | null) => void;
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
  onSelect,
  liveHref,
  onChat,
  onPrompt,
  season,
  pinned,
  onPin,
  detailHref,
  broadcastOnly = false,
  simulation = true,
  answer = "yes",
  referenceMarkets,
  marketSourceLabel,
  heading,
  onBroadcastState,
}: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const [fullscreenError, setFullscreenError] = useState("");
  const [detail, setDetail] = useState<ArenaMarket | null>(null);
  const [broadcastStatus, setBroadcastStatus] =
    useState<ArenaBroadcastStatus | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (detail && !dialog.current?.open) dialog.current?.showModal();
  }, [detail]);
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await frame.current?.requestFullscreen();
    } catch {
      setFullscreenError("Full screen is unavailable in this browser.");
    }
  }
  const winnerMarkets = markets.filter((item) => item.kind === "match-winner");
  const board = matchWinnerBoard(
    winnerMarkets,
    winnerMarkets.find((item) => item.id === market.id) ??
      winnerMarkets[0] ??
      market,
  );
  const boardOutcome =
    board.outcomes.find((item) => item.id === market.id) ?? board.outcomes[0];
  const intermission =
    match.phase === "countdown" ||
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
  const broadcastContext: BroadcastContext = intermission
    ? {
        state: "BREAK TIME",
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
  return (
    <section className="ch-viewer" aria-label="Highlighted event viewer">
      <div className="ch-view-navigation">
        <div className="ch-match-actions">
          {heading ?? (
            <>
              {!detailHref && (
                <button
                  className="ch-detail-button"
                  onClick={() => setDetail(structuredClone(market))}
                >
                  Match info <ArrowUpRight size={12} />
                </button>
              )}
              {season && (
                <button className="ch-pinned" onClick={onPin}>
                  <Pin size={11} />
                  {pinned ? "Pinned · release" : "Keep highlight"}
                </button>
              )}
            </>
          )}
        </div>
        {!broadcastOnly && (
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
                    <span>{markets.length}</span>
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
                  <>
                    <Radio size={14} /> Livestream
                  </>
                ),
              },
            ]}
          />
        )}
      </div>
      <div className="ch-viewer-body">
        <div className={`ch-screen ${season ? "is-season" : ""}`}>
          <TabPanel
            id="live"
            idPrefix="highlight-view"
            active={view === "live"}
          >
            <div className="sh-broadcast" ref={frame}>
              <BroadcastMedia
                key={`${match.streamUrl ?? "iframe"}:${liveHref}`}
                source={match.streamUrl}
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
                <span className="sh-preview-chip">
                  {intermission
                    ? "NEXT MATCH RESERVED"
                    : match.streamUrl
                      ? "LIVE BROADCAST"
                      : "VIDEO UNAVAILABLE"}
                </span>
                <span>
                  <Eye size={13} />
                  {compact(match.viewers)} watching
                </span>
              </div>
              {!intermission && (
                <div
                  className={`ch-scoreboard ${match.teams.length > 2 ? "is-ffa" : ""}`}
                >
                  {match.teams.map((team, index) => (
                    <div key={team.teamId} style={{ color: team.color }}>
                      <TeamMark id={team.teamId} color={team.color} />
                      <strong>{teamLabel(team.symbol)}</strong>
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
              {intermission ? (
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
                      The room is reserved and the match system is preparing the
                      next round. Prediction sides remain visible at 50:50 until
                      live pricing begins.
                    </p>
                    <strong>{match.roster.length} / 12 AGENTS CONFIRMED</strong>
                  </div>
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
                  <small className="ch-intermission-lock">
                    CHECK THE TRADE PANEL FOR THIS EVENT’S ON-CHAIN CUTOFF
                  </small>
                </div>
              ) : (
                <div className="sh-broadcast-bottom">
                  <div>
                    <span className="sh-map-label">
                      <Crosshair size={14} /> COOLA / GENESIS SERIES
                    </span>
                    <h2>
                      {match.phase === "settled" ? "MATCH COMPLETE" : match.map}
                    </h2>
                    <div className="ch-broadcast-roster">
                      {match.roster.map((entry) => (
                        <span title={entry.codename} key={entry.agentId}>
                          <AgentPortrait
                            number={Number(entry.agentId.split("-")[1])}
                          />
                        </span>
                      ))}
                      <span>
                        {match.roster.length} CAN AGENTS{" "}
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
              <HighlightChart
                sourceLabel={marketSourceLabel}
                simulation={simulation}
                key={board.id}
                market={board}
                snapshot={snapshot}
                outcome={boardOutcome}
                onOutcome={(item) => {
                  const next = winnerMarkets.find(
                    (candidate) => candidate.id === item.id,
                  );
                  const yes =
                    next?.outcomes.find(
                      (candidate) => candidate.id === "yes",
                    ) ?? next?.outcomes[0];
                  if (next && yes) onSelect(next, yes);
                }}
                onMarket={() => {}}
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
                match={match}
                sourceLabel={marketSourceLabel}
                answer={answer}
                key={`${match.id}-${season}`}
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
                    <p>0 predictions · waiting for the prediction feed</p>
                  </div>
                  <span className="ch-simulation">FEED UNAVAILABLE</span>
                </div>
                <div className="ch-market-empty">
                  <strong>No prediction questions yet.</strong>
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
          />
        )}
      </div>
      <dialog
        ref={dialog}
        className="ch-event-dialog"
        onClose={() => setDetail(null)}
        aria-labelledby="event-overview-title"
      >
        {detail && (
          <>
            <div>
              <span className="ch-simulation">SIMULATION</span>
              <button
                aria-label="Close event detail"
                onClick={() => dialog.current?.close()}
              >
                <X size={20} />
              </button>
            </div>
            <h2 id="event-overview-title">{detail.title}</h2>
            <p>{detail.description}</p>
            <h3>Resolution</h3>
            <p>{detail.rules}</p>
            <dl>
              <div>
                <dt>Closes</dt>
                <dd>{new Date(detail.closesAt).toLocaleString("en")}</dd>
              </div>
              <div>
                <dt>Trading</dt>
                <dd>Off-chain sample credits</dd>
              </div>
            </dl>
            {!detail.matchId && (
              <button
                className="sh-button"
                onClick={() => {
                  if (!pinned) onPin();
                  dialog.current?.close();
                }}
              >
                Keep this highlight <Pin size={14} />
              </button>
            )}
            <p className="ch-dialog-note">
              Market overview · off-chain preview credits.
            </p>
          </>
        )}
      </dialog>
    </section>
  );
}
