import { ArrowUpRight } from "lucide-react";
import { useState } from "react";

type Props = {
  apiUrl: string;
  eventId?: string;
  agentId?: string;
  onOpened: () => void;
  preparing?: boolean;
};
type CreationResult = { market?: { marketId?: string }; error?: string };

export async function readMarketCreationResponse(
  response: Response,
): Promise<CreationResult> {
  const contentType = response.headers.get("content-type") ?? "";
  const result = contentType.includes("application/json")
    ? ((await response.json().catch(() => null)) as CreationResult | null)
    : null;
  if (!result)
    throw Error(
      response.ok
        ? "The market service returned an invalid response."
        : `Sponsored market creation is unavailable (${response.status}).`,
    );
  return result;
}

/** Explicit testnet operator action: market creation spends sponsored native gas. */
export function OpenDreamDexMarket({
  apiUrl,
  eventId,
  agentId,
  onOpened,
  preparing = false,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!apiUrl || !eventId || !agentId?.startsWith("genesis-")) return null;
  async function open() {
    if (busy) return;
    setBusy(true);
    setMessage("Opening the DreamDEX event contract…");
    try {
      const response = await fetch(new URL("/dreamdex/game-markets", apiUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId, agentId }),
      });
      const result = await readMarketCreationResponse(response);
      if (!response.ok || !result.market?.marketId)
        throw Error(result.error ?? "Market creation did not complete.");
      setMessage("Event contract confirmed. Loading the market…");
      onOpened();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Market creation did not complete.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (preparing)
    return (
      <div className="ch-open-market is-preparing" role="status">
        <div>
          <strong>BREAK TIME</strong>
          <span>
            PREPARING MATCH SYSTEM · YES and NO remain at 50:50 until live
            pricing begins.
          </span>
        </div>
      </div>
    );
  return (
    <div className="ch-open-market">
      <div>
        <strong>No market opened for this match.</strong>
        <span>
          Each match needs its own YES/NO question market. Open this one on
          Shannon with sponsored testnet gas, then place your trade here.
        </span>
      </div>
      <button type="button" onClick={() => void open()} disabled={busy}>
        {busy ? "Opening market…" : "Open market · sponsored"}
        <ArrowUpRight size={14} />
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
