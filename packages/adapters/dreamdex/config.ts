import type { DreamDexPublicConfig } from "../../prediction-core/market-data";
import {
  atomic,
  integer,
  invariant,
  record,
  textField,
} from "../../prediction-core/validation";
import { dreamDexNetwork, type DreamDexEventBinding } from "./event-reader";
export function parseDreamDexPublicConfig(
  input: unknown,
): DreamDexPublicConfig {
  const c = record(input),
    chainId = textField(c.chainId, "chainId");
  dreamDexNetwork(chainId);
  const url = (field: string, protocols: string[]) => {
    const u = new URL(textField(c[field], field, 2048));
    invariant(
      protocols.includes(u.protocol) && !u.username && !u.password,
      "INVALID_CONFIG",
      "Public endpoint protocol or credentials are invalid",
    );
    return u.toString();
  };
  invariant(
    Array.isArray(c.markets),
    "INVALID_CONFIG",
    "DreamDEX requires explicit game-event bindings",
  );
  const markets: DreamDexPublicConfig["markets"] = c.markets.map((item) => {
    const m = record(item),
      marketId = textField(m.marketId, "marketId"),
      voidPolicy = integer(m.voidPolicy, "voidPolicy", 0, 2);
    invariant(
      /^0x[0-9a-fA-F]{64}$/.test(marketId) &&
        (voidPolicy === 0 || voidPolicy === 2),
      "INVALID_CONFIG",
      "Invalid DreamDEX market identity or void policy",
    );
    const tradingStartsAt = integer(m.tradingStartsAt, "tradingStartsAt"),
      tradingLocksAt = integer(m.tradingLocksAt, "tradingLocksAt");
    invariant(
      tradingStartsAt < tradingLocksAt &&
        tradingStartsAt % 1000 === 0 &&
        tradingLocksAt % 1000 === 0,
      "INVALID_CONFIG",
      "Event timing must be ordered whole seconds",
    );
    return {
      eventId: textField(m.eventId, "eventId"),
      ...(m.questionId ? {questionId: textField(m.questionId, 'questionId')} : {}),
      ...(m.subjectId ? {subjectId: textField(m.subjectId, 'subjectId')} : {}),
      label: textField(m.label, "label"),
      marketId: marketId as `0x${string}`,
      oracleQuestionId: atomic(
        m.oracleQuestionId,
        "oracleQuestionId",
        (1n << 256n) - 1n,
      ).toString(),
      tradingStartsAt,
      tradingLocksAt,
      voidPolicy: voidPolicy as 0 | 2,
    };
  });
  invariant(
    new Set(markets.map((m) => m.marketId.toLowerCase())).size ===
      markets.length,
    "INVALID_CONFIG",
    "Duplicate DreamDEX market binding",
  );
  return {
    chainId: chainId as DreamDexPublicConfig["chainId"],
    ...(chainId === '50312' && c.demoCreation === true ? { demoCreation: true } : {}),
    label: textField(c.label, "label"),
    indexerUrl: url("indexerUrl", ["http:", "https:"]),
    wsRpcUrl: url("wsRpcUrl", ["ws:", "wss:"]),
    markets,
  };
}
export function eventBinding(
  config: DreamDexPublicConfig,
  market: DreamDexPublicConfig["markets"][number],
): DreamDexEventBinding {
  return {
    venue: "DREAMDEX",
    chainId: config.chainId,
    matchId: market.eventId,
    marketId: market.marketId,
    oracleQuestionId: BigInt(market.oracleQuestionId),
    tradingStartsAt: market.tradingStartsAt,
    tradingLocksAt: market.tradingLocksAt,
    voidPolicy: market.voidPolicy,
  };
}
