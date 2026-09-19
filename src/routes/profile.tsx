import { createFileRoute } from '@tanstack/react-router'
import { PortfolioRoute } from '../app/routeComponents'

export const Route = createFileRoute('/profile')({ component: PortfolioRoute })
