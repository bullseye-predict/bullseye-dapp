import { ArrowUpRight, Check, Copy, Network, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ArenaTokenConfig, TokenIdentity } from '../solz/tokenInfo'

function TokenRecord({ symbol, identity, description }: { symbol: 'COOLA' | 'SOLZ'; identity: TokenIdentity; description: string }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  async function copy() {
    if (!identity.contractAddress) return
    try { await navigator.clipboard.writeText(identity.contractAddress); setCopyState('copied') }
    catch { setCopyState('error') }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopyState('idle'), 2200)
  }
  return <article className={`ch-token-record is-${symbol.toLowerCase()}`} aria-label={`${symbol} token information`}>
    <header><span className="ch-token-emblem" aria-hidden="true">{symbol === 'COOLA' ? <Zap size={20}/> : <span>SZ</span>}</span><div><h3>${symbol}</h3><span>{symbol === 'COOLA' ? 'AGENT FUEL' : 'ARENA TOKEN'}</span></div>{identity.explorerUrl && <a href={identity.explorerUrl} target="_blank" rel="noreferrer" aria-label={`View ${symbol} contract in explorer`}><ArrowUpRight size={17}/></a>}</header>
    <p>{description}</p>
    <dl><div><dt>Network</dt><dd><Network size={12}/>{identity.network}</dd></div><div className="ch-token-contract"><dt>CA</dt><dd>{identity.contractAddress ? <><code>{identity.contractAddress}</code><button onClick={() => void copy()} aria-label={`Copy ${symbol} contract address`}>{copyState === 'copied' ? <Check size={14}/> : <Copy size={14}/>}</button></> : <span className="ch-token-pending">To be announced</span>}</dd></div></dl>
    <span className="ch-token-copy-status" role="status">{copyState === 'copied' ? 'Contract address copied' : copyState === 'error' ? 'Select the address above to copy it.' : ''}</span>
  </article>
}

export function TokenDirectory({ config }: { config: ArenaTokenConfig }) {
  return <aside className="ch-token-directory" aria-labelledby="arena-token-title"><header><h2 id="arena-token-title">THE ARENA ECONOMY</h2><span>02 TOKENS</span></header><div className="ch-token-records"><TokenRecord symbol="COOLA" identity={config.coola} description="Fuel prompts. Predict outcomes."/><TokenRecord symbol="SOLZ" identity={config.solz} description="Play in the SOLZ live arena."/></div><p className="ch-token-preview-note">Homepage activity uses off-chain sample credits.</p></aside>
}
