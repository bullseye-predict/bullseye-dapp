const TELEGRAM_AUTH_PATH = /\/telegram\/auth\/?$/
const POPUP_FEATURES = 'popup=yes,width=500,height=640'
const POPUP_TIMEOUT_MS = 6 * 60 * 1_000

let preparedPopup: Window | null = null
let completedCallbackUrl: URL | null = null

export function prepareTelegramOAuthPopup() {
  completedCallbackUrl = null
  if (preparedPopup && !preparedPopup.closed) preparedPopup.close()
  preparedPopup = window.open('', '_blank', POPUP_FEATURES)
  if (!preparedPopup) throw new Error('Telegram sign-in was blocked. Allow popups for this site and try again.')
  preparedPopup.document.title = 'Connecting Telegram…'
}

export function cancelTelegramOAuthPopup() {
  if (preparedPopup && !preparedPopup.closed) preparedPopup.close()
  preparedPopup = null
  completedCallbackUrl = null
}

export function takeTelegramOAuthCallbackUrl() {
  const callback = completedCallbackUrl
  completedCallbackUrl = null
  return callback
}

// Dynamic creates Telegram's URL asynchronously, after the original click.
// Reserving the popup above keeps that navigation inside browser popup policy.
export async function navigateDynamicAuth(url: string) {
  const target = new URL(url)
  if (!TELEGRAM_AUTH_PATH.test(target.pathname)) {
    window.location.assign(target.toString())
    return
  }
  const popup = preparedPopup
  preparedPopup = null
  if (!popup || popup.closed) throw new Error('Telegram sign-in could not open. Allow popups and try again.')
  const expectedState = target.searchParams.get('state')
  if (!expectedState) {
    popup.close()
    throw new Error('Telegram sign-in is missing its security state.')
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false
    let closedAt = 0
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', receive)
      window.clearInterval(closePoll)
      window.clearTimeout(timeout)
      error ? reject(error) : resolve()
    }
    const receive = (event: MessageEvent) => {
      if (event.origin !== target.origin) return
      const message = event.data as { type?: string; code?: string; state?: string } | null
      if (message?.type === 'origin_check') {
        ;(event.source as Window | null)?.postMessage('origin_check_response', target.origin)
        return
      }
      if (message?.type !== 'telegram_completed') return
      if (message.state !== expectedState || !message.code) {
        popup.close()
        finish(new Error('Telegram returned an invalid or incomplete security response.'))
        return
      }
      popup.close()
      const callback = new URL(window.location.href)
      callback.searchParams.set('dynamicOauthState', expectedState)
      callback.searchParams.set('dynamicOauthCode', message.code)
      completedCallbackUrl = callback
      finish()
    }
    window.addEventListener('message', receive)
    const closePoll = window.setInterval(() => {
      if (!popup.closed) { closedAt = 0; return }
      if (!closedAt) { closedAt = Date.now(); return }
      if (Date.now() - closedAt >= 1_000) finish(new Error('Telegram sign-in closed before completion.'))
    }, 500)
    const timeout = window.setTimeout(() => {
      if (!popup.closed) popup.close()
      finish(new Error('Telegram sign-in timed out.'))
    }, POPUP_TIMEOUT_MS)
    popup.location.assign(target.toString())
    popup.focus()
  })
}
