export function canSubmitDirective(input: {
  relayOpen: boolean
  walletReady: boolean
  sampleReady: boolean
  pending: boolean
  fueling: boolean
  prompt: string
}) {
  if (input.pending || input.fueling || input.prompt.trim().length < 8) return false
  // Paid directives go to the relay even when this page has no local roster or
  // disagrees about match timing. Elysia owns both facts and throttles abuse.
  return input.relayOpen ? input.walletReady : input.sampleReady
}
