import { createFileRoute, redirect } from '@tanstack/react-router'

const search = (value: Record<string, unknown>) => ({ outcome: typeof value.outcome === 'string' ? value.outcome : undefined })

export const Route = createFileRoute('/events/$id/$predictionId')({
  validateSearch: search,
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/events/$id',
      params: { id: params.id },
      search: { view: undefined, market: params.predictionId, outcome: search.outcome },
      replace: true,
    })
  },
})
