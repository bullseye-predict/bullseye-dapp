import { useEffect, useMemo, useRef, useState } from "react";
import type { EIP1193Provider } from "viem";
import type { BinarySide } from "@somnia-chain/markets-sdk";
import type {
  Candle,
  DreamDexPublicConfig,
} from "../../../packages/prediction-core/market-data";
import {
  DreamDexBrowser,
  type DreamDexBrowserWallet,
  orderTerms,
} from "../../../packages/adapters/dreamdex/browser";
import { eventBinding } from "../../../packages/adapters/dreamdex/config";
import { dreamDexNetwork } from "../../../packages/adapters/dreamdex/event-reader";
import { ConfirmedPriceChart } from "./ConfirmedPriceChart";
import { formatUnitsExact, parseUnitsExact, priceLabel } from "./amounts";
type Snapshot = Awaited<ReturnType<DreamDexBrowser["snapshot"]>>;
export function DreamDexTerminal({
  deployments,
  eventId,
  subjectId,
  chainId,
  initialOutcome = 0,
}: {
  deployments: DreamDexPublicConfig[];
  eventId?: string;
  subjectId?: string;
  chainId?: '5031' | '50312';
  initialOutcome?: 0 | 1;
}) {
  const [chain, setChain] = useState(deployments[0]?.chainId ?? "50312"),
    [id, setId] = useState("");
  const config = chainId ? deployments.find(c => c.chainId === chainId) : deployments.find((c) => c.chainId === chain) ?? deployments[0];
  const markets =
      config?.markets.filter((m) => (!eventId || m.eventId === eventId) && (!subjectId || m.subjectId === subjectId)) ?? [],
    market = markets.find((m) => m.marketId === id) ?? markets[0];
  return (
    <>
      <div className="pt-toolbar">
        {config && !chainId && (
          <label>
            Somnia deployment
            <select
              value={config.chainId}
              onChange={(e) => {
                setChain(e.target.value as typeof chain);
                setId("");
              }}
            >
              {deployments.map((c) => (
                <option key={c.chainId} value={c.chainId}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {market && (
          <label>
            Event contract
            <select
              value={market.marketId}
              onChange={(e) => setId(e.target.value)}
            >
              {markets.map((m) => (
                <option key={m.marketId} value={m.marketId}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!config ? (
        <div className="pt-empty">
          <h3>{chainId === '50312' ? 'Testnet · tUSDC' : 'Mainnet · USDso'} configuration missing</h3>
          <p>
            Configure Somnia Event Contracts to load this network’s markets.
          </p>
        </div>
      ) : !market ? (
        <div className="pt-empty">
          <h3>No DreamDEX event linked{eventId ? " to this match" : ""}</h3>
          <p>
            Create the game’s oracle question and register its confirmed
            event-contract ID.
          </p>
        </div>
      ) : (
        <DreamEvent
          key={`${config.chainId}:${market.marketId}`}
          config={config}
          market={market}
          initialOutcome={initialOutcome}
        />
      )}
    </>
  );
}
function DreamEvent({
  config,
  market,
  initialOutcome,
}: {
  config: DreamDexPublicConfig;
  market: DreamDexPublicConfig["markets"][number];
  initialOutcome: 0 | 1;
}) {
  const adapter = useMemo(
    () => new DreamDexBrowser(config, eventBinding(config, market)),
    [config, market],
  );
  useEffect(
    () => () => {
      void adapter.close();
    },
    [adapter],
  );
  const [wallet, setWallet] = useState<DreamDexBrowserWallet | null>(null),
    walletRef = useRef<DreamDexBrowserWallet | null>(null);
  walletRef.current = wallet;
  useEffect(() => () => wallet?.dispose(), [wallet]);
  const [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [outcome, setOutcome] = useState<0 | 1>(initialOutcome),
    [side, setSide] = useState<"BUY" | "SELL">("BUY"),
    [kind, setKind] = useState<0 | 2 | 3>(2),
    [price, setPrice] = useState("50"),
    [quantity, setQuantity] = useState("10"),
    [amount, setAmount] = useState("10");
  const [candles, setCandles] = useState<Candle[]>([]),
    [historyError, setHistoryError] = useState("");
  useEffect(() => { setOutcome(initialOutcome); setReview(null); }, [initialOutcome]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [review, setReview] = useState<{
    side: BinarySide;
    outcomePrice: bigint;
    quantity: bigint;
    orderType: 0 | 2 | 3;
  } | null>(null);
  const alive = useRef(true),
    pending = useRef(false);
  useEffect(() => {
    alive.current = true;
    const provider = (window as Window & { ethereum?: EIP1193Provider })
      .ethereum;
    const changed = () => {
      walletRef.current?.dispose();
      setWallet(null);
      setReview(null);
      setMessage("Wallet changed. Connect again to continue.");
    };
    provider?.on?.("accountsChanged", changed);
    provider?.on?.("chainChanged", changed);
    return () => {
      alive.current = false;
      walletRef.current?.dispose();
      provider?.removeListener?.("accountsChanged", changed);
      provider?.removeListener?.("chainChanged", changed);
    };
  }, []);
  useEffect(() => {
    let current = true,
      loading = false;
    setData(null);
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const next = await adapter.snapshot(wallet?.owner);
        if (current) {
          setData(next);
          setError("");
        }
      } catch (e) {
        if (current) {
          setError(e instanceof Error ? e.message : "Event data unavailable");
          setReview(null);
        }
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [adapter, wallet, refresh]);
  useEffect(() => {
    let current = true,
      loading = false;
    setCandles([]);
    setHistoryLoading(true);
    setHistoryError("");
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const next = await adapter.candles(outcome);
        if (current) {
          setCandles(next);
          setHistoryError("");
        }
      } catch (e) {
        if (current)
          setHistoryError(
            e instanceof Error ? e.message : "Event chart unavailable",
          );
      } finally {
        loading = false;
        if (current) setHistoryLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [adapter, outcome, refresh]);
  useEffect(() => setReview(null), [outcome, side, kind, price, quantity]);
  const run = async (fn: () => Promise<string>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await fn();
      if (alive.current) {
        setMessage(result);
        setReview(null);
        setRefresh((n) => n + 1);
      }
    } catch (e) {
      if (alive.current)
        setMessage(e instanceof Error ? e.message : "Operation did not finish");
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const connect = () =>
    void run(async () => {
      const provider = (window as Window & { ethereum?: EIP1193Provider })
        .ethereum;
      if (!provider)
        throw new Error("Install or open an EVM wallet to connect to Somnia");
      const next = await adapter.connect(provider);
      if (!alive.current) {
        next.dispose();
        return "";
      }
      setWallet(next);
      return `Connected ${next.owner}`;
    });
  const network = dreamDexNetwork(config.chainId),
    decimals = network.collateralDecimals,
    scale = 10n ** BigInt(decimals),
    symbol = network.collateralSymbol;
  const format = (n: bigint) => formatUnitsExact(n, decimals, 6),
    priceText = (n: bigint) => priceLabel((n * 1000000n) / scale);
  const closed =
    !data ||
    data.market.status !== 1 ||
    data.now < market.tradingStartsAt ||
    data.now >= market.tradingLocksAt;
  const unavailable = !wallet || !data || !!error || busy;
  const bids = outcome === 0 ? data?.book?.yesBids : data?.book?.noBids,
    asks = outcome === 0 ? data?.book?.yesAsks : data?.book?.noAsks;
  const fee = (n: bigint) => `${Number(n) / 100000}%`;
  return (
    <fieldset
      className="pt-session"
      disabled={busy}
      aria-label="DreamDEX event trading"
    >
      <div className="pt-toolbar">
        <span>
          {network.chain.name} · {symbol} · Event Contracts
        </span>
        <button onClick={connect} disabled={busy}>
          {wallet
            ? `${wallet.owner.slice(0, 6)}…${wallet.owner.slice(-4)}`
            : "Connect Somnia wallet"}
        </button>
      </div>
      <p className="pt-market-status">
        {error
          ? "Event data unavailable"
          : !data
            ? "Loading event…"
            : data.market.isVoided
              ? "Voided"
              : data.market.isResolved
                ? "Resolved"
                : closed
                  ? "Closed to trading"
                  : "Trading open"}{" "}
        · Cutoff {new Date(market.tradingLocksAt).toLocaleString()}
      </p>
      {error && (
        <p className="pt-error" role="alert">
          {error}
        </p>
      )}
      <div className="pt-outcomes" aria-label="Event outcome">
        {(["YES", "NO"] as const).map((label, i) => (
          <button
            key={label}
            aria-pressed={outcome === i}
            onClick={() => setOutcome(i as 0 | 1)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="pt-grid">
        <section className="pt-market">
          {historyLoading ? (
            <p className="pt-empty pt-chart-empty" role="status">
              Loading event trades…
            </p>
          ) : historyError ? (
            <p className="pt-empty" role="alert">
              Event chart unavailable: {historyError}
            </p>
          ) : (
            <ConfirmedPriceChart
              candles={candles}
              label={`${outcome === 0 ? "YES" : "NO"} · Somnia`}
              sourceLabel="indexed trades"
            />
          )}
          <p className="pt-muted">
            Latest 100 indexed fills for this event only.
          </p>
          <h2>Order book</h2>
          <div className="pt-book-scroll">
            <table className="pt-book">
              <thead>
                <tr>
                  <th>Side</th>
                  <th>Price</th>
                  <th>Shares</th>
                </tr>
              </thead>
              <tbody>
                {asks
                  ?.slice()
                  .reverse()
                  .map((level) => (
                    <tr className="pt-ask" key={`a${level.price}`}>
                      <td>Ask</td>
                      <td>{priceText(level.price)}</td>
                      <td>{format(level.quantity)}</td>
                    </tr>
                  ))}
                {bids?.map((level) => (
                  <tr className="pt-bid" key={`b${level.price}`}>
                    <td>Bid</td>
                    <td>{priceText(level.price)}</td>
                    <td>{format(level.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && !bids?.length && !asks?.length && (
            <p className="pt-empty">No available orders for this event.</p>
          )}
          <h3>Your open orders</h3>
          {!wallet ? (
            <p>Connect a wallet to see orders.</p>
          ) : data?.orders.length ? (
            data.orders.map(
              (o) =>
                o && (
                  <div className="pt-order" key={o.orderId.toString()}>
                    <span>
                      #{o.orderId.toString()} · {format(o.quantityRemaining)}{" "}
                      shares · YES price {priceText(o.price)}
                    </span>
                    <button
                      disabled={unavailable}
                      onClick={() =>
                        void run(
                          async () =>
                            `Cancellation confirmed: ${await wallet.cancel(o.orderId)}`,
                        )
                      }
                    >
                      Cancel
                    </button>
                  </div>
                ),
            )
          ) : (
            <p>No open orders.</p>
          )}
        </section>
        <aside className="pt-ticket">
          <h2>Trade {outcome === 0 ? "YES" : "NO"}</h2>
          <div className="pt-side">
            {(["BUY", "SELL"] as const).map((s) => (
              <button
                key={s}
                aria-pressed={side === s}
                onClick={() => setSide(s)}
              >
                {s === "BUY" ? "Buy" : "Sell"}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                if (unavailable || closed || !data?.pool)
                  throw new Error("Connect a wallet and refresh an open event");
                const outcomePrice = parseUnitsExact(price, decimals - 2),
                  q = parseUnitsExact(quantity, decimals),
                  s = `${side}_${outcome === 0 ? "YES" : "NO"}` as BinarySide;
                orderTerms(s, outcomePrice, q, decimals, data.pool.grid);
                if (
                  side === "BUY" &&
                  (q * outcomePrice + scale - 1n) / scale >
                    (data.balances?.[0] ?? 0n)
                )
                  throw new Error(`Not enough ${symbol} collateral`);
                if (side === "SELL" && q > (data.balances?.[outcome + 1] ?? 0n))
                  throw new Error("Not enough wallet outcome tokens");
                setReview({
                  side: s,
                  outcomePrice,
                  quantity: q,
                  orderType: kind,
                });
                setMessage("");
              } catch (e) {
                setMessage(e instanceof Error ? e.message : "Invalid order");
              }
            }}
          >
            <label>
              Order type
              <select
                value={kind}
                onChange={(e) => setKind(Number(e.target.value) as 0 | 2 | 3)}
              >
                <option value="2">Immediate · cancel unfilled</option>
                <option value="0">Limit</option>
                <option value="3">Post only</option>
              </select>
            </label>
            <label>
              Shares
              <input
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
            <label>
              {side === "BUY" ? "Maximum" : "Minimum"} outcome price · cents
              <input
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
            {data?.pool && (
              <p>
                Maker fee {fee(data.pool.params.makerFeeBpsTimes1k)} · taker fee{" "}
                {fee(data.pool.params.takerFeeBpsTimes1k)} · settlement fee{" "}
                {fee(data.pool.params.settlementFeeBpsTimes1k)}.
              </p>
            )}
            <p>No additional frontend builder fee is configured.</p>
            <button className="pt-primary" disabled={unavailable || closed}>
              Review order
            </button>
          </form>
          {review && (
            <div className="pt-review">
              <h3>Review {review.side.replace("_", " ").toLowerCase()}</h3>
              <p>
                {format(review.quantity)} shares at{" "}
                {priceText(review.outcomePrice)}.{" "}
                {review.orderType === 2
                  ? "Unfilled shares cancel immediately."
                  : "Order expires at the event cutoff."}
              </p>
              <p>
                Your wallet may request collateral or outcome-token approval
                before placing the order.
              </p>
              <button
                className="pt-primary"
                disabled={unavailable || closed}
                onClick={() =>
                  void run(
                    async () =>
                      `Trade confirmed: ${await wallet!.order(review)}`,
                  )
                }
              >
                Sign & submit
              </button>
              <button onClick={() => setReview(null)}>Dismiss</button>
            </div>
          )}
          {message && (
            <p className="pt-feedback" role="status">
              {message}
            </p>
          )}
          <h3>Wallet balances</h3>
          <dl className="pt-totals">
            {[symbol, "YES", "NO"].map((label, i) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{data?.balances ? format(data.balances[i]!) : "—"}</dd>
              </div>
            ))}
          </dl>
          <details className="pt-collateral">
            <summary>Complete sets & settlement</summary>
            <p>
              One {symbol} backs one YES and one NO. Create sets to fund
              sell-side inventory; merging returns collateral. Redeem uses the
              permanent event ID, including after its pool is reused.
            </p>
            <label>
              Amount
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <div>
              {(["mint", "merge", "redeem"] as const).map((action) => (
                <button
                  key={action}
                  disabled={
                    unavailable ||
                    (action === "mint" && closed) ||
                    (action === "redeem" &&
                      !data?.market.isResolved &&
                      !data?.market.isVoided)
                  }
                  onClick={() =>
                    void run(
                      async () =>
                        `${action} confirmed: ${await wallet!.sets(action, parseUnitsExact(amount, decimals), outcome)}`,
                    )
                  }
                >
                  {action === "mint"
                    ? "Create sets"
                    : action === "merge"
                      ? "Merge sets"
                      : `Redeem ${outcome === 0 ? "YES" : "NO"}`}
                </button>
              ))}
            </div>
            <p>
              Void policy:{" "}
              {market.voidPolicy === 0
                ? "uniform payout"
                : "closing-book snapshot payout"}
              . Protocol settlement fees may reduce payouts.
            </p>
          </details>
          <p className="pt-muted">
            Game-result submission and automated trading agents are separate
            operator integrations.
          </p>
        </aside>
      </div>
    </fieldset>
  );
}
