import { ChevronUp, MessageSquare, Minus, X } from 'lucide-react'
import { useState } from 'react'
import { CutoutCorner } from '../solz/ui'
import type { SolzDataSource, SolzMatch, SolzSnapshot } from '../solz/model'
import { LiveChatForm } from './LiveChatForm'
import { PromptComposer } from './PromptComposer'

/**
 * The two plates that notch into the bottom corners of the broadcast stage.
 *
 * Both are rendered inside the livestream TabPanel, so leaving that tab closes
 * them out with no extra state: the panel is `hidden` and its subtree goes with
 * it. Each plate carries two CutoutCorner wedges in its own background colour,
 * which is what makes the stage appear to wrap around it. See CutoutCorner in
 * src/components/solz/ui.tsx for why the wedges overlap by a pixel.
 */

const NOTCH = 28

type PromptProps = {
  source: SolzDataSource
  snapshot: SolzSnapshot
  match: SolzMatch
  promptAgentId?: string
  intermission: boolean
  simulation: boolean
  warning?: string
}

/**
 * Bottom-right. Always present on the livestream tab - the mock keeps the
 * composer permanently available, and its chevron opens the detail body only.
 * Light gray, so it continues the AGENT INSTRUCTIONS rail directly below it.
 *
 * It opens with the tab. The plate exists only here, so arriving on livestream
 * IS the request to write a prompt; leaving unmounts it, which is what closes
 * it again on Predictions and Market.
 */
export function StagePromptCorner({
  source,
  snapshot,
  match,
  promptAgentId,
  intermission,
  simulation,
  warning,
}: PromptProps) {
  const [open, setOpen] = useState(true)
  return (
    <div className="ch-stage-corner ch-stage-corner--prompt">
      <CutoutCorner size={NOTCH} className="ch-stage-cut ch-stage-cut--br-top" />
      <CutoutCorner size={NOTCH} className="ch-stage-cut ch-stage-cut--br-side" />
      <PromptComposer
        source={source}
        snapshot={snapshot}
        match={match}
        open={open}
        onToggle={() => setOpen(!open)}
        promptAgentId={promptAgentId}
        intermission={intermission}
        simulation={simulation}
        warning={warning}
      />
    </div>
  )
}

type ChatProps = {
  source: SolzDataSource
  matchId: string
  onClose: () => void
}

/**
 * Bottom-left, hidden until the CHAT HIGHLIGHTS rail is clicked. The field
 * only: the message log stays in that rail, immediately below this plate.
 */
export function StageChatCorner({ source, matchId, onClose }: ChatProps) {
  const [minimized, setMinimized] = useState(false)
  return (
    <div
      className={`ch-stage-corner ch-stage-corner--chat ${minimized ? 'is-minimized' : ''}`}
    >
      <CutoutCorner size={NOTCH} className="ch-stage-cut ch-stage-cut--bl-top" />
      <CutoutCorner size={NOTCH} className="ch-stage-cut ch-stage-cut--bl-side" />
      {minimized ? (
        <button
          type="button"
          className="ch-stage-restore"
          aria-expanded={false}
          onClick={() => setMinimized(false)}
        >
          <MessageSquare size={13} aria-hidden="true" />
          <span>LIVE CHAT</span>
          <ChevronUp size={14} aria-hidden="true" />
        </button>
      ) : (
        <>
          <header>
            <h3>
              <MessageSquare size={13} /> LIVE CHAT
            </h3>
            <span>
              <button
                type="button"
                className="ch-stage-minimize"
                aria-label="Minimize the chat field"
                onClick={() => setMinimized(true)}
              >
                <Minus size={14} aria-hidden="true" />
              </button>
              <button type="button" aria-label="Close the chat field" onClick={onClose}>
                <X size={15} />
              </button>
            </span>
          </header>
          <LiveChatForm
            source={source}
            matchId={matchId}
            note="Local preview · visible on this device"
            autoFocus
          />
        </>
      )}
    </div>
  )
}
