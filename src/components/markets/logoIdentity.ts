import { useSyncExternalStore } from 'react'
import { FastAverageColor } from 'fast-average-color'
import { allowedIconHost, tokenIconUrl } from '../solz/tokenIcon'

/**
 * THE HUE A TEAM'S CREST IS ACTUALLY PAINTED IN.
 *
 * `teamIdentityColor` (moneyline.ts) hashes a name into a hue, which gives every
 * side a stable, readable, vivid colour - and no relationship whatsoever to the
 * artwork sitting next to it. An orange cat got a blue-violet button; a red crest
 * got cyan. This module answers the other half: what colour is that image.
 *
 * ONLY THE HUE CROSSES OVER. The saturation and lightness stay on the hash's
 * band (58-68% / 44-51%), because a raw sampled colour is whatever the artist
 * chose - a white-background logo samples to #f2f2f2 and a dark one to #1a1a1a,
 * and neither is a button. Taking the hue and re-seating it on the existing band
 * gives "orange cat, orange button" while every control on the board keeps one
 * weight and stays inside `pickInk`'s contrast range.
 *
 * SAME-ORIGIN IS THE WHOLE TRICK. Reading pixels back out of a canvas taints it
 * for any image the browser did not fetch same-origin, and token artwork lives on
 * IPFS gateways, Arweave and pump.fun - hosts that mostly do not send CORS
 * headers. This site already proxies crests through /api/token-icon for a related
 * reason (Cross-Origin-Resource-Policy, see src/components/solz/tokenIcon.ts), so
 * the same rewrite makes the pixels legible: a proxied crest is this origin's
 * bytes and `getImageData` simply works. A URL the proxy will not serve is not
 * sampled at all rather than sampled and caught - a tainted read is a console
 * error on every render for a colour we were never going to get.
 */

/** SETTLED ANSWERS ONLY, by the URL actually sampled. `NO_HUE` is settled too -
 *  the crest decoded and turned out to be greyscale - and it is what stops a
 *  black-and-white wordmark being re-read on every render.
 *
 *  A FAILED LOAD IS NOT A SETTLED ANSWER, and conflating the two was a bug: a
 *  crest that lost one race against a slow gateway was recorded as "no hue" and
 *  never looked at again, so RAYCAT - whose artwork samples to a clean 24 degrees
 *  once it arrives - showed the name hash's blue-violet for the rest of the
 *  session. Failures count attempts instead, and are retried. */
const NO_HUE = -1
const hues = new Map<string, number>()
/** In flight. Distinct from settled: a second render must not start a second read. */
const reading = new Set<string>()
/** Attempts so far, for URLs that have failed at least once. */
const failures = new Map<string, number>()
/** TWO, not more. A retry is here for the crest that lost a race against a busy
 *  gateway - RAYCAT succeeds on its second attempt - not for one whose host is
 *  refusing. ipfs.io answers a cold board with 404s and 429s, and every extra
 *  attempt against that is load added to a host that is already rate-limiting
 *  us. After two the crest keeps the name hash, which is a good colour. */
const MAX_ATTEMPTS = 2
const listeners = new Set<() => void>()
let version = 0

const publish = () => { version += 1; for (const listener of listeners) listener() }

/** One canvas for the whole page rather than one per crest. */
let reader: FastAverageColor | null = null

/** Near-white, near-black and transparent pixels are the background of a crest,
 *  not its identity: a red logo on a white field averages to pink and a neon one
 *  on black averages to grey. The fifth number is the match threshold. */
const IGNORED = [
  [255, 255, 255, 255, 48],
  [0, 0, 0, 255, 40],
  [0, 0, 0, 0, 12],
] as [number, number, number, number, number][]

