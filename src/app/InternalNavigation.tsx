import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'

/**
 * The migrated feature tree still renders ordinary anchors. This bridge keeps
 * those established component contracts while letting TanStack Router own
 * same-origin navigation, so the wallet and query providers stay mounted.
 */
export function InternalNavigation() {
  const router = useRouter()

  useEffect(() => {
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest<HTMLAnchorElement>('a[href]')
      if (!anchor || anchor.target || anchor.hasAttribute('download') || anchor.rel.includes('external')) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return
      event.preventDefault()
      void router.navigate({ href: `${url.pathname}${url.search}${url.hash}` })
    }
    document.addEventListener('click', navigate)
    return () => document.removeEventListener('click', navigate)
  }, [router])

  return null
}
