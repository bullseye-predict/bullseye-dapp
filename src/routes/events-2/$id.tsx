import { createFileRoute, redirect } from '@tanstack/react-router'

const search = (value: Record<string, unknown>) => ({ outcome: typeof value.outcome === 'string' ? value.outcome : undefined })

export const Route = createFileRoute('/events-2/$id')({
  validateSearch: search,
  beforeLoad: ({ params, search, location }) => {
    const predictionId = location.pathname.split('/')[3]
    throw redirect({
      to: '/events/$id',
      params: { id: params.id },
      search: { view: 'community', market: predictionId || undefined, outcome: search.outcome },
      replace: true,
    })
  },
})
