import { createFileRoute } from '@tanstack/react-router'
import { ColaCatRoute } from '../app/routeComponents'

export const Route = createFileRoute('/colacat')({ component: ColaCatRoute })
