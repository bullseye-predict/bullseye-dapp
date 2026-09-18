import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Square, Zap } from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import type { ArenaMarket } from "../solz/model";
import type { PublicPredictionVenue } from "../../../packages/prediction-core/market-data";
import { getPredictionConfig } from "../../../packages/sdk/PredictionTradingClient";
import { predictionUrl } from "../../../packages/sdk/prediction-url";
import { vaultAddress } from "../../../packages/adapters/solana/wire";
import { connectSolanaTradingWallet, type TradingWallet } from "../prediction/wallets";
import { useSolanaWallet } from "../session/store";
import { venueBinding } from "./venue/useVenueMarket";
import { cachedQuestionMarketAddress } from "../solz/questionMarketPda";
import { parseReservedSolanaQuestions, type ReservedSolanaQuestion } from "./solanaQuestionMarkets";

/**
 * WHY HERMES AND NOT THE RULE FORM BESIDE IT.
 *
 * The simulated Agent Trader arms a threshold rule against the sample account:
 * "buy YES below 40%". That is a toy, and on a live network it was replaced by
 * a single sentence saying automation was not integrated - a panel with a title
 * and nothing to do.
 *
 * Hermes is the real thing and it already exists in this repo: a worker that
 * reads a market and trades it inside limits authorized on the trader's own
 * prediction vault. It takes an INSTRUCTION, not a threshold, which is what
 * makes it worth arming once instead of watching every card in the programme.
 *
 * Two facts about it drive this whole component, and both are stated on screen
 * rather than implied:
 *
 * 1. THE STRATEGY TEXT CANNOT RAISE THE LIMITS. The vault session sets what the
 *    agent may spend; the prompt only decides what it does inside that. So the
 *    balance shown here is the vault's, never the wallet's, and it is labelled
 *    as the agent's spending limit rather than as "your balance".
 * 2. THE CONTROL PLANE IS SEPARATE FROM THE FEED. `/hermes/*` is served by the
 *    full prediction API (apps/api/server.ts in solz-prediction-backend), not
 *    by the stake-mode API that serves this page's questions. A deployment can
 *    therefore answer every market read on this page and still have no Hermes
 *    at all - which answers 404, not 503. Both are reported as themselves.
 */

type HermesState = {
  state: string;
  marketId?: string;
  updatedAt?: number;
  reasonCode?: string;
};

/** What each stop reason means for the trader, in their terms. */
const REASONS: Record<string, string> = {
  CONFIGURE_VAULT:
    "Authorize a prediction vault session before the agent can trade. The session sets its spending limit.",
  ACCOUNTING_UNAVAILABLE:
    "The agent is waiting for its complete position cost and loss history.",
  PENDING_RECONCILIATION:
    "A previous transaction needs confirmation before the agent can continue.",
  SESSION_POLICY_CHANGED:
    "Vault permissions changed. Review the authorized session limits before restarting.",
  WORKER_RESTART:
    "The agent stopped after a worker restart. Review outstanding orders before restarting.",
  INFRASTRUCTURE_UNAVAILABLE:
    "The agent worker or its reasoning service is unavailable.",
};

const RUNNING = ["RUNNING", "START_REQUESTED", "STOPPING"];

/** A canonical match id and a canonical question id share this shape. */
const CANONICAL_ID = /^0x[0-9a-f]{64}$/i;

const marketAddress = (value: string) => {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
};

/**
 * Turns what the trader typed into the ONE market Hermes can be armed on.
 *
 * A market address needs nothing. A match id does: a match carries a question
 * per agent, so it names several markets and the trader has to say which. The
 * catalogue is read here, on submit, rather than polled: this is one round trip
 * on an explicit action, and the panel is idle the rest of the time.
 */
export async function resolveAgentTarget(
  typed: string,
  apiUrl: string,
  programId: string | undefined,
  fetchQuestions: () => Promise<unknown> = async () => {
    const response = await fetch(predictionUrl("/solana/questions", apiUrl), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok)
      throw new Error("The question catalogue is unavailable, so that id cannot be resolved.");
    return (await response.json().catch(() => null)) as unknown;
  },
): Promise<string> {
  const value = typed.trim();
  if (marketAddress(value)) return value;
  if (!CANONICAL_ID.test(value))
    throw new Error(
      "Enter a match id or question id (0x and 64 hex characters), or a market address.",
    );
  const questions = parseReservedSolanaQuestions(await fetchQuestions());
  const program = programId ? new PublicKey(programId) : undefined;
  const address = (question: ReservedSolanaQuestion) =>
    question.marketId ||
    (program ? cachedQuestionMarketAddress(program, question.matchId, question.questionId) : "");
  const wanted = value.toLowerCase();
  const byQuestion = questions.filter((item) => item.questionId.toLowerCase() === wanted);
  const matched = byQuestion.length
    ? byQuestion
    : questions.filter((item) => item.matchId.toLowerCase() === wanted);
  if (!matched.length)
    throw new Error(`No question on this deployment carries the id ${value}.`);
  if (matched.length > 1)
    throw new Error(
      `That match carries ${matched.length} questions, so it does not name one market. Arm one by its market address: ${matched
        .map((item) => `${item.label} — ${address(item)}`)
        .join(" · ")}`,
    );
  const resolved = address(matched[0]!);
  if (!resolved)
    throw new Error(
      "That question has no market address yet. Open it from the trade ticket first, then instruct the agent.",
    );
  return resolved;
}

