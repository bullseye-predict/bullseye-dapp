import { placeBinaryLimitBuy } from '../../../packages/adapters/solana/manifest/limit'
import {
  ArrowLeftRight,
  ArrowUpRight,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { executable, useSolanaMarket } from "./venue/useSolanaMarket";
import { binaryBuyQuote } from "../../../packages/adapters/solana/manifest/quotes";
import { nextBinaryBuy } from "../../../packages/adapters/solana/manifest/limit";
import { planSellInventory, quoteSell } from "../../../packages/adapters/solana/manifest/inventory";
import { explorerTxUrl } from "../../../packages/adapters/explorer";
import { notify } from "../feedback/notify";
import { SoundToggle } from "../feedback/SoundToggle";
import { pushAlert as pushGlobalAlert } from "./alerts/store";
import { createToastIds } from "./alerts/toastIds";
import { useEvmWallet, useSolanaWallet } from "../session/store";
import { dreamDexBinding, venueBinding } from "./venue/useVenueMarket";
import { sellableShares, takerBps, useSolanaHoldings } from "./venue/useSolanaHoldings";
import type { SolanaBinding } from "./venue/types";
import { ManifestBrowserWallet } from "../../../packages/adapters/solana/manifest/browser";
import { applyStage, planTradeSteps, reconcileSteps, TRADE_STEPS, type LiveStep, type StepFacts } from "../../../packages/adapters/solana/manifest/steps";
import { useQuestionPresence } from "./venue/useQuestionPresence";
import { takerFee } from "../../../packages/adapters/solana/manifest/wire";
import { parseUnitsExact } from "../prediction/amounts";
import { PRICE_PLACEHOLDER } from "./venue/quoteLabels";
import { clearBookPick, getBookPick, useBookPick } from "./venue/bookPick";
import { setTradeSide, useTradeSide } from "./venue/tradeSide";
import { pickColor, pickInk } from "../markets/moneyline";

/** The countdown badge appears only inside the last five minutes. */
const COUNTDOWN_VISIBLE_MS = 5 * 60_000;

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
  // Published rather than local: the market rows beside this ticket quote a
  // price per outcome, and that price only means anything against a direction.
  const side = useTradeSide();
  const setSide = setTradeSide;
  const [type, setType] = useState<"market" | "limit">("market");
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
  // A price level picked out of the order book. It arrives through a store
  // rather than a prop because the book sits six components away under a
  // different parent, and the event page assembles the same pair through
  // different parents again.
  const bookPick = useBookPick();
  const ticketIsNo = multiple ? answer === "no" : outcome.id === "no";
  /** The contract a live pick speaks for. While it holds, the re-seed effects
   *  below leave the price and the share count alone: `market.onchain?.marketId`
   *  resolves seconds after mount with no user action at all, and re-seeding
   *  then would quietly undo what the trader had just chosen from the book. */
  const pickedContract = `${market.id}|${contract.id}`;
  const pickOwner = useRef<string | null>(null);
  // Seeded from whatever is already in the store, so a pick left behind by a
  // previous ticket instance counts as spent: a remount must not replay it
  // into whichever contract happens to be selected now.
  const appliedPick = useRef(getBookPick()?.nonce ?? 0);
  /** Which direction the live pick was last applied for. A picked level survives
   *  a Buy/Sell switch — the price is still the one the trader chose — so the
   *  size and the rounding have to be recomputed for the new direction, or the
   *  panel says "20,490 matching" over a total of zero. */
  const appliedSide = useRef<"buy" | "sell" | null>(null);
  /** The trader taking the price back — typing it, stepping it, switching side
   *  or order type — ends the pick and unmarks the row in the book. */
  const releasePick = () => {
    pickOwner.current = null;
    appliedSide.current = null;
    clearBookPick();
  };
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
  // What the wallet has actually been asked for so far, and whether the run
  // has finished. Both drive the dialog's second pane; neither is derived from
  // `pending`, because a settled run keeps the rail on screen to be read.
  const [liveSteps, setLiveSteps] = useState<LiveStep[]>([]);
  const [settled, setSettled] = useState(false);
  // Clear the last run when the dialog opens, not only when a new one starts.
  // These outlive submit() on purpose — a finished trade keeps its rail on
  // screen to be read — so without this the next trade opened straight into the
  // previous trade's receipt instead of its own invoice.
  useEffect(() => {
    if (!review) return;
    setLiveSteps([]);
    setSettled(false);
  }, [review]);
  const [ordersExpanded, setOrdersExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    error?: boolean;
    hash?: string;
  } | null>(null);
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
  // `executable` rather than the raw ladder: the book now publishes the viewer's
  // own resting orders so the panel can mark them, and a route planned over an
  // order you cannot fill quotes a fill that will not happen.
  const solanaBooks = solana && solanaView.book
    ? { asks: executable(outcomeIndex === 1 ? solanaView.book.noAsks : solanaView.book.yesAsks), oppositeBids: executable(outcomeIndex === 1 ? solanaView.book.yesBids : solanaView.book.noBids) }
    : null;
  const solanaPreview = (() => {
    if (!solana || type !== "market" || side !== "buy") return { quote: null, error: "" };
    if (!solanaView.now) return { quote: null, error: "Loading executable prices…" };
    if (!solanaBooks) return { quote: null, error: "No sell liquidity yet. Choose Limit to open the market and place the first order." };
    try {
      return { quote: binaryBuyQuote(solanaBooks.asks, solanaBooks.oppositeBids, parseUnitsExact(amount, 6)), error: "" };
    } catch (reason) { return { quote: null, error: reason instanceof Error ? reason.message : "Market quote unavailable." }; }
  })();
  // A limit price is a ceiling, not a target: a limit at 80¢ fills against 50¢
  // offers at 50¢, exactly as placeBinaryLimitBuy walks the ladder. Previewing
  // only "reserved if unfilled" described the resting case while the marketable
  // case was what actually happened, so a fill at half the quoted price read as
  // a bug rather than as price improvement.
  const marketable = (() => {
    if (!solana || type !== "limit" || side !== "buy" || !solanaBooks) return null;
    try { return nextBinaryBuy(solanaBooks.asks, solanaBooks.oppositeBids, parseUnitsExact(shares, 6), BigInt(Math.round(Number(limitPrice) * 10_000))); }
    catch { return null; }
  })();
  const restingShares = (() => {
    if (!marketable) return null;
    try { return Math.max(0, Number(parseUnitsExact(shares, 6) - marketable.quantity) / 1_000_000); }
    catch { return null; }
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
  const solanaTakerBps = type === "limit" && solanaHoldings.outcomes?.every(entry => entry.bps !== null)
    ? Math.max(...solanaHoldings.outcomes.map(entry => entry.bps!))
    : takerBps((solanaReview ?? solanaPreview.quote)?.route === "complete-set"
      ? solanaHoldings.outcomes?.[outcomeIndex === 1 ? 0 : 1] : selectedHoldings);
  const linkedAnswer = market.presentation?.kind === "linked" ? market.presentation.answer : undefined;
  // The header names the ANSWER, so it takes the answer's identity. The Yes/No
  // contract underneath has no colour of its own — reading it gave every answer
  // in a twelve-row prediction the same palette entry.
  const color =
    pickColor(market, outcome, snapshot, Math.max(0, outcomeIndex)) ||
    (linkedAnswer?.participantId && snapshot.agents.find((agent) => agent.id === linkedAnswer.participantId)?.color) ||
    linkedAnswer?.color ||
    outcomeColor(outcome, snapshot, Math.max(0, outcomeIndex));
  const solanaMaxFee = (() => {
    if (!solana || solanaTakerBps === null || !solanaVenue) return null;
    try {
      const decimals = solanaVenue.collateralDecimals;
      const quote = solanaReview ?? solanaPreview.quote;
      // The submitted order bounds its fee by what it can actually execute:
      // `quantity` for the complete-set route, `maximumCost` for a direct fill.
      // Reading the typed budget instead overstated the cap by the whole
      // unfilled remainder whenever the book was thinner than the amount box.
      const notional =
        type === "market"
          ? quote ? (quote.route === "complete-set" ? quote.quantity : quote.maximumCost) : null
          : parseUnitsExact(shares, 6);
      if (notional === null) return null;
      if (notional <= 0n) return null;
      return Number(takerFee(notional, solanaTakerBps) + (type === "limit" ? 8n : 0n)) / 10 ** decimals;
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

  // What this trade is about to ask the wallet to sign.
  //
  // Every fact below is already on screen; the one exception is whether the
  // question account exists, which is read only when neither book is activated,
  // because that is the only case where the answer changes the SOL figure.
  const booksOpen: [boolean, boolean] = [
    (solanaHoldings.outcomes?.[0]?.holdings ?? null) !== null,
    (solanaHoldings.outcomes?.[1]?.holdings ?? null) !== null,
  ];
  const questionExists = useQuestionPresence(
    solanaBinding,
    review && liveSolana && !booksOpen[0] && !booksOpen[1] && Boolean(solanaHoldings.outcomes),
  );
  const stepFacts = useMemo<StepFacts | null>(() => {
    if (!liveSolana || !solanaVenue || !solanaHoldings.outcomes) return null;
    const selected = outcomeIndex === 1 ? 1 : 0;
    // Only a market order has a reviewed route. solanaReview holds whatever the
    // last market review produced and is not cleared when the ticket switches to
    // Limit, so reading it there pointed the plan at the opposite binding and
    // made a real prepare() arrive as an unplanned step.
    //
    // A limit order's route comes from `marketable`, which walks the live books
    // through the same nextBinaryBuy the flow itself uses. Assuming `direct`
    // instead made every limit plan promise a funding step, and a first leg that
    // routed through the opposite bids pays from the wallet rather than the
    // seat — so that step sat at Waiting for the whole trade and then admitted
    // it was never needed.
    // Two different quote shapes, kept apart: binaryBuyQuote carries priceMicros
    // and the reviewed cost, nextBinaryBuy carries only the next leg's level.
    const marketQuote = type === "market" ? solanaReview ?? solanaPreview.quote : null;
    const route = (type === "market" ? marketQuote?.route : marketable?.route) === "complete-set" ? "complete-set" : "direct";
    // The complete-set route prepares the OPPOSITE binding, because that is the
    // book it sells into; every other route prepares the selected one.
    const other = selected === 1 ? 0 : 1;
    const preparing = solanaHoldings.outcomes[route === "complete-set" ? other : selected];
    // A limit buy re-picks its route per leg and prepares whichever binding that
    // leg uses, so both are in scope for the plan.
    const alternate = type === "limit" ? solanaHoldings.outcomes[route === "complete-set" ? selected : other] : undefined;
    try {
      const quantityAtoms = type === "market" ? marketQuote?.quantity ?? 0n : parseUnitsExact(shares, 6);
      const priceMicros = type === "market" ? marketQuote?.priceMicros ?? 0n : BigInt(Math.round(Number(limitPrice) * 10_000));
      const amountAtoms = (quantityAtoms * priceMicros + 999_999n) / 1_000_000n;
      const seatUsdc = solanaHoldings.outcomes[selected]?.holdings?.venueAvailableUsdc ?? 0n;
      // Whether a sell will actually match decides which of two differently named
      // transactions it sends, so it is read off the book rather than assumed
      // from the order type: a marketable limit sell labelled "Rest offer" would
      // leave that step stranded as "Not needed" beside an unplanned twin.
      const sellBids = solana && solanaView.book ? (outcomeIndex === 1 ? solanaView.book.noBids : solanaView.book.yesBids) : [];
      const floor = type === "limit" ? BigInt(Math.round(Number(limitPrice) * 10_000)) : 1n;
      const sell = side === "sell" && quantityAtoms > 0n && preparing?.holdings
        ? (() => {
            const made = planSellInventory(preparing.holdings!, quantityAtoms);
            return { exportAtoms: made.exportAtoms, depositAtoms: made.depositAtoms, matched: sellBids.some(level => level.quantity > 0n && level.price >= floor) };
          })()
        : undefined;
      return {
        side, type, route,
        outcome: selected as 0 | 1,
        collateralSymbol: solanaVenue.collateralSymbol,
        books: booksOpen,
        ...(questionExists === undefined ? {} : { questionExists }),
        accounts: preparing?.holdings?.accounts ?? null,
        ...(alternate ? { accountsAlternate: alternate.holdings?.accounts ?? null } : {}),
        fundingAtoms: side === "buy" && route === "direct" && amountAtoms > seatUsdc ? amountAtoms - seatUsdc : 0n,
        upfrontAtoms: route === "complete-set" ? quantityAtoms : 0n,
        maxFeeAtoms: solanaMaxFee === null ? 0n : BigInt(Math.round(solanaMaxFee * 10 ** solanaVenue.collateralDecimals)),
        ...(sell ? { sell } : {}),
      };
    } catch {
      // An amount still being typed throws in parseUnitsExact. No plan is a
      // stepper that does not render, never a blank ticket.
      return null;
    }
  }, [liveSolana, solanaVenue, solanaHoldings.outcomes, outcomeIndex, solanaReview, solanaPreview.quote, type, side, shares, amount, limitPrice, solanaMaxFee, questionExists, booksOpen[0], booksOpen[1], solanaView.book, marketable]);
  const tradePlan = useMemo(() => (stepFacts ? planTradeSteps(stepFacts) : null), [stepFacts]);
  const stepRows = useMemo(
    () => (tradePlan ? reconcileSteps(tradePlan, liveSteps, settled) : []),
    [tradePlan, liveSteps, settled],
  );

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
  // A countdown is urgency, not a calendar. `endsAt` is the trading lock on a
  // reserved question, which can be six weeks out — rendering it as "64124
  // MINS" beside the Trade button told nobody anything, and announced the same
  // to a screen reader.
  const gameRemainingMs = (() => {
    if (preparing || match?.phase !== "live" || match.timingType === "open-ended") return null;
    const remaining = match.endsAt - clock;
    return remaining > COUNTDOWN_VISIBLE_MS ? null : Math.max(0, remaining);
  })();
  // One balance for the whole ticket: the Amount field and any summary row read
  // the same number, so they cannot drift.
  // A limit buy can do both at once: fill what is marketable now and reserve
  // the rest. `restingShares` is null when nothing is marketable, which means
  // the WHOLE order rests — not that none of it does.
  const resting = type === "limit" && side === "buy"
    ? restingShares ?? (Number(shares) || 0)
    : 0;
  const buyOutlay = type === "limit" && side === "buy"
    ? (marketable ? Number(marketable.maximumCost) / 1_000_000 : 0) + resting * (Number(limitPrice) / 100)
    : null;
  // What must be on hand at submission, which the net Total understates: the
  // complete-set leg mints a whole set at 1.00 per share and only gets the
  // difference back when the opposite leg sells, so a wallet holding exactly
  // the Total comes up short. Today that surfaces only as a thrown error inside
  // placeBinaryLimitBuy, after the trader has already committed to the flow.
  const peakOutlay = marketable?.route === "complete-set" && buyOutlay !== null
    ? Number(marketable.upfrontCollateral) / 1_000_000 + resting * (Number(limitPrice) / 100)
    : null;
  const summaryPrice = price > 0
    ? price
    : solana && side === "buy"
      ? contract.marketQuote?.ask ?? outcome.marketQuote?.ask ?? 0
      : 0;
  const summaryQuantity = price > 0
    ? quantity
    : summaryPrice > 0 && side === "buy" && type === "market"
      ? Number(amount) / summaryPrice
      : summaryPrice > 0
        ? Number(shares)
        : 0;
  const collateralBalance = (() => {
    if (solana) {
      const holdings = selectedHoldings?.holdings;
      return holdings
        ? Number(holdings.venueAvailableUsdc + holdings.walletUsdc) / 10 ** (solanaVenue?.collateralDecimals ?? 6)
        : null;
    }
    return balances && account.data ? Number(balances[0]) / 10 ** account.data.market.decimals : null;
  })();
  const safeLabel = (value: number) =>
    amountLabel(Number.isFinite(value) ? value : 0);
  /** Devnet's fUSDC and Somnia's tUSDC are dollar stablecoins, so a figure in
   *  them is a figure in dollars: "$106.86", not "106.859 fUSDC". The ticker
   *  belongs beside the balance in the wallet, not stamped on every number the
   *  trader is reading. A collateral that is not a dollar keeps its own symbol
   *  and its own precision. */
  const dollarCollateral = /usdc$/i.test(collateralSymbol);
  const money = (value: number) =>
    dollarCollateral
      ? `$${(Number.isFinite(value) ? value : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `${safeLabel(value)} ${collateralSymbol}`;
  const venueWallet = solana ? solanaWallet : evmWallet;
  /** A balance in the same unit as the field it sits under: the collateral you
   *  would spend when the field is an amount of it, your own shares whenever the
   *  field is a share count — which a limit buy is, just as a sell is. A dollar
   *  figure under a field labelled "Shares" was answering a question nobody had
   *  asked, and on a large balance it read as the order size. */
  const balanceCaption = (() => {
    if (!simulation && !venueWallet) return "Wallet not connected";
    if (side === "sell" || type === "limit") return `${safeLabel(available)} shares`;
    if (simulation) return `${safeLabel(snapshot.account.balances.COOLA)} COOLA`;
    if (collateralBalance !== null) return money(collateralBalance);
    if (solana && solanaHoldings.loading) return "Loading…";
    if (solana && solanaHoldings.error) return "Balance unavailable";
    return PRICE_PLACEHOLDER;
  })();
  const formatOutcomePrice = (probability: number) => {
    const cents = Math.round(Math.max(0, Math.min(1, probability)) * 100);
    return priceFormat === "decimal"
      ? (cents / 100).toFixed(2)
      : priceFormat === "percent"
        ? `${cents}%`
        : `${cents}¢`;
  };

  // Seeding the limit price from the newly picked side is wanted; resetting the
  // order type and the menu on the same change is not. Keyed on contract.id
  // alone this never fired for a Solana question, whose contract ids are always
  // "yes"/"no" — so the limit kept the previous question's price.
  useEffect(() => {
    if (pickOwner.current === pickedContract) return;
    // The ticket has moved to a contract the pick does not speak for, so the
    // pick owns nothing here. Releasing it now is what lets a later return to
    // that contract re-seed normally instead of finding the guard still set.
    pickOwner.current = null;
    setLimitPrice(String(Math.round(contract.probability * 100)));
    setLimitPriceDraft(null);
  }, [contract.id, market.id, market.onchain?.marketId, pickedContract]);
  /** A market order needs somebody already resting on the other side. Until this
   *  question is opened on-chain there is no book at all, so the ticket opens on
   *  Limit — the order type that actually opens the market and rests, rather
   *  than one that can only cancel for want of a counterparty.
   *
   *  `status === 'indicative'` is the market's own word for "not opened yet",
   *  and it is the only signal that means it. A missing venue binding is NOT:
   *  that is also what a question which has traded for hours looks like while
   *  its venue configuration is still loading, and defaulting off it would flip
   *  the order type on every slow load. PredictionDetail's Activity tab makes
   *  the same distinction for the same reason.
   *
   *  Applied once per contract and never enforced: it decides where the ticket
   *  opens, not what the trader is allowed to choose. Someone who reads the
   *  note under the button and still wants a market order keeps it, and a
   *  market that opens while the ticket is up does not yank them back. */
  const limitDefault = useRef<string | null>(null);
  useEffect(() => {
    if (simulation || market.status !== "indicative") return;
    if (limitDefault.current === pickedContract) return;
    limitDefault.current = pickedContract;
    setType("limit");
  }, [simulation, market.status, pickedContract]);
  useEffect(() => {
    setFeedback(null);
    setReview(false);
    setPriceFormatMenuOpen(false);
  }, [
    market.matchId,
    market.id,
    market.onchain?.marketId,
    evmBinding?.chainId,
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
    if (pickOwner.current === pickedContract) return;
    if (!simulation && ["tUSDC", "fUSDC"].includes(collateralSymbol)) {
      setAmount("1");
      setShares("1");
    }
    // No pickedContract here: contract.id is not a collateral change, and
    // adding it made every Yes/No flip reset the amount the trader had typed.
  }, [collateralSymbol, market.id, simulation]);
  // Declared after both re-seeds so that when one click both selects a contract
  // and picks a level, this runs last in that commit and the pick survives.
  useEffect(() => {
    if (!bookPick) return;
    if (bookPick.nonce === appliedPick.current && appliedSide.current === side) return;
    // Match on the contract, not on the market id: the event page hands the
    // book a synthesised per-answer market while this ticket holds the parent
    // prediction, so the two market ids differ for one and the same contract.
    if (bookPick.outcomeId !== outcome.id || bookPick.no !== ticketIsNo) return;
    appliedPick.current = bookPick.nonce;
    appliedSide.current = side;
    pickOwner.current = pickedContract;
    // Buy/Sell stays the trader's — clicking a bid while buying names a price,
    // it does not ask to become a seller. The size does follow the level, but
    // only from the ladder that direction actually takes: buying takes asks,
    // selling hits bids, and the other ladder matches nothing, so the totals
    // below read zero rather than quoting a trade that cannot happen.
    setType("limit");
    const executable = (bookPick.side === "ask") === (side === "buy");
    setShares(executable ? bookPick.cumulative : "0");
    // A limit is a ceiling on a buy and a floor on a sell, so a level that is
    // not a whole cent rounds toward the side the trader is actually on, and
    // still reaches the level either way.
    const exact = Number(bookPick.cents);
    const whole = side === "buy" ? Math.ceil(exact) : Math.floor(exact);
    setLimitPrice(String(Math.min(99, Math.max(1, whole))));
    // The field prefers the draft to the value, so a stale draft would hide the
    // picked price and then win it back on blur.
    setLimitPriceDraft(null);
    setFeedback(null);
  }, [bookPick, outcome.id, ticketIsNo, pickedContract, side]);
  /** The level the trader last chose in the book, if it speaks for the contract
   *  this ticket is on. Buying takes asks and selling hits bids, so the very
   *  same level is executable in one direction and a bare price choice in the
   *  other — which is the thing worth saying out loud, since clicking it no
   *  longer silently turns the trader around. */
  const pickedLevel =
    bookPick && bookPick.outcomeId === outcome.id && bookPick.no === ticketIsNo
      ? bookPick
      : null;
  const levelLiquidity =
    pickedLevel === null
      ? null
      : (pickedLevel.side === "ask") === (side === "buy")
        ? Number(pickedLevel.cumulative)
        : 0;
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
    setLiveSteps([]);
    setSettled(false);
    // Set by the stage notifier below, read by the catch: both live outside the
    // live-Solana branch that declares the wallet.
    let solanaFailureReported = false;
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
          setLiveSteps((rows) => applyStage(rows, stage));
          const id = toasts.idFor(stage.step);
          if (stage.status === "preparing") {
            notify.loading(stage.step, { id, description: "Checking the transaction on Solana" });
            pushAlert({ level: "info", title: stage.step, detail: "Checking the transaction on Solana" });
          }
          else if (stage.status === "signing") {
            notify.loading(stage.step, { id, description: "Approve in your wallet" });
            pushAlert({ level: "info", title: stage.step, detail: "Waiting for your wallet signature" });
          }
          else if (stage.status === "failed") {
            toasts.settle(stage.step);
            solanaFailureReported = true;
            // Transient like every other toast. The failure is not lost when it
            // fades: the step keeps it on the dialog's rail, and AlertsDock holds
            // the record until the trader clears it.
            notify.error(stage.step, { id, description: stage.error, duration: 12_000 });
            pushAlert({ level: "error", title: stage.step, detail: stage.error });
          }
          else {
            toasts.settle(stage.step);
            const href = stage.signature ? explorerTxUrl(solanaVenue, stage.signature) : undefined;
            pushAlert({ level: "success", title: stage.step, detail: "Confirmed on Solana", href });
            notify.step(stage.step, {
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

          const selected = market.outcomes.findIndex((item) => item.id === outcome.id) === 1 ? 1 : 0;
          const binding = await client.binding(solanaQuestion.marketId, selected);

          if (side === "sell") {
            // Selling is the only way an ask ever reaches these books, so this
            // path is what gives the market a two-sided spread at all. It is
            // direct-only: selling YES through the NO book means buying NO and
            // merging a complete set, which is a different transaction shape.
            setProgress("Checking where your shares are held…");
            const quantityAtoms = parseUnitsExact(shares, 6);
            const custody = await client.adapter.holdings(wallet.owner, binding);
            const plan = planSellInventory(custody, quantityAtoms);
            if (plan.shortfall > 0n)
              throw Error(`You hold ${Number(plan.sellable) / 1_000_000} sellable ${outcome.label} shares. Cancel a resting ask to free reserved shares, or sell less.`);
            // A market sell needs a floor; a limit sell already has one.
            const floor = type === "limit" ? BigInt(Math.round(Number(limitPrice) * 10_000)) : 1n;
            /** Quoted twice: once before any wallet prompt, so a sell that
             * cannot be submitted costs the trader nothing, and again right
             * before submitting, because the custody prompts in between take as
             * long as the trader needs and the book moves meanwhile. */
            const quote = async () => {
              const { match, crossing } = quoteSell((await client.adapter.readBook(binding)).bids()
                .map((order) => ({ own: order.trader.equals(wallet.owner), price: BigInt(order.price.toString()) / 10n ** 12n, quantity: BigInt(order.numBaseAtoms.toString()) })), quantityAtoms, floor);
              if (!match && type === "market") throw Error("No buyer is available for this outcome. Choose Limit to rest an offer instead.");
              // The guard rejects the whole transaction as Custom(8100) when
              // this happens on chain, which says nothing the trader can act on.
              if (crossing !== undefined)
                throw Error(`Your own ${outcome.label} bid at ${(Number(crossing) / 10_000).toFixed(2)}¢ would fill this offer instead of resting it. Cancel that order first, or price this offer above it.`);
              return match;
            };
            await quote();
            // The claim account must exist before anything can be exported into it.
            if (plan.exportAtoms > 0n || plan.depositAtoms > 0n) await wallet.prepare(binding);
            if (plan.exportAtoms > 0n) {
              setProgress("Moving shares out of your prediction position…");
              await wallet.claims(binding, plan.exportAtoms, "export", TRADE_STEPS.release);
            }
            if (plan.depositAtoms > 0n) {
              setProgress("Depositing shares to the order book…");
              await wallet.send(await client.adapter.moveTokens(wallet.owner, binding, "claims", plan.depositAtoms, "deposit"), TRADE_STEPS.deposit);
            }
            const match = await quote();
            // A sell is quoted in shares, but the taker fee is charged on the
            // collateral that actually changes hands.
            const proceeds = match ? match.estimatedProceeds : (quantityAtoms * floor + 999_999n) / 1_000_000n;
            setProgress(match ? "Selling into the best bids…" : "Resting your offer on the book…");
            const hash = await wallet.send(await client.adapter.order(wallet.owner, binding, {
              side: "SELL",
              quantity: match ? match.quantity : quantityAtoms,
              priceMicros: match ? match.price : floor,
              lastValidSlot: 0,
              kind: match ? "IOC" : "LIMIT",
              maxFeeAtoms: takerFee(proceeds, binding.bps),
            }), match ? TRADE_STEPS.sell : TRADE_STEPS.offer);
            invalidate();
            const summary = match
              ? `Sold ${Number(match.quantity) / 1_000_000} ${outcome.label} shares at ${(Number(match.price) / 10_000).toFixed(2)}¢`
              : `Offer resting: ${shares} ${outcome.label} shares at ${limitPrice}¢`;
            const href = explorerTxUrl(solanaVenue, hash);
            notify.success(summary, { id: `solana-sell:${hash}`, duration: 12_000, ...(href ? { action: { label: "View", onClick: () => window.open(href, "_blank", "noreferrer") } } : {}) });
            pushAlert({ level: "success", title: summary, detail: match ? "Proceeds are on your book seat; withdraw them to your wallet." : "It stays until it is filled, cancelled, or the question closes.", href });
            setFeedback({ text: `${summary}.`, hash });
            return;
          }

          setProgress(`Funding this outcome book with ${solanaVenue.collateralSymbol}…`);
          if (type === "market" && !solanaReview) throw Error("Review an executable market quote before submitting.");
          const priceMicros = type === "market" ? solanaReview!.priceMicros : BigInt(Math.round(price * 1_000_000));
          const quantityAtoms = type === "market" ? solanaReview!.quantity : parseUnitsExact(shares, 6);
          const amountAtoms = (quantityAtoms * priceMicros + 999_999n) / 1_000_000n;
          let hash: string;
          const complementary = type === "market" && solanaReview?.route === "complete-set";
          let limitResult: Awaited<ReturnType<typeof placeBinaryLimitBuy>> | undefined;
          if (type === "limit") {
            const opposite = await client.binding(solanaQuestion.marketId, selected === 0 ? 1 : 0);
            limitResult = await placeBinaryLimitBuy(wallet, binding, opposite, quantityAtoms, priceMicros);
            hash = limitResult.signatures.at(-1)!;
          } else if (complementary) {
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
              await wallet.send(await client.adapter.moveTokens(wallet.owner, binding, "USDC", missing, "deposit"), TRADE_STEPS.fundBook(solanaVenue.collateralSymbol));
            }
            setProgress("Submitting your Manifest trade order…");
            hash = await wallet.send(await client.adapter.order(wallet.owner, binding, {
              side: "BUY",
              quantity: quantityAtoms,
              priceMicros,
              lastValidSlot: 0,
              kind: "IOC",
              maxFeeAtoms: maximumFee,
            }), TRADE_STEPS.submit);
          }
          invalidate();
          const summary = `${activation.length ? "Market activated and " : ""}trade order submitted on Manifest`;
          const href = explorerTxUrl(solanaVenue, hash);
          // Surfaced as a toast rather than text under the button, which sits
          // below the fold once the ticket is scrolled.
          notify.success(summary, {
            id: `solana-order:${hash}`,
            description: complementary ? "Purchased through opposite bids. Your selected shares are in your prediction position; sale proceeds returned to your wallet." : type === "market" ? "Only matched shares were purchased. Any unfilled remainder was cancelled; unused funds remain in your book balance." : `Matched ${Number(limitResult?.matched ?? 0n) / 1_000_000} shares; ${Number(limitResult?.resting ?? 0n) / 1_000_000} shares remain in your limit order. Check Activity for fills.`,
            duration: 12_000,
            ...(href ? { action: { label: "View", onClick: () => window.open(href, "_blank", "noreferrer") } } : {}),
          });
          pushAlert({ level: "success", title: summary, detail: complementary ? "Purchased through opposite bids. Your selected shares are in your prediction position; sale proceeds returned to your wallet." : type === "market" ? "Only matched shares were purchased. Any unfilled remainder was cancelled; unused funds remain in your book balance." : `Matched ${Number(limitResult?.matched ?? 0n) / 1_000_000} shares; ${Number(limitResult?.resting ?? 0n) / 1_000_000} shares remain in your limit order. Check Activity for fills.`, href });
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
      if (!liveSolana) setReview(false);
    } catch (reason) {
      const selfMatch =
        reason instanceof Error &&
        reason.message.includes("SelfMatchCancelTaker");
      const text = selfMatch
        ? "Trade not completed: your own opposing order blocks this trade. Cancel or change that open order below. Token approval alone does not buy shares."
        : `Trade not completed: ${reason instanceof Error ? reason.message : "Please check your wallet and try again."}`;
      setFeedback({ text, error: true });
      const detail = text.replace("Trade not completed: ", "");
      if (!solanaFailureReported) {
        notify.error("Trade not completed", { description: detail, duration: 12_000 });
        pushAlert({ level: "error", title: "Trade not completed", detail });
      }
      setOrdersExpanded(true);
      // A live Solana trade keeps its dialog: the rail is where the trader reads
      // which steps confirmed before the failure and which never ran, and
      // closing it would leave a fading toast as the only account of that.
      if (!liveSolana) setReview(false);
      if (evmBinding) refreshDreamDex(evmBinding.chainId);
      // A failed trade can still have landed its earlier transactions, so the
      // read model is stale either way. This branch never fired for Solana.
      if (solanaVenue?.publicRpcUrl && solanaQuestion) refreshSolana(solanaVenue.publicRpcUrl, solanaQuestion.marketId);
    } finally {
      setPending(false);
      setProgress("");
      setSettled(true);
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
      {market.presentation?.imageUrl && (
        <img className="ch-trade-question-image" src={market.presentation.imageUrl} alt="" />
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
          {/* A head-to-head names its fixture, exactly as the page H1 does —
              gating this on `linked` left the ticket headed by the raw question
              while the page above it said "JUP vs ANSEM". A linked answer needs
              no kicker at all: the question is already the H1 and the section
              heading, and the answer is the only thing this ticket is about. */}
          {!linkedAnswer && <span>{market.presentation?.eventTitle ?? market.title}</span>}
          <strong>{linkedAnswer ? linkedAnswer.label : outcome.label}</strong>
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
                // Deliberately keeps the picked level: the trader chose that
                // price, and changing direction only changes whether it is
                // executable — which the line under Shares now says.
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
          <SoundToggle />
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
            {/* A two-value control does not need a menu: the button states the
                order type and switches it. The menu was one extra click and one
                extra thing to dismiss for a choice with two options. */}
            <button
              type="button"
              className="ch-order-type-trigger"
              aria-label={`Order type: ${type === "market" ? "Market" : "Limit"}. Switch to ${type === "market" ? "Limit" : "Market"}.`}
              onClick={() => {
                setType((current) => (current === "market" ? "limit" : "market"));
                setFeedback(null);
              }}
            >
              {type === "market" ? "Market" : "Limit"}
              <ArrowLeftRight size={12} />
            </button>
          </div>
        </div>
      </div>
      <div className="ch-trade-outcomes" aria-label="Trade outcome">
        {multiple
          ? // A multi-outcome answer is its own Yes/No book: the identity colour
            // stays on the header above, never on these two controls.
            (["yes", "no"] as const).map((value) => (
              <button
                type="button"
                className={`is-${value}`}
                data-fx="select"
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
              </button>
            ))
          : market.outcomes.map((item, index) => (
              <button
                type="button"
                className={`${index === 0 ? "is-yes" : "is-no"}${pickColor(market, item, snapshot, index) ? " has-pick-color" : ""}`}
                data-fx="select"
                key={item.id}
                style={(() => {
                  // Both vars or neither: the fill alone left near-white text
                  // on a bright team colour at about 1.7:1.
                  const fill = pickColor(market, item, snapshot, index);
                  return fill ? { "--pick-color": fill, "--pick-ink": pickInk(fill) } as React.CSSProperties : undefined;
                })()}
                aria-pressed={outcome.id === item.id}
                onClick={() => onOutcome(item)}
              >
                <span>{item.label}</span>
                <b>
                  {solana
                    ? (() => {
                        const quote = index === 1 ? solanaView.quote?.no : solanaView.quote?.yes;
                        const value = side === "buy" ? quote?.ask : quote?.bid;
                        if (value !== undefined) return formatOutcomePrice(Number(value) / 1_000_000);
                        // The ticket's own book read is still in flight, but the
                        // market list already published this outcome's quote —
                        // the same book, the same number. Showing it is not a
                        // stale read; blanking to "…" on every answer switch was
                        // a loading state over data already in hand.
                        const known = side === "buy" ? item.marketQuote?.ask : item.marketQuote?.bid;
                        if (known !== undefined) return formatOutcomePrice(known);
                        // "No asks" on a market nobody has opened yet read as a
                        // failure. The reason belongs in the help text below,
                        // which already explains what to do about it.
                        return solanaView.now ? PRICE_PLACEHOLDER : "…";
                      })()
                    : formatOutcomePrice(item.probability)}
                </b>
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
                  releasePick();
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
                onChange={(event) => {
                  releasePick();
                  setLimitPriceDraft(event.target.value);
                }}
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
                  releasePick();
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
          <div className="ch-trade-amount-label">
            <label htmlFor="trade-quantity">
              {side === "buy" && type === "market" ? "Amount" : "Shares"}
            </label>
            {/* The balance belongs beside the field it constrains, not eleven
                rows below it. */}
            <small>{balanceCaption}</small>
          </div>
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
            {/* Only the currency earns a caption. "SHARES" under a field
                already labelled "Shares" said it twice and pushed the label out
                of alignment with the number. */}
            {side === "buy" && type === "market" && <span>{collateralSymbol}</span>}
          </div>
          {levelLiquidity !== null && type === "limit" && (
            <p className={`ch-level-liquidity${levelLiquidity > 0 ? "" : " is-empty"}`} role="status">
              {levelLiquidity > 0
                ? `${levelLiquidity.toLocaleString(undefined, { maximumFractionDigits: 2 })} matching at ${displayedLimitPrice}${priceFormat === "cents" ? "¢" : ""}`
                : `Nothing to ${side} at ${displayedLimitPrice}${priceFormat === "cents" ? "¢" : ""} — this order would rest`}
            </p>
          )}
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
            aria-label="Order summary"
          >
            {/* Balances moved up beside the Amount field, and the fee moved to
                the review dialog where it is disclosed before signing. What is
                left is what a trader decides on: when it expires, what it
                costs, what it returns. */}
            {type === "limit" && (
              <div>
                <span>Expires</span>
                <strong>Market close</strong>
              </div>
            )}
            {/* What the order costs, and what it comes back as. Buying has both:
                the outlay and the payout if it settles your way. Selling has one
                figure — the proceeds — so it takes the payout's own treatment
                rather than being labelled as a cost. */}
            {side === "buy" && (
              <div className="is-total">
                <span>Total</span>
                <strong>
                  {buyOutlay !== null
                    ? money(buyOutlay)
                    : price > 0
                      ? money(total)
                      : summaryPrice > 0
                        ? money(summaryQuantity * summaryPrice)
                        : PRICE_PLACEHOLDER}
                  {resting > 0 && (
                    <small>
                      {money(resting * (Number(limitPrice) / 100))} reserved if unfilled
                    </small>
                  )}
                  {peakOutlay !== null && buyOutlay !== null && peakOutlay > buyOutlay && (
                    <small>
                      {money(peakOutlay)} must be in your wallet to start; the opposite sale returns the difference
                    </small>
                  )}
                </strong>
              </div>
            )}
            <div className="is-win">
              {/* The price the figure is struck at sits with its label, not
                  under the number, where it competed with it for the eye. */}
              <span>
                {side === "buy" ? "To win" : "You'll win"}
                {summaryPrice > 0 && <small>@{formatOutcomePrice(summaryPrice)}</small>}
              </span>
              <strong>
                {side === "buy"
                  ? summaryPrice > 0
                    ? money(summaryQuantity)
                    : PRICE_PLACEHOLDER
                  : price > 0
                    ? money(total)
                    : summaryPrice > 0
                      ? money(summaryQuantity * summaryPrice)
                      : PRICE_PLACEHOLDER}
              </strong>
            </div>
          </div>
        )}
        <div className="ch-trade-action">
          <button
            className="ch-submit-trade"
            data-fx="commit"
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
                      ? `${safeLabel((Number(orderPrice) / Number(scale)) * 100)}¢ · ${isBuy ? `${money(Number((order.quantityRemaining * orderPrice) / scale) / 1_000_000)} reserved` : "shares reserved to sell"}`
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
        upfrontCollateral={solanaReview?.route === "complete-set" ? Number(solanaReview.upfrontCollateral) / 1_000_000 : marketable?.route === "complete-set" ? Number(marketable.upfrontCollateral) / 1_000_000 : undefined}
        maximumFee={solana ? solanaMaxFee ?? undefined : undefined}
        progress={progress}
        plan={tradePlan}
        steps={stepRows}
        settled={settled}
        collateralDecimals={solanaVenue?.collateralDecimals ?? 6}
        explorerUrl={solanaVenue ? (signature: string) => explorerTxUrl(solanaVenue, signature) : undefined}
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
