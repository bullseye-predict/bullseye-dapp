import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Square, Zap } from "lucide-react";
import type { ArenaMarket, ArenaMarketOutcome } from "../solz/model";
import type { PublicPredictionVenue } from "../../../packages/prediction-core/market-data";
import { getPredictionConfig } from "../../../packages/sdk/PredictionTradingClient";
import { predictionUrl } from "../../../packages/sdk/prediction-url";
import { vaultAddress } from "../../../packages/adapters/solana/wire";
import { connectSolanaTradingWallet, type TradingWallet } from "../prediction/wallets";
import { useSolanaWallet } from "../session/store";
import { venueBinding } from "./venue/useVenueMarket";

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
  outcome: ArenaMarketOutcome;
  onOutcome: (outcome: ArenaMarketOutcome) => void;
  collateralSymbol: string;
  venue?: PublicPredictionVenue | null;
  apiUrl: string;
  /** Trading is closed on this question, so nothing may be armed against it. */
  closed?: boolean;
};

export function AgentTrader({
  market,
  outcome,
  onOutcome,
  collateralSymbol,
  venue,
  apiUrl,
  closed = false,
}: Props) {
  const wallet = useSolanaWallet();
  const [prompt, setPrompt] = useState("");
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
      if (start && !onchainMarketId)
        throw new Error(
          "This question has no Manifest market yet. Open it from the trade ticket first, then instruct the agent.",
        );
      const { audience } = await getPredictionConfig(apiUrl);
      // Reconnected per command on purpose: the signed session is short lived,
      // and holding one open across an idle panel is a signature the trader
      // gave for work that never happened.
      session.current?.dispose();
      const connected = await connectSolanaTradingWallet(venue, apiUrl, audience, wallet);
      session.current = connected;
      if (start) await connected.client.startHermes(onchainMarketId!, prompt.trim());
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

  const blocked = closed || !!unavailable || !wallet;
  return (
    <div className="ch-agent-trader">
      <p className="sh-console-intro">
        Tired of catching every card yourself? Write the instruction once and the
        agent watches this question and trades it for you.
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
          BUY OUTCOME
          <select
            value={outcome.id}
            onChange={(event) => {
              const next = market.outcomes.find(
                (item) => item.id === event.target.value,
              );
              if (next) onOutcome(next);
            }}
          >
            {market.outcomes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          TRADING INSTRUCTIONS
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={8000}
            rows={4}
            disabled={busy || running}
            placeholder="Describe when the agent should trade or hold. For example: buy this side under 45c, scale out above 70c, and never hold through the horn."
          />
        </label>
        <p className="sh-form-note">
          {prompt.trim().length}/8000 · The instruction decides what the agent
          does inside its authorized limits. It cannot raise them.
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
      {closed && (
        <p className="sh-form-note">
          Trading has closed on this question, so nothing can be armed against it.
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
