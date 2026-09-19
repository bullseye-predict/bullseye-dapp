import { createFileRoute } from '@tanstack/react-router'
import { LiveRoute } from '../app/routeComponents'

export const Route = createFileRoute('/live')({ component: LiveRoute })
