import { describe, expect, test } from "bun:test";
import { decodeFunctionData, erc20Abi, type EIP1193Provider } from "viem";
import { binaryModuleWriteAbi, erc6909Abi } from "@somnia-chain/markets-sdk";
import { DreamDexBrowser, DreamDexBrowserWallet, orderTerms } from "./browser";
import { parseDreamDexPublicConfig, eventBinding } from "./config";
import { dreamDexNetwork } from "./event-reader";
const owner = `0x${"12".repeat(20)}` as const,
  marketId = `0x${"ab".repeat(32)}` as const;
const config = parseDreamDexPublicConfig({
  chainId: "50312",
  label: "Shannon",
  indexerUrl: "https://indexer.example",
  wsRpcUrl: "wss://rpc.example",
  markets: [
    {
      eventId: "match-1",
      label: "Match 1",
      marketId,
      oracleQuestionId: "7",
      tradingStartsAt: 1000,
      tradingLocksAt: 60000,
      voidPolicy: 0,
    },
  ],
});
function fixture(indexerUrl = config.indexerUrl) {
  const network = dreamDexNetwork("50312"),
    transactions: any[] = [],
    orders: any[] = [];
  let chain = "0xc488",
    account: string = owner,
    now = 2n,
    nonce = 1n,
    status = 1,
    success = true;
  const market = {
    marketAddress: owner,
    outcomeToken: owner,
    yesId: 3n,
    noId: 4n,
    pool: owner,
    nonce: 1n,
    collateral: network.addresses.collateral!,
    status: 1,
    backing: 0n,
    finalized: false,
    expiry: 60n,
    decimals: 6,
    winningOutcome: 0,
    isResolved: false,
    isVoided: false,
    voidPolicy: 0,
  };
  const rpc = {
    getBlock: async () => ({ timestamp: now }),
    readContract: async (p: any) =>
      p.functionName === "getBinaryPoolParams"
        ? { marketNonce: nonce, market: owner, yesId: 3n, noId: 4n }
        : p.functionName === "getOrderBookParameters"
          ? { tickSize: 1000n, lotSize: 1n, minQuantity: 1n }
          : 0n,
    waitForTransactionReceipt: async () => ({
      status: success ? "success" : "reverted",
    }),
  };
  const resources = {
    reader: {
      network,
      inspect: async () => ({
        market: { ...market, status },
        scope: eventBinding(config, config.markets[0]!),
      }),
    },
    client: {
      getViemClient: () => rpc,
      createTrader: () => ({
        placeOrder: async (p: any) => {
          orders.push(p);
          return { hash: "0x01", receipt: { status: "success" } };
        },
      }),
    },
    close: async () => {},
  };
  const adapter = new DreamDexBrowser(
    { ...config, indexerUrl },
    eventBinding(config, config.markets[0]!),
    resources as never,
  );
  const provider = {
    request: async ({ method, params }: any) => {
      if (method === "eth_chainId") return chain;
      if (method === "eth_accounts" || method === "eth_requestAccounts")
        return [account];
      if (method === "eth_sendTransaction") {
        transactions.push(params[0]);
        return `0x${"11".repeat(32)}`;
      }
      throw new Error(method);
    },
  } as EIP1193Provider;
  const wallet = new DreamDexBrowserWallet(adapter, provider, owner);
  return {
    adapter,
    wallet,
    transactions,
    orders,
    market,
    setChain: (x: string) => (chain = x),
    setAccount: (x: string) => (account = x),
    setNow: (x: bigint) => (now = x),
    setNonce: (x: bigint) => (nonce = x),
    setStatus: (x: number) => (status = x),
    setSuccess: (x: boolean) => (success = x),
  };
}
describe("DreamDEX frontend integration", () => {
  test("prices NO orders in YES units at both collateral precisions", () => {
    for (const decimals of [6, 18]) {
      const scale = 10n ** BigInt(decimals),
        grid = { tickSize: scale / 100n, lotSize: 1n, minQuantity: 1n };
      for (const side of ["BUY_YES", "SELL_YES", "BUY_NO", "SELL_NO"] as const)
        expect(
          orderTerms(side, (scale * 30n) / 100n, scale, decimals, grid).price,
        ).toBe((scale * (side.endsWith("NO") ? 70n : 30n)) / 100n);
    }
  });
  test("rejects off-grid, zero-price and sub-minimum orders", () => {
    const grid = { tickSize: 10000n, lotSize: 100n, minQuantity: 200n };
    expect(() => orderTerms("BUY_YES", 500001n, 200n, 6, grid)).toThrow();
    expect(() => orderTerms("BUY_NO", 0n, 200n, 6, grid)).toThrow();
    expect(() => orderTerms("BUY_YES", 500000n, 100n, 6, grid)).toThrow();
  });
  test("public config strips secrets and rejects pool IDs and duplicate bindings", () => {
    expect(
      parseDreamDexPublicConfig({ ...config, privateKey: "secret" }),
    ).not.toHaveProperty("privateKey");
    expect(() =>
      parseDreamDexPublicConfig({
        ...config,
        markets: [{ ...config.markets[0], marketId: owner }],
      }),
    ).toThrow();
    expect(() =>
      parseDreamDexPublicConfig({
        ...config,
        markets: [...config.markets, ...config.markets],
      }),
    ).toThrow("Duplicate");
  });
  test("orders use explicit original cutoff and outcome IDs", async () => {
    const f = fixture();
    await f.wallet.order({
      side: "BUY_NO",
      outcomePrice: 300000n,
      quantity: 1000000n,
      orderType: 2,
    });
    expect(f.orders[0]).toMatchObject({
      price: 700000n,
      expireTimestampNs: 60000000000n,
      yesId: 3n,
      noId: 4n,
      orderType: 2,
    });
  });
  test("rejects stale wallet account/network and disposed sessions before signing", async () => {
    for (const change of [
      (f: ReturnType<typeof fixture>) => f.setChain("0x1"),
      (f: ReturnType<typeof fixture>) => f.setAccount("0x00"),
      (f: ReturnType<typeof fixture>) => f.wallet.dispose(),
    ]) {
      const f = fixture();
      change(f);
      await expect(f.wallet.sets("mint", 1n, 0)).rejects.toThrow();
      expect(f.transactions).toHaveLength(0);
    }
  });
  test("rejects closed events and recycled pools before orders", async () => {
    const f = fixture();
    f.setNow(60n);
    await expect(
      f.wallet.order({
        side: "BUY_YES",
        outcomePrice: 500000n,
        quantity: 1000000n,
        orderType: 0,
      }),
    ).rejects.toThrow("closed");
    f.setNow(2n);
    f.setNonce(2n);
    await expect(
      f.wallet.order({
        side: "BUY_YES",
        outcomePrice: 500000n,
        quantity: 1000000n,
        orderType: 0,
      }),
    ).rejects.toThrow("recycled");
    expect(f.orders).toHaveLength(0);
  });
  test("mint uses exact collateral allowance and permanent module market ID", async () => {
    const f = fixture();
    await f.wallet.sets("mint", 1000000n, 0);
    const approval = decodeFunctionData({
        abi: erc20Abi,
        data: f.transactions[0].data,
      }),
      mint = decodeFunctionData({
        abi: binaryModuleWriteAbi,
        data: f.transactions[1].data,
      });
    expect(approval.args).toEqual([
      dreamDexNetwork("50312").addresses.binaryModule!,
      1000000n,
    ]);
    expect(mint.functionName).toBe("mintCompleteSet");
    expect(mint.args).toEqual([0, `0x${"00".repeat(32)}`, marketId, 1000000n]);
  });
  test("merge approvals are per outcome ID, not global operator grants", async () => {
    const f = fixture();
    await f.wallet.sets("merge", 9n, 0);
    for (let i = 0; i < 2; i++) {
      const approval = decodeFunctionData({
        abi: erc6909Abi,
        data: f.transactions[i].data,
      });
      expect(approval.functionName).toBe("approve");
      expect(approval.args?.slice(1)).toEqual([BigInt(i + 3), 9n]);
    }
    expect(
      decodeFunctionData({
        abi: binaryModuleWriteAbi,
        data: f.transactions[2].data,
      }).functionName,
    ).toBe("mergeCompleteSet");
  });
  test("redemption remains keyed to the original event after pool reuse", async () => {
    const f = fixture();
    f.market.isResolved = true;
    f.market.finalized = true;
    f.setStatus(4);
    f.setNonce(99n);
    await f.wallet.sets("redeem", 5n, 1);
    expect(
      decodeFunctionData({
        abi: binaryModuleWriteAbi,
        data: f.transactions[1].data,
      }).args,
    ).toEqual([0, `0x${"00".repeat(32)}`, marketId, 1, 5n]);
  });
  test("reverted approval prevents the dependent operation", async () => {
    const f = fixture();
    f.setSuccess(false);
    await expect(f.wallet.sets("mint", 1n, 0)).rejects.toThrow("reverted");
    expect(f.transactions).toHaveLength(1);
  });
});

