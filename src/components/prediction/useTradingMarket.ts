import { useCallback, useEffect, useRef, useState } from 'react'
import type { Balance, Order } from '../../../packages/prediction-core/types'
import type { Candle, MarketSnapshot, PortfolioPosition } from '../../../packages/prediction-core/market-data'
import type { MarketExecution } from '../../../packages/prediction-core/execution'
import type { PredictionTradingClient } from '../../../packages/sdk/PredictionTradingClient'

export function useTradingMarket(client: PredictionTradingClient, marketId: string, outcomeId: number, connected: boolean) {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null)
  const [candles, setCandles] = useState<Candle[]>([])
  const [positions, setPositions] = useState<PortfolioPosition[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [executions, setExecutions] = useState<MarketExecution[]>([])
  const [balance, setBalance] = useState<Balance | null>(null)
  const [error, setError] = useState('')
  const [accountError, setAccountError] = useState('')
  const [feed, setFeed] = useState<'connected' | 'reconnecting'>('reconnecting')
  const [serverNow, setServerNow] = useState(0)
  const [stale, setStale] = useState(true)
  const refreshRef = useRef<() => void>(() => {})
  const refresh = useCallback(() => refreshRef.current(), [])

  useEffect(() => {
    let disposed = false
    let loading = false
    let again = false
    let received = 0
    let serverTime = 0
    let unsubscribe: (() => void) | undefined
    let unsubscribeMatch: (() => void) | undefined
    setSnapshot(null); setCandles([]); setPositions([]); setOrders([]); setExecutions([]); setBalance(null); setError(''); setAccountError(''); setStale(true)
    const load = async () => {
      if (disposed || !marketId) return
      if (loading) { again = true; return }
      loading = true
      try {
        const next = await client.getSnapshot(marketId)
        if (disposed) return
        if (next.market.id !== marketId || next.market.venue !== client.venue || next.market.chainId !== client.chainId) throw new Error('Market response did not match the selected venue.')
        received = performance.now(); serverTime = next.serverTime
        setSnapshot(next); setServerNow(serverTime); setStale(false); setError('')
        if (!unsubscribe) unsubscribe = client.subscribe(marketId, next.sequence, () => void load(), state => { if (!disposed) setFeed(state) })
        if (!unsubscribeMatch) unsubscribeMatch = client.subscribeMatch(next.market.matchId, () => void load())
        const history = await client.getCandles(marketId, outcomeId, 15_000)
        if (disposed) return
        setCandles(history)
        if (connected) {
          const [nextBalance, nextPositions, nextOrders, nextExecutions] = await Promise.allSettled([
            client.getBalance(client.account), client.getPortfolioPositions(client.account), client.getOpenOrders(client.account, marketId), client.getExecutions(marketId),
          ])
          if (disposed) return
          setBalance(nextBalance.status === 'fulfilled' ? nextBalance.value : null)
          setPositions(nextPositions.status === 'fulfilled' ? nextPositions.value.filter(position => position.marketId === marketId) : [])
          setOrders(nextOrders.status === 'fulfilled' ? nextOrders.value : [])
          setExecutions(nextExecutions.status === 'fulfilled' ? nextExecutions.value : [])
          const failure = [nextBalance, nextPositions, nextOrders, nextExecutions].find(value => value.status === 'rejected')
          setAccountError(failure?.status === 'rejected' ? failure.reason instanceof Error ? failure.reason.message : 'Account data is unavailable.' : '')
        }
      } catch (reason) { if (!disposed) { setError(reason instanceof Error ? reason.message : 'Market data is unavailable.'); setStale(true) } }
      finally { loading = false; if (again && !disposed) { again = false; void load() } }
    }
    refreshRef.current = () => void load()
    void load()
    const poll = setInterval(() => void load(), 2000)
    const clock = setInterval(() => {
      if (!received) return
      const age = performance.now() - received
      setServerNow(serverTime + age); setStale(age > 6000)
    }, 250)
    return () => { disposed = true; clearInterval(poll); clearInterval(clock); unsubscribe?.(); unsubscribeMatch?.(); refreshRef.current = () => {} }
  }, [client, marketId, outcomeId, connected])
  return { snapshot, candles, positions, orders, executions, balance, error, accountError, feed, serverNow, stale, refresh }
}
