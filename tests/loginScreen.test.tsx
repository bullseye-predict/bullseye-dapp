import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { LoginScreen } from '../src/components/auth/LoginDialog'

/**
 * The login screen is the whole first impression of the product, and it is the
 * one surface that must not drift from the game's: a player who signed into
 * sol-zero-engine-mainnet has to recognise this screen.
 *
 * Each assertion below stands for a one-token edit that used to be invisible:
 * a provider's own mark swapped for a generic glyph (Google's identity
 * guidelines require the four-colour G, and an unbranded row reads as a
 * phishing page), Telegram quietly re-enabled onto a completion path this app
 * does not carry, or the X route losing its handler and becoming decoration.
 *
 * THIS REPO CARRIES NO jsdom, happy-dom OR testing-library. That is why the
 * screen is a separate, stateless export from the dialog that portals it: every
 * route is a PROP here, so `renderToStaticMarkup` can hold each one to what it
 * claims to be, while the portal, Escape handling and the wallet directory
 * query stay in LoginDialog.
 */

const base = {
  initStatus: 'finished',
  initError: undefined,
  installed: [{ key: 'phantom:sol', name: 'Phantom', iconUrl: 'https://wallets.test/phantom.png' }],
  busy: false,
  pending: '',
  error: '',
  setupPending: false,
  network: 'devnet',
  onGoogle: () => {},
  onX: () => {},
  onWallet: () => {},
  catalogOpen: false,
  catalogSearch: '',
  catalogueLoading: false,
  directory: [],
  onSearch: () => {},
  onOpenCatalog: () => {},
  onLeaveCatalog: () => {},
  onCloseScreen: () => {},
} as const

const screen = (overrides: Partial<Parameters<typeof LoginScreen>[0]> = {}) =>
  renderToStaticMarkup(<LoginScreen {...base} {...overrides} />)

test('Google is the primary route and carries Google’s own four-colour mark', () => {
  const html = screen()
  expect(html).toContain('Continue with Google')
  expect(html).toContain('dyl-option--primary')
  // The four brand fills, not a tinted glyph: this is what the guidelines ask for.
  for (const fill of ['#EA4335', '#4285F4', '#FBBC05', '#34A853']) expect(html).toContain(fill)
  // And the mark sits on the white chip it is specified against.
  expect(html).toContain('dyl-option__glyph--light')
})

test('X is an enabled route and carries the X mark, not a placeholder', () => {
  const html = screen()
  expect(html).toContain('Continue with X')
  // The X glyph's own path. A generic wallet icon here would still say "X".
  expect(html).toContain('M18.24 2.25h3.31')
  const x = html.slice(html.indexOf('Continue with X') - 400, html.indexOf('Continue with X'))
  expect(x).not.toContain('disabled')
})

test('Telegram is present but locked, as it is in the game build', () => {
  const html = screen()
  const row = html.slice(html.indexOf('#2AABEE'), html.indexOf('#2AABEE') + 600)
  expect(row).toContain('dyl-option--locked')
  expect(row).toContain('disabled')
  expect(row).toContain('Coming soon')
  // No route may claim a Telegram sign-in this app cannot complete.
  expect(html).not.toContain('Continue with Telegram')
})

test('Apple is locked, and every detected Solana wallet is offered', () => {
  const html = screen({
    installed: [
      { key: 'phantom:sol', name: 'Phantom', iconUrl: 'https://wallets.test/phantom.png' },
      { key: 'nightly:sol', name: 'Nightly' },
      { key: 'solflare:sol', name: 'Solflare' },
      { key: 'backpack:sol', name: 'Backpack' },
      { key: 'metamask:sol', name: 'MetaMask' },
    ],
  })
  expect(html).toContain('Apple')
  for (const name of ['Phantom', 'Nightly', 'Solflare', 'Backpack', 'MetaMask']) {
    expect(html).toContain(name)
  }
  expect(html).toContain('5 detected')
  expect(html).toContain('Browse all wallets')
})

test('an unconfigured cluster and a failed link both read out rather than hide', () => {
  const html = screen({ initStatus: 'failed', initError: 'environment unreachable' })
  expect(html).toContain('Account service unavailable')
  expect(html).toContain('environment unreachable')
  expect(html).toContain('Unavailable')
  // Nothing is connectable while the link is down.
  expect(html).not.toContain('dyl-option--primary" data-busy')
})

test('the directory replaces the routes and names what it lists', () => {
  const html = screen({
    catalogOpen: true,
    directory: [
      {
        option: { key: 'phantom', name: 'Phantom', iconUrl: 'https://wallets.test/phantom.png', connectionOptions: [{ chain: 'SOL', source: 'selfAnnounced', type: 'withWalletProvider', walletProviderKey: 'phantom:sol' }] },
        route: { kind: 'provider', walletProviderKey: 'phantom:sol' },
      },
      {
        option: { key: 'glow', name: 'Glow', iconUrl: 'https://wallets.test/glow.png', connectionOptions: [], installationUrls: { chrome: 'https://glow.test/install' } },
        route: { kind: 'install', url: 'https://glow.test/install' },
      },
    ] as Parameters<typeof LoginScreen>[0]['directory'],
  })
  expect(html).toContain('All Solana wallets')
  expect(html).toContain('2 listed')
  expect(html).toContain('Ready to connect')
  expect(html).toContain('Install the extension')
  // The login routes are a page behind this one, not stacked under it.
  expect(html).not.toContain('Continue with Google')
})