test("indexed chart is scoped to the immutable event and inverts NO exactly", async () => {
  let wrong = false,
    variables: unknown;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as { variables: unknown };
      variables = body.variables;
      return Response.json({
        data: {
          Fill: [
            {
              id: "one",
              market: wrong ? "0x00" : marketId,
              fillPrice: "300001",
              quantity: "1000000",
              quoteQuantity: "300001",
              timestamp: "12",
            },
          ],
        },
      });
    },
  });
  try {
    const f = fixture(`http://127.0.0.1:${server.port}`);
    expect((await f.adapter.candles(0))[0]?.close).toBe(300001n);
    expect((await f.adapter.candles(1))[0]?.close).toBe(699999n);
    expect(variables).toEqual({ id: marketId });
    wrong = true;
    await expect(f.adapter.candles(0)).rejects.toThrow("Invalid event");
  } finally {
    server.stop(true);
  }
});
test("order approval covers only the selected outcome or exact collateral escrow", async () => {
  const buy = fixture();
  await buy.wallet.order({
    side: "BUY_NO",
    outcomePrice: 300000n,
    quantity: 1000001n,
    orderType: 2,
  });
  expect(
    decodeFunctionData({ abi: erc20Abi, data: buy.transactions[0].data }).args,
  ).toEqual([owner, 300001n]);
  expect(buy.orders[0].autoApprove).toBe(false);
  const sell = fixture();
  await sell.wallet.order({
    side: "SELL_NO",
    outcomePrice: 300000n,
    quantity: 1000000n,
    orderType: 0,
  });
  expect(
    decodeFunctionData({ abi: erc6909Abi, data: sell.transactions[0].data })
      .args,
  ).toEqual([owner, 4n, 1000000n]);
});
