import { AppShell } from '../components/solz/AppShell'

export function RouteNotFound() {
  return <AppShell className="solz-home cc-loading-shell" active="highlight">
    <section className="cc-loading-state" role="alert">
      <h1>That route is not in the arena.</h1>
      <p>The Vite host could not match this URL.</p>
      <a className="sh-button" href="/">Return home</a>
    </section>
  </AppShell>
}

export function RouteError({ error, reset }: { error: unknown; reset?: () => void }) {
  const message = error instanceof Error ? error.message : 'The page could not be loaded.'
  return <AppShell className="solz-home cc-loading-shell" active="highlight">
    <section className="cc-loading-state" role="alert">
      <h1>This surface did not load.</h1>
      <p>{message}</p>
      {reset ? <button className="sh-button" type="button" onClick={reset}>Try again</button> : <a className="sh-button" href="/">Return home</a>}
    </section>
  </AppShell>
}
