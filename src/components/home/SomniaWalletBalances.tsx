import { erc20Abi, encodeFunctionData, formatUnits } from 'viem'
import { useEffect, useState } from 'react'
import type { DynamicEvmWalletPort } from '../arena/DynamicSolanaSession'
import { dreamDexNetwork } from '../../../packages/adapters/dreamdex/event-reader'

type Props = { wallet: DynamicEvmWalletPort | null; chainId?: '5031' | '50312'; compact?: boolean }
type BalanceState = { status: 'disconnected' | 'loading' | 'wrong-network' | 'unsupported-network' | 'ready' | 'error'; connectedChainId?: number; native?: bigint; collateral?: bigint }

const chainLabel = (chainId: number) => chainId === 50312 ? 'Somnia Testnet' : chainId === 5031 ? 'Somnia Mainnet' : `Chain ${chainId}`
const compact = (amount: bigint, decimals: number) => Number(formatUnits(amount, decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })

/** Read-only Somnia wallet overview. It never asks the wallet to sign. */
export function SomniaWalletBalances({ wallet, chainId, compact: compactMode = false }: Props) {
  const expectedNetwork = dreamDexNetwork(chainId ?? '50312')
  const [state, setState] = useState<BalanceState>({ status: 'disconnected' })

  useEffect(() => {
    if (!wallet) { setState({ status: 'disconnected' }); return }
    let alive = true
    setState({ status: 'loading' })
    void (async () => {
      try {
        const client = await wallet.getWalletClient()
        const connectedChainId = Number(BigInt(await client.request({ method: 'eth_chainId' } as never) as string))
        if (connectedChainId !== 5031 && connectedChainId !== 50312) {
          if (alive) setState({ status: 'unsupported-network', connectedChainId })
          return
        }
        if (chainId && connectedChainId !== Number(chainId)) {
          if (alive) setState({ status: 'wrong-network', connectedChainId })
          return
        }
        const network = dreamDexNetwork(String(connectedChainId))
        const tokenCall = encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [wallet.address as `0x${string}`] })
        const [native, collateral] = await Promise.all([
          client.request({ method: 'eth_getBalance', params: [wallet.address as `0x${string}`, 'latest'] } as never) as Promise<string>,
          client.request({ method: 'eth_call', params: [{ to: network.addresses.collateral!, data: tokenCall }, 'latest'] } as never) as Promise<string>,
        ])
        if (alive) setState({ status: 'ready', connectedChainId, native: BigInt(native), collateral: BigInt(collateral) })
      } catch {
        if (alive) setState({ status: 'error' })
      }
    })()
    return () => { alive = false }
  }, [chainId, wallet])

  const network = state.connectedChainId === 5031 || state.connectedChainId === 50312 ? dreamDexNetwork(String(state.connectedChainId)) : expectedNetwork
  const contents = <>
    <header><span>Trading network</span><strong>{state.connectedChainId ? chainLabel(state.connectedChainId) : network.chain.name}</strong></header>
    {state.status === 'disconnected' ? <p>Connect an EVM wallet to view your balances.</p>
      : state.status === 'loading' ? <p>Reading wallet balances…</p>
      : state.status === 'wrong-network' ? <p>Switch to {network.chain.name} to trade with {network.collateralSymbol}.</p>
      : state.status === 'unsupported-network' ? <p>Switch to Somnia Testnet or Mainnet to view prediction balances.</p>
      : state.status === 'error' ? <p>Balances are unavailable. Check your wallet connection and try again.</p>
      : <div><span><small>Native balance</small><b>{compact(state.native!, network.chain.nativeCurrency.decimals)} {network.chain.nativeCurrency.symbol}</b></span><span><small>Available to trade</small><b>{compact(state.collateral!, network.collateralDecimals)} {network.collateralSymbol}</b></span></div>}
  </>

  if (compactMode) {
    const isReady = state.status === 'ready'
    const hasCollateral = isReady && state.collateral !== undefined && state.collateral > 0n
    return <section className="ch-wallet-overview" aria-label="Somnia wallet overview">
      {hasCollateral && <span className="ch-wallet-metric"><small>Trade</small><b>{compact(state.collateral!, network.collateralDecimals)} {network.collateralSymbol}</b></span>}
      {isReady && <span className="ch-wallet-metric"><small>Native</small><b>{compact(state.native!, network.chain.nativeCurrency.decimals)} {network.chain.nativeCurrency.symbol}</b></span>}
      <span className="ch-wallet-network"><i aria-hidden="true" /><span><small>Network</small><b>{state.connectedChainId ? chainLabel(state.connectedChainId) : 'Checking Somnia…'}</b></span></span>
    </section>
  }

  return <section className="ch-wallet-balances" aria-label="Somnia wallet balances">{contents}</section>
}
