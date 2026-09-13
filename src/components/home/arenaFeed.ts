import { arenaAdapter, parseAgents, parseMatch } from "../agent-arena/adapter";
import {
  emptyFilters,
  type ArenaAgent,
  type ArenaMatch,
} from "../agent-arena/model";
import { predictionUrl } from "../../../packages/sdk/prediction-url";

export interface ArenaFeed {
  agents: ArenaAgent[];
  current: ArenaMatch | null;
  matches: ArenaMatch[];
  historyError: string | null;
  readAt: number;
}

/**
 * The Genesis arena is a fixed twelve-agent channel. Older game responses for
 * a reserved or live room omit the participant projection even though that
 * fixed channel already contains every Genesis agent. Keep this reconstruction
 * confined to the documented twelve-agent Genesis channel.
 */
function reservedGenesisRoster(
  match: ArenaMatch,
  agents: ArenaAgent[],
  policy: unknown,
): ArenaMatch {
  const participantCount = (policy as { participants?: unknown } | undefined)
    ?.participants;
  if (
    !["reserved", "live"].includes(match.status) ||
    match.participants.length ||
    participantCount !== 12 ||
    agents.length !== 12
  )
    return match;
  return {
    ...match,
    participants: agents.map((agent) => ({
      agentId: agent.agentId,
      actorId: `server-bot-0-${agent.slot}`,
      teamId: null,
      kills: null,
      deaths: null,
      won: null,
    })),
  };
}

function withMatchPolicy(match: ArenaMatch, policy: unknown): ArenaMatch {
  const duration = Number(
    (policy as { matchDurationMs?: unknown } | undefined)?.matchDurationMs,
  );
  if (!Number.isFinite(duration) || duration <= 0) return match;
  return { ...match, matchDurationMs: duration, timingType: "countdown" };
}

export function createArenaFeed(
  endpoint: string,
  fetcher: (
    input: string | URL,
    init?: RequestInit,
  ) => Promise<Response> = fetch,
  predictionApiUrl = "",
  currentOnly = false,
) {
  const api = arenaAdapter(endpoint, fetcher);
  return async (signal: AbortSignal): Promise<ArenaFeed> => {
    if (predictionApiUrl) {
      const response = await fetcher(
        predictionUrl("/arena/feed", predictionApiUrl),
        { signal, headers: { accept: "application/json" } },
      );
      if (!response.ok)
        throw Error(
          `Prediction match feed could not load (${response.status}).`,
        );
      const feed = await response.json();
      const agents = parseAgents(feed);
      if (!Array.isArray(feed.matches))
        throw Error("Invalid prediction match feed.");
      const current = feed.current
        ? withMatchPolicy(parseMatch(feed.current, agents), feed.policy)
        : null;
      const matches = feed.matches
        .map((m: unknown) => parseMatch(m, agents))
        .map((item: ArenaMatch) =>
          current?.roomId === item.roomId ? { ...item, ...current } : item,
        );
      return {
        agents,
        current,
        matches,
        historyError: null,
        readAt: Date.now(),
      };
    }
    const [agents, current] = await Promise.all([
      api.agents(signal),
      api.current(signal),
    ]);
    const match = current.match
      ? withMatchPolicy(
          reservedGenesisRoster(
            parseMatch(current.match, agents),
            agents,
            current.policy,
          ),
          current.policy,
        )
      : null;
    if (currentOnly)
      return {
        agents,
        current: match,
        matches: match ? [match] : [],
        historyError: null,
        readAt: Date.now(),
      };
    let matches: ArenaMatch[] = [],
      historyError: string | null = null;
    try {
      matches = (await api.matches(agents, emptyFilters, signal)).matches;
    } catch (e) {
      if (signal.aborted) throw e;
      historyError = "Match history could not refresh.";
    }
    // A game API may temporarily fail the paginated history route while its
    // current-match route remains healthy. The hero must still show that real
    // reserved/live room instead of dropping back to sample matches.
    if (match) {
      const currentIndex = matches.findIndex(
        (item) => item.roomId === match.roomId,
      );
      if (currentIndex >= 0)
        matches[currentIndex] = { ...matches[currentIndex]!, ...match };
      else matches.unshift(match);
    }
    return {
      agents,
      current: match,
      matches,
      historyError,
      readAt: Date.now(),
    };
  };
}

/** A profile is not evidence of entry. Only saved participation creates a match question. */
export function matchQuestions(match: ArenaMatch, agents: ArenaAgent[]) {
  return match.participants.map((p) => ({
    id: `arena-${match.roomId}-winner-${p.agentId}`,
    subjectId: p.actorId,
    agentId: p.agentId,
    label: `Will ${agents.find((a) => a.agentId === p.agentId)?.codename ?? p.agentId} win?`,
    answer:
      match.status === "cancelled"
        ? "VOID"
        : match.status === "settled" && p.won !== null
          ? p.won
            ? "YES"
            : "NO"
          : null,
  }));
}

/** Read-only event drafts derived from the authoritative current game room.
 * They let the hero render the real twelve YES/NO questions while the separate
 * prediction importer is unavailable; no market, order, or collateral action
 * is enabled by this fallback. */
export function currentMatchDrafts(feed: ArenaFeed) {
  const match = feed.current;
  if (!match) return { events: [] };
  return {
    events: [
      {
        eventId: match.matchId
          ? `arena-${match.matchId.slice(2)}`
          : `arena-${match.roomId}`,
        matchId: match.matchId ?? match.roomId,
        roomId: match.roomId,
        status: match.status,
        questions: matchQuestions(match, feed.agents).map((question) => ({
          questionId: `winner-${question.agentId}`,
          agentId: question.agentId,
          actorId: question.subjectId,
          answer: question.answer,
        })),
      },
    ],
  };
}

export function tradingCollateral(
  network: "SOLANA" | "SOMNIA",
  chainId: string,
) {
  return network === "SOLANA" ? "fUSDC" : chainId === "5031" ? "USDso" : "tUSDC";
}
