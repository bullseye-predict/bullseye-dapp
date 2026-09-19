import { Suspense, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  fallback: ReactNode
}

/** A local code/data boundary: one event region can prepare without replacing
 * the route shell or any of its sibling regions. */
export function EventRegion({ children, fallback }: Props) {
  return <Suspense fallback={fallback}>{children}</Suspense>
}

const status = (label: string) => <p className="sr-only" role="status">{label}</p>

export function EventRailSkeleton() {
  return <div className="ev-sk-rail" aria-busy="true">
    {status('Loading event navigation…')}
    <span className="ev-sk ev-sk-line" style={{ width: '60%' }}/>
    {[0, 1, 2, 3].map((key) => <span className="ev-sk ev-sk-row" key={key}/>)}
  </div>
}

export function EventStageSkeleton() {
  return <section className="ev-stage" aria-busy="true">
    {status('Loading event chart…')}
    <span className="ev-sk ev-sk-stage" aria-hidden="true"/>
  </section>
}

export function EventMarketsSkeleton() {
  return <section className="ev-markets" aria-busy="true">
    {status('Loading event markets…')}
    <div className="ev-section-title" aria-hidden="true"><span className="ev-sk ev-sk-line" style={{ width: 140 }}/></div>
    <div className="ev-sk-markets" aria-hidden="true">
      {[0, 1, 2].map((key) => <span className="ev-sk ev-sk-market" key={key}/>)}
    </div>
  </section>
}

export function EventCommunitySkeleton() {
  return <section className="ev-community" aria-busy="true">
    {status('Loading market activity…')}
    <div className="ev-sk-markets" aria-hidden="true">
      {[0, 1, 2].map((key) => <span className="ev-sk ev-sk-row" key={key}/>)}
    </div>
  </section>
}

export function EventTicketSkeleton() {
  return <div className="ev-sk-ticket" aria-busy="true">
    {status('Loading the trade ticket…')}
    <span className="ev-sk ev-sk-line" style={{ width: '70%' }}/>
    <div className="ev-sk-pair" aria-hidden="true"><span className="ev-sk ev-sk-chip"/><span className="ev-sk ev-sk-chip"/></div>
    <span className="ev-sk ev-sk-line" style={{ width: '40%' }}/>
    <span className="ev-sk ev-sk-button"/>
  </div>
}
