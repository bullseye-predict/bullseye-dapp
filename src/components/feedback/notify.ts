/** The toast and the tone are one event, so they are one call.
 *
 *  Every result toast in the app goes through here instead of through sonner
 *  directly: a success that chimes on one call site and lands silently on the
 *  next is the kind of difference nobody notices until a trade fails quietly.
 *  Spinners are deliberately absent — `loading` passes straight through,
 *  because "still working" is not a result and must not make a sound. */
import { toast } from 'sonner'
import { feedback } from './feedback'

export const notify = {
  success: ((message, data) => {
    feedback('success')
    return toast.success(message, data)
  }) as typeof toast.success,
  error: ((message, data) => {
    feedback('error')
    return toast.error(message, data)
  }) as typeof toast.error,
  /** One transaction of a multi-step trade confirmed. Ticks rather than rings:
   *  see the note on FeedbackKind. */
  step: ((message, data) => {
    feedback('step')
    return toast.success(message, data)
  }) as typeof toast.success,
  /** Passed through unchanged: no sound, no vibration. Wrapped rather than
   *  handed over as bare references, so nothing here depends on sonner's
   *  methods being safe to detach from the object they are declared on. */
  loading: ((message, data) => toast.loading(message, data)) as typeof toast.loading,
  message: ((message, data) => toast.message(message, data)) as typeof toast.message,
  dismiss: ((id?: Parameters<typeof toast.dismiss>[0]) => toast.dismiss(id)) as typeof toast.dismiss,
}
