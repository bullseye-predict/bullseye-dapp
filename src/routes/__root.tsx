import type { QueryClient } from '@tanstack/react-query'
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import { appConfig } from '../app/config'
import { InternalNavigation } from '../app/InternalNavigation'
import { RouteError, RouteNotFound } from '../app/RouteStatus'
import { SiteChrome } from '../components/solz/SiteChrome'

type RouterContext = { queryClient: QueryClient }

function RootLayout() {
  return <div className="sz-shell">
    <InternalNavigation />
    <SiteChrome
      environmentId={appConfig.environmentId}
      apiUrl={appConfig.predictionProxyUrl}
      colacatMint={appConfig.colacatMint}
      allowEvm={appConfig.marketSources.includes('SOMNIA')}
    />
    <Outlet />
  </div>
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: RouteNotFound,
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} />,
})
