import { useEffect, useState, type ReactNode } from "react";
import type { PredictionPublicConfig, PublicPredictionVenue } from "../../../packages/prediction-core/market-data";
import { getPredictionConfig } from "../../../packages/sdk/PredictionTradingClient";
import type { DynamicSolanaSessionValue } from "../arena/DynamicSolanaSession";
import { DreamDexTerminal } from "./DreamDexTerminal";
import { ManifestTerminal } from "./LazyManifestTerminal";
import "./prediction.css";
import { parseDreamDexPublicConfig } from '../../../packages/adapters/dreamdex/config';
export type TradingNetwork = "SOLANA" | "SOMNIA";
export function NetworkTabs({
  network,
  onChange,
}: {
  network: TradingNetwork;
  onChange: (n: TradingNetwork) => void;
}) {
  const choices = ["SOLANA", "SOMNIA"] as const;
  return (
    <div
      className="ch-network-tabs"
      role="tablist"
      aria-label="Trading network"
    >
      {choices.map((n, i) => (
        <button
          type="button"
          role="tab"
          key={n}
          id={`network-tab-${n}`}
          aria-controls="network-trading-panel"
          aria-selected={network === n}
          tabIndex={network === n ? 0 : -1}
          onClick={() => onChange(n)}
          onKeyDown={(e) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
              e.preventDefault();
              const next =
                e.key === "Home"
                  ? choices[0]
                  : e.key === "End"
                    ? choices[1]
                    : choices[1 - i]!;
              onChange(next);
              document.getElementById(`network-tab-${next}`)?.focus();
            }
          }}
        >
          {n === "SOLANA" ? "Solana" : "Somnia"}
        </button>
      ))}
    </div>
  );
}
export function NetworkTrading({
  apiUrl,
  network,
  session,
  eventId,
  subjectId,
  somniaChainId,
  initialOutcome,
  renderEvmTerminal,
}: {
  apiUrl: string;
  network: TradingNetwork;
  session: DynamicSolanaSessionValue;
  eventId?: string;
  subjectId?: string;
  somniaChainId?: '5031' | '50312';
  initialOutcome?: 0 | 1;
  renderEvmTerminal?: (venue: PublicPredictionVenue, audience: string, allowedMarketIds?: string[]) => ReactNode;
}) {
  const [config, setConfig] = useState<PredictionPublicConfig | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setConfig(null);
    setError("");
    if (!apiUrl) {
      setError(
        "The trading service is not connected. Connect the deployed network configuration to enable trading.",
      );
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const raw = await getPredictionConfig(apiUrl, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]));
        const value = {...raw,dreamdex:raw.dreamdex?.map(parseDreamDexPublicConfig)};
        if (!controller.signal.aborted) { setConfig(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value); setError(''); }
      } catch(e) {
        if (!controller.signal.aborted) { setConfig(null); setError(e instanceof Error ? e.message : 'Trading service unavailable'); }
      } finally { if (!controller.signal.aborted) timer = setTimeout(refresh, 15000); }
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [apiUrl, retry]);
  const venues = config?.venues.filter((v) => network === 'SOLANA' ? v.family === 'SOLANA' : v.family === 'EVM') ?? [];
  const [selectedChain, setSelectedChain] = useState("");
  const venue = venues.find((v) => v.chainId === selectedChain) ?? venues[0];
  const allowedMarketIds = eventId
    ? (venue?.arenaMarketBindings
        ?.filter((b) => b.eventId === eventId)
        .map((b) => b.marketId) ?? [])
    : undefined;
  const scopedVenue =
    venue && allowedMarketIds
      ? {
          ...venue,
          manifestMarkets: venue.manifestMarkets?.filter((m) =>
            allowedMarketIds.includes(m.address),
          ),
        }
      : venue;
  return (
    <section
      id="network-trading-panel"
      role="tabpanel"
      aria-labelledby={`network-tab-${network}`}
      className="ch-network-panel"
      tabIndex={0}
    >
      <header className="pt-heading">
        <div>
          <h2>{network === "SOLANA" ? "Solana" : "Somnia"} markets</h2>
          <p>
            {network === "SOLANA"
              ? `${venue?.collateralSymbol ?? 'SOL'} predictions · Manifest order book`
              : venue ? `${venue.collateralSymbol} custom SOLZ settlement · chain ${venue.chainId}` : `DreamDEX Event Contracts · ${somniaChainId === '50312' ? 'tUSDC testnet' : 'USDso mainnet'}`}
          </p>
        </div>
        {venues.length > 1 && (
          <label>
            Deployment
            <select
              value={venue?.chainId}
              onChange={(e) => setSelectedChain(e.target.value)}
            >
              {venues.map((v) => (
                <option value={v.chainId} key={v.chainId}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      {error ? (
        <div className="pt-empty" role="alert">
          <h3>Trading is not connected</h3>
          <p>{error}</p>
          {apiUrl && (
            <button onClick={() => setRetry((n) => n + 1)}>
              Retry connection
            </button>
          )}
        </div>
      ) : !config ? (
        <p role="status" className="pt-empty">
          Loading {network === "SOLANA" ? "Solana" : "Somnia"} markets…
        </p>
      ) : network === "SOMNIA" && venue ? (
        renderEvmTerminal?.(venue, config.audience, allowedMarketIds)
      ) : network === "SOMNIA" ? (
        <DreamDexTerminal
          deployments={config.dreamdex ?? []}
          eventId={eventId}
          subjectId={subjectId}
          chainId={somniaChainId}
          initialOutcome={initialOutcome}
        />
      ) : !venue ? (
        <div className="pt-empty">
          <h3>
            No {network === "SOLANA" ? "Solana" : "Somnia"} deployment connected
          </h3>
          <p>
            This network’s markets, balances, and chart will appear when its
            deployment is configured.
          </p>
        </div>
      ) : allowedMarketIds?.length === 0 ? (
        <div className="pt-empty">
          <h3>
            No market linked to this event on{" "}
            {network === "SOLANA" ? "Solana" : "Somnia"}
          </h3>
          <p>
            The event must be linked to its deployed question before trading.
          </p>
        </div>
      ) : network === "SOLANA" ? (
        venue.matchingEngine === "MANIFEST" ? (
          <ManifestTerminal
            key={`${venue.chainId}:${venue.programId}`}
            venue={scopedVenue!}
            session={session}
          />
        ) : (
          <div className="pt-empty">
            A guarded Manifest deployment is required for Solana trading.
          </div>
        )
      ) : null}
    </section>
  );
}
