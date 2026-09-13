import { AlertTriangle, CheckCircle2, Info, Loader, X } from 'lucide-react'
import { useState } from 'react'
import { clearAlerts, dismissAlert, useAlerts, type AlertLevel, type AlertRecord } from './store'

const ICON: Record<AlertLevel, typeof Info> = { error: AlertTriangle, warning: AlertTriangle, info: Loader, success: CheckCircle2 }

/** Records persist across reloads, so a timestamp alone stops being enough to
 *  place one: anything older than today carries its date too. */
function stamp(at: number) {
  const moment = new Date(at)
  const time = moment.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return moment.toDateString() === new Date().toDateString() ? time : `${moment.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`
}

/** Floating alert log, bottom-right. Collapsed it is a single badge counting
 *  everything recorded; expanded it lists every step — signatures requested,
 *  confirmations and failures alike — and nothing leaves it except by the
 *  user's hand, through one record's × or Clear all. */
export function AlertsDock() {
  const alerts = useAlerts()
  const [open, setOpen] = useState(false)
  if (!alerts.length) return null
  const failures = alerts.filter((alert: AlertRecord) => alert.level === 'error' || alert.level === 'warning').length
  return (
    <div className={`ch-alerts-dock ${open ? 'is-open' : ''}`}>
      {open && (
        <div className="ch-alerts-dock__panel" role="log" aria-label="Activity log">
          <header>
            <strong>{alerts.length} record{alerts.length === 1 ? '' : 's'}{failures > 0 ? ` · ${failures} failed` : ''}</strong>
            <button type="button" onClick={clearAlerts}>Clear all</button>
          </header>
          <ol>
            {alerts.map(alert => {
              const Icon = ICON[alert.level]
              return (
                <li key={alert.id} className={`is-${alert.level}`}>
                  <Icon size={13} aria-hidden="true" />
                  <div>
                    <strong>{alert.title}</strong>
                    {alert.detail && <span>{alert.detail}</span>}
                    {alert.href && <a href={alert.href} target="_blank" rel="noreferrer">View transaction ↗</a>}
                    <time dateTime={new Date(alert.at).toISOString()}>{stamp(alert.at)}</time>
                  </div>
                  <button type="button" onClick={() => dismissAlert(alert.id)} aria-label={`Remove ${alert.title}`}><X size={12} /></button>
                </li>
              )
            })}
          </ol>
        </div>
      )}
      <button
        type="button"
        className="ch-alerts-dock__toggle"
        aria-expanded={open}
        aria-label={`Activity log, ${alerts.length} record${alerts.length === 1 ? '' : 's'}${failures > 0 ? `, ${failures} failed` : ''}${open ? ', collapse' : ', expand'}`}
        onClick={() => setOpen(value => !value)}
      >
        <AlertTriangle size={15} aria-hidden="true" />
        <span className={`ch-alerts-dock__badge ${failures > 0 ? 'is-failing' : ''}`}>{alerts.length > 99 ? '99+' : alerts.length}</span>
      </button>
    </div>
  )
}
