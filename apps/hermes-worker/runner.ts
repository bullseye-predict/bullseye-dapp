import type { HermesAgent, HermesTickResult } from './agent'

export interface HermesWorkerOptions {
  agent: HermesAgent
  signal: AbortSignal
  intervalMs?: number
  onTick?: (result: HermesTickResult) => Promise<void> | void
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
    const timer = setTimeout(finish, milliseconds)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) finish()
  })
}

/** Run independently of game/API processes; deterministic risk gates run on every tick. */
export async function runHermesWorker(options: HermesWorkerOptions): Promise<void> {
  const interval = options.intervalMs ?? 1000
  if (!Number.isSafeInteger(interval) || interval < 10) throw new Error('Invalid Hermes worker interval')
  const onAbort = () => { void options.agent.stop('Worker shutdown').catch(() => undefined) }
  options.signal.addEventListener('abort', onAbort, { once: true })
  try {
    while (!options.signal.aborted) {
      const result = await options.agent.tick()
      await options.onTick?.(result)
      if (options.agent.getStatus().state === 'STOPPED') break
      await delay(interval, options.signal)
    }
  } finally {
    options.signal.removeEventListener('abort', onAbort)
    await options.agent.stop('Worker shutdown')
  }
}
