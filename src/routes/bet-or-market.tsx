import { createFileRoute } from '@tanstack/react-router'
import { BetOrMarketRoute } from '../app/routeComponents'

export const Route = createFileRoute('/bet-or-market')({ component: BetOrMarketRoute })
