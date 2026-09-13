import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Toaster } from 'sonner'
import { AlertsDock } from './AlertsDock'

/** Everything that has to stay visible while a trade is being signed: the
 *  per-transaction toasts and the alert log.
 *
 *  A dialog opened with showModal() paints in the browser's top layer, which no
 *  z-index can reach over, and it makes every node outside itself inert, so a
 *  toast parked on <body> was both hidden behind the trade dialog and dead to
 *  clicks. The one place that is painted above the backdrop *and* still
 *  interactive is inside the open dialog itself, so this host element follows
 *  whichever modal dialog is open and returns to <body> when it closes. The
 *  toasts keep their own fixed positioning throughout, because a dialog with no
 *  transform or filter is not a containing block and does not clip them. */
export function OverlayLayer() {
  const [host, setHost] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    const element = document.createElement('div')
    element.className = 'ch-overlay-layer'

    /** A dialog opened with show() rather than showModal() is not in the top
     *  layer and blocks nothing, so it must not capture the layer. */
    const topmostModal = () => {
      const modal = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'))
        .filter(dialog => { try { return dialog.matches(':modal') } catch { return true } })
      return modal[modal.length - 1] ?? null
    }

    let removal: MutationObserver | null = null
    const anchor = () => {
      const target: HTMLElement = topmostModal() ?? document.body
      if (element.parentElement !== target) target.appendChild(element)
      removal?.disconnect()
      removal = null
      // React can unmount a dialog, or anything above it, without closing it
      // first, which would carry the layer out of the document with it and
      // silently kill every toast. Watching the tree costs two boolean reads per
      // batch and only runs while a dialog is actually holding the layer.
      if (target !== document.body) {
        removal = new MutationObserver(() => { if (!element.isConnected || !target.isConnected) anchor() })
        removal.observe(document.body, { childList: true, subtree: true })
      }
    }
    anchor()
    setHost(element)

    // showModal() and close() both toggle the open attribute, so this is the
    // one signal needed to follow a dialog in and out of the top layer.
    const dialogs = new MutationObserver(anchor)
    dialogs.observe(document.documentElement, { subtree: true, attributeFilter: ['open'] })
    return () => { dialogs.disconnect(); removal?.disconnect(); element.remove() }
  }, [])

  if (!host) return null
  // One Toaster for the whole app. Each on-chain transaction reports which step
  // it is, so a multi-transaction first trade is not a run of unlabelled wallet
  // prompts. The z-index still matters whenever no dialog is open.
  return createPortal(
    <>
      <Toaster
        position="bottom-center"
        richColors
        closeButton
        theme="dark"
        // sonner shows three at a time by default and hides the rest, so a first
        // trade — activation, two book activations, funding, the order — pushed
        // its own earlier steps out of sight.
        visibleToasts={6}
        style={{ zIndex: 2147483000 }}
      />
      <AlertsDock />
    </>,
    host,
  )
}
