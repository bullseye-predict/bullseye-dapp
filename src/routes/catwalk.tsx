import { createFileRoute } from '@tanstack/react-router'
import { CatwalkRoute } from '../app/routeComponents'

export const Route = createFileRoute('/catwalk')({ component: CatwalkRoute })
