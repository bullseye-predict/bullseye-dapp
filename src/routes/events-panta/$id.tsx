import { createFileRoute } from '@tanstack/react-router'
import { PantaEventRoute } from '../../app/routeComponents'

export const Route = createFileRoute('/events-panta/$id')({
  component: () => {
    const { id } = Route.useParams()
    return <PantaEventRoute id={id}/>
  },
})
