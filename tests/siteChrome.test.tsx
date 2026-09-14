import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppShell } from '../src/components/solz/AppShell'
import { activeForPath, chromeHandlers, setChrome, chromeState } from '../src/components/session/chrome'

describe('site chrome', () => {
  test('the page renders no header of its own, on any page family', () => {
    for (const className of ['solz-home ch-home', 'solz-home ev-app', 'ah-root', 'arena-app']) {
      const html = renderToStaticMarkup(<AppShell className={className} active="agents"><main/></AppShell>)
      // One header for the whole app: commenting it out in SiteHeader has to be
      // the only way to remove it, which is false the moment a page renders one.
      expect(html).not.toContain('sz-site-header')
      expect(html).not.toContain('sh-wallet')
      expect(html).toContain('cc-site-footer')
    }
  })

  test('the page publishes what the header needs, and a repeat publish is ignored', () => {
    setChrome({ active: 'markets', marketsHref: '/markets', skipTo: '#market-directory', skipLabel: 'Skip to markets' })
    const first = chromeState()
    expect(first.active).toBe('markets')
    expect(first.skipTo).toBe('#market-directory')
    setChrome({ active: 'markets', marketsHref: '/markets', skipTo: '#market-directory', skipLabel: 'Skip to markets' })
    // Identity, not just equality: HomeApp republishes on every render, and a new
    // object each time would re-render the header for a value that never moved.
    expect(chromeState()).toBe(first)
  })

  test('handlers are read at click time, so the header calls the page on screen', () => {
    let reached = ''
    setChrome({ active: 'highlight' }, () => { reached = 'arena' })
    chromeHandlers().onArena?.()
    expect(reached).toBe('arena')
    // A page with no handler must not leave the previous page's closure armed.
    setChrome({ active: 'profile' })
    expect(chromeHandlers().onArena).toBeUndefined()
  })

  test('the URL lights the right link before any page has published', () => {
    expect(activeForPath('/markets')).toBe('markets')
    expect(activeForPath('/live')).toBe('markets')
    expect(activeForPath('/agent-arena')).toBe('agents')
    expect(activeForPath('/profile')).toBe('profile')
    expect(activeForPath('/solana/devnet/abc')).toBe('profile')
    expect(activeForPath('/events/xyz')).toBe('highlight')
    expect(activeForPath('/')).toBe('highlight')
  })
})
