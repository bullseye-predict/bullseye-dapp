import { createFileRoute } from '@tanstack/react-router'
import { EventRoute } from '../../../app/routeComponents'

const search = (value: Record<string, unknown>) => ({ outcome: typeof value.outcome === 'string' ? value.outcome : undefined })

export const Route = createFileRoute('/events-3/$id/$predictionId')({
  validateSearch: search,
  component: () => {
    const { id, predictionId } = Route.useParams()
    return <EventRoute eventId={id} predictionId={predictionId} initialOutcomeId={Route.useSearch().outcome} variant="agents" />
  },
})
