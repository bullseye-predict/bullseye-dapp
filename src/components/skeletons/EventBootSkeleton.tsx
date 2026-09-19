import '../../styles/event-boot.css'

export function EventBootSkeleton() {
  return <div id="boot-skeleton" role="status" aria-label="Loading event">
    <span className="sr-only">Loading event</span>
    <div className="bs-bar"><span className="bs bs-line" style={{ width: 96 }} /></div>
    <div className="bs-layout">
      <aside className="bs-panel" aria-hidden="true">
        <span className="bs bs-line" style={{ width: '60%' }} />
        <span className="bs bs-row" /><span className="bs bs-row" />
        <span className="bs bs-row" /><span className="bs bs-row" />
      </aside>
      <div aria-hidden="true">
        <div className="bs-heading">
          <span className="bs bs-line" style={{ width: 168 }} />
          <span className="bs bs-title" />
          <span className="bs bs-line" style={{ width: '46%' }} />
        </div>
        <span className="bs bs-stage" />
        <div className="bs-markets">
          <span className="bs bs-market" /><span className="bs bs-market" /><span className="bs bs-market" />
        </div>
      </div>
      <aside className="bs-panel" aria-hidden="true">
        <span className="bs bs-line" style={{ width: '70%' }} />
        <div className="bs-pair"><span className="bs bs-chip" /><span className="bs bs-chip" /></div>
        <span className="bs bs-line" style={{ width: '40%' }} />
        <span className="bs bs-button" />
      </aside>
    </div>
  </div>
}
