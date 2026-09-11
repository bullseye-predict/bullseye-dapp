import {
  binaryModuleWriteAbi,
  erc6909Abi,
  type BinarySide,
  type MarketOnchain,
  type PlaceOrderParams,
} from "@somnia-chain/markets-sdk";
import {
  createWalletClient,
  custom,
  erc20Abi,
  parseAbi,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import type {
  Candle,
  DreamDexPublicConfig,
} from "../../prediction-core/market-data";
import {
  createDreamDexEventReader,
  type DreamDexEventBinding,
} from "./event-reader";

// Read signatures pinned to markets-sdk 0.29.0 src/readsAbi.ts (not exported by the SDK).
const binaryPoolReadAbi = parseAbi([
  "function getOrderBookParameters() view returns ((uint256 tickSize, uint256 minQuantity, uint256 lotSize))",
  "function getBinaryPoolParams() view returns ((address collateralToken, address market, address outcomeToken, uint256 yesId, uint256 noId, uint256 oneCollateral, uint256 setBacking, address feeRecipient, uint256 makerFeeBpsTimes1k, uint256 takerFeeBpsTimes1k, uint256 maxBuilderFeeBpsTimes1k, uint256 settlementFeeBpsTimes1k, address settlement, uint64 marketNonce, bool finalized))",
]);
export function orderTerms(
  side: BinarySide,
  outcomePrice: bigint,
  quantity: bigint,
  decimals: number,
  grid: { tickSize: bigint; lotSize: bigint; minQuantity: bigint },
) {
  const scale = 10n ** BigInt(decimals),
    price = side.endsWith("NO") ? scale - outcomePrice : outcomePrice;
  if (
    !["BUY_YES", "SELL_YES", "BUY_NO", "SELL_NO"].includes(side) ||
    price <= 0n ||
    price >= scale ||
    quantity <= 0n ||
    grid.tickSize <= 0n ||
    grid.lotSize <= 0n ||
    price % grid.tickSize !== 0n ||
    quantity % grid.lotSize !== 0n ||
    quantity < grid.minQuantity
  )
    throw new Error(
      "Price or shares do not match this pool’s tick, lot, and minimum quantity",
    );
  return { price, quantity, side };
}
export class DreamDexBrowser {
  readonly resources: ReturnType<typeof createDreamDexEventReader>;
  private active = true;
  constructor(
    readonly config: DreamDexPublicConfig,
    readonly binding: DreamDexEventBinding,
    resources?: ReturnType<typeof createDreamDexEventReader>,
  ) {
    this.resources = resources ?? createDreamDexEventReader(config);
  }
  get client() {
    return this.resources.client;
  }
  async close() {
    this.active = false;
    await this.resources.close();
  }
  async inspect(trading = false) {
    if (!this.active) throw new Error("Network or market selection changed");
    const { market } = await this.resources.reader.inspect(this.binding),
      rpc = this.client.getViemClient();
    const block = await rpc.getBlock();
    if (!this.active) throw new Error("Network or market selection changed");
    if (
      trading &&
      (market.status !== 1 ||
        block.timestamp * 1000n < BigInt(this.binding.tradingStartsAt) ||
        block.timestamp * 1000n >= BigInt(this.binding.tradingLocksAt))
    )
      throw new Error("Event is closed to trading");
    return { market, now: Number(block.timestamp) * 1000 };
  }
  async pool(market: MarketOnchain) {
    const rpc = this.client.getViemClient();
    const [params, grid] = await Promise.all([
      rpc.readContract({
        address: market.pool,
        abi: binaryPoolReadAbi,
        functionName: "getBinaryPoolParams",
      }),
      rpc.readContract({
        address: market.pool,
        abi: binaryPoolReadAbi,
        functionName: "getOrderBookParameters",
      }),
    ]);
    if (
      params.marketNonce !== market.nonce ||
      params.market.toLowerCase() !== market.marketAddress.toLowerCase() ||
      params.yesId !== market.yesId ||
      params.noId !== market.noId
    )
      throw new Error(
        "This pool has been recycled; use this event’s permanent settlement to redeem",
      );
    return { params, grid };
  }
  async snapshot(owner?: Address) {
    const state = await this.inspect(),
      { market } = state,
      rpc = this.client.getViemClient();
    let book = null,
      pool = null,
      orders: Awaited<ReturnType<typeof this.client.getOrderOnchain>>[] = [];
    if (!market.finalized) {
      pool = await this.pool(market);
      book = await this.client.getBinaryOrderBook(market.pool, {
        depth: 10,
        decimals: market.decimals,
      });
      if (owner) {
        const ids = await this.client.getOwnOpenOrdersOnchain(
          market.pool,
          owner,
        );
        if (ids.length > 100)
          throw new Error(
            "More than 100 open orders; use the operator tool to manage this account",
          );
        orders = await Promise.all(
          ids.map((id) => this.client.getOrderOnchain(market.pool, id)),
        );
      }
    }
    const balances = owner
      ? await Promise.all([
          rpc.readContract({
            address: market.collateral,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [owner],
          }),
          rpc.readContract({
            address: market.outcomeToken,
            abi: erc6909Abi,
            functionName: "balanceOf",
            args: [owner, market.yesId],
          }),
          rpc.readContract({
            address: market.outcomeToken,
            abi: erc6909Abi,
            functionName: "balanceOf",
            args: [owner, market.noId],
          }),
        ])
      : null;
    return {
      ...state,
      pool,
      book,
      orders: orders.filter(
        (o) =>
          o !== null &&
          (!owner || o.owner.toLowerCase() === owner.toLowerCase()),
      ),
      balances,
    };
  }
  async candles(outcome: 0 | 1): Promise<Candle[]> {
    const { market } = await this.inspect();
    const response = await fetch(this.config.indexerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        query:
          "query EventTradeChart($id:String!){ Fill(where:{market_id:{_eq:$id}},limit:100,order_by:{timestamp:desc}){id market:market_id fillPrice quantity quoteQuantity timestamp} }",
        variables: { id: this.binding.marketId.toLowerCase() },
      }),
    });
    if (!response.ok) throw new Error("DreamDEX trade indexer unavailable");
    const result = (await response.json()) as {
      data?: {
        Fill: {
          id: string;
          market: string;
          fillPrice: string;
          quantity: string;
          quoteQuantity: string;
          timestamp: string;
        }[];
      };
      errors?: unknown[];
    };
    if (result.errors?.length || !Array.isArray(result.data?.Fill))
      throw new Error("DreamDEX indexer rejected the event history query");
    const scale = 10n ** BigInt(market.decimals);
    return result.data.Fill.slice()
      .reverse()
      .map((fill) => {
        if (
          fill.market.toLowerCase() !== this.binding.marketId.toLowerCase() ||
          ![
            fill.fillPrice,
            fill.quantity,
            fill.quoteQuantity,
            fill.timestamp,
          ].every((n) => /^\d+$/.test(n))
        )
          throw new Error("Invalid event trade record");
        let price = BigInt(fill.fillPrice);
        if (price > scale) throw new Error("Invalid event price");
        if (outcome === 1) price = scale - price;
        price = (price * 1000000n) / scale;
        const timestamp = Number(fill.timestamp) * 1000;
        if (!Number.isSafeInteger(timestamp))
          throw new Error("Invalid event timestamp");
        return {
          timestamp,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: BigInt(fill.quantity),
          collateralVolume: BigInt(fill.quoteQuantity),
          trades: 1,
        };
      });
  }
  async connect(provider: EIP1193Provider) {
    const [address] = (await provider.request({
      method: "eth_requestAccounts",
    })) as string[];
    if (!address) throw new Error("Connect an EVM wallet");
    const chain = this.resources.reader.network.chain;
    if (
      Number(await provider.request({ method: "eth_chainId" })) !== chain.id
    ) {
      const chainId = `0x${chain.id.toString(16)}`;
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId }],
        });
      } catch (error) {
        if ((error as { code?: number }).code !== 4902) throw error;
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId,
              chainName: chain.name,
              nativeCurrency: chain.nativeCurrency,
              rpcUrls: [...chain.rpcUrls.default.http],
              blockExplorerUrls: chain.blockExplorers
                ? [chain.blockExplorers.default.url]
                : [],
            },
          ],
        });
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId }],
        });
      }
    }
    await this.inspect();
    return new DreamDexBrowserWallet(this, provider, address as Address);
  }
}
export class DreamDexBrowserWallet {
  private active = true;
  constructor(
    readonly adapter: DreamDexBrowser,
    private provider: EIP1193Provider,
    readonly owner: Address,
  ) {}
  dispose() {
    this.active = false;
  }
  private async check(trading: boolean) {
    if (!this.active) throw new Error("Wallet or network selection changed");
    const [chain, accounts] = await Promise.all([
      this.provider.request({ method: "eth_chainId" }),
      this.provider.request({ method: "eth_accounts" }),
    ]);
    if (
      Number(chain) !== Number(this.adapter.config.chainId) ||
      (accounts as string[])[0]?.toLowerCase() !== this.owner.toLowerCase()
    )
      throw new Error("Wallet account or network changed");
    const result = await this.adapter.inspect(trading);
    if (!this.active) throw new Error("Wallet or network selection changed");
    return result.market;
  }
  private async writer(trading: boolean) {
    await this.check(trading);
    const guarded = {
      request: async (args: { method: string; params?: unknown }) => {
        if (
          args.method === "eth_sendTransaction" ||
          args.method === "eth_signTransaction"
        )
          await this.check(trading);
        return this.provider.request(args as never);
      },
    } as EIP1193Provider;
    const { id, name, nativeCurrency, rpcUrls, blockExplorers } =
      this.adapter.resources.reader.network.chain;
    return createWalletClient({
      account: this.owner,
      chain: { id, name, nativeCurrency, rpcUrls, blockExplorers },
      transport: custom(guarded),
    });
  }
  async order(input: {
    side: BinarySide;
    outcomePrice: bigint;
    quantity: bigint;
    orderType: 0 | 2 | 3;
  }) {
    const market = await this.check(true),
      { grid } = await this.adapter.pool(market);
    const terms = orderTerms(
      input.side,
      input.outcomePrice,
      input.quantity,
      market.decimals,
      grid,
    );
    if (![0, 2, 3].includes(input.orderType))
      throw new Error("Unsupported order type");
    const walletClient = await this.writer(true);
    const rpc = this.adapter.client.getViemClient(),
      scale = 10n ** BigInt(market.decimals);
    if (input.side.startsWith("BUY")) {
      // Same ceiling-rounded escrow as SDK 0.29.0, without its unlimited approval.
      const amount = (input.quantity * input.outcomePrice + scale - 1n) / scale;
      const allowance = await rpc.readContract({
        address: market.collateral,
        abi: erc20Abi,
        functionName: "allowance",
        args: [this.owner, market.pool],
      });
      if (allowance < amount) {
        const hash = await walletClient.writeContract({
          address: market.collateral,
          abi: erc20Abi,
          functionName: "approve",
          args: [market.pool, amount],
        });
        const receipt = await rpc.waitForTransactionReceipt({
          hash,
          timeout: 90000,
        });
        if (receipt.status !== "success")
          throw new Error(`Approval reverted: ${hash}`);
      }
    } else {
      const id = input.side.endsWith("YES") ? market.yesId : market.noId;
      const allowance = await rpc.readContract({
        address: market.outcomeToken,
        abi: erc6909Abi,
        functionName: "allowance",
        args: [this.owner, market.pool, id],
      });
      if (allowance < input.quantity) {
        const hash = await walletClient.writeContract({
          address: market.outcomeToken,
          abi: erc6909Abi,
          functionName: "approve",
          args: [market.pool, id, input.quantity],
        });
        const receipt = await rpc.waitForTransactionReceipt({
          hash,
          timeout: 90000,
        });
        if (receipt.status !== "success")
          throw new Error(`Approval reverted: ${hash}`);
      }
    }
    await this.check(true);
    await this.adapter.pool(market);
    const trader = this.adapter.client.createTrader({
      walletClient: walletClient as never,
      account: this.owner,
      decimals: market.decimals,
    });
    // Explicit old expiry cannot authorize an order on a later recycled market.
    const receipt = await trader.placeOrder({
      ...terms,
      pool: market.pool,
      orderType: input.orderType,
      expireTimestampNs: market.expiry * 1000000000n,
      collateral: market.collateral,
      outcomeToken: market.outcomeToken,
      yesId: market.yesId,
      noId: market.noId,
      autoApprove: false,
    } satisfies PlaceOrderParams);
    if (receipt.receipt.status !== "success")
      throw new Error(`Order failed: ${receipt.hash}`);
    return receipt.hash;
  }
  async cancel(orderId: bigint) {
    const market = await this.check(false);
    await this.adapter.pool(market);
    const order = await this.adapter.client.getOrderOnchain(
      market.pool,
      orderId,
    );
    if (!order || order.owner.toLowerCase() !== this.owner.toLowerCase())
      throw new Error("Order is not owned by this wallet");
    const trader = this.adapter.client.createTrader({
      walletClient: (await this.writer(false)) as never,
      account: this.owner,
    });
    const result = await trader.cancelOrder({ pool: market.pool, orderId });
    if (result.receipt.status !== "success")
      throw new Error(`Cancellation reverted: ${result.hash}`);
    return result.hash;
  }
  async sets(
    action: "mint" | "merge" | "redeem",
    amount: bigint,
    outcome: 0 | 1,
  ) {
    if (amount <= 0n) throw new Error("Amount must be positive");
    const market = await this.check(action === "mint");
    if (action === "redeem" && !market.isResolved && !market.isVoided)
      throw new Error("Oracle settlement is not available yet");
    const wallet = await this.writer(action === "mint"),
      rpc = this.adapter.client.getViemClient(),
      module = this.adapter.resources.reader.network.addresses.binaryModule!;
    const send = async (
      request: Parameters<typeof wallet.writeContract>[0],
    ) => {
      const hash = await wallet.writeContract(request);
      const receipt = await rpc.waitForTransactionReceipt({
        hash,
        timeout: 90000,
      });
      if (receipt.status !== "success")
        throw new Error(`Transaction reverted: ${hash}`);
      return hash;
    };
    if (action === "mint") {
      const allowance = await rpc.readContract({
        address: market.collateral,
        abi: erc20Abi,
        functionName: "allowance",
        args: [this.owner, module],
      });
      if (allowance < amount)
        await send({
          address: market.collateral,
          abi: erc20Abi,
          functionName: "approve",
          args: [module, amount],
        });
    } else {
      const ids =
        action === "merge"
          ? [market.yesId, market.noId]
          : [outcome === 0 ? market.yesId : market.noId];
      for (const id of ids) {
        const allowance = await rpc.readContract({
          address: market.outcomeToken,
          abi: erc6909Abi,
          functionName: "allowance",
          args: [this.owner, module, id],
        });
        if (allowance < amount)
          await send({
            address: market.outcomeToken,
            abi: erc6909Abi,
            functionName: "approve",
            args: [module, id, amount],
          });
      }
    }
    await this.check(action === "mint");
    const zero = `0x${"00".repeat(32)}` as Hex;
    if (action === "redeem")
      return send({
        address: module,
        abi: binaryModuleWriteAbi,
        functionName: "redeem",
        args: [0, zero, this.adapter.binding.marketId, outcome, amount],
      });
    return send({
      address: module,
      abi: binaryModuleWriteAbi,
      functionName: action === "mint" ? "mintCompleteSet" : "mergeCompleteSet",
      args: [0, zero, this.adapter.binding.marketId, amount],
    });
  }
}
