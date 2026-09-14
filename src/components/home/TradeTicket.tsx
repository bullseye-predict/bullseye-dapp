import {
  ArrowUpRight,
  Check,
  ChevronDown,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ArenaMarket,
  ArenaMarketOutcome,
  SolzDataSource,
  SolzMatch,
  SolzSnapshot,
} from "../solz/model";
import {
  baseOutcomeId,
  isNoContract,
  predictionContract,
  type PredictionAnswer,
} from "../solz/predictionContracts";
import {
  accentStyle,
  AgentPortrait,
  amountLabel,
  TeamMark,
} from "./HomePrimitives";
import { availableShares, outcomeColor } from "./heroMarket";
import { TradeReviewDialog } from "./TradeReviewDialog";
import { OpenDreamDexMarket } from "./OpenDreamDexMarket";
import {
  marketOrderQuote,
  selfMatchingOrders,
  type OrderInput,
} from "../../../packages/adapters/dreamdex/trading";
import { sideLabel } from "../../../packages/adapters/dreamdex/activity";
import { dynamicEvmProvider } from "../prediction/dynamicEvmProvider";
import { refreshDreamDex, refreshSolana } from "./venue/revision";
import {
  createMarketBrowser,
  useDreamDexSnapshot,
} from "./useDreamDexSnapshot";
import { parseUnits } from "viem";
import type { PublicPredictionVenue } from "../../../packages/prediction-core/market-data";
import type { ReservedSolanaQuestion } from "./solanaQuestionMarkets";
import { manifestClient } from "./venue/manifestClients";
import { useSolanaMarket } from "./venue/useSolanaMarket";
import { binaryBuyQuote } from "../../../packages/adapters/solana/manifest/quotes";
import { explorerTxUrl } from "../../../packages/adapters/explorer";
import { toast } from "sonner";
import { pushAlert as pushGlobalAlert } from "./alerts/store";
import { createToastIds } from "./alerts/toastIds";
import { useEvmWallet, useSolanaWallet } from "../session/store";
import { dreamDexBinding, venueBinding } from "./venue/useVenueMarket";
import { ownedShares, sellableShares, takerBps, useSolanaHoldings } from "./venue/useSolanaHoldings";
import type { SolanaBinding } from "./venue/types";
import { ManifestBrowserWallet } from "../../../packages/adapters/solana/manifest/browser";
import { takerFee } from "../../../packages/adapters/solana/manifest/wire";
import { parseUnitsExact } from "../prediction/amounts";

