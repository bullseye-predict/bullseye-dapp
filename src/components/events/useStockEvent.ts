import { useEffect, useMemo, useState } from 'react'
import { useAgentForecasts, useGeneralEventPrices, type GeneralEventPrices } from './generalEventPrices'
import { agentScore, agentThoughts, agentWindows, type AgentAccuracyRule } from './agentThinking'

/** The agent question of a PreStocks event is its id plus `-agent`. */
export const isAgentQuestionId = (eventId: string) => /^general-.+-agent$/.test(eventId)

const loaded = (state: ReturnType<typeof useGeneralEventPrices>): GeneralEventPrices | null => state.phase === 'loaded' ? state.prices : null

/**
 * Everything a PreStocks event page shows, read once for the whole page: the
 * event's own measured prices, the agent's frozen schedule, its calls, and on
 * an agent question the parent's prices for the comparison chart.
 *
 * Reads, per page: own prices; on a main event with an agent question, that
 * question's rule; on an agent question, the parent's prices; and the agent's
 * call history. The price routes answer from backend memory; the history
 * route is cached for a minute on the backend. Pass an empty `eventId` for a
 * page that is not a stock event and nothing is read.
 */
export function useStockEvent(apiUrl: string, eventId: string, agentEventId?: string) {
  const agentPage = isAgentQuestionId(eventId)
  const own = useGeneralEventPrices(apiUrl, eventId)
  const agentRuleState = useGeneralEventPrices(apiUrl, agentPage ? '' : agentEventId ?? '')
  const ruleSource = agentPage ? loaded(own) : loaded(agentRuleState)
  const agentRule = ruleSource?.rule.kind === 'agent-accuracy' ? ruleSource.rule as AgentAccuracyRule : null
  const parent = useGeneralEventPrices(apiUrl, agentPage && agentRule ? agentRule.parentEventId : '')
  const agent = useAgentForecasts(apiUrl, agentPage || agentEventId ? eventId : '')
  // Statuses move on window boundaries, which are whole hours; a minute is
  // precise enough and costs no request.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!agentRule) return
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [agentRule])
  const windows = useMemo(() => agentRule ? agentWindows(agentRule, agent.forecasts, agent.method, now) : [], [agentRule, agent.forecasts, agent.method, now])
  const thoughts = useMemo(() => agentRule || agent.forecasts.length ? agentThoughts(agentRule, agent.forecasts, agent.method, now) : [], [agentRule, agent.forecasts, agent.method, now])
  return {
    agentPage,
    own,
    /** The prices the agent is judged against: the parent's on an agent page. */
    measured: agentPage ? parent : own,
    agentRule,
    agent,
    windows,
    thoughts,
    score: agentScore(windows),
    now,
    /** Both agent reads have answered, or this event has no agent to wait for. */
    agentLoaded: agentPage || agentEventId ? (agentPage ? own : agentRuleState).phase !== 'loading' && agent.loaded : true,
  }
}

export type StockEvent = ReturnType<typeof useStockEvent>
