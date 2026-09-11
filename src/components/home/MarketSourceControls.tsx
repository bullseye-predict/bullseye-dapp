export type MarketSource = 'SIMULATION' | 'SOLANA' | 'SOMNIA'
export type SolanaCluster = 'devnet' | 'mainnet'
export type SomniaChain = '50312' | '5031'

type Props = {
  source: MarketSource
  onSource: (source: MarketSource) => void
  solana: SolanaCluster
  onSolana: (cluster: SolanaCluster) => void
  somnia: SomniaChain
  onSomnia: (chain: SomniaChain) => void
  status?: string
}

const sources = [
  { id: 'SIMULATION', label: 'Simulation' },
  { id: 'SOLANA', label: 'Solana' },
  { id: 'SOMNIA', label: 'Somnia' },
] as const

export function MarketSourceControls({ source, onSource, solana, onSolana, somnia, onSomnia, status }: Props) {
  return <div className="ch-market-source">
    <div className="ch-network-tabs" role="tablist" aria-label="Market data source">
      {sources.map((item, index) => <button
        type="button"
        role="tab"
        key={item.id}
        id={`market-source-${item.id}`}
        aria-selected={source === item.id}
        tabIndex={source === item.id ? 0 : -1}
        onClick={() => onSource(item.id)}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? sources.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + sources.length) % sources.length
          const next = sources[nextIndex]!
          onSource(next.id)
          document.getElementById(`market-source-${next.id}`)?.focus()
        }}
      >{item.label}</button>)}
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
