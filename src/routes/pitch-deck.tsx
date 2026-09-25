import { createFileRoute } from '@tanstack/react-router'
import { PitchDeckRoute } from '../app/routeComponents'

// `slide` is one-based in the URL so a shared link reads like the counter.
const search = (value: Record<string, unknown>) => {
  const slide = Number(value.slide)
  return { slide: Number.isInteger(slide) && slide > 0 ? slide : 1 }
}

function PitchDeckPage() {
  const { slide } = Route.useSearch()
  const navigate = Route.useNavigate()
  return <PitchDeckRoute
    slide={slide - 1}
    onSlideChange={(next) => void navigate({ search: { slide: next + 1 }, replace: true })}
  />
}

export const Route = createFileRoute('/pitch-deck')({
  validateSearch: search,
  component: PitchDeckPage,
})
