import { createFileRoute } from '@tanstack/react-router'
import { DemoRoute } from '../app/routeComponents'

export const Route = createFileRoute('/demo')({ component: DemoRoute })
