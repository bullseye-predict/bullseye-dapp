export type MarketSource = 'SIMULATION' | 'SOLANA' | 'SOMNIA'
export type SolanaCluster = 'devnet' | 'mainnet'
export type SomniaChain = '50312' | '5031'

type Props = {
  sources?: readonly MarketSource[]
  source: MarketSource
  onSource: (source: MarketSource) => void
  solana: SolanaCluster
  onSolana: (cluster: SolanaCluster) => void
  somnia: SomniaChain
  onSomnia: (chain: SomniaChain) => void
  status?: string
}

const sourceLabels: Record<MarketSource, string> = {
  SIMULATION: 'Simulation', SOLANA: 'Solana', SOMNIA: 'Somnia',
}

export function MarketSourceControls({ sources = ['SIMULATION', 'SOLANA', 'SOMNIA'], source, onSource, solana, onSolana, somnia, onSomnia, status }: Props) {
  return <div className="ch-market-source">
    <div className="ch-network-tabs" role="tablist" aria-label="Market data source">
      {sources.map((id, index) => <button
        type="button"
        role="tab"
        key={id}
        id={`market-source-${id}`}
        aria-selected={source === id}
        tabIndex={source === id ? 0 : -1}
        onClick={() => onSource(id)}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? sources.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + sources.length) % sources.length
          const next = sources[nextIndex]!
          onSource(next)
          document.getElementById(`market-source-${next}`)?.focus()
        }}
      >{sourceLabels[id]}</button>)}
    </div>
    <div className="ch-source-detail">
      {source === 'SIMULATION' ? <span>LOCAL MEMORY · HELD</span> : <div role="group" aria-label={`${source === 'SOLANA' ? 'Solana' : 'Somnia'} network`}>
        {source === 'SOLANA' ? <>
          <button type="button" aria-pressed={solana === 'devnet'} onClick={() => onSolana('devnet')}>Devnet</button>
          <button type="button" aria-pressed={solana === 'mainnet'} onClick={() => onSolana('mainnet')}>Mainnet</button>
        </> : <>
          <button type="button" aria-pressed={somnia === '50312'} onClick={() => onSomnia('50312')}>Testnet</button>
          <button type="button" aria-pressed={somnia === '5031'} onClick={() => onSomnia('5031')}>Mainnet</button>
        </>}
      </div>}
      {status && <small title={status}>{status}</small>}
    </div>
  </div>
}
