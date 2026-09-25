import { createFileRoute } from '@tanstack/react-router'
import { PantaCreateRoute } from '../app/routeComponents'

export const Route = createFileRoute('/markets_/create')({ component: PantaCreateRoute })
