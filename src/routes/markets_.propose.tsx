import { createFileRoute } from '@tanstack/react-router'
import { MarketProposalRoute } from '../app/routeComponents'

export const Route = createFileRoute('/markets_/propose')({ component: MarketProposalRoute })
