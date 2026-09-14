import { useEffect, useState } from 'react'
import { predictionUrl } from '../../../packages/sdk/prediction-url'
import type { PortfolioReadModel } from '../../../packages/prediction-core/portfolio/model'
import type { ReservedSolanaQuestion } from '../home/solanaQuestionMarkets'
export type ProfileAccounting = PortfolioReadModel & {
  questions?: ReservedSolanaQuestion[]
}
export function useProfileAccounting(
  apiUrl: string,
  owner: string | undefined,
  section: '' | 'activity' | 'pnl',
  range: string,
  retry: number,
  cursor = '',
  deployment?: string,
) {
  const [state, setState] = useState<{
    key: string
    data: ProfileAccounting | null
    error: string
  }>({ key: '', data: null, error: '' })
  const key = `${apiUrl}:${owner}:${section}:${range}:${cursor}:${deployment ?? ''}`
  useEffect(() => {
    if (!owner || !apiUrl) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const url = new URL(
          predictionUrl(
            `/solana/portfolio/${encodeURIComponent(owner)}${section ? `/${section}` : ''}`,
            apiUrl,
          ),
          window.location.origin,
        )
        if (range) url.searchParams.set('range', range)
        if (cursor) url.searchParams.set('cursor', cursor)
        const response = await fetch(url, { signal: controller.signal })
        const data = await response.json()
        if (!response.ok)
          throw new Error(
            data.message ?? data.error ?? 'Portfolio history unavailable',
          )
        if (
          (deployment && data.deployment !== deployment) ||
          data.address !== owner ||
          !data.accounting ||
          !data.coverage ||
          !Array.isArray(data.events)
        )
          throw new Error('Invalid portfolio response')
        if (!controller.signal.aborted) setState({ key, data, error: '' })
      } catch (e) {
        if (!controller.signal.aborted)
          setState((previous) => ({
            key,
            data: previous.key === key ? previous.data : null,
            error:
              e instanceof Error ? e.message : 'Portfolio history unavailable',
          }))
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 15000)
      }
    }
    void load()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [key, retry])
  return state.key === key ? state : { data: null, error: '' }
}
