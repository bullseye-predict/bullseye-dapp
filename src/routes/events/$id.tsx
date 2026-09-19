import { createFileRoute } from '@tanstack/react-router'
import { EventRoute } from '../../app/routeComponents'
import type { EventVariant } from '../../components/events/eventModel'

const variants = new Set<EventVariant>(['markets', 'community', 'agents'])
const string = (value: unknown) => typeof value === 'string' && value ? value : undefined
const search = (value: Record<string, unknown>) => ({
  view: variants.has(value.view as EventVariant) ? value.view as EventVariant : undefined,
  market: string(value.market),
  outcome: string(value.outcome),
})

export const Route = createFileRoute('/events/$id')({
  validateSearch: search,
  component: () => {
    const { id } = Route.useParams()
    const state = Route.useSearch()
    return <EventRoute
      eventId={id}
      predictionId={state.market}
      initialOutcomeId={state.outcome}
      variant={state.view ?? 'markets'}
    />
  },
})
