/**
 * PreStocks assets this deployment can list as stock candidates.
 *
 * Frozen here on purpose. A name or a ticker is not an identity: only the mint
 * is the asset, so a candidate can never be swapped by a renamed token. Each
 * entry was checked against https://prestocks.com/api/prestocks on 2026-09-25,
 * and `scripts/verify-prestocks.ts` re-checks all of it.
 *
 * `pool` is the price source: the GeckoTerminal pool with the most traded
 * volume on that date, quoted in USDC or SOL where one was active. Volume, not
 * liquidity, chose it. The deepest KALSHI and NEURALINK pools had no trade in
 * 24 hours and quoted prices 40% away from the market.
 *
 * Every PreStocks mint is Token-2022 with 9 decimals, a transfer fee and a
 * scaled UI amount. GeckoTerminal prices the base unit, which a multiplier
 * change does not move, so a measured return needs no adjustment for it.
 * `uiMultiplier` is the multiplier wallets and Jupiter applied on the check
 * date; a price shown next to a wallet balance divides by it.
 */
export type PrestocksAsset = {
  symbol: string
  company: string
  mint: string
  pool: string
  poolDex: string
  poolQuote: 'USDC' | 'SOL' | 'SPCXx'
  uiMultiplier: number
  imageUrl: string
  productUrl: string
}

export const PRESTOCKS_VERIFIED_AT = '2026-09-25'

const ASSETS: PrestocksAsset[] = [
  { symbol: 'ANDURIL', company: 'Anduril', mint: 'PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB', pool: 'DZwJYn5ZgC3ZzJPjdzLnpufr3YHJ8PveNyXomzoh1Md4', poolDex: 'meteora', poolQuote: 'USDC', uiMultiplier: 1, imageUrl: 'https://www.prestocks.com/logos/anduril.png', productUrl: 'https://www.prestocks.com/anduril' },
  { symbol: 'ANTHROPIC', company: 'Anthropic', mint: 'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw', pool: 'EZyszDEx1LZDt7TsSFV8xdPi49sDKC3mdfv2MVMEQLtU', poolDex: 'meteora', poolQuote: 'SOL', uiMultiplier: 1, imageUrl: 'https://www.prestocks.com/logos/anthropic.png', productUrl: 'https://www.prestocks.com/anthropic' },
  { symbol: 'FIGUREAI', company: 'Figure AI', mint: 'PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd', pool: '5fLS1XqZshXkPPYyZcnzWK2RRDkcHuXf88wpFoXCJXKG', poolDex: 'meteora', poolQuote: 'USDC', uiMultiplier: 1, imageUrl: 'https://www.prestocks.com/logos/figureai.png', productUrl: 'https://www.prestocks.com/figureai' },
  { symbol: 'KALSHI', company: 'Kalshi', mint: 'PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua', pool: '6gVN1JBffdyFtkSgsHTkGiyzmbp7oJsLuQho56aPx7Fy', poolDex: 'meteora', poolQuote: 'SOL', uiMultiplier: 1, imageUrl: 'https://www.prestocks.com/logos/kalshi.png', productUrl: 'https://www.prestocks.com/kalshi' },
  { symbol: 'NEURALINK', company: 'Neuralink', mint: 'PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S', pool: 'GhznDwSWioFirbyAJY5GWpwcfN4NNR2KPY9Q9XPHT8Ry', poolDex: 'meteora', poolQuote: 'USDC', uiMultiplier: 1, imageUrl: 'https://www.prestocks.com/logos/neuralink.png', productUrl: 'https://www.prestocks.com/neuralink' },
  { symbol: 'OPENAI', company: 'OpenAI', mint: 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF', pool: '4HTy7aTjPm5PTSEws2yWRDPX6gjWM6sC2dV5mv9u8JsH', poolDex: 'meteora', poolQuote: 'USDC', uiMultiplier: 1.4861347, imageUrl: 'https://www.prestocks.com/logos/openai.png', productUrl: 'https://www.prestocks.com/openai' },
  { symbol: 'POLYMARKET', company: 'Polymarket', mint: 'Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP', pool: 'EEkVx3wibBK6m5Fc9VaUTfr32Xwwopv9n7PrvS4Qp9eb', poolDex: 'meteora', poolQuote: 'USDC', uiMultiplier: 1, imageUrl: 'https://www.prestocks.com/logos/polymarket.png', productUrl: 'https://www.prestocks.com/polymarket' },
  { symbol: 'SPACEX', company: 'SpaceX', mint: 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh', pool: '9RExWJFGfAviKHCSCQ59CqA6e7eZgmnfKuABqHn1jKG4', poolDex: 'meteora', poolQuote: 'SPCXx', uiMultiplier: 5, imageUrl: 'https://www.prestocks.com/logos/spacex.png', productUrl: 'https://www.prestocks.com/spacex' },
]

export const PRESTOCKS_ASSETS: readonly Readonly<PrestocksAsset>[] = Object.freeze(ASSETS.map(asset => Object.freeze(asset)))

export const prestocksAsset = (symbol: string): Readonly<PrestocksAsset> | undefined => PRESTOCKS_ASSETS.find(asset => asset.symbol === symbol)
