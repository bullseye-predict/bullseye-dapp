import "../../styles/home-console.css";
import {
  ArrowUpRight,
  Bot,
  ChevronDown,
  MessageSquare,
  Pause,
  Play,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  ArenaMarket,
  ArenaMarketOutcome,
  AutomationTriggerKind,
  SolzDataSource,
  SolzMatch,
  SolzSnapshot,
} from "../solz/model";
import {
  predictionContract,
  type PredictionAnswer,
} from "../solz/predictionContracts";
import { AgentTrader } from "./AgentTrader";
import { AnimatedCollapse } from "./AnimatedCollapse";
import { PromptComposer } from "./PromptComposer";
import { TradeTicket } from "./TradeTicket";
import { MarketErrorBoundary } from "./MarketErrorBoundary";
import { LiveChatForm } from "./LiveChatForm";
import { mergeMatchChat, useLiveChat } from "./useLiveChat";
import type { PublicPredictionVenue } from "../../../packages/prediction-core/market-data";
import type { ReservedSolanaQuestion } from "./solanaQuestionMarkets";

export type ConsoleSection = "trade" | "automate" | "prompt" | "chat";
type Props = {
  source: SolzDataSource;
  snapshot: SolzSnapshot;
  match: SolzMatch;
  market: ArenaMarket;
  outcome: ArenaMarketOutcome;
  onOutcome: (outcome: ArenaMarketOutcome) => void;
  /** Every panel that is currently expanded. The homepage opens two at once; the
      event page passes at most one and so stays a single-open accordion. */
  sections: ConsoleSection[];
  onSections: (sections: ConsoleSection[]) => void;
  promptAgentId?: string;
  intermission: boolean;
  hideChat?: boolean;
  hidePrompt?: boolean;
  simulation?: boolean;
  answer?: PredictionAnswer;
  onAnswer?: (answer: PredictionAnswer) => void;
  marketAvailable?: boolean;
  /** What to say in place of the ticket when there is no market. The
      default speaks for a prediction feed that is down; a match whose
      question was never opened needs its own sentence. */
  marketNotice?: { title: string; detail: string };
  tradingPanel?: ReactNode;
  /** Required on purpose. A missing symbol used to fall back to COOLA, the
      simulation's credit, which then printed as a ticker on live pages. */
  collateralSymbol: string;
  dreamDexApiUrl?: string;
  onDreamDexOpened?: () => void;
  solana?: boolean;
  solanaVenue?: PublicPredictionVenue | null;
  solanaQuestion?: ReservedSolanaQuestion;
  predictionApiUrl?: string;
  automationWarning?: string;
  promptWarning?: string;
};
function ConsolePanel({
  name,
  title,
  icon,
  meta,
  active,
  onToggle,
  children,
}: {
  name: ConsoleSection;
  title: string;
  icon: ReactNode;
  meta: string;
  active: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className={`sh-console-panel ch-console-accordion ch-console-${name} ${active ? "is-open" : ""}`}
    >
      <h3>
        <button
          id={`console-${name}-button`}
          aria-expanded={active}
          aria-controls={`console-${name}-body`}
          onClick={onToggle}
        >
          {icon}
          <span>{title}</span>
          <small>{meta}</small>
          <ChevronDown size={15} />
        </button>
      </h3>
      <AnimatedCollapse
        id={`console-${name}-body`}
        labelledBy={`console-${name}-button`}
        open={active}
        className="ch-console-reveal"
      >
        <div className="sh-console-body">{children}</div>
      </AnimatedCollapse>
    </section>
  );
}

