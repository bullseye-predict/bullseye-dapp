/**
 * THE SAMPLE DIRECTIVE FEE.
 *
 * This is the off-chain simulation's own number and nothing else. A real
 * directive is priced by the game control plane against the fuel token's live
 * market - see src/components/solz/directiveRelay.ts, which is the only place a
 * price a viewer will actually be charged comes from.
 *
 * There used to be a USD figure here too, derived from a constant token price.
 * It is gone: a fixed price per token is a guess, and a guessed dollar figure
 * beside a real-looking token amount reads as a quote. The simulation quotes in
 * sample credits and says so; the relay quotes in dollars because that is what
 * an operator actually sets.
 */

/** What one directive costs in the simulation, per settlement token. The SOLZ
 *  arena adapters in src/components/arena carry their own table on purpose:
 *  that is a different token with a different price, not this one renamed. */
export const PROMPT_COST = { SOL: 0.005, COOLA: 1000 } as const

/** The simulation's credit, named as a credit. It is not a ticker. */
export const SAMPLE_FUEL_LABEL = 'SAMPLE CREDITS'

/** A sample amount, grouped, because it can run long. */
export function fuelAmountLabel(amount: number): string {
  return amount.toLocaleString('en-US')
}
