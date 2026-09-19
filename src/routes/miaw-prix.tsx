import { createFileRoute } from '@tanstack/react-router'
import { MiawPrixRoute } from '../app/routeComponents'

const search = (value: Record<string, unknown>) => ({ season: typeof value.season === 'string' ? value.season : '' })

export const Route = createFileRoute('/miaw-prix')({
  validateSearch: search,
  component: () => <MiawPrixRoute initialSeasonId={Route.useSearch().season} />,
})
