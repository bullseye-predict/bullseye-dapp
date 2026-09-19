import { createFileRoute } from '@tanstack/react-router'
import { AgentArenaRoute } from '../app/routeComponents'

const search = (value: Record<string, unknown>) => ({ agent: typeof value.agent === 'string' ? value.agent : '' })

export const Route = createFileRoute('/agent-arena')({
  validateSearch: search,
  component: () => <AgentArenaRoute initialAgent={Route.useSearch().agent} />,
})
