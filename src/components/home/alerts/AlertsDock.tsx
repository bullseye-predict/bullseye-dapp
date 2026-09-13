import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useState } from 'react'
import { clearAlerts, dismissAlert, useAlerts, type AlertLevel } from './store'

const ICON: Record<AlertLevel, typeof Info> = { error: AlertTriangle, warning: AlertTriangle, info: Info, success: CheckCircle2 }

/** Floating alert log, bottom-right. Collapsed it is a single badge showing the
 *  unread count; expanded it lists what happened and can be cleared. */
export function AlertsDock() {
  const alerts = useAlerts()
  const [open, setOpen] = useState(false)
  if (!alerts.length) return null
  const unresolved = alerts.filter(alert => alert.level === 'error' || alert.level === 'warning').length
  return (
    <div className={`ch-alerts-dock ${open ? 'is-open' : ''}`}>
      {open && (
        <div className="ch-alerts-dock__panel" role="log" aria-label="Recent alerts">
          <header>
            <strong>{alerts.length} alert{alerts.length === 1 ? '' : 's'}</strong>
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
                    <time dateTime={new Date(alert.at).toISOString()}>
                      {new Date(alert.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </time>
                  </div>
                  <button type="button" onClick={() => dismissAlert(alert.id)} aria-label={`Dismiss ${alert.title}`}><X size={12} /></button>
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
        aria-label={`${alerts.length} alert${alerts.length === 1 ? '' : 's'}${open ? ', collapse' : ', expand'}`}
        onClick={() => setOpen(value => !value)}
      >
        <AlertTriangle size={15} aria-hidden="true" />
        {unresolved > 0 && <span className="ch-alerts-dock__badge">{unresolved}</span>}
      </button>
    </div>
  )
}