type Props = {
  source: SolzDataSource;
  snapshot: SolzSnapshot;
  market: ArenaMarket;
  outcome: ArenaMarketOutcome;
  onOutcome: (outcome: ArenaMarketOutcome) => void;
  answer: PredictionAnswer;
  onAnswer: (answer: PredictionAnswer) => void;
  simulation: boolean;
  collateralSymbol?: string;
  dreamDexApiUrl?: string;
  onDreamDexOpened?: () => void;
  match?: SolzMatch;
  buyAmount?: string;
  onBuyAmountChange?: (value: string) => void;
  preparing?: boolean;
  solana?: boolean;
  solanaVenue?: PublicPredictionVenue | null;
  solanaQuestion?: ReservedSolanaQuestion;
  predictionApiUrl?: string;
};
export function TradeTicket({
  source,
  snapshot,
  market,
  outcome,
  onOutcome,
  answer,
  onAnswer,
  simulation,
  collateralSymbol = "COOLA",
  dreamDexApiUrl = "",
  onDreamDexOpened,
  match,
  buyAmount,
  onBuyAmountChange,
  preparing = false,
  solana = false,
  solanaVenue = null,
  solanaQuestion,
  predictionApiUrl = "",
}: Props) {
  // The connected wallets come from the session store rather than four levels
  // of props through components that never touched them.
  const evmWallet = useEvmWallet();
  const solanaWallet = useSolanaWallet();

  const pushAlert = (alert: Parameters<typeof pushGlobalAlert>[0]) => pushGlobalAlert({ ...alert, marketScope: solanaBinding ? `${solanaBinding.rpcUrl}:${solanaBinding.marketId}` : undefined });
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [type, setType] = useState<"market" | "limit">("market");
  const [orderTypeMenuOpen, setOrderTypeMenuOpen] = useState(false);
  const [priceFormat, setPriceFormat] = useState<
    "cents" | "decimal" | "percent"
  >("cents");
  const [priceFormatMenuOpen, setPriceFormatMenuOpen] = useState(false);
  const [limitPriceDraft, setLimitPriceDraft] = useState<string | null>(null);
  const [localAmount, setLocalAmount] = useState("1");
  const amount = buyAmount ?? localAmount;
  const setAmount = (value: string) => {
    setLocalAmount(value);
    onBuyAmountChange?.(value);
  };
  const [clock, setClock] = useState(() => Date.now());
  const [shares, setShares] = useState("1");
  const multiple = market.outcomes.length > 2;
  const contract = predictionContract(outcome, multiple ? answer : "yes");
  const [limitPrice, setLimitPrice] = useState(
    String(Math.round(contract.probability * 100)),
  );
  const [expiry, setExpiry] = useState("close");
  const [review, setReview] = useState(false);
  const [reviewTerms, setReviewTerms] = useState<{
    input: OrderInput;
    price: number;
    quantity: number;
    total: number;
  } | null>(null);
  const [solanaReview, setSolanaReview] = useState<ReturnType<typeof binaryBuyQuote> | null>(null);
  const [progress, setProgress] = useState("");
  const [ordersExpanded, setOrdersExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    error?: boolean;
    hash?: string;
  } | null>(null);
  const color = outcomeColor(outcome, snapshot);
  const account = useDreamDexSnapshot(
    market,
    simulation ? undefined : evmWallet?.address,
  );
  const balances = evmWallet ? account.data?.balances : null;
  const outcomeIndex = market.outcomes.findIndex(
    (item) => item.id === outcome.id,
  );
  // The DreamDEX snapshot is structurally dead on Solana, so every Solana
  // question rendered "Available shares · Loading…" forever. Manifest custody is
  // its own read: shares sit in a venue seat, the wallet's own claim account and
  // the prediction position, and only the seat can back a resting sell.
  const solanaBinding =
    venueBinding(market)?.family === "SOLANA"
      ? (venueBinding(market) as SolanaBinding)
      : null;
  const solanaHoldings = useSolanaHoldings(
    solanaBinding,
    solanaWallet?.address,
    !simulation && solana && !pending,
  );
  const selectedHoldings = solanaHoldings.outcomes?.[outcomeIndex === 1 ? 1 : 0];
  const available = simulation
    ? availableShares(snapshot, market, contract)
    : balances
      ? Number(balances[outcomeIndex === 1 ? 2 : 1]) / 1_000_000
      : solanaHoldings.outcomes
        ? Number(sellableShares(selectedHoldings)) / 1_000_000
        : 0;
  const closed =
    (!solana && market.status !== "open") || snapshot.updatedAt >= market.closesAt;
  const binarySide =
    `${side === "buy" ? "BUY" : "SELL"}_${outcomeIndex === 1 ? "NO" : "YES"}` as OrderInput["side"];
  const livePreview = (() => {
    const data = account.data;
    if (simulation || !data?.pool) return null;
    try {
      const scale = 10n ** BigInt(data.market.decimals);
      if (type === "market")
        return data.book
          ? marketOrderQuote(
              data.book,
              binarySide,
              parseUnits(side === "buy" ? amount : shares, 6),
              data.market.decimals,
              data.pool.grid,
            )
          : null;
      const quantity = parseUnits(shares, 6);
      const limit = parseUnits(
        (Number(limitPrice) / 100).toFixed(2),
        data.market.decimals,
      );
      if (
        quantity < data.pool.grid.minQuantity ||
        quantity % data.pool.grid.lotSize ||
        limit % data.pool.grid.tickSize
      )
        return null;
      return {
        input: {
          side: binarySide,
          quantity,
          outcomePrice: limit,
          orderType: 0 as const,
        },
        filled: quantity,
        cost: (quantity * limit + scale - 1n) / scale,
        avgPrice: limit,
        maxCost: (quantity * limit + scale - 1n) / scale,
      };
    } catch {
      return null;
    }
  })();
  const evmBinding = dreamDexBinding(market);
  const solanaView = useSolanaMarket(solanaBinding, !simulation && solana && !pending, solanaWallet?.address);
  const solanaPreview = (() => {
    if (!solana || type !== "market" || side !== "buy") return { quote: null, error: "" };
    if (!solanaView.now) return { quote: null, error: "Loading executable prices…" };
    if (!solanaView.book) return { quote: null, error: "No sell liquidity yet. Choose Limit to open the market and place the first order." };
    try {
      return { quote: binaryBuyQuote(outcomeIndex === 1 ? solanaView.book.noAsks : solanaView.book.yesAsks, outcomeIndex === 1 ? solanaView.book.yesBids : solanaView.book.noBids, parseUnitsExact(amount, 6)), error: "" };
    } catch (reason) { return { quote: null, error: reason instanceof Error ? reason.message : "Market quote unavailable." }; }
  })();
  const indicativeOnly = !simulation && (!market.onchain || solana);
  const price = solana && type === "market"
    ? solanaPreview.quote ? Number(solanaPreview.quote.estimatedCost) / Number(solanaPreview.quote.quantity) : 0
    : simulation || indicativeOnly
      ? type === "limit" ? Number(limitPrice) / 100 : Math.max(0.01, contract.probability)
      : livePreview && account.data ? Number(livePreview.avgPrice) / 10 ** account.data.market.decimals : 0;
  const quantity = solana && type === "market"
    ? Number(solanaPreview.quote?.quantity ?? 0n) / 1_000_000
    : simulation || indicativeOnly
      ? side === "buy" && type === "market" ? Number(amount) / price : Number(shares)
      : livePreview ? Number(livePreview.filled) / 1_000_000 : 0;
  const gross = simulation || indicativeOnly
    ? quantity * price
    : livePreview && account.data ? Number(livePreview.cost) / 10 ** account.data.market.decimals : 0;
  const fee = simulation ? gross * 0.012 : 0;
  const total = side === "buy" ? gross + fee : gross - fee;
  // The venue's real rate, not the simulation's 1.2%. takerFee and
  // parseUnitsExact both throw on malformed input, and this sits in the bare
  // render body — an unguarded call would blank the whole ticket while someone
  // is still typing an amount.
  const solanaTakerBps = takerBps((solanaReview ?? solanaPreview.quote)?.route === "complete-set"
    ? solanaHoldings.outcomes?.[outcomeIndex === 1 ? 0 : 1] : selectedHoldings);
  const linkedAnswer = market.presentation?.kind === "linked" ? market.presentation.answer : undefined;
  const solanaMaxFee = (() => {
    if (!solana || solanaTakerBps === null || !solanaVenue) return null;
    try {
      const decimals = solanaVenue.collateralDecimals;
      const notional =
        type === "market"
          ? (solanaReview ?? solanaPreview.quote)?.route === "complete-set" ? (solanaReview ?? solanaPreview.quote)!.quantity : parseUnitsExact(amount, decimals)
          : (parseUnitsExact(shares, 6) * BigInt(Math.round(price * 1_000_000)) +
              999_999n) /
            1_000_000n;
      if (notional <= 0n) return null;
      return Number(takerFee(notional, solanaTakerBps)) / 10 ** decimals;
    } catch {
      return null;
    }
  })();
  const ownOrders =
    account.data?.orders.filter((order) => order !== null) ?? [];
  const conflicts =
    livePreview && account.data
      ? selfMatchingOrders(
          ownOrders,
          livePreview.input,
          account.data.market.decimals,
          account.data.now,
        )
      : [];
  // On Manifest the escrow is on the seat, not in an order list this ticket
  // holds, so it reads from holdings; the DreamDEX reduce below is permanently
  // zero on that venue and kept the row hidden.
  const reservedYes = solana
    ? solanaHoldings.outcomes?.[0]?.holdings?.venueReservedClaims ?? 0n
    : ownOrders
        .filter(
          (order) =>
            account.data?.orderSides[order.orderId.toString()] === "SELL_YES",
        )
        .reduce((sum, order) => sum + order.quantityRemaining, 0n);
  const reservedNo = solana
    ? solanaHoldings.outcomes?.[1]?.holdings?.venueReservedClaims ?? 0n
    : ownOrders
        .filter(
          (order) =>
            account.data?.orderSides[order.orderId.toString()] === "SELL_NO",
        )
        .reduce((sum, order) => sum + order.quantityRemaining, 0n);
  const positions = (simulation ? snapshot.account.positions : []).filter(
    (position) => position.marketId === market.id && position.token === "COOLA",
  );
  const orders = (simulation ? snapshot.limitOrders : [])
    .filter((order) => order.marketId === market.id)
    .slice(0, 5);
  const valid =
    Number.isFinite(quantity) &&
    quantity > 0 &&
    price >= 0.01 &&
    price <= (type === "limit" ? 0.99 : 1) &&
    (side !== "sell" ||
      (simulation
        ? quantity
        : Number(livePreview?.input.quantity ?? 0n) / 1_000_000) <= available);
  const liveDreamDex =
    !simulation &&
    !solana &&
    collateralSymbol === "tUSDC" &&
    evmBinding?.chainId === "50312";
  const liveSolana = !simulation && solana && Boolean(solanaVenue?.programId && solanaVenue.manifestProgramId && solanaVenue.publicRpcUrl && solanaQuestion && predictionApiUrl);
  const unavailable =
    (!simulation && !liveDreamDex && !liveSolana) ||
    closed ||
    (simulation && side === "sell" && available < 0.01) ||
    (liveDreamDex && (!evmWallet || !account.data || !!account.error)) ||
    (liveSolana && !solanaWallet);
  const solanaUnavailableMessage = !solana
    ? null
    : closed
      ? "Trading has closed for this question."
      : !solanaVenue?.programId ||
          !solanaVenue.manifestProgramId ||
          !solanaVenue.publicRpcUrl
        ? "Manifest venue configuration is unavailable. Reload after the prediction service reconnects."
        : !solanaQuestion
          ? "This question is visible, but it has no backend creation permit yet. It cannot be opened on-chain."
          : !predictionApiUrl
            ? "The prediction service is unavailable, so the creation permit cannot be requested."
            : !solanaWallet
              ? `Connect a Solana wallet to trade. SOL pays network fees and first-trader rent; the order itself uses ${collateralSymbol}.`
              : null;
  const gameRemainingMs =
    preparing || match?.phase !== "live" || match.timingType === "open-ended"
      ? null
      : Math.max(0, match.endsAt - clock);
  const safeLabel = (value: number) =>
    amountLabel(Number.isFinite(value) ? value : 0);
  const formatOutcomePrice = (probability: number) => {
    const cents = Math.round(Math.max(0, Math.min(1, probability)) * 100);
    return priceFormat === "decimal"
      ? (cents / 100).toFixed(2)
      : priceFormat === "percent"
        ? `${cents}%`
        : `${cents}¢`;
  };

  useEffect(() => {
    setLimitPrice(String(Math.round(contract.probability * 100)));
    setFeedback(null);
    setReview(false);
    setOrderTypeMenuOpen(false);
    setPriceFormatMenuOpen(false);
    setLimitPriceDraft(null);
  }, [
    market.matchId,
    market.id,
    market.onchain?.marketId,
    evmBinding?.chainId,
    contract.id,
  ]);
  useEffect(() => {
    if (!simulation) setReview(false);
  }, [simulation]);
  useEffect(() => {
    if (
      !match ||
      match.timingType === "open-ended" ||
      match.phase === "settled"
    )
      return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [match?.id, match?.phase, match?.timingType]);
  useEffect(() => {
    if (!simulation && ["tUSDC", "fUSDC"].includes(collateralSymbol)) {
      setAmount("1");
      setShares("1");
    }
  }, [collateralSymbol, market.id, simulation]);
  const displayedLimitPrice =
    priceFormat === "decimal"
      ? (Number(limitPrice) / 100).toFixed(2)
      : limitPrice;
  const updateDisplayedLimitPrice = (value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setLimitPrice(
      String(
        Math.max(
          1,
          Math.min(
            99,
            Math.round(priceFormat === "decimal" ? parsed * 100 : parsed),
          ),
        ),
      ),
    );
  };
  async function submit() {
    if (pending || unavailable || !valid) return;
    setPending(true);
    setFeedback(null);
    setProgress("Checking your order…");
    try {
      if (liveDreamDex) {
        const binding = evmBinding!;
        const adapter = createMarketBrowser(market);
        try {
          const provider = await dynamicEvmProvider(
            evmWallet!,
            binding.chainId,
          );
          const wallet = await adapter.connect(provider);
          try {
            const snapshot = await adapter.snapshot(wallet.owner);
            if (!snapshot.pool)
              throw Error("This event pool is not available for trading yet.");
            const input = reviewTerms?.input;
            if (!input)
              throw Error("Review the current quote before submitting.");
            const crossing = selfMatchingOrders(
              snapshot.orders.filter((order) => order !== null),
              input,
              snapshot.market.decimals,
              snapshot.now,
            );
            if (crossing.length) throw Error("SelfMatchCancelTaker");
            const result = await wallet.orderDetailed(input, (event) => {
              setProgress(
                event.stage === "approval"
                  ? "Step 1 · Approve token access in your wallet. This does not buy shares."
                  : event.stage === "approval-confirmed"
                    ? "Token approval confirmed. Your trade still needs a separate confirmation."
                    : "Step 2 · Confirm the trade in your wallet, then wait for its result.",
              );
              if (event.stage === "approval-confirmed")
                refreshDreamDex(binding.chainId);
            });
            const filled = safeLabel(Number(result.filled) / 1_000_000),
              resting = safeLabel(Number(result.resting) / 1_000_000);
            const label = input.side.endsWith("YES") ? "YES" : "NO";
            const resultText =
              result.filled > 0n
                ? `${side === "buy" ? "Bought" : "Sold"} ${filled} ${label} shares. ${result.resting > 0n ? `${resting} shares still waiting in your limit order.` : result.cancelled > 0n ? "Partially filled; the unfilled remainder was cancelled." : "Fully filled."}`
                : result.resting > 0n
                  ? `Limit order placed. ${resting} ${label} shares waiting for a match; no shares filled yet.`
                  : "No shares filled. The market order remainder was cancelled.";
            setFeedback({ text: resultText, hash: result.hash });
            setOrdersExpanded(result.resting > 0n);
            refreshDreamDex(binding.chainId);
          } finally {
            wallet.dispose();
          }
        } finally {
          await adapter.close();
        }
      } else if (liveSolana) {
        if (!solanaWallet || !solanaVenue?.programId || !solanaVenue.manifestProgramId || !solanaVenue.publicRpcUrl || !solanaQuestion)
          throw Error("Connect a Solana wallet and wait for the Manifest deployment configuration.");
        if (side !== "buy") throw Error("Buy an outcome first; selling requires available claim shares.");
        setProgress("Preparing the Pinocchio question and guarded Manifest books…");
        const client = manifestClient(solanaVenue.publicRpcUrl, {
          genesisHash: solanaVenue.chainId,
          predictionProgram: solanaVenue.programId,
          manifestProgram: solanaVenue.manifestProgramId,
          collateralMint: solanaVenue.collateralToken,
        });
        // Each wallet prompt names the transaction it is asking for, so a first
        // trade (question creation, two book activations, funding, order) is not
        // four anonymous approvals in a row.
        const toasts = createToastIds("solana-tx");
        const wallet = new ManifestBrowserWallet(client.adapter, solanaWallet, client, (stage) => {
          const id = toasts.idFor(stage.step);
          if (stage.status === "preparing") {
            toast.loading(stage.step, { id, description: "Checking the transaction on Solana" });
            pushAlert({ level: "info", title: stage.step, detail: "Checking the transaction on Solana" });
          }
          else if (stage.status === "signing") {
            toast.loading(stage.step, { id, description: "Approve in your wallet" });
            pushAlert({ level: "info", title: stage.step, detail: "Waiting for your wallet signature" });
          }
          else if (stage.status === "failed") {
            toasts.settle(stage.step);
            // A failure stays until it is dismissed by hand. Everything else here
            // is worth glancing at; this is worth reading.
            toast.error(stage.step, { id, description: stage.error, duration: Infinity });
            pushAlert({ level: "error", title: stage.step, detail: stage.error });
          }
          else {
            toasts.settle(stage.step);
            const href = stage.signature ? explorerTxUrl(solanaVenue, stage.signature) : undefined;
            pushAlert({ level: "success", title: stage.step, detail: "Confirmed on Solana", href });
            toast.success(stage.step, {
              id,
              description: "Confirmed on Solana",
              ...(href ? { action: { label: "View", onClick: () => window.open(href, "_blank", "noreferrer") } } : {}),
            });
          }
        });
        try {
          const activation = await wallet.activateQuestion(predictionApiUrl, solanaQuestion);
          // Refresh once the flow finishes. Refreshing after every setup step
          // made balance/history reads compete with the next transaction.
          const invalidate = () => refreshSolana(solanaVenue.publicRpcUrl!, solanaQuestion.marketId);

          setProgress(`Funding this outcome book with ${solanaVenue.collateralSymbol}…`);
          const selected = market.outcomes.findIndex((item) => item.id === outcome.id) === 1 ? 1 : 0;
          const binding = await client.binding(solanaQuestion.marketId, selected);
          if (type === "market" && !solanaReview) throw Error("Review an executable market quote before submitting.");
          const priceMicros = type === "market" ? solanaReview!.priceMicros : BigInt(Math.round(price * 1_000_000));
          const quantityAtoms = type === "market" ? solanaReview!.quantity : parseUnitsExact(shares, 6);
          const amountAtoms = (quantityAtoms * priceMicros + 999_999n) / 1_000_000n;
          let hash: string;
          const complementary = type === "market" && solanaReview?.route === "complete-set";
          if (complementary) {
            const opposite = await client.binding(solanaQuestion.marketId, selected === 0 ? 1 : 0);
            const book = await client.adapter.readBook(opposite);
            const bids = book.bids().filter(order => !order.trader.equals(wallet.owner));
            if (!bids.some(order => BigInt(order.price.toString()) / 10n ** 12n >= 1_000_000n - priceMicros))
              throw Error("The opposite bids changed or belong to you. Refresh and review the new quote.");
            await wallet.prepare(opposite);
            const holdings = await client.adapter.holdings(wallet.owner, opposite);
            // A better execution can return more collateral and incur a larger
            // fee, so bound the fee by a full unit per share, not the net cost.
            const maximumFee = takerFee(quantityAtoms, opposite.bps);
            if (holdings.walletUsdc < quantityAtoms + maximumFee)
              throw Error(`This complete-set purchase temporarily needs ${Number(quantityAtoms + maximumFee) / 1_000_000} ${solanaVenue.collateralSymbol} in your wallet. The opposite sale returns the unused cost in the same transaction.`);
            setProgress("Buying through the opposite outcome bids…");
            hash = await wallet.completeSetBuy(opposite, quantityAtoms, solanaReview!.maximumCost, maximumFee);
          } else {
            if (type === "market") {
              const book = await client.adapter.readBook(binding);
              const asks = book.asks().filter(order => !order.trader.equals(wallet.owner));
              if (!asks.some(order => BigInt(order.price.toString()) / 10n ** 12n <= priceMicros))
                throw Error("No other seller is available within your reviewed price. Choose Limit or wait for liquidity.");
            }
            await wallet.prepare(binding);
            if (amountAtoms <= 0n || quantityAtoms <= 0n)
              throw Error(`Enter a positive ${solanaVenue.collateralSymbol} amount.`);
            const holdings = await client.adapter.holdings(wallet.owner, binding);
            const missing = amountAtoms > holdings.venueAvailableUsdc ? amountAtoms - holdings.venueAvailableUsdc : 0n;
            const maximumFee = takerFee(amountAtoms, binding.bps);
            if (holdings.walletUsdc < missing + maximumFee)
                throw Error(`Not enough ${solanaVenue.collateralSymbol}. Keep the order amount plus up to ${Number(maximumFee) / 10 ** solanaVenue.collateralDecimals} ${solanaVenue.collateralSymbol} for an executed taker fee.`);
            if (missing > 0n) {
              await wallet.send(await client.adapter.moveTokens(wallet.owner, binding, "USDC", missing, "deposit"), `Funding the book with ${solanaVenue.collateralSymbol}`);
            }
            setProgress("Submitting your Manifest trade order…");
            hash = await wallet.send(await client.adapter.order(wallet.owner, binding, {
              side: "BUY",
              quantity: quantityAtoms,
              priceMicros,
              lastValidSlot: 0,
              kind: type === "market" ? "IOC" : "LIMIT",
              maxFeeAtoms: maximumFee,
            }), "Submitting your order");
          }
          invalidate();
          const summary = `${activation.length ? "Market activated and " : ""}trade order submitted on Manifest`;
          const href = explorerTxUrl(solanaVenue, hash);
          // Surfaced as a toast rather than text under the button, which sits
          // below the fold once the ticket is scrolled.
          toast.success(summary, {
            id: `solana-order:${hash}`,
            description: complementary ? "Purchased through opposite bids. Your selected shares are in your prediction position; sale proceeds returned to your wallet." : type === "market" ? "Only matched shares were purchased. Any unfilled remainder was cancelled; unused funds remain in your book balance." : "Unmatched shares remain in your limit order. Check Activity for fills.",
            duration: 12_000,
            ...(href ? { action: { label: "View", onClick: () => window.open(href, "_blank", "noreferrer") } } : {}),
          });
          pushAlert({ level: "success", title: summary, detail: complementary ? "Purchased through opposite bids. Your selected shares are in your prediction position; sale proceeds returned to your wallet." : type === "market" ? "Only matched shares were purchased. Any unfilled remainder was cancelled; unused funds remain in your book balance." : "Unmatched shares remain in your limit order. Check Activity for fills.", href });
          setFeedback({ text: `${summary}.`, hash });
        } finally {
          wallet.dispose();
        }
      } else if (type === "limit") {
        const order = await source.placeLimitOrder({
          marketId: market.id,
          outcomeId: contract.id,
          side,
          token: "COOLA",
          price,
          shares: quantity,
          expiresAt:
            expiry === "close"
              ? market.closesAt
              : Date.now() + Number(expiry) * 60_000,
        });
        setFeedback({
          text:
            order.status === "filled"
              ? `Limit ${side} filled · ${safeLabel(quantity)} shares.`
              : `Limit ${side} placed at ${limitPrice}¢. ${side === "buy" ? "Credits" : "Shares"} reserved.`,
        });
      } else if (side === "buy") {
        const receipt = await source.placeOrder({
          market,
          outcome: contract,
          token: "COOLA",
          amount: Number(amount),
        });
        setFeedback({
          text: `Bought ${safeLabel(receipt.position.shares)} ${contract.label} shares.`,
        });
      } else {
        await source.sellShares(market.id, contract.id, "COOLA", quantity);
        setFeedback({
          text: `Sold ${safeLabel(quantity)} ${contract.label} shares.`,
        });
      }
      setReview(false);
    } catch (reason) {
      const selfMatch =
        reason instanceof Error &&
        reason.message.includes("SelfMatchCancelTaker");
      const text = selfMatch
        ? "Trade not completed: your own opposing order blocks this trade. Cancel or change that open order below. Token approval alone does not buy shares."
        : `Trade not completed: ${reason instanceof Error ? reason.message : "Please check your wallet and try again."}`;
      setFeedback({ text, error: true });
      const detail = text.replace("Trade not completed: ", "");
      toast.error("Trade not completed", { description: detail, duration: Infinity });
      pushAlert({ level: "error", title: "Trade not completed", detail });
      setOrdersExpanded(true);
      setReview(false);
      if (evmBinding) refreshDreamDex(evmBinding.chainId);
      // A failed trade can still have landed its earlier transactions, so the
      // read model is stale either way. This branch never fired for Solana.
      if (solanaVenue?.publicRpcUrl && solanaQuestion) refreshSolana(solanaVenue.publicRpcUrl, solanaQuestion.marketId);
    } finally {
      setPending(false);
      setProgress("");
    }
  }

  async function cancelOrder(orderId: bigint) {
    if (pending || !evmWallet || !evmBinding) return;
    setPending(true);
    setFeedback(null);
    const adapter = createMarketBrowser(market);
    try {
      const wallet = await adapter.connect(
        await dynamicEvmProvider(evmWallet, evmBinding.chainId),
      );
      try {
        await wallet.cancel(orderId);
        refreshDreamDex(evmBinding.chainId);
        setFeedback({ text: "Order cancelled. Refreshing funds and shares." });
      } finally {
        wallet.dispose();
      }
    } catch (reason) {
      setFeedback({
        text: reason instanceof Error ? reason.message : "Cancellation failed.",
        error: true,
      });
    } finally {
      await adapter.close();
      setPending(false);
    }
  }

  return (
    <section
      className="ch-trade"
      aria-label="Trade ticket"
      style={accentStyle(color)}
    >
      {liveDreamDex && evmWallet && (
        <p className="ch-ticket-wallet">
          Trading as{" "}
          <strong>
            {evmWallet.address.slice(0, 6)}…{evmWallet.address.slice(-4)}
          </strong>
        </p>
      )}
      <div className="ch-trade-title">
        {linkedAnswer?.imageUrl ? (
          <img className="ch-trade-answer-image" src={linkedAnswer.imageUrl} alt="" />
        ) : linkedAnswer?.participantId ? (
          <AgentPortrait number={Number(linkedAnswer.participantId.split("-")[1])} />
        ) : outcome.participantId ? (
          <AgentPortrait number={Number(outcome.participantId.split("-")[1])} />
        ) : (
          <TeamMark id={linkedAnswer?.teamId ?? outcome.teamId ?? outcome.id} color={color} />
        )}
        <div>
          <span>{linkedAnswer ? market.presentation?.eventTitle ?? market.title : market.title}</span>
          <strong>{linkedAnswer ? `${linkedAnswer.label} · ${outcome.label}` : outcome.label}</strong>
        </div>
        {gameRemainingMs !== null && (
          <div
            className="ch-game-time"
            aria-label={`${Math.floor(gameRemainingMs / 60_000)} minutes ${Math.floor((gameRemainingMs % 60_000) / 1_000)} seconds left`}
          >
            <span>
              <b>
                {String(Math.floor(gameRemainingMs / 60_000)).padStart(2, "0")}
              </b>
              <small>MINS</small>
            </span>
            <span>
              <b>
                {String(
                  Math.floor((gameRemainingMs % 60_000) / 1_000),
                ).padStart(2, "0")}
              </b>
              <small>SECS</small>
            </span>
          </div>
        )}
      </div>
      <div className="ch-trade-controls">
        <div aria-label="Trade side">
          {(["buy", "sell"] as const).map((value) => (
            <button
              key={value}
              className={`is-${value}`}
              aria-pressed={side === value}
              onClick={() => {
                setSide(value);
                setFeedback(null);
                if (value === "sell")
                  setShares(String(Math.floor(available * 100) / 100));
              }}
            >
              {value === "buy" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>
        <div className="ch-trade-order-actions">
          <div className="ch-price-format">
            <button
              type="button"
              aria-label="Choose odds format"
              aria-haspopup="menu"
              aria-expanded={priceFormatMenuOpen}
              onClick={() => setPriceFormatMenuOpen((open) => !open)}
            >
              <SlidersHorizontal size={13} />
            </button>
            {priceFormatMenuOpen && (
              <div
                className="ch-price-format-menu"
                role="menu"
                aria-label="Odds format"
              >
                <strong>ODD FORMAT</strong>
                {(
                  [
                    { id: "cents", label: "Price", detail: "44¢" },
                    { id: "decimal", label: "Decimal", detail: "0.44" },
                    { id: "percent", label: "Percentage", detail: "44%" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={priceFormat === option.id}
                    onClick={() => {
                      setPriceFormat(option.id);
                      setLimitPriceDraft(null);
                      setPriceFormatMenuOpen(false);
                    }}
                  >
                    <b>{option.label}</b>
                    <span>{option.detail}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="ch-order-type">
            <button
              type="button"
              className="ch-order-type-trigger"
              aria-haspopup="menu"
              aria-expanded={orderTypeMenuOpen}
              onClick={() => setOrderTypeMenuOpen((open) => !open)}
            >
              {type === "market" ? "Market" : "Limit"}
              <ChevronDown size={13} />
            </button>
            {orderTypeMenuOpen && (
              <div
                className="ch-order-type-menu"
                role="menu"
                aria-label="Order type"
              >
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={type === "market"}
                  onClick={() => {
                    setType("market");
                    setFeedback(null);
                    setOrderTypeMenuOpen(false);
                  }}
                >
                  <b>Market</b>
                  <span>Fill against the best live quote.</span>
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={type === "limit"}
                  onClick={() => {
                    setType("limit");
                    setFeedback(null);
                    setOrderTypeMenuOpen(false);
                  }}
                >
                  <b>Limit</b>
                  <span>Choose a price in whole cents.</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="ch-trade-outcomes" aria-label="Trade outcome">
        {multiple
          ? (["yes", "no"] as const).map((value) => (
              <button
                type="button"
                className={`is-${value}`}
                key={value}
                aria-pressed={answer === value}
                onClick={() => onAnswer(value)}
              >
                <span>{value === "yes" ? "Yes" : "No"}</span>
                <b>
                  {formatOutcomePrice(
                    value === "yes"
                      ? outcome.probability
                      : 1 - outcome.probability,
                  )}
                </b>
                {answer === value && <Check size={12} />}
              </button>
            ))
          : market.outcomes.map((item, index) => (
              <button
                type="button"
                className={index === 0 ? "is-yes" : "is-no"}
                key={item.id}
                aria-pressed={outcome.id === item.id}
                onClick={() => onOutcome(item)}
              >
                <span>{item.label}</span>
                <b>
                  {solana
                    ? (() => { const quote = index === 1 ? solanaView.quote?.no : solanaView.quote?.yes; const value = side === "buy" ? quote?.ask : quote?.bid; return value === undefined ? (solanaView.now ? (side === "buy" ? "No asks" : "No bids") : "…") : formatOutcomePrice(Number(value) / 1_000_000); })()
                    : formatOutcomePrice(item.probability)}
                </b>
                {item.id === outcome.id && <Check size={12} />}
              </button>
            ))}
      </div>
      {!simulation && !solana && collateralSymbol === "tUSDC" && !market.onchain && (
        <OpenDreamDexMarket
          preparing={preparing}
          apiUrl={dreamDexApiUrl}
          eventId={market.matchId}
          agentId={outcome.participantId}
          onOpened={() => onDreamDexOpened?.()}
        />
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setFeedback(null);
          if (!unavailable && valid) {
            if (!simulation && conflicts.length) {
              setFeedback({
                text: "Your own opposing order could match this trade. Cancel it below or change your outcome or price before continuing.",
                error: true,
              });
              setOrdersExpanded(true);
              return;
            }
            setSolanaReview(solanaPreview.quote);
            setReviewTerms(
              livePreview
                ? { input: livePreview.input, price, quantity, total }
                : null,
            );
            setReview(true);
          }
        }}
      >
        {type === "limit" && (
          <div className="ch-limit-price">
            <label htmlFor="limit-price">Limit price</label>
            <div>
              <button
                type="button"
                aria-label="Decrease limit price"
                onClick={() => {
                  setLimitPriceDraft(null);
                  setLimitPrice(String(Math.max(1, Number(limitPrice) - 1)));
                }}
              >
                −
              </button>
              <input
                id="limit-price"
                type="number"
                min={priceFormat === "decimal" ? ".01" : "1"}
                max={priceFormat === "decimal" ? ".99" : "99"}
                step={priceFormat === "decimal" ? ".01" : "1"}
                required
                value={limitPriceDraft ?? displayedLimitPrice}
                onChange={(event) => setLimitPriceDraft(event.target.value)}
                onBlur={() => {
                  if (limitPriceDraft !== null)
                    updateDisplayedLimitPrice(limitPriceDraft);
                  setLimitPriceDraft(null);
                }}
              />
              <span>
                {priceFormat === "decimal"
                  ? collateralSymbol
                  : priceFormat === "percent"
                    ? "%"
                    : "¢"}
              </span>
              <button
                type="button"
                aria-label="Increase limit price"
                onClick={() => {
                  setLimitPriceDraft(null);
                  setLimitPrice(String(Math.min(99, Number(limitPrice) + 1)));
                }}
              >
                +
              </button>
            </div>
          </div>
        )}
        <div className="ch-trade-amount">
          <label htmlFor="trade-quantity">
            {side === "buy" && type === "market" ? "Amount" : "Shares"}
          </label>
          <div>
            <input
              id="trade-quantity"
              aria-label={
                side === "buy" && type === "market"
                  ? "Trade amount"
                  : "Trade shares"
              }
              type="number"
              inputMode="decimal"
              required
              min={
                liveDreamDex || liveSolana
                  ? 1
                  : side === "buy" && type === "market"
                    ? 25
                    : 0.01
              }
              max={simulation && side === "sell" ? available : undefined}
              step={
                liveDreamDex && !(side === "buy" && type === "market")
                  ? "1"
                  : "any"
              }
              value={side === "buy" && type === "market" ? amount : shares}
              onChange={(event) =>
                side === "buy" && type === "market"
                  ? setAmount(event.target.value)
                  : setShares(event.target.value)
              }
            />
            <span>
              {side === "buy" && type === "market"
                ? collateralSymbol
                : "SHARES"}
            </span>
          </div>
        </div>
        <div className="ch-trade-presets">
          {side === "sell"
            ? [25, 50, 100].map((value) => (
                <button
                  type="button"
                  key={value}
                  onClick={() =>
                    setShares(String(Math.floor(available * value) / 100))
                  }
                >
                  {value === 100 ? "Max" : `${value}%`}
                </button>
              ))
            : [1, 5, 10].map((value) => (
                <button
                  type="button"
                  key={value}
                  onClick={() =>
                    type === "market"
                      ? setAmount(String(value))
                      : setShares(String(value))
                  }
                >
                  {value}
                </button>
              ))}
        </div>
        {(liveDreamDex || indicativeOnly) && (
          <div
            className="ch-ticket-summary"
            aria-label="Position and order summary"
          >
            <div>
              <span>Available shares</span>
              <strong>
                {balances
                  ? `${safeLabel(Number(balances[1]) / 1_000_000)} YES · ${safeLabel(Number(balances[2]) / 1_000_000)} NO`
                  : /* Four states, not two. "Loading…" forever was the old
                       behaviour for every one of the last three. */
                    !solana
                    ? "Loading…"
                    : !solanaWallet
                      ? "Connect a wallet"
                      : solanaHoldings.loading
                        ? "Loading…"
                        : solanaHoldings.error
                          ? "Balances unavailable"
                          : !solanaHoldings.outcomes
                            ? "—"
                            : solanaHoldings.outcomes.every((entry) => !entry.holdings)
                              ? "No books opened yet"
                              : `${safeLabel(Number(ownedShares(solanaHoldings.outcomes[0])) / 1_000_000)} YES · ${safeLabel(Number(ownedShares(solanaHoldings.outcomes[1])) / 1_000_000)} NO`}
              </strong>
            </div>
            {(reservedYes > 0n || reservedNo > 0n) && (
              <div>
                <span>Reserved to sell</span>
                <strong>
                  {safeLabel(Number(reservedYes) / 1_000_000)} YES ·{" "}
                  {safeLabel(Number(reservedNo) / 1_000_000)} NO
                </strong>
              </div>
            )}
            {liveDreamDex && balances && (
              <div>
                <span>Available funds</span>
                <strong>
                  {safeLabel(
                    Number(balances[0]) / 10 ** account.data!.market.decimals,
                  )}{" "}
                  {collateralSymbol}
                </strong>
              </div>
            )}
            {/* Its own branch: the DreamDEX body above asserts account.data,
                which is null on Solana. The seat and the wallet are separate
                custodians, and the submit path deposits the shortfall itself. */}
            {solana && selectedHoldings?.holdings && (
              <div>
                <span>Available funds</span>
                <strong>
                  {safeLabel(
                    Number(
                      selectedHoldings.holdings.venueAvailableUsdc +
                        selectedHoldings.holdings.walletUsdc,
                    ) /
                      10 ** (solanaVenue?.collateralDecimals ?? 6),
                  )}{" "}
                  {collateralSymbol}
                </strong>
              </div>
            )}
            {type === "limit" && (
              <div>
                <span>Expires</span>
                <strong>Market close</strong>
              </div>
            )}
            {/* Its own row, never folded into the total: the fee applies to
                executed notional only, so an order that rests pays nothing.
                `fee` above is hard-zero on every live path, which meant the
                only rate this ticket ever showed was the simulation's. */}
            {solana && side === "buy" && (
              <div>
                <span>
                  Max taker fee
                  {solanaTakerBps !== null && ` · ${solanaTakerBps / 100}%`}
                </span>
                <strong>
                  {solanaTakerBps === null
                    ? "Set when the market opens"
                    : solanaMaxFee === null
                      ? "—"
                      : `${safeLabel(solanaMaxFee)} ${collateralSymbol}`}
                </strong>
              </div>
            )}
            <div>
              <span>
                {side === "buy"
                  ? type === "market"
                    ? "Estimated cost"
                    : "Reserved if unfilled"
                  : "Estimated proceeds"}
              </span>
              <strong>
                {price > 0 ? `${safeLabel(total)} ${collateralSymbol}` : "—"}
              </strong>
            </div>
            {side === "buy" && (
              <div className="is-win">
                <span>Payout if filled & correct</span>
                <strong>
                  {price > 0
                    ? `${safeLabel(quantity)} ${collateralSymbol}`
                    : "—"}
                </strong>
              </div>
            )}
          </div>
        )}
        <div className="ch-trade-action">
          <button
            className="ch-submit-trade"
            disabled={pending || unavailable || !valid}
          >
            {pending && liveSolana ? "Trading on Solana…" : "Trade"} <ArrowUpRight size={17} />
          </button>
          <p className="ch-sample-note">
            {!simulation
              ? liveDreamDex
                ? !evmWallet
                  ? "Connect a Somnia wallet to sign a real tUSDC order."
                  : closed
                    ? "This event is closed to new orders."
                    : type === "market"
                      ? conflicts.length
                        ? "Your own order is at a crossing price. Cancel it below before trading."
                        : "Market orders fill immediately against available orders. Any unfilled remainder is cancelled."
                      : "Limit orders can wait for a match. Unfilled buys reserve funds; unfilled sells reserve shares."
                : solana
                  ? solanaUnavailableMessage ?? (type === "market" ? solanaPreview.error || "Market orders fill against sellers up to your reviewed price. Unfilled shares cancel." : null) ??
                    `Your first trade activates the Pinocchio market and guarded Manifest books, then submits the ${collateralSymbol} order here.`
                  : `On-chain ${collateralSymbol} trading opens when this question has a confirmed DreamDEX event contract.`
              : closed
                ? "This market is closed."
                : side === "sell" && available < 0.01
                  ? "You have no shares of this outcome to sell."
                  : "Simulation · off-chain credits only"}
          </p>
        </div>
      </form>
      {feedback && !review && (
        <p
          className={`ch-trade-feedback ${feedback.error ? "is-error" : ""}`}
          role={feedback.error ? "alert" : "status"}
        >
          {feedback.text}
          {feedback.hash && (() => {
            // The link must follow the venue the trade actually executed on.
            // Hardcoding one chain's explorer sent every Solana signature to the
            // Somnia explorer, where it does not exist.
            const href = liveSolana
              ? explorerTxUrl(solanaVenue, feedback.hash)
              : explorerTxUrl({ family: "EVM", chainId: "50312", explorerUrl: "https://shannon-explorer.somnia.network" }, feedback.hash);
            return href ? (
              <a href={href} target="_blank" rel="noreferrer">
                {" "}
                View transaction ↗
              </a>
            ) : null;
          })()}
        </p>
      )}
      {liveDreamDex && evmWallet && (
        <details
          className="ch-holdings"
          aria-label="Open on-chain orders"
          open={ordersExpanded}
          onToggle={(event) => setOrdersExpanded(event.currentTarget.open)}
        >
          <summary>
            Orders & reserves <span>{ownOrders.length}</span>
          </summary>
          <p className="ch-order-help">
            These are not new holdings. Cancelling returns the remaining
            reserved funds or shares.
          </p>
          {ownOrders.map((order) => {
            const orderSide =
              account.data!.orderSides[order.orderId.toString()];
            const scale = 10n ** BigInt(account.data!.market.decimals);
            const orderPrice = orderSide?.endsWith("NO")
              ? scale - order.price
              : order.price;
            const isBuy = orderSide?.startsWith("BUY");
            const expired =
              order.expireTimestampNs <= BigInt(account.data!.now) * 1_000_000n;
            return (
              <p
                key={order.orderId.toString()}
                className={
                  conflicts.some((item) => item.orderId === order.orderId)
                    ? "ch-conflicting-order"
                    : ""
                }
              >
                <span>
                  <strong>
                    {orderSide ? sideLabel(orderSide) : "Order side syncing"} ·{" "}
                    {safeLabel(Number(order.quantityRemaining) / 1_000_000)}{" "}
                    remaining
                  </strong>
                  <small>
                    {orderSide
                      ? `${safeLabel((Number(orderPrice) / Number(scale)) * 100)}¢ · ${isBuy ? `${safeLabel(Number((order.quantityRemaining * orderPrice) / scale) / 1_000_000)} ${collateralSymbol} reserved` : "shares reserved to sell"}`
                      : "Live quantity confirmed; side details awaiting indexer"}
                  </small>
                  <small>
                    {expired
                      ? "Expired · cancel to release reserves"
                      : order.fullQuantity > order.quantityRemaining
                        ? "Partially filled · remainder waiting"
                        : "Waiting for a match"}
                    {conflicts.some((item) => item.orderId === order.orderId)
                      ? " · conflicts with this trade"
                      : ""}
                  </small>
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void cancelOrder(order.orderId)}
                >
                  {expired ? "Release" : "Cancel"}
                </button>
              </p>
            );
          })}
          {account.error && <p role="alert">{account.error}</p>}
          {account.data?.orderMetadataUnavailable && (
            <p>
              Order labels are temporarily unavailable; balances and remaining
              quantities are read on chain.
            </p>
          )}
          {account.data && ownOrders.length === 0 && <p>No waiting orders.</p>}
        </details>
      )}
      {(positions.length > 0 || orders.length > 0) && (
        <details className="ch-holdings">
          <summary>
            Your activity{" "}
            <span>
              {positions.length} positions ·{" "}
              {orders.filter((order) => order.status === "open").length} open
              orders
            </span>
          </summary>
          <div>
            {positions.map((position) => (
              <p key={position.id}>
                <span>
                  {position.outcomeLabel}
                  <small>
                    {amountLabel(position.shares)} shares ·{" "}
                    {amountLabel(position.value)} COOLA
                  </small>
                </span>
                <button
                  disabled={!simulation}
                  onClick={() => {
                    const selected = market.outcomes.find(
                      (item) => item.id === baseOutcomeId(position.outcomeId),
                    );
                    if (selected) onOutcome(selected);
                    onAnswer(isNoContract(position.outcomeId) ? "no" : "yes");
                    setSide("sell");
                    setShares(String(Math.floor(position.shares * 100) / 100));
                    setType("market");
                  }}
                >
                  Sell
                </button>
              </p>
            ))}
            {orders.map((order) => (
              <p key={order.id}>
                <span>
                  {order.side.toUpperCase()} {order.label}
                  <small>
                    {amountLabel(order.shares)} shares @{" "}
                    {Math.round(order.price * 100)}¢ · {order.status}
                  </small>
                </span>
                {order.status === "open" && (
                  <button
                    disabled={!simulation}
                    aria-label={`Cancel ${order.label} limit order`}
                    onClick={() => source.cancelLimitOrder(order.id)}
                  >
                    <X size={13} />
                  </button>
                )}
              </p>
            ))}
          </div>
        </details>
      )}
      <TradeReviewDialog
        open={review}
        onClose={() => setReview(false)}
        onConfirm={() => void submit()}
        pending={pending}
        disabled={unavailable || !valid}
        title={market.title}
        label={
          multiple
            ? `${answer.toUpperCase()} · ${outcome.label}`
            : outcome.label
        }
        side={side}
        type={type}
        price={solanaReview ? Number(solanaReview.estimatedCost) / Number(solanaReview.quantity) : reviewTerms?.price ?? price}
        quantity={solanaReview ? Number(solanaReview.quantity) / 1_000_000 : reviewTerms?.quantity ?? quantity}
        fee={fee}
        total={solanaReview ? Number(solanaReview.estimatedCost) / 1_000_000 : reviewTerms?.total ?? total}
        priceLimit={solanaReview ? Number(solanaReview.priceMicros) / 1_000_000 : undefined}
        maximumTotal={solanaReview ? Number(solanaReview.maximumCost) / 1_000_000 : undefined}
        upfrontCollateral={solanaReview?.route === "complete-set" ? Number(solanaReview.upfrontCollateral) / 1_000_000 : undefined}
        maximumFee={solana ? solanaMaxFee ?? undefined : undefined}
        progress={progress}
        expiry={expiry}
        onExpiry={setExpiry}
        simulation={simulation}
        network={solana ? "SOLANA" : "SOMNIA"}
        collateralSymbol={collateralSymbol}
        error={
          closed
            ? simulation
              ? "This market closed before confirmation. Your credits have not been used."
              : "This event closed before confirmation. No wallet transaction was submitted."
            : feedback?.error
              ? feedback.text
              : undefined
        }
      />
    </section>
  );
}