/** Below this the crest is greyscale (a black-and-white wordmark, a silver coin)
 *  and its "hue" is quantisation noise - two near-identical greys can sit on
 *  opposite sides of the wheel. The name hash is the better answer there.
 *
 *  DELIBERATELY LOW, because this gate reads a DOMINANT colour, not a vivid one.
 *  Flat vector artwork returns its brand colour saturated, but photographic and
 *  painted crests return something muted: RAYCAT's cat quantises to #917473,
 *  whose saturation is 0.12 exactly - it sat on the old threshold and could fall
 *  to either side. The hue in that muted brown is still the right hue, and it is
 *  re-seated on the vivid band anyway, so only genuine grey needs excluding. */
const MIN_SATURATION = 0.06

/** The hue of an RGB triple, or null when it has no meaningful one. */
function hueOf([red, green, blue]: [number, number, number, number]) {
  const [r, g, b] = [red / 255, green / 255, blue / 255]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  const lightness = (max + min) / 2
  if (!chroma || !lightness || lightness === 1) return null
  if (chroma / (1 - Math.abs(2 * lightness - 1)) < MIN_SATURATION) return null
  const hue = max === r ? ((g - b) / chroma + 6) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4
  return hue * 60
}

/** The URL this site is willing to read pixels from, or '' for one it is not.
 *  A relative path is already this origin. An allowlisted remote host becomes
 *  the same-origin proxy URL - the identical rewrite the <img> got, so the
 *  sample reuses the bytes already in the browser's cache rather than costing a
 *  second download. */
function sampleable(raw: string) {
  if (!raw) return ''
  if (raw.startsWith('/')) return raw
  if (raw.startsWith('/api/token-icon?')) return raw
  return allowedIconHost(raw) ? tokenIconUrl(raw) : ''
}

/**
 * The crest's hue if it has already been read, otherwise undefined - and, on the
 * first miss, the read is started. Synchronous by design: the colour helpers are
 * called during render and must answer immediately with the hash fallback, then
 * render again once the real hue lands. `useLogoPalette` is what makes that
 * second render happen.
 */
export function logoHue(raw?: string): number | undefined {
  const url = sampleable(raw ?? '')
  if (!url) return undefined
  const settled = hues.get(url)
  if (settled !== undefined) return settled === NO_HUE ? undefined : settled
  if (typeof window === 'undefined') return undefined
  if (reading.has(url) || (failures.get(url) ?? 0) >= MAX_ATTEMPTS) return undefined
  start(url)
  return undefined
}

/** In flight at once. A board is a dozen crests, each on an IPFS or Arweave
 *  gateway reached through /api/token-icon, and that route has no cache of its
 *  own - it fetches upstream every time. Twelve simultaneous reads is how the
 *  transient failures above were being produced in the first place, so the queue
 *  is what makes the retry above rarely necessary. */
const MAX_IN_FLIGHT = 4
const queue: string[] = []

function start(url: string) {
  reading.add(url)
  queue.push(url)
  pump()
}

function pump() {
  while (queue.length && reading.size - queue.length < MAX_IN_FLIGHT) {
    const url = queue.shift()
    if (!url) return
    read(url)
  }
}

function read(url: string) {
  reader ??= new FastAverageColor()
  reader
    // `dominant` and not the default average: a crest is flat brand colours, and
    // the most common one is the brand. Averaging the red card with its white
    // wordmark returns pink, which is nobody's colour.
    .getColorAsync(url, { algorithm: 'dominant', mode: 'speed', step: 2, ignoredColor: IGNORED, silent: true })
    .then((result) => {
      if (result.error) throw result.error
      hues.set(url, hueOf(result.value) ?? NO_HUE)
      failures.delete(url)
      publish()
    })
    .catch(() => {
      // Not settled: the bytes never arrived, so nothing was learned about this
      // crest's colour. The next render that asks for it will try again.
      failures.set(url, (failures.get(url) ?? 0) + 1)
    })
    .finally(() => { reading.delete(url); pump() })
}

/**
 * Re-render this component when a crest's hue arrives.
 *
 * Every surface that colours a head-to-head side calls it once, near the top.
 * Without it the first paint's hash colour would simply stay on screen, because
 * nothing in React knows the cache changed underneath it.
 */
export function useLogoPalette() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => version,
    () => 0,
  )
}
