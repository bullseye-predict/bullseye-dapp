import { createFileRoute } from '@tanstack/react-router'
import { ArenaRoute } from '../app/routeComponents'

// The arena's own address, for a brand whose `/` is the markets directory.
export const Route = createFileRoute('/highlight')({ component: ArenaRoute })
