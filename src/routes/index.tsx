import { createFileRoute } from '@tanstack/react-router'
import { HomeRoute } from '../app/routeComponents'

export const Route = createFileRoute('/')({ component: HomeRoute })
