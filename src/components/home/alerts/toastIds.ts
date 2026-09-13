/** sonner updates a toast in place whenever an id repeats. A spinner needs
 *  exactly that — "Approve in your wallet" should turn into its own result —
 *  but the id has to be retired the moment the attempt resolves. Keyed on the
 *  step alone it outlived the attempt, so retrying a failed step put the new
 *  spinner, and then its success, on top of the error being retried: the
 *  failure vanished as if it had never happened.
 *
 *  The sequence is module-level and never resets, so two attempts at one step
 *  cannot collide even across separate submits, while the earlier attempt's
 *  error toast is still on screen. */
let sequence = 0

export function createToastIds(prefix: string) {
  const open = new Map<string, string>()
  return {
    /** The id of the attempt in flight for this step, minting one if the step
     *  has no attempt open. */
    idFor(step: string) {
      const live = open.get(step)
      if (live) return live
      const minted = `${prefix}:${step}:${(sequence += 1)}`
      open.set(step, minted)
      return minted
    },
    /** The attempt has reached a result. Whatever that toast now shows stays
     *  put: nothing after it is allowed to update it. */
    settle(step: string) { open.delete(step) },
  }
}
