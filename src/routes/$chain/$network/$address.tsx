import { createFileRoute, redirect } from '@tanstack/react-router'
import { PortfolioRoute } from '../../../app/routeComponents'
import type { ProfileChain, ProfileNetwork } from '../../../components/portfolio/profileRoute'

const chains = new Set<ProfileChain>(['solana', 'somnia'])
const networks = new Set<ProfileNetwork>(['devnet', 'testnet', 'mainnet'])

export const Route = createFileRoute('/$chain/$network/$address')({
  beforeLoad: ({ params }) => {
    if (!chains.has(params.chain as ProfileChain) || !networks.has(params.network as ProfileNetwork) || !params.address) {
      throw redirect({ to: '/' })
    }
  },
  component: () => {
    const params = Route.useParams()
    return <PortfolioRoute profile={{
      chain: params.chain as ProfileChain,
      network: params.network as ProfileNetwork,
      address: params.address,
    }} />
  },
})
