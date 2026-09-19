import "../../styles/home.css";
import "../../styles/home-markets.css";
import { OverlayLayer } from './alerts/OverlayLayer'
import "../../styles/home-hero.css";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  ChartNoAxesCombined,
  Radio,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createSolzDataSource } from "../solz/solzDataSource";
import type { ArenaMarket, ArenaMarketOutcome, SolzMatch } from "../solz/model";
import { useHomeData } from "./useHomeData";
import { AppShell } from "../solz/AppShell";
import { broadcastBelongsToMatch, MatchViewer } from "./MatchViewer";
import { InteractionConsole, type ConsoleSection } from "./InteractionConsole";
import { CatwalkEntry, LiveMatches, NextMatches, ProgrammeStandings } from "./CommunitySections";
import { useCatwalkBoard } from "../catwalk/useCatwalkBoard";
import { GenesisAgents } from "./GenesisAgents";
import type { PredictionAnswer } from "../solz/predictionContracts";
import {
  matchIdLabel,
  shouldShowSeason,
  type HighlightView,
} from "./heroMarket";
import type { MarketSource, SomniaChain } from "./MarketSourceControls";
import { solanaClusterLabel } from "../../../packages/adapters/solana/cluster";
import { useSomniaMarketPrices } from "./useVenueMarketPrices";
import { useSolanaMarketPrices } from "./useSolanaMarketPrices";
import { questionTradeable, resolveMatchMarkets, useReservedSolanaQuestions } from "./solanaQuestionMarkets";
import { useSolanaVenue } from "./useSolanaVenue";
import { useMiawPrixHighlight } from "./useMiawPrixHighlight";
import { seasonLabel } from "../miawprix/board";

type Props = {
  apiUrl?: string;
  dreamDexApiUrl?: string;
  demoHref: string;
  liveHref: string;
  livestreamUrl?: string;
  eventBasePath: string;
  marketSources: readonly MarketSource[];
};

const BREAK_DURATION_MS = 5 * 60_000;
/** 2XL and up. Narrower than this, the console rail opens Trade only. */
const CONSOLE_BOTH_OPEN = "(min-width: 1536px)";

/** Somnia has no chain switcher on the page any more; this was its default. */
const SOMNIA_CHAIN: SomniaChain = "50312";

export function HomeApp({
  apiUrl = "",
  dreamDexApiUrl = "",
  demoHref,
  liveHref,
  livestreamUrl,
  eventBasePath,
  marketSources,
}: Props) {
  return (
    <>
    {/* Toasts and the alert log, hosted so that a modal trade dialog cannot
        bury them in the top layer. */}
    <OverlayLayer />
    <Home
      apiUrl={apiUrl}
      dreamDexApiUrl={dreamDexApiUrl}
      demoHref={demoHref}
      liveHref={liveHref}
      livestreamUrl={livestreamUrl}
      eventBasePath={eventBasePath}
      marketSources={marketSources}
    />
    </>
  );
}