const shortAddress = (value: string) =>
  value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;

const formatAtoms = (value: bigint, decimals: number) => {
  const unit = 10n ** BigInt(decimals);
  const whole = value / unit;
  const fraction = (value % unit).toString().padStart(decimals, "0").slice(0, 2);
  return `${whole.toLocaleString("en-US")}.${fraction}`;
};

type Props = {
  market: ArenaMarket;
  collateralSymbol: string;
  venue?: PublicPredictionVenue | null;
  apiUrl: string;
  /** Trading is closed on this question, so nothing may be armed against it. */
  closed?: boolean;
};

export function AgentTrader({
  market,
  collateralSymbol,
  venue,
  apiUrl,
  closed = false,
}: Props) {
  const wallet = useSolanaWallet();
  const [prompt, setPrompt] = useState("");
  /** Blank means the question on screen. */
  const [target, setTarget] = useState("");
  const [status, setStatus] = useState<HermesState | null>(null);
  const [balance, setBalance] = useState<{ available: bigint; reserved: bigint } | null>(null);
  const [unavailable, setUnavailable] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const session = useRef<TradingWallet | null>(null);
  useEffect(() => () => session.current?.dispose(), []);
  // A wallet change invalidates a session signed by the previous one.
  useEffect(() => {
    session.current?.dispose();
    session.current = null;
  }, [wallet]);

  const binding = venueBinding(market);
  const onchainMarketId =
    binding?.family === "SOLANA" ? binding.marketId : undefined;

  /** The agent's own account: the prediction vault this wallet owns, which is
   *  the account Hermes trades and the account its limits are set on. */
  const vault = useMemo(() => {
    if (!wallet?.address || !venue?.programId) return "";
    try {
      return vaultAddress(venue.programId, wallet.address).toBase58();
    } catch {
      return "";
    }
  }, [wallet?.address, venue?.programId]);

  const decimals = venue?.collateralDecimals ?? 6;

  useEffect(() => {
    if (!apiUrl || !vault) {
      setStatus(null);
      setBalance(null);
      setUnavailable("");
      return;
    }
    let active = true;
    let timer: number | undefined;
    const read = async () => {
      try {
        const response = await fetch(
          predictionUrl(`/users/${encodeURIComponent(vault)}/hermes`, apiUrl),
          { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) },
        );
        if (!active) return;
        // 404 and 503 are DIFFERENT deployments, not one generic outage, and a
        // trader can act on the difference: 503 is a worker to start, 404 is an
        // API that does not carry Hermes at all.
        if (response.status === 404) {
          setUnavailable(
            "This prediction deployment serves market data only — it carries no agent control plane, so nothing can be armed here yet.",
          );
          setStatus(null);
        } else if (response.status === 503) {
          setUnavailable(
            "The agent worker is not configured on this deployment. It needs an authorized vault session and a reasoning service.",
          );
          setStatus(null);
        } else if (response.ok) {
          setUnavailable("");
          setStatus((await response.json()) as HermesState);
        }
      } catch {
        // Keep the last verified state through a transient outage rather than
        // flashing an error over a running agent.
      }
      if (!active) return;
      try {
        const response = await fetch(
          predictionUrl(`/users/${encodeURIComponent(vault)}/balance`, apiUrl),
          { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) },
        );
        if (!active) return;
        if (response.ok) {
          const value = (await response.json()) as { available: string; reserved: string };
          setBalance({
            available: BigInt(value.available ?? 0),
            reserved: BigInt(value.reserved ?? 0),
          });
        } else setBalance(null);
      } catch {
        /* The balance is a caption, never a gate. */
      }
      if (active) timer = window.setTimeout(() => void read(), 10_000);
    };
    void read();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [apiUrl, vault]);

  const running = Boolean(status && RUNNING.includes(status.state));

  const command = async (start: boolean) => {
    setBusy(true);
    setError("");
    try {
      if (!wallet) throw new Error("Connect your Solana wallet to instruct the agent.");
      if (!venue) throw new Error("The prediction venue is unavailable.");
      // Blank targets the question on screen; a typed id targets that one, so a
      // trader can arm a match they are not currently looking at.
      const marketId = start
        ? target.trim()
          ? await resolveAgentTarget(target, apiUrl, venue.programId)
          : onchainMarketId
        : undefined;
      if (start && !marketId)
        throw new Error(
          "This question has no Manifest market yet. Open it from the trade ticket first, or paste the match id of the one you want.",
        );
      const { audience } = await getPredictionConfig(apiUrl);
      // Reconnected per command on purpose: the signed session is short lived,
      // and holding one open across an idle panel is a signature the trader
      // gave for work that never happened.
      session.current?.dispose();
      const connected = await connectSolanaTradingWallet(venue, apiUrl, audience, wallet);
      session.current = connected;
      if (start) await connected.client.startHermes(marketId!, prompt.trim());
      else await connected.client.stopHermes();
      setStatus(await connected.client.getHermesStatus());
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "The agent could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  };

  // `closed` describes the question on screen. A typed target is a different
  // question, so it is gated by its own market, not by this one.
  const blocked = (closed && !target.trim()) || !!unavailable || !wallet;
  return (
    <div className="ch-agent-trader">
      <p className="sh-console-intro">
        Tired of catching every card yourself? Write the instruction once and the
        agent watches the question and trades it for you. It arms the question on
        screen unless you name another match above it.
      </p>
      {/* TWO TOKENS, SAID APART. $COLACAT is what a directive costs - it is the
          agent's fuel, the same claim /colacat makes. The collateral below is
          what the agent then trades inside the vault. Printing only one of them
          is how a trader arrives at the button expecting the wrong balance. */}
      <p className="sh-form-note">
        Running an agent costs <b>$COLACAT</b>. Every directive you send is paid
        in it, and the agent needs it to keep the run alive; the position itself
        is traded in {collateralSymbol} from the vault below.{" "}
        <a href="/colacat">What $COLACAT is</a>
      </p>
      {unavailable && (
        <p className="ch-integration-warning" role="note">
          {unavailable}
        </p>
      )}
      <form
        className="sh-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void command(true);
        }}
      >
        <label>
          MATCH ID (OPTIONAL)
          <input
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            disabled={busy || running}
            spellCheck={false}
            placeholder={
              onchainMarketId
                ? `Blank arms this question · ${shortAddress(onchainMarketId)}`
                : "Paste a match id, question id or market address"
            }
          />
        </label>
        <label>
          TRADING INSTRUCTIONS
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={8000}
            rows={4}
            disabled={busy || running}
            placeholder="Describe which side to buy and when to trade or hold. For example: buy YES with USDC under 45c, scale out above 70c, and never hold through the horn."
          />
        </label>
        <p className="sh-form-note">
          {prompt.trim().length}/8000 · Name the side and the token in the
          instruction itself. It decides what the agent does inside its
          authorized limits; it cannot raise them.
        </p>
        <div className="ch-agent-trader__actions">
          <button
            className="sh-button sh-button--black"
            disabled={busy || running || blocked || !prompt.trim()}
          >
            Instruct agent <Zap size={15} />
          </button>
          <button
            type="button"
            className="sh-button"
            disabled={busy || !running}
            onClick={() => void command(false)}
          >
            Stop &amp; cancel orders <Square size={14} />
          </button>
        </div>
      </form>
      <dl className="ch-agent-balance">
        <div>
          <dt>
            <Bot size={13} /> Agent account
          </dt>
          <dd>{vault ? shortAddress(vault) : "—"}</dd>
        </div>
        <div>
          <dt>Spendable</dt>
          <dd>
            {balance
              ? `${formatAtoms(balance.available, decimals)} ${collateralSymbol}`
              : "—"}
          </dd>
        </div>
        <div>
          <dt>Held in open orders</dt>
          <dd>
            {balance
              ? `${formatAtoms(balance.reserved, decimals)} ${collateralSymbol}`
              : "—"}
          </dd>
        </div>
      </dl>
      <p className="sh-form-note">
        {/* Said plainly because it is the one thing a trader must not get wrong
            about an autonomous agent: this is not the wallet balance. */}
        The agent trades the prediction vault your wallet owns, never the wallet
        itself. It can spend only the vault's spendable {collateralSymbol}, and
        only up to the limits your vault session authorizes — deposit to raise
        that ceiling, withdraw to lower it.
      </p>
      <p role="status" className="ch-agent-status">
        {!wallet
          ? "Connect your Solana wallet to read this agent and instruct it."
          : status
            ? `Agent: ${status.state.toLowerCase().replaceAll("_", " ")}${
                status.marketId ? ` · ${shortAddress(status.marketId)}` : ""
              }`
            : unavailable
              ? "Agent: unavailable on this deployment"
              : "Agent: reading…"}
      </p>
      {status?.reasonCode && (
        <p className="sh-form-note">
          {REASONS[status.reasonCode] ??
            "The agent is stopped. Review the configured vault session before continuing."}
        </p>
      )}
      {closed && !target.trim() && (
        <p className="sh-form-note">
          Trading has closed on this question. Paste a match id above to arm the
          agent on another one.
        </p>
      )}
      {error && (
        <p className="ch-integration-warning" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
