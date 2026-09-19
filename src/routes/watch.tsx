import { createFileRoute } from '@tanstack/react-router'
import { WatchRoute } from '../app/routeComponents'

export const Route = createFileRoute('/watch')({ component: WatchRoute })