export function InteractionConsole({
  source,
  snapshot,
  match,
  market,
  outcome,
  onOutcome,
  sections,
  onSections,
  promptAgentId,
  intermission,
  hideChat = false,
  hidePrompt = false,
  simulation = true,
  answer: externalAnswer,
  onAnswer,
  marketAvailable = true,
  marketNotice,
  tradingPanel,
  collateralSymbol,
  dreamDexApiUrl,
  onDreamDexOpened,
  solana = false,
  solanaVenue = null,
  solanaQuestion,
  predictionApiUrl = "",
  automationWarning,
  promptWarning,
}: Props) {
  const [localAnswer, setLocalAnswer] = useState<PredictionAnswer>("yes");
  const answer = externalAnswer ?? localAnswer;
  const selectAnswer = (next: PredictionAnswer) => {
    setLocalAnswer(next);
    onAnswer?.(next);
  };
  const contract = predictionContract(
    outcome,
    market.outcomes.length > 2 ? answer : "yes",
  );
  useEffect(() => {
    if (!onAnswer) setLocalAnswer("yes");
  }, [market.id, outcome.id, onAnswer]);
  const [trigger, setTrigger] = useState<AutomationTriggerKind>("below");
  const [threshold, setThreshold] = useState("40");
  const [budget, setBudget] = useState(simulation ? "25" : "1");
  const [pending, setPending] = useState("");
  const [feedback, setFeedback] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const chatList = useRef<HTMLDivElement>(null);
  // The arena's public room first, this device's own messages alongside it.
  // See src/components/home/useLiveChat.ts for why both streams are kept.
  const room = useLiveChat();
  const messages = mergeMatchChat(snapshot.chat, room.messages, match.id).slice(
    -14,
  );
  const rules = snapshot.automation.filter(
    (item) => item.marketId === market.id,
  );
  /** The simulated rule form's gate: it also refuses on a live network, where
   *  arming a sample rule against real money would be a lie. */
  const closed =
    !simulation ||
    market.status !== "open" ||
    snapshot.updatedAt >= market.closesAt;
  /** The question's own trading state, without the simulation clause above.
   *  Hermes trades the real question, so it is this that stops it. */
  const questionClosed =
    market.status !== "open" || snapshot.updatedAt >= market.closesAt;
  useEffect(() => {
    if (sections.includes("chat") && chatList.current)
      chatList.current.scrollTop = chatList.current.scrollHeight;
  }, [sections, match.id, messages.length]);

  async function perform(key: string, action: () => Promise<string>) {
    if (pending || !simulation) return;
    setPending(key);
    setFeedback(null);
    try {
      setFeedback({ text: await action(), error: false });
    } catch (reason) {
      setFeedback({
        text: reason instanceof Error ? reason.message : "Please try again.",
        error: true,
      });
    } finally {
      setPending("");
    }
  }
  const panel = (name: ConsoleSection) => ({
    name,
    active: sections.includes(name),
    onToggle: () => {
      onSections(
        sections.includes(name)
          ? sections.filter((item) => item !== name)
          : [...sections, name],
      );
      setFeedback(null);
    },
  });

  return (
    <aside className="ch-console" aria-label="Match interaction console">
      <ConsolePanel
        {...panel("trade")}
        title="Trade"
        icon={<ArrowUpRight size={16} />}
        meta={
          tradingPanel ? "ON-CHAIN" : !marketAvailable ? "NO MARKET" : simulation ? "SIMULATION" : solana && market.onchain?.family === "SOLANA" && !market.onchain.opened ? "OFF-CHAIN" : "ON-CHAIN"
        }
      >
        {tradingPanel ??
          (marketAvailable ? (
            <MarketErrorBoundary label={market?.title ?? "Trade ticket"}>
            <TradeTicket
              preparing={intermission}
              match={match}
              buyAmount={budget}
              onBuyAmountChange={setBudget}
              solana={solana}
              solanaVenue={solanaVenue}
              solanaQuestion={solanaQuestion}
              predictionApiUrl={predictionApiUrl}
              collateralSymbol={collateralSymbol}
              dreamDexApiUrl={dreamDexApiUrl}
              onDreamDexOpened={onDreamDexOpened}
              source={source}
              snapshot={snapshot}
              market={market}
              outcome={outcome}
              onOutcome={onOutcome}
              answer={answer}
              onAnswer={selectAnswer}
              simulation={simulation}
            />
            </MarketErrorBoundary>
          ) : (
            // Keep the ticket's shape while it has no data. A blank panel reads as a
            // broken page; a disabled skeleton shows what will appear and where.
            <div className="ch-trade-skeleton" role="status" aria-busy="true">
              <div className="ch-trade-skeleton__notice">
                <strong>{marketNotice?.title ?? "Prediction feed unavailable."}</strong>
                <span>
                  {marketNotice?.detail ??
                    "The trade ticket will populate when match questions return. Other arena controls remain independent."}
                </span>
              </div>
              <div className="ch-trade-skeleton__outcomes" aria-hidden="true">
                <span className="is-yes">YES</span>
                <span className="is-no">NO</span>
              </div>
              {/* Mirrors the real ticket's rows so the panel keeps its shape
                  while it has no data. */}
              <dl className="ch-trade-skeleton__fields" aria-hidden="true">
                <div><dt>Limit price</dt><dd>—</dd></div>
                <div><dt>Shares</dt><dd>—</dd></div>
                <div><dt>Expires</dt><dd>—</dd></div>
                <div><dt>Total</dt><dd>—</dd></div>
                <div><dt>To win</dt><dd>—</dd></div>
              </dl>
              <button type="button" className="ch-submit-trade ch-trade-skeleton__action" disabled>Trade</button>
            </div>
          ))}
      </ConsolePanel>
      <ConsolePanel
        {...panel("automate")}
        title="Agent Trader"
        icon={<Bot size={16} />}
        meta={
          simulation
            ? `${rules.filter((rule) => rule.status === "armed").length} ARMED`
            : "HERMES"
        }
      >
        {!marketAvailable ? (
          <div className="ch-console-empty" role="status">
            <strong>No market to automate yet.</strong>
            <span>
              Automation remains idle until a real prediction question is
              available.
            </span>
          </div>
        ) : !simulation ? (
          // A live network gets the real agent, not a disabled copy of the
          // sample one. See AgentTrader for why the two cannot share a form.
          <AgentTrader
            market={market}
            outcome={outcome}
            onOutcome={onOutcome}
            collateralSymbol={collateralSymbol}
            venue={solanaVenue}
            apiUrl={predictionApiUrl}
            closed={questionClosed}
          />
        ) : (
          <>
            {automationWarning && (
              <p className="ch-integration-warning" role="note">
                {automationWarning}
              </p>
            )}
            <p className="sh-console-intro">
              An agent watches your selected prediction.
            </p>
            <form
              className="sh-form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void perform("automate", async () => {
                  const instruction = `Buy ${contract.label} ${trigger === "below" ? `below ${threshold}%` : trigger === "above" ? `above ${threshold}%` : "on a 2.5-point probability move"}. Spend at most ${budget} ${collateralSymbol}.`;
                  await source.createAutomation({
                    matchId: market.matchId ?? match.id,
                    marketId: market.id,
                    outcomeId: contract.id,
                    instruction,
                    trigger: {
                      kind: trigger,
                      threshold: Number(threshold) / 100,
                    },
                    action: "buy",
                    budget: Number(budget),
                    token: "COOLA",
                  });
                  return "Trading agent armed in simulation. Pause it below.";
                });
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
                      {item.id === outcome.id &&
                      market.outcomes.length > 2 &&
                      answer === "no"
                        ? `NO · ${item.label}`
                        : item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                WHEN
                <select
                  value={trigger}
                  onChange={(event) =>
                    setTrigger(event.target.value as AutomationTriggerKind)
                  }
                >
                  <option value="below">Probability falls below</option>
                  <option value="above">Probability rises above</option>
                  <option value="momentum">Probability moves 2.5 points</option>
                </select>
              </label>
              <div className="sh-form-columns">
                {trigger !== "momentum" && (
                  <label>
                    THRESHOLD (%)
                    <input
                      type="number"
                      value={threshold}
                      onChange={(event) => setThreshold(event.target.value)}
                      min="1"
                      max="99"
                      required
                    />
                  </label>
                )}
                <label>
                  BUDGET ({collateralSymbol})
                  <input
                    type="number"
                    min={simulation ? 25 : 1}
                    max={
                      simulation ? snapshot.account.balances.COOLA : undefined
                    }
                    value={budget}
                    onChange={(event) => setBudget(event.target.value)}
                    required
                  />
                </label>
              </div>
              <button
                className="sh-button sh-button--black"
                disabled={!!pending || closed}
              >
                Arm agent <Zap size={15} />
              </button>
              <p className="sh-form-note">
                Uses the same amount as Trade. Budget includes fees.
              </p>
            </form>
            <div className="sh-rule-list">
              {rules.map((rule) => (
                <div key={rule.id}>
                  <span>
                    <b>
                      {rule.outcomeLabel} · {rule.status}
                    </b>
                    <small>{rule.instruction}</small>
                  </span>
                  <button
                    aria-label={`${rule.status === "armed" ? "Pause" : "Arm"} ${rule.outcomeLabel} rule`}
                    onClick={() =>
                      source.setAutomationStatus(
                        rule.id,
                        rule.status === "armed" ? "paused" : "armed",
                      )
                    }
                    disabled={closed}
                  >
                    {rule.status === "armed" ? (
                      <Pause size={14} />
                    ) : (
                      <Play size={14} />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </ConsolePanel>
      {!hideChat && (
        <ConsolePanel
          {...panel("chat")}
          title="Live chat"
          icon={<MessageSquare size={16} />}
          meta="SPECTATOR CHANNEL"
        >
          <div
            className="sh-chat"
            ref={chatList}
            role="log"
            aria-label="Match chat"
          >
            {messages.length ? (
              messages.map((item) => (
                <article
                  key={item.id}
                  className={`ch-chat-message ${item.self ? "is-self" : ""}`}
                >
                  <span className="ch-chat-initial" aria-hidden="true">
                    {item.author[0].toUpperCase()}
                  </span>
                  <div>
                    <header>
                      <b>{item.self ? "You" : item.author}</b>
                      <time dateTime={new Date(item.at).toISOString()}>
                        {new Date(item.at).toLocaleTimeString("en", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </time>
                    </header>
                    <p>{item.text}</p>
                  </div>
                </article>
              ))
            ) : (
              <p>Be the first to make your call.</p>
            )}
          </div>
          <LiveChatForm
            source={source}
            matchId={match.id}
            note="Local preview · visible on this device"
          />
        </ConsolePanel>
      )}
      {!hidePrompt && (
        <PromptComposer
          warning={promptWarning}
          source={source}
          snapshot={snapshot}
          match={match}
          open={sections.includes("prompt")}
          onToggle={panel("prompt").onToggle}
          promptAgentId={promptAgentId}
          intermission={intermission}
          simulation={simulation}
        />
      )}
      {feedback && (
        <p
          role={feedback.error ? "alert" : "status"}
          className={`sh-feedback ${feedback.error ? "is-error" : ""}`}
        >
          {feedback.text}
        </p>
      )}
    </aside>
  );
}
