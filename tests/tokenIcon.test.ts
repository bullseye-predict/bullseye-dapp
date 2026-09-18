import { describe, expect, test } from 'bun:test'
import { allowedIconHost, resolvedTokenLogo, tokenIconUrl } from '../src/components/solz/tokenIcon'

const PROXY = '/api/token-icon?url='

describe('which crest a row actually asks for', () => {
  test('an allowlisted board logo is fetched through this origin', () => {
    const board = 'https://cdn.dexscreener.com/cms/images/abc?width=800'
    expect(resolvedTokenLogo(board, 'https://ipfs.io/ipfs/xyz')).toBe(PROXY + encodeURIComponent(board))
  })

  test('a board logo on a host this site refuses falls through to the registry', () => {
    // THE BUG THIS LOCKS. resolvedTokenLogo used to end in
    // `tokenIconUrl(boardLogo) || boardLogo`, so a refused host was handed to the
    // browser RAW - the cross-origin fetch the allowlist had just declined, and
    // the exact CORP/COEP failure this module exists to prevent. It also returned
    // before the registry was consulted, so a coin with a perfectly good registry
    // icon rendered as the generic mark on every load.
    const board = 'https://unlisted.example/logo.png'
    const registry = tokenIconUrl('https://ipfs.io/ipfs/xyz')
    expect(resolvedTokenLogo(board, registry)).toBe(registry)
    expect(resolvedTokenLogo(board, registry)).not.toContain('unlisted.example')
  })

  test('a refused board logo with no registry icon renders nothing, never a raw URL', () => {
    expect(resolvedTokenLogo('https://unlisted.example/logo.png', '')).toBe('')
  })

  test('a root-relative board path belongs to the service that published it', () => {
    // The game API publishes /solz_logo.svg, which is correct on its own origin
    // and a 404 here, so the registry answers instead.
    const registry = tokenIconUrl('https://ipfs.io/ipfs/solz')
    expect(resolvedTokenLogo('/solz_logo.svg', registry)).toBe(registry)
  })

  test('a data URI is already inline and is left exactly as it is', () => {
    const inline = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
    expect(resolvedTokenLogo(inline, 'https://ipfs.io/ipfs/xyz')).toBe(inline)
  })
})

describe('the allowlist is a host list, not a substring match', () => {
  test('a subdomain of a listed domain is allowed', () => {
    expect(allowedIconHost('https://cdn.dexscreener.com/x.png')).not.toBeNull()
    expect(allowedIconHost('https://xstocks-metadata.backed.fi/logos/tokens/GMEx.png')).not.toBeNull()
  })

  test('backpack.exchange serves the other half of the xStock artwork', () => {
    // RDDT is published as backpack.exchange/api/stock-logo/RDDT by BOTH the
    // board and the registry, so with this host missing there was no second
    // source and the row was the generic mark on every load.
    expect(allowedIconHost('https://backpack.exchange/api/stock-logo/RDDT')).not.toBeNull()
  })

  test('a lookalike host that merely contains a listed one is refused', () => {
    expect(allowedIconHost('https://ipfs.io.evil.test/x.png')).toBeNull()
    expect(allowedIconHost('https://notbacked.fi/x.png')).toBeNull()
    expect(allowedIconHost('https://evil.test/?a=dexscreener.com')).toBeNull()
  })

  test('http and loopback are refused rather than fetched', () => {
    expect(allowedIconHost('http://ipfs.io/x.png')).toBeNull()
    expect(allowedIconHost('https://127.0.0.1/x.png')).toBeNull()
    expect(tokenIconUrl('http://cdn.dexscreener.com/x.png')).toBe('')
  })
})
