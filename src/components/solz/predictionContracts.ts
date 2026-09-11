import type { ArenaMarket, ArenaMarketOutcome } from './model'

export type PredictionAnswer = 'yes' | 'no'
const NO_PREFIX = 'no:'
export const isNoContract = (id: string) => id.startsWith(NO_PREFIX)
export const baseOutcomeId = (id: string) => isNoContract(id) ? id.slice(NO_PREFIX.length) : id

/** NO is the complement of one outcome, not another participant in the market. */
export function predictionContract(outcome: ArenaMarketOutcome, answer: PredictionAnswer): ArenaMarketOutcome {
  if (answer === 'yes') return outcome
  return {
    ...outcome,
    id: `${NO_PREFIX}${outcome.id}`,
    label: `NO · ${outcome.label}`,
    probability: 1 - outcome.probability,
    quoteHistory: outcome.quoteHistory?.map(point => ({ ...point, probability: 1 - point.probability })),
    priceHistory: outcome.priceHistory?.map((point) => ({ ...point, probability: 1 - point.probability })),
  }
}

export function resolvePredictionContract(market: ArenaMarket | undefined, id: string) {
  const outcome = market?.outcomes.find((item) => item.id === baseOutcomeId(id))
  return outcome ? predictionContract(outcome, isNoContract(id) ? 'no' : 'yes') : undefined
}
