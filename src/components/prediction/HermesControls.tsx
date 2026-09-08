import { useEffect, useState } from 'react'
import type { PredictionTradingClient } from '../../../packages/sdk/PredictionTradingClient'

const reasons: Record<string, string> = {
  CONFIGURE_VAULT: 'An authorized Hermes vault and session must be configured before starting.',
  ACCOUNTING_UNAVAILABLE: 'Hermes is waiting for complete position cost and loss history.',
  PENDING_RECONCILIATION: 'A previous transaction needs confirmation before Hermes can continue.',
  SESSION_POLICY_CHANGED: 'Vault permissions changed. Review the authorized session limits.',
  WORKER_RESTART: 'Hermes stopped after a worker restart. Review outstanding orders before restarting.',
  INFRASTRUCTURE_UNAVAILABLE: 'The Hermes worker or reasoning service is unavailable.',
}
export function HermesControls({ client, marketId, connected }: { client: PredictionTradingClient; marketId: string; connected: boolean }) {
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState<Awaited<ReturnType<PredictionTradingClient['getHermesStatus']>> | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    setStatus(null); setError('')
    if (!connected) return
    const load = () => client.getHermesStatus().then(value => { if (active) { setStatus(value); setError('') } }, () => { if (active) setError('Hermes status is unavailable.') })
    void load(); const timer = setInterval(() => void load(), 3000)
    return () => { active = false; clearInterval(timer) }
  }, [client, connected])
  const command = async (start: boolean) => {
    setBusy(true); setError('')
    try { await (start ? client.startHermes(marketId, prompt) : client.stopHermes()); setStatus(await client.getHermesStatus()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Hermes could not update.') }
    finally { setBusy(false) }
  }
  const running = status && ['RUNNING', 'START_REQUESTED', 'STOPPING'].includes(status.state)
  return <details className="pt-collateral"><summary>Hermes autonomous trading</summary><p>Hermes trades within the limits authorized on your prediction vault. Strategy text cannot raise those limits.</p><label>Trading instructions<textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={8000} rows={4} disabled={busy || !!running} placeholder="Describe when Hermes should trade or hold…"/></label><p role="status">{connected ? `Status: ${status?.state.toLowerCase().replaceAll('_', ' ') ?? 'loading'}` : 'Connect your vault owner wallet to control Hermes.'}</p>{status?.reasonCode && <p>{reasons[status.reasonCode] ?? 'Hermes is stopped. Review the configured session before continuing.'}</p>}<div><button disabled={!connected || busy || !!running || status?.reasonCode === 'CONFIGURE_VAULT'} onClick={() => void command(true)}>Start Hermes</button><button disabled={!connected || busy || !running} onClick={() => void command(false)}>Stop & cancel orders</button></div>{error && <p className="pt-error" role="alert">{error}</p>}</details>
}