function Home({
  apiUrl = "",
  dreamDexApiUrl = "",
  demoHref,
  liveHref,
  livestreamUrl,
  eventBasePath,
  marketSources,
}: Props) {
  // The source switcher is gone from the page, so this is a fixed choice now:
  // the strongest venue the deployment configured, Solana first.
  const [marketSource, setMarketSource] = useState<MarketSource>(() =>
    marketSources.includes("SOLANA")
      ? "SOLANA"
      : marketSources.includes("SOMNIA")
        ? "SOMNIA"
        : (marketSources[0] ?? "SIMULATION"),
  );
  // Both venues were reader-toggled. With the switcher gone the Solana label
  // comes from the venue's genesis hash instead, which is the one cluster fact
  // that cannot drift - see packages/adapters/solana/cluster.ts, whose own
  // notes name this toggle as the thing that used to announce a mainnet
  // deployment as devnet. Somnia keeps its previous default.
  const somniaChain: SomniaChain = SOMNIA_CHAIN;
  const source = useMemo(() => createSolzDataSource(), []);
  const { snapshot, referenceSnapshot, error, predictionFeed, predictionFeedSettled, arenaSchedule, retry } =
    useHomeData(source, apiUrl);
  const solanaVenue = useSolanaVenue(apiUrl, marketSources.includes("SOLANA"));
  const reservedQuestions = useReservedSolanaQuestions(apiUrl, solanaVenue, true, snapshot?.matches ?? []);
  const reservedSolana = reservedQuestions.questions;
  // THE HIGHLIGHT IS THE MIAW PRIX PROGRAMME. Agent Colosseum runs the coin
  // fixtures this page is about: two coins per match, one of them wins, and the
  // prediction question is that pairing rather than twelve per-agent questions.
  // The Genesis arena feed below still supplies the rest of the page - the
  // roster, the standings, the live rooms - and stands in for the hero only
  // when the programme has no open card at all.
  const miawPrix = useMiawPrixHighlight("/api/agent-arena", apiUrl);
  // CATWALK IS THE DOOR INTO THE PROGRAMME ABOVE, so the panel that explains it
  // reads the real board rather than describing one.
  //
  // `schedule: false` because this page draws no lock clock, and the schedule
  // read is byte-for-byte the programme read `useMiawPrixHighlight` is already
  // making one line up - asking for it here would double the home page's traffic
  // to the control plane for a fact nothing on this page renders.
  const catwalk = useCatwalkBoard("/api/agent-arena", { schedule: false, pollMs: 60_000 });
  const [matchId, setMatchId] = useState("");
  const [outcomeId, setOutcomeId] = useState("");
  const [view, setView] = useState<HighlightView>("live");
  const [marketId, setMarketId] = useState("");
  const [answer, setAnswer] = useState<PredictionAnswer>("yes");
  const [pinned, setPinned] = useState(false);
  // Live chat and Prompt Agent moved to the stage corners, so the rail holds
  // only these two. Both start open only from 2XL up: below that the rail shares
  // its column height with the ticket, and two open panels pushed Agent Trader's
  // own controls past the fold. Trade is what a viewer came for, so it keeps the
  // room and Agent Trader opens on demand. A lazy initial value is safe here -
  // this island is client:only, so there is no server pass to disagree with.
  const [sections, setSections] = useState<ConsoleSection[]>(() =>
    typeof window !== "undefined" && window.matchMedia?.(CONSOLE_BOTH_OPEN).matches
      ? ["trade", "automate"]
      : ["trade"],
  );
  const [chatOpen, setChatOpen] = useState(false);
  const [promptAgentId, setPromptAgentId] = useState<string | undefined>();
  const [dreamDexRefresh, setDreamDexRefresh] = useState(0);
  const [matchIdCopied, setMatchIdCopied] = useState(false);
  const openSection = (name: ConsoleSection) =>
    setSections((current) =>
      current.includes(name) ? current : [...current, name],
    );
  const [broadcastState, setBroadcastState] = useState<
    "preview" | "intermission" | "preparing" | "live" | "unavailable" | null
  >(null);
  const lastBroadcastMismatch = useRef<string | null>(null);
  const highlight = useRef<HTMLElement>(null);
  const externalFeedPending = Boolean(apiUrl) && !predictionFeed;
  const selectedMatch = snapshot?.matches.find(
    (item) => item.id === (matchId || snapshot.highlightMatchId),
  );
  // A trade reservation is independent from the actual game feed. Never let a
  // stale reservation replace a game the arena is already reporting as live.
  const liveMatch = snapshot?.matches.find((item) => item.phase === "live");
  const arenaMatch = selectedMatch?.phase === "live" ? selectedMatch : liveMatch ?? selectedMatch;
  // A reader who picked a match out of the page keeps it. Otherwise the
  // programme's card is the hero, and the arena room is the fallback.
  const programme = matchId ? undefined : miawPrix.highlight;
  const loadedMatch = programme?.match ?? arenaMatch;
  // Matched on BOTH canonical ids. A Genesis arena question names its event by
  // this site's own `arena-<id>` display identity, while a MIAW PRIX question
  // names the Colosseum matchId that is also the match's id here; one equality
  // cannot answer for both, and the wrong one leaves a live pairing with no
  // tradable market at all.
  const loadedSolanaQuestions = marketSource === "SOLANA" && loadedMatch
    ? reservedSolana.filter(
        (item) =>
          item.question.eventId.toLowerCase() === loadedMatch.id.toLowerCase() ||
          item.question.matchId.toLowerCase() === loadedMatch.id.toLowerCase(),
      )
    : [];
  // The first TRADEABLE question. The catalogue also publishes recently
  // finished ones so a held position can be named, and the highlight is an
  // invitation to trade rather than a record of what is over.
  const reservedSolanaMatch = marketSource === "SOLANA" && !loadedMatch
    ? reservedSolana.find((item) => questionTradeable(item.question))
    : undefined;
  const match: SolzMatch | undefined = loadedMatch ?? reservedSolanaMatch?.match ??
    (externalFeedPending && snapshot
      ? {
          id: "arena-feed-pending",
          kind: "highlight",
          mode: "ARENA",
          map: "GENESIS AGENT ARENA",
          round: "AWAITING FEED",
          phase: "countdown",
          startedAt: snapshot.updatedAt,
          endsAt: snapshot.updatedAt + BREAK_DURATION_MS,
          timingEstimated: true,
          viewers: 0,
          marketId: "arena-feed-pending",
          volume: { SOL: 0, COOLA: 0 },
          teams: [],
          roster: [],
        }
      : loadedMatch);
  const reconcileBroadcastMatch = (broadcastMatchId: string | null) => {
    if (!broadcastMatchId || !match || broadcastBelongsToMatch(broadcastMatchId, match)) {
      lastBroadcastMismatch.current = null;
      return;
    }
    if (lastBroadcastMismatch.current === broadcastMatchId) return;
    // The iframe is already connected to the new server-authoritative room.
    // Refresh once when its immutable match ID differs, rather than letting an
    // older page keep a completed five-minute clock until the user reloads.
    lastBroadcastMismatch.current = broadcastMatchId;
    retry();
  };
  const season = !!(
    snapshot &&
    match &&
    shouldShowSeason(match.phase, match.endsAt, snapshot.updatedAt, pinned)
  );
  // The canonical catalogue is a market SOURCE, not a decoration. Every canonical
  // match is eligible "as soon as its matchId exists" (MARKET_LIST_API.md:73), and
  // the backend composes one linked binary question per participant on demand -
  // which is what makes an FFA field tradable without anyone pre-registering a row
  // for it. The only identity that matters is (matchId, questionId).
  const catalogueMarkets = useMemo(() => {
    if (season) return [];
    if (marketSource === "SOLANA" && loadedSolanaQuestions.length)
      return loadedSolanaQuestions.map((item) => item.market);
    // The programme card's OWN moneyline, when no canonical question carries
    // this pairing yet. It names the two coins and nothing else: it has no
    // venue binding, so the ticket still reports that no market has been
    // opened. That is the truth for a card the catalogue has not listed, and
    // it beats "Prediction questions unavailable" over a fixture the page can
    // name in full.
    return programme ? [programme.market] : [];
  }, [loadedSolanaQuestions, marketSource, programme, season]);
  // Where this match's questions come from, and whether that source is canonical.
  // Keying the ticket off /arena/events alone meant that endpoint being slow,
  // stalled or down took a live match with twelve valid questions to zero
  // tradable markets; resolveMatchMarkets() carries the rule and its reasoning.
  const { markets, canonical } = useMemo(() => {
    if (reservedSolanaMatch)
      return {
        markets: reservedSolana
          .filter((item) => item.match.id === reservedSolanaMatch.match.id)
          .map((item) => item.market),
        canonical: true,
      };
    return resolveMatchMarkets(
      externalFeedPending
        ? []
        : (snapshot?.markets.filter((item) =>
            season ? !item.matchId : item.matchId === match?.id,
          ) ?? []),
      catalogueMarkets,
    );
  }, [
    catalogueMarkets,
    externalFeedPending,
    match?.id,
    reservedSolana,
    reservedSolanaMatch,
    season,
    snapshot?.markets,
  ]);
  // The arena feed builds its markets in predictionArena.marketsFor(), which has
  // no onchain field at all, and the Solana-bound markets from reservedSolanaView
  // were only ever used when NO match was loaded. So whenever the arena feed was
  // healthy every rendered market carried no venue binding: venueBinding() returned
  // null, the order book showed nothing and the ticket said "Market not created
  // yet" however many trades had settled on chain.
  //
  // loadedSolanaQuestions already resolves the right questions for the loaded
  // match - it drives the trade ticket and the status line - so merge its binding
  // onto whatever markets are being rendered. Matching mirrors selectedSolanaQuestion
  // exactly (canonical questionId first, then the "will <agent> win?" label) so the
  // book, the ticket and the status can never disagree about which question a market is.
  //
  // Those questions are now a market source in their own right (catalogueMarkets
  // above), so this pass only has real work to do for feed-sourced rows; a
  // catalogue-sourced market finds itself here and keeps the binding it was born
  // with.
  const solanaBoundMarkets = useMemo(() => {
    if (marketSource !== "SOLANA" || !loadedSolanaQuestions.length) return markets;
    return markets.map((item) => {
      const bound =
        loadedSolanaQuestions.find(
          (entry) => entry.question.questionId.toLowerCase() === item.id.toLowerCase(),
        ) ??
        loadedSolanaQuestions.find((entry) => {
          const participantId = item.outcomes[0]?.participantId;
          return (
            Boolean(participantId) &&
            entry.question.label.toLowerCase() === `will ${participantId!.toLowerCase()} win?`
          );
        });
      return bound?.market.onchain ? { ...item, onchain: bound.market.onchain } : item;
    });
  }, [markets, loadedSolanaQuestions, marketSource]);
  const predictionMarkets = useMemo(
    // `canonical` covers both catalogue paths. Those markets were built from the
    // two canonical IDs and already carry their venue binding, so an arena-feed
    // flag describing a different source must never blank them.
    () => (predictionFeed || !apiUrl || canonical ? solanaBoundMarkets : []),
    [apiUrl, solanaBoundMarkets, predictionFeed, canonical],
  );
  const somnia = useSomniaMarketPrices(
    dreamDexApiUrl || apiUrl,
    somniaChain,
    predictionMarkets,
    marketSource === "SOMNIA",
    dreamDexRefresh,
  );
  // One pricing producer for the whole page, batching every Solana question's
  // books into two account reads. It calls unpricedMarkets itself, so the arena
  // feed's simulated probabilities are still blanked before chain data lands.
  const solana = useSolanaMarketPrices(
    predictionMarkets,
    solanaVenue,
    marketSource === "SOLANA",
    marketId,
  );
  const sourcedMarkets =
    marketSource === "SOMNIA"
      ? somnia.markets
      : marketSource === "SOLANA"
        ? solana.markets
        : predictionMarkets;
  // Same rule as MatchViewer: a live broadcast settles it, because a stored
  // slot can still read `countdown` after the room has actually started. This
  // flag blanks prices and closes the prompt composer, so a stale `countdown`
  // used to mute a match that viewers could already see being played.
  const preparingMatch =
    broadcastState === "live"
      ? false
      : match?.phase === "countdown" ||
        broadcastState === "preview" ||
        broadcastState === "intermission" ||
        broadcastState === "preparing";
  const activeMarkets = useMemo(
    () =>
      preparingMatch
        ? sourcedMarkets.map((item) =>
            // Per market, not wholesale. The pre-game placeholder is for
            // markets with nothing behind them; blanking one that carries a
            // real venue series reads to a trader as the market having moved
            // back to 50/50 between rounds.
            item.outcomes.some(
              (entry) =>
                (entry.quoteHistory?.length ?? 0) > 0 ||
                (entry.priceHistory?.length ?? 0) > 0,
            )
              ? item
              : {
                  ...item,
                  outcomes: item.outcomes.map((entry) => ({
                    ...entry,
                    probability: 0.5,
                    priceHistory: [],
                  })),
                },
          )
        : sourcedMarkets,
    [preparingMatch, sourcedMarkets],
  );
  const market =
    activeMarkets.find((item) => item.id === marketId) ?? activeMarkets[0];
  const selectedSolanaQuestion = marketSource === "SOLANA" && market
    ? loadedSolanaQuestions.find(
        (item) =>
          item.question.questionId.toLowerCase() === market.id.toLowerCase(),
      )?.question ?? loadedSolanaQuestions.find((item) => {
        const participantId = market.outcomes[0]?.participantId;
        return Boolean(participantId) && item.question.label.toLowerCase() === `will ${participantId!.toLowerCase()} win?`;
      })?.question
    : undefined;
  const outcome =
    market?.outcomes.find((item) => item.id === outcomeId) ??
    market?.outcomes[0];
  const simulationEnabled = marketSource === "SIMULATION";
  const sourceLabel =
    marketSource === "SIMULATION"
      ? "LOCAL SIMULATION"
      : marketSource === "SOLANA"
        ? `SOLANA ${solanaClusterLabel(solanaVenue?.chainId)}`
        : `SOMNIA ${somniaChain === "50312" ? "TESTNET" : "MAINNET"}`;
  const promptWarning = !simulationEnabled
    ? somniaChain === "5031" && marketSource === "SOMNIA"
      ? "Mainnet selected. The live prompt relay is not integrated yet."
      : "Agent directives open when the relay is configured and a match is live."
    : undefined;
  const collateralSymbol =
    marketSource === "SOMNIA"
      ? somniaChain === "50312"
        ? "tUSDC"
        : "USDso"
      : marketSource === "SOLANA"
        ? (solanaVenue?.collateralSymbol ?? "USDC")
        : "COOLA";
  const shellMarket: ArenaMarket | undefined = match
    ? {
        id: `${match.id}:prediction-feed`,
        matchId: match.id,
        kind: "match-winner",
        title: "Prediction questions unavailable",
        description:
          "The arena remains available while its independent prediction feed reconnects.",
        status: "indicative",
        closesAt: match.endsAt,
        volume: { SOL: 0, COOLA: 0 },
        rules: "No market is available until the prediction feed returns.",
        outcomes: [
          {
            id: "unavailable",
            label: "AWAITING FEED",
            detail: "No prediction price is available.",
            probability: 0,
            priceHistory: [],
          },
        ],
      }
    : undefined;
  const displayedMarket = market ?? shellMarket;
  const displayedOutcome = outcome ?? shellMarket?.outcomes[0];
  const marketAvailable = Boolean(market && outcome && activeMarkets.length);
  /**
   * The question sources are still answering, so any count taken from them now
   * is provisional.
   *
   * Deliberately NOT `externalFeedPending`: that stays true for as long as the
   * prediction backend is down, and a "still loading" badge that never clears
   * is the same lie in a different shape. These two flags flip once the
   * request has been MADE, whatever it came back with.
   */
  const sourcesAnswered =
    Boolean(snapshot) &&
    predictionFeedSettled &&
    (marketSource !== "SOLANA" || reservedQuestions.loaded);
  /**
   * Latched per match, because "pending" has to mean ONE thing.
   *
   * Both flags above go false again on a later pass - the catalogue re-polls,
   * the arena refreshes on its schedule boundary - and a badge that drops back
   * to an ellipsis every few seconds over a count it has already published is
   * its own wrong answer: it reads as the page losing the questions it is
   * visibly showing. So this says "no answer yet FOR THIS MATCH", and once an
   * answer lands it stays answered until the match changes.
   */
  const answeredMatch = useRef<string | null>(null);
  if (sourcesAnswered && match?.id) answeredMatch.current = match.id;
  const marketsPending =
    !sourcesAnswered && (!match?.id || answeredMatch.current !== match.id);
  const watchMatches = useMemo(
    () => ({
      matches: (snapshot?.matches ?? [])
        .filter(
          (item) =>
            item.roomId &&
            (item.phase === "live" || item.phase === "countdown"),
        )
        .map((item) => ({
          id:
            matchIdLabel(item) === "MATCH —"
              ? item.roomId!
              : matchIdLabel(item),
          region: "Configured arena" as const,
          phase:
            item.phase === "live" ? ("live" as const) : ("countdown" as const),
          mode: item.mode,
          players: item.roster.length,
          // A catalog-backed room's roster is the signed, fully funded field;
          // retaining the retired twelve-player capacity would misstate 3v3.
          capacity: Math.max(1, item.roster.length),
          spectators: item.viewers,
          startedAt: item.startedAt,
          watchUrl: liveHref,
        })),
      loading: !snapshot,
      error: "",
    }),
    [liveHref, snapshot],
  );
  const toHighlight = () =>
    highlight.current?.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
  const selectPrediction = (
    nextMarket: ArenaMarket,
    nextOutcome: ArenaMarketOutcome,
    nextAnswer: PredictionAnswer = "yes",
  ) => {
    setMarketId(nextMarket.id);
    setOutcomeId(nextOutcome.id);
    setAnswer(nextAnswer);
    openSection("trade");
  };
  const chooseFeature = (
    feature: "watch" | "trade" | "automate" | "prompt" | "track",
  ) => {
    if (feature === "watch") setView("live");
    else if (feature === "track") setView("market");
    // The prompt composer lives in the stage's bottom-right corner now, and
    // that corner only exists on the livestream tab.
    else if (feature === "prompt") setView("live");
    else openSection(feature);
    toHighlight();
  };
  const matchCode = match?.id.split("-")[1] ?? "07";
  const copyMatchId = () =>
    void navigator.clipboard
      .writeText(match?.id ?? matchCode)
      .then(() => {
        setMatchIdCopied(true);
        window.setTimeout(() => setMatchIdCopied(false), 1_600);
      })
      .catch(() => setMatchIdCopied(false));

  useEffect(() => {
    if (!marketSources.includes(marketSource))
      setMarketSource(marketSources[0] ?? "SIMULATION");
  }, [marketSource, marketSources]);

  // Mirrored for the arena iframe, which reads this key to keep its own clock
  // in step. It used to hang off the match heading; the heading is gone but the
  // contract with the arena is not.
  const displayMatchId = match?.displayMatchId;
  const matchPhase = match?.phase;
  const matchStartedAt = match?.startedAt;
  const matchEndsAt = match?.endsAt;
  const matchKey = match?.id;
  useEffect(() => {
    if (!matchKey) return;
    try {
      window.localStorage.setItem(
        "solz:arena:match-clock",
        JSON.stringify({
          matchId: matchKey,
          displayMatchId,
          phase: matchPhase,
          startedAt: matchStartedAt,
          endsAt: matchEndsAt,
          savedAt: Date.now(),
        }),
      );
    } catch {
      // The live feed remains authoritative when storage is unavailable.
    }
  }, [displayMatchId, matchEndsAt, matchKey, matchPhase, matchStartedAt]);

  return (
    <AppShell
      className="solz-home ch-home"
      mainClassName="sh-main"
      marketsHref="/markets"
      active={view === "market" ? "markets" : "highlight"}
      onArena={() => setView("live")}
      skipTo="#highlight"
      skipLabel="Skip to the arena"
    >
        <NextMatches
          snapshot={snapshot}
          schedule={arenaSchedule}
          programme={miawPrix.upcoming}
          {...(miawPrix.season
            // Only when the programme has actually named a season. MIAW PRIX
            // opens at SEASON 00, while seasonLabel(null) is "NO SEASON" -
            // not a thing to print over the Genesis arena fallback.
            ? { seasonName: seasonLabel(miawPrix.season) }
            : {})}
          eventBasePath={eventBasePath}
          highlight={match}
          season={season}
          matchIdCopied={matchIdCopied}
          onCopyMatchId={copyMatchId}
        />
        <section
          className="sh-highlight-section"
          ref={highlight}
          id="highlight"
        >
          {snapshot && match && displayedMarket && displayedOutcome ? (
            <>
              <div className="ch-hero-grid" id="network-trading-panel">
                <MatchViewer
                  onBroadcastState={setBroadcastState}
                  onBroadcastMatchId={reconcileBroadcastMatch}
                  marketSourceLabel={sourceLabel}
                  collateralSymbol={collateralSymbol}
                  referenceMarkets={
                    marketAvailable ? referenceSnapshot?.markets : undefined
                  }
                  simulation={simulationEnabled}
                  answer={answer}
                  match={match}
                  market={displayedMarket}
                  markets={activeMarkets}
                  marketsPending={marketsPending}
                  snapshot={snapshot}
                  source={source}
                  view={view}
                  // Both stage plates belong to the livestream tab. The
                  // composer unmounts with the panel; the chat field's open
                  // flag lives here, so it is closed explicitly - otherwise it
                  // reopened by itself on the way back.
                  onView={(next) => {
                    setView(next);
                    if (next !== "live") setChatOpen(false);
                  }}
                  outcome={displayedOutcome}
                  onSelect={selectPrediction}
                  liveHref={liveHref}
                  livestreamUrl={livestreamUrl}
                  onChat={() => {
                    setView("live");
                    setChatOpen(true);
                  }}
                  onPrompt={() => setView("live")}
                  promptAgentId={promptAgentId}
                  promptWarning={promptWarning}
                  chatOpen={chatOpen}
                  onChatClose={() => setChatOpen(false)}
                  season={season}
                />
                <InteractionConsole
                  automationWarning={
                    marketSource === "SOMNIA"
                      ? "Somnia automation is unavailable: BotKit and Hermes Agent are not integrated yet."
                      : undefined
                  }
                  solana={marketSource === "SOLANA"}
                  solanaVenue={solanaVenue}
                  solanaQuestion={selectedSolanaQuestion}
                  predictionApiUrl={apiUrl}
                  collateralSymbol={collateralSymbol}
                  dreamDexApiUrl={dreamDexApiUrl || apiUrl}
                  onDreamDexOpened={() =>
                    setDreamDexRefresh((value) => value + 1)
                  }
                  marketAvailable={marketAvailable}
                  key={`${match.id}:${marketSource}:${solanaVenue?.chainId ?? ""}:${somniaChain}`}
                  source={source}
                  snapshot={snapshot}
                  match={match}
                  market={displayedMarket}
                  outcome={displayedOutcome}
                  onOutcome={(next) => {
                    setOutcomeId(next.id);
                    setAnswer("yes");
                  }}
                  answer={answer}
                  onAnswer={setAnswer}
                  simulation={simulationEnabled}
                  sections={sections}
                  onSections={setSections}
                  hideChat
                  hidePrompt
                  intermission={preparingMatch || season}
                />
              </div>
            </>
          ) : error ? (
            // The match identity lives in the UP NEXT rail above now, so these
            // two states are the state alone.
            <div className="sh-load-state" role="alert">
              <h2>The arena couldn’t load.</h2>
              <p>{error}</p>
              <button className="sh-button" onClick={retry}>
                Try again
              </button>
            </div>
          ) : (
            <div className="sh-loading" role="status">
              <div />
              <div />
              <span>Loading the arena…</span>
            </div>
          )}
        </section>
        {/* NOTHING BELOW WAITS ON THE ARENA SNAPSHOT.
            Every section under the hero used to be inside `{snapshot && ...}`,
            so the SLOWEST read on the page - the arena overview plus its
            schedule, 8-22s on a cold control plane - held back a static
            explainer strip, the live-room list on its own feed, and the two
            panels below, which read the MIAW PRIX programme and the CATWALK
            board and have nothing to do with the arena at all. The page then
            showed one sentence for twenty seconds with the whole site under it
            blank. Each part now arrives on its own read, and draws its own
            loading state in its own frame. Only GenesisAgents genuinely needs
            the snapshot - the roster IS the snapshot - so only it is gated. */}
        <section className="ch-guide" aria-labelledby="arena-guide-title">
            <div className="ch-guide-heading">
              <h2 id="arena-guide-title">Find your way in the arena.</h2>
              <p>Watch the action. Choose how you take part.</p>
            </div>
            <div className="sh-how-strip">
              {(
                [
                  {
                    id: "watch",
                    icon: <Radio />,
                    title: "Watch",
                    description: "Autonomous agents. Live competition.",
                  },
                  {
                    id: "trade",
                    icon: <ArrowUpRight />,
                    title: "Trade",
                    description: "Take a position on the outcome.",
                  },
                  {
                    id: "automate",
                    icon: <Bot />,
                    title: "Automate",
                    description: "Your strategy. An agent on execution.",
                  },
                  {
                    id: "prompt",
                    icon: <Zap />,
                    title: "Prompt",
                    description: "Send a directive. Change the game.",
                  },
                  {
                    id: "track",
                    icon: <ChartNoAxesCombined />,
                    title: "Track",
                    description: "Every price move. Every play.",
                  },
                ] as const
              ).map((feature) => (
                <button
                  key={feature.id}
                  onClick={() => chooseFeature(feature.id)}
                >
                  {feature.icon}
                  <span>
                    <strong>{feature.title}</strong>
                    <small>{feature.description}</small>
                  </span>
                  <ArrowUpRight className="sh-how-arrow" size={13} />
                </button>
              ))}
            </div>
        </section>
        <LiveMatches feed={watchMatches} watchHref={liveHref} />
        <div className="sh-community-grid">
          <ProgrammeStandings
            board={miawPrix.board}
            loading={!miawPrix.loaded}
            refreshing={miawPrix.refreshing}
          />
          <CatwalkEntry feed={catwalk} />
        </div>
        {snapshot && (
          <>
            <GenesisAgents
              snapshot={snapshot}
              onPrompt={(agentId) => {
                const nextMatch = snapshot.matches.find(
                  (item) =>
                    item.phase === "live" &&
                    item.roster.some((entry) => entry.agentId === agentId),
                );
                if (nextMatch) {
                  setPinned(false);
                  setAnswer("yes");
                  setMarketId("");
                  setMatchId(nextMatch.id);
                  setOutcomeId("");
                  setPromptAgentId(agentId);
                  // The prompt composer is the stage's bottom-right corner,
                  // which only exists on the livestream tab. PromptComposer
                  // focuses its field when promptAgentId names a roster agent.
                  setView("live");
                  toHighlight();
                }
              }}
            />
          </>
        )}
        <div className="sh-bottom-callout">
          <span>THE NEXT MOVE IS YOURS.</span>
          <a href={demoHref}>
            Enter the demo <ArrowRight size={18} />
          </a>
        </div>
    </AppShell>
  );
}
