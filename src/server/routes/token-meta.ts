/**
 * TOKEN IDENTITY BY MINT, for coins the board names but does not describe.
 *
 * The CATWALK board arrives from the SOLZ game API carrying whatever the game's
 * own registry recorded, which for a freshly listed coin is a bare ticker and a
 * ROOT-RELATIVE logo path - `/solz_logo.svg`, which resolves against this
 * origin, 404s here, and rendered as the browser's broken-image glyph where a
 * coin's crest belongs. The mints are mainnet, so the chain's own token
 * registry can answer both questions the board cannot: what this coin is called,
 * and what it looks like.
 *
 * It is a SAME-ORIGIN PROXY rather than a fetch from the component, for the
 * reasons every other upstream on this site is proxied: the browser never talks
 * to a third party, there is no CORS to depend on, and the wire shape is parsed
 * in one place (src/components/solz/tokenMeta.ts) rather than in a view.
 *
 * IT NEVER INVENTS ANYTHING. A mint the registry does not know is simply absent
 * from the reply, and the board keeps rendering that coin by the one thing it
 * always knows - its contract address.
 */

const REGISTRY = 'https://lite-api.jup.ag/tokens/v2/search'

/** A mint is base58 and 32-44 characters. Anything else is not asked about:
 *  the query string is built from it, and a board that sent rubbish must not
 *  become a request this server makes on its behalf. */
const isMint = (value: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)

/** The registry answers a bounded number of mints per call, and this board is
 *  36 positions, so one page is always enough. The cap is here so a crafted
 *  query cannot turn one request into an unbounded upstream one. */
const MAX_MINTS = 50

/** A minute in the browser, an hour of stale-while-revalidate behind it. Long
 *  enough that thirty-six rows cost one request a minute, short enough that a
 *  coin whose metadata was just fixed is not wrong on screen for five. */
const json = (payload: unknown, status = 200, cache = 'public, max-age=60, stale-while-revalidate=3600') =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache },
  })

export async function getTokenMeta(url: URL) {
  const mints = (url.searchParams.get('mints') ?? '')
    .split(',')
    .map((mint) => mint.trim())
    .filter(isMint)
    .slice(0, MAX_MINTS)
  // Not an error: a board with nothing on it asks about nothing, and an empty
  // answer is the correct one.
  if (!mints.length) return json({ ok: true, tokens: [] })

  try {
    const response = await fetch(`${REGISTRY}?query=${encodeURIComponent(mints.join(','))}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) throw new Error(`The token registry returned HTTP ${response.status}.`)
    const payload = await response.json()
    const rows: unknown[] = Array.isArray(payload) ? payload : Array.isArray((payload as any)?.tokens) ? (payload as any).tokens : []
    // Only the three fields this site asks for. Forwarding the registry's whole
    // record would put its price, its supply and its holder count on a wire the
    // board reads for identity, and something would eventually render one.
    const tokens = rows
      .filter((row): row is Record<string, any> => !!row && typeof row === 'object')
      .map((row) => ({
        mint: String(row.id ?? row.address ?? ''),
        name: typeof row.name === 'string' ? row.name : '',
        symbol: typeof row.symbol === 'string' ? row.symbol : '',
        // THE REGISTRY'S OWN URL, verbatim. It is turned into a same-origin one
        // by the client (src/components/solz/tokenIcon.ts) rather than here,
        // because this reply is cached and a baked-in proxy URL would pin
        // whatever rule was in force when it was stored.
        icon: typeof row.icon === 'string' ? row.icon : typeof row.logoURI === 'string' ? row.logoURI : '',
      }))
      .filter((token) => token.mint)
    return json({ ok: true, tokens })
  } catch (error) {
    // A registry that did not answer is not a board that is broken. The caller
    // keeps whatever the board itself published, so this degrades to exactly
    // the state the page was in before this route existed.
    return json({ ok: false, tokens: [], error: String((error as Error)?.message ?? error) }, 200, 'no-store')
  }
}
