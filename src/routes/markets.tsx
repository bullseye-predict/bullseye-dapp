import { createFileRoute } from '@tanstack/react-router'
import { MarketsRoute } from '../app/routeComponents'

export const Route = createFileRoute('/markets')({ component: MarketsRoute })
