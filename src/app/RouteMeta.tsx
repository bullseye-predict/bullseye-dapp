import { useEffect, type ReactNode } from 'react'
import { brand } from '../components/solz/brand'

type Props = {
  title: string
  description: string
  children: ReactNode
}

const setMeta = (selector: string, value: string) => {
  const element = document.querySelector<HTMLMetaElement>(selector)
  if (element) element.content = value
}

export function RouteMeta({ title, description, children }: Props) {
  useEffect(() => {
    const canonical = new URL(window.location.pathname, window.location.origin).toString()
    const image = new URL(brand.ogImage, window.location.origin).toString()
    document.title = title
    setMeta('meta[name="description"]', description)
    setMeta('meta[property="og:title"]', title)
    setMeta('meta[property="og:description"]', description)
    setMeta('meta[property="og:url"]', canonical)
    setMeta('meta[property="og:image"]', image)
    setMeta('meta[name="twitter:title"]', title)
    setMeta('meta[name="twitter:description"]', description)
    setMeta('meta[name="twitter:image"]', image)
    const link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]') ?? document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'canonical' }))
    link.href = canonical
  }, [description, title])

  return children
}
