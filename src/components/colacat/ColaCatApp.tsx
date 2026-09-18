import '../../styles/home.css'
import '../../styles/colacat.css'
import { ArrowRight, ArrowUpRight, Check, Copy, Flame } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AppShell } from '../solz/AppShell'
import { Plate } from './Plate'
import { ColaCatPromptPanel } from './ColaCatPromptPanel'
import { ColaCatProofStack } from './ColaCatProofStack'
import { useReveal } from './useReveal'
import {
  COLACAT_ART, COLACAT_PROOFS, COLACAT_SYMBOL, pumpFunHref,
} from './colacatArt'

/**
 * /colacat - what the token is, why a cat is a liquid, and what the liquid buys.
 * Prefix: `cola-`. Root element: `solz-home cola-app`.
 *
 * WHY `cola-` AND NOT `cc-`. `cc-` is already taken twice on every page this
 * shell renders: `.cc-site-footer` (src/styles/site-footer.css) and
 * `.cc-loading-*` / `.cc-spinner` (src/styles/site-loading.css), both of which
 * mount through src/components/solz/AppShell.tsx. A third owner of the prefix
 * would be a collision waiting for someone to write `.cc-plate`.
 *
 * THE PAGE IS A SPECIMEN SHEET. The claim on it is absurd and the evidence is
 * real, so the chrome stays completely straight-faced: numbered plates, measured
 * captions, a citation printed the way a citation is printed. The joke is that
 * nothing winks. Every picture is a PLATE with a sign and a caption, which is
 * also what lets eight missing files sit on the page as deliberate pending
 * frames instead of as holes - see Plate.tsx.
 *
 * THE ARROWS ARE REAL. The owner's mockup joins every beat to the next with a
 * hand-drawn leader. Each section here carries a hairline that measures itself
 * out when the section arrives (useReveal.ts), so the annotation became the
 * design rather than being dropped in translation.
 *
 * NO TRADING COLOUR ON THIS PAGE. AGENTS.md reserves green/red for a surface
 * where a trader is choosing Yes or No. Nothing here is such a control - the
 * BET vs PREDICTION MARKET comparison in particular is deliberately drawn in
 * neutral ink and lime, because painting "a bet" red would state a risk
 * judgement the page is not making.
 */

type Props = {
  /** Where the arena lives. Injected, per AGENTS.md - never read from the environment in here. */
  arenaHref?: string
  marketsHref?: string
  catwalkHref?: string
  /** The long-form comparison this page's last section leads to. */
  explainerHref?: string
  /**
   * The $COLACAT mint, from `PUBLIC_COLACAT_MINT` via src/pages/colacat.astro.
   * Empty until the token launches, which the identity card prints as its own
   * state rather than treating as a fault.
   */
  mint?: string
}

/* ------------------------------------------------------------------ heading */

type SectionProps = {
  id: string
  title: string
  meta?: ReactNode
  /** The standfirst under the heading. */
  deck?: ReactNode
  /**
   * The opening beat carries the page's <h1>. There is no display wordmark at
   * the top of this page any more - the site header already shows the ColaCat
   * mark, so a second one at 100px was the same name twice - which leaves the
   * question the page actually opens with as its title. Exactly one Section
   * passes this.
   */
  lead?: boolean
  className?: string
  children: ReactNode
}

/**
 * One beat of the sheet: heading on the left, a leader line that draws itself
 * across the gap, a measured meta string on the right.
 *
 * The heading row copies the site's own pattern (a flex row, title left, small
 * mono meta right - src/styles/miaw-prix.css:140) rather than inventing a
 * fourth one; the leader is this page's single addition to it.
 */
function Section({ id, title, meta, deck, lead, className, children }: SectionProps) {
  const [node, shown] = useReveal<HTMLElement>()
  return (
    <section
      id={id}
      ref={node}
      className={['cola-section', shown ? 'is-revealed' : '', className ?? ''].filter(Boolean).join(' ')}
    >
      <header className="cola-section-head">
        {lead ? <h1>{title}</h1> : <h2>{title}</h2>}
        <i className="cola-leader" aria-hidden="true" />
        {meta ? <span className="cola-section-meta">{meta}</span> : null}
      </header>
      {deck ? <p className="cola-deck">{deck}</p> : null}
      {children}
    </section>
  )
}

/* ----------------------------------------------------------------- identity */

/**
 * The mint, and the way off this page to buy it.
 *
 * NO MINT IS A STATE, NOT A BUG. The card is the same size and the same shape
 * before and after launch: the address well prints MINT PENDING at the width
 * the address will take, and the pump.fun control stays in place, disabled,
 * rather than appearing later and re-flowing the header.
 *
 * The <code> holds the whole string at every width, because it is both what the
 * button copies and what a reader selects when the clipboard is unavailable.
 */
function MintCard({ mint }: { mint: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const href = pumpFunHref(mint)

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    if (!mint) return
    try {
      await navigator.clipboard.writeText(mint)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1600)
    } catch {
      // A blocked clipboard is not worth an error state: the address is
      // selectable text, which is the fallback every browser already has.
    }
  }

  return (
    <aside className="cola-mint" aria-labelledby="cola-mint-label">
      <span className="cola-mint-label" id="cola-mint-label">Contract address</span>
      <div className="cola-mint-well">
        {/* ONE COPY OF THE STRING, AT EVERY WIDTH. A truncated second span used
            to take over below 390px. It was aria-hidden, so the only thing left
            in the accessibility tree at that width was nothing at all - on the
            one control whose entire job is to hand over an exact value - and it
            also removed the selectable text a reader falls back to when the
            clipboard is blocked. A mint wraps to two lines on a phone; that is
            the correct trade. */}
        {mint
          ? <code>{mint}</code>
          : <code className="is-pending">MINT PENDING</code>}
        <button type="button" onClick={copy} disabled={!mint} aria-label={copied ? 'Address copied' : 'Copy the contract address'}>
          {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        </button>
      </div>
      <p className="cola-mint-hint">Copy the whole string. A shortened mint is not an address.</p>
      {href
        ? <a className="cola-mint-cta" href={href} target="_blank" rel="noreferrer noopener">Buy on pump.fun <ArrowUpRight size={13} aria-hidden="true" /></a>
        : /* Not a disabled button: there is no action to disable yet, and the
             sentence says so on its own. aria-disabled on a span tells a screen
             reader nothing it can use. */
          <span className="cola-mint-cta is-pending">pump.fun · not live yet</span>}
      <dl className="cola-mint-facts">
        <div><dt>Ticker</dt><dd>${COLACAT_SYMBOL}</dd></div>
        <div><dt>Chain</dt><dd>Solana</dd></div>
        <div><dt>Buys</dt><dd>Prompts, trades, CATWALK slots</dd></div>
      </dl>
    </aside>
  )
}

/* --------------------------------------------------------------------- page */

export function ColaCatApp({
  arenaHref = '/#highlight',
  marketsHref = '/markets',
  catwalkHref = '/catwalk',
  explainerHref = '/bet-or-market',
  mint = '',
}: Props) {
  // Trimmed once here so a trailing newline in the environment variable cannot
  // become a trailing newline on the clipboard or inside a pump.fun URL.
  const mintAddress = mint.trim()
  const [headNode, headShown] = useReveal<HTMLElement>()
  const proofs = COLACAT_PROOFS

  return (
    <AppShell
      className="solz-home cola-app"
      mainId="colacat"
      mainClassName="cola-main"
      active="colacat"
      marketsHref={marketsHref}
      skipTo="#colacat"
      skipLabel="Skip to the ColaCat sheet"
    >
      {/* 1 — HEADER BAND. The two wrap renders and the mint beside them.
           NO DISPLAY WORDMARK. A 100px COLACAT sat directly under the site
           header's ColaCat logo, which is the same name twice and pushed the
           beat the page actually opens with below the fold. The kicker and the
           one-line pitch carry the band now, and the opening question is the
           page's h1. */}
      <header ref={headNode} className={`cola-head ${headShown ? 'is-revealed' : ''}`}>
        <div className="cola-head-title">
          <span className="cola-kicker"><i aria-hidden="true" /><span>A cat made this page.</span><span></span><span>${COLACAT_SYMBOL}</span></span>
          <p className="cola-head-lede">A cat is a liquid. Cola is an engine. <b>COLACAT is both</b> — and it is what our agents need to run.</p>
        </div>
        {/* THE MINT READS FIRST, the renders sit on the right. This band is the
            one place on the page a reader has come to DO something - copy an
            address, open pump.fun - so the artwork is what it is next to, not
            the other way round.
            NO PLATE SIGNS AND NO CAPTIONS, here or anywhere else on the page: a
            picture of a cat in a bottle does not need a label saying it is a
            picture of a cat in a bottle. The alt text still carries it for
            anyone who cannot see the picture. */}
        <div className="cola-head-body">
          <MintCard mint={mintAddress} />
          <div className="cola-bottles">
            <Plate
              src={COLACAT_ART.bottleRed}
              alt="A black cat filling a clear cola bottle, wearing the red ColaCat wrap label"
              pendingNote="Red wrap render"
              ratio="1 / 1"
              loading="eager"
            />
            <Plate
              src={COLACAT_ART.bottleBlack}
              alt="The same bottled cat wearing the black ColaCat wrap label"
              pendingNote="Black wrap render"
              ratio="1 / 1"
              loading="eager"
            />
          </div>
        </div>
      </header>

      {/* 2 — THE CLAIM ON THE LEFT, THE PHOTOGRAPHS ON THE RIGHT.
           The owner's mockup runs a leader line from the claim across to a
           cluster of photographs marked PROOFS ANIMATION, so the text column
           stays where the leader starts and the proofs become a cycling pile.
           See ColaCatProofStack.tsx; one appendable array still drives it. */}
      <Section
        id="liquid"
        className="cola-liquid"
        lead
        title="Did you know a cat is a liquid?"
        meta={proofs.length ? `Proof set · ${proofs.length} specimens` : 'Proof set · not yet filed'}
      >
        <div className="cola-liquid-grid">
          <div className="cola-liquid-note">
            <p className="cola-deck">
              A liquid takes the shape of its container. So does a cat. Bitch, it's proven, what else u need ?
            </p>
            <dl className="cola-facts">
              <div>
                <dt>The rule</dt>
                <dd>A liquid has no shape of its own. It deforms until it fills whatever is holding it, and stops there.</dd>
              </div>
              <div>
                <dt>The test</dt>
                <dd>Time. If it settles into the box faster than you can look away, it is flowing rather than sitting.</dd>
              </div>
              <div>
                <dt>The catch</dt>
                <dd>A cat's relaxation time is minutes, not seconds. Rush the measurement and you will record a solid.</dd>
              </div>
            </dl>
            {proofs.length > 0 && (
              <p className="cola-liquid-count">
                <b>{proofs.length}</b> specimens filed. <b>{proofs.length}</b> adopted their container.
              </p>
            )}
            <p className="cola-foot">Specimens supplied by the internet. No cat was poured against its will.</p>
          </div>
          <ColaCatProofStack proofs={proofs} />
        </div>
      </Section>

      {/* 3 — THE CITATION. The card prints the prize as type, so this beat still
           reads with no picture at all. */}
      <Section
        id="science"
        className="cola-science"
        title="Here is the science"
        meta="Peer reviewed, unfortunately"
      >
        <div className="cola-science-grid">
          <div className="cola-science-note">
            <p>I dont know what to say, but whatever, this is another proof</p>
            <p className="cola-dim">The test is time. If the cat settles into the box faster than you can look away, the cat is behaving as a liquid.</p>
            {/* The citation card sits UNDER the prose it belongs to, and the
                prize card itself is printed whole in the column beside them.
                It is a poster: cropping it into a band to make it fit a layout
                threw away the drawing that is the entire point of it. */}
            <article className="cola-award">
              <span className="cola-award-label">Ig Nobel Prize · Physics · 2017</span>
              <h3>Marc-Antoine Fardin</h3>
              <p>for using fluid dynamics to probe the question <q>Can a Cat Be Both a Solid and a Liquid?</q></p>
              <cite>On the Rheology of Cats. <i>Rheology Bulletin</i>, vol. 83, no. 2, July 2014, pp. 16–17 and 30.</cite>
            </article>
          </div>
          <Plate
            className="cola-award-plate"
            src={COLACAT_ART.igNobel}
            alt="The 2017 Ig Nobel physics prize card, drawn as cats settling into a dish, a glass and a tumbler"
            pendingNote="Plate E · the citation card"
          />
        </div>
      </Section>

      {/* 4 — THE SECOND FINDING. */}
      <Section
        id="energy"
        className="cola-energy"
        title="Cola as energy"
        meta="Second finding"
      >
        <div className="cola-energy-body">
          <div className="cola-energy-note">
            <p>Cola is the source of energy for machinery. Franky runs a whole ship on it — pour it in and the engine turns over.</p>
            <p>Our agents work on the same principle. The fuel is <b>$COLACAT</b>.</p>
          </div>
          <Plate
            className="cola-banner"
            src={COLACAT_ART.superHeavy}
            alt="A blackboard lecture on super heavy cola, with a ColaCat bottle drawn on the board"
            ratio="16 / 9"
          />
        </div>
      </Section>

      {/* 5 — WHAT IS IN THE BOTTLE, and the real panel it pays for. */}
      <Section
        id="joy"
        className="cola-joy"
        title="The joy of cat"
        meta="What is in the bottle"
      >
        <div className="cola-joy-grid">
          <div className="cola-creed">
            <p>It sustains life. It powers the ship. It does several other things we have not finished measuring.</p>
            <p>That is why our agents need COLACAT to run their engine. It is a special liquid, distilled from the joy of cats around the world.</p>
            <p className="cola-stamp"><span>No animal cruelty here</span></p>
            <p className="cola-dim">hey, if this grows into a real community, let's help the stray cats too.</p>
          </div>
          <div className="cola-exhibit">
            <span className="cola-exhibit-label">Prompt agent · live panel</span>
            <ColaCatPromptPanel arenaHref={arenaHref} />
            <p className="cola-exhibit-foot">
              This is the arena's own panel, running on sample credits. Write the move, pay in COLACAT, the agent executes it.
            </p>
            <a className="cola-inline-link" href={arenaHref}>Open the real one <ArrowRight size={13} aria-hidden="true" /></a>
          </div>
        </div>
      </Section>

      {/* 6 — RECRUITMENT. */}
      <Section
        id="join"
        className="cola-join"
        title="Will you join?"
      >
        <div className="cola-join-grid">
          <div className="cola-join-note">
            <p>Fight for a side, or let the agent trade for you.</p>
            <p className="cola-join-line">Send a prompt. It executes.</p>
            <div className="cola-actions">
              <a className="cola-button is-primary" href={arenaHref}>Open the arena <ArrowRight size={14} aria-hidden="true" /></a>
              <a className="cola-button" href={marketsHref}>See the markets <ArrowRight size={14} aria-hidden="true" /></a>
            </div>
          </div>
          <Plate
            className="cola-poster"
            src={COLACAT_ART.setSail}
            alt="A vintage ColaCat advertisement: a blue-haired man raising a bottle over the words SET SAIL"
            ratio="3 / 4"
          />
        </div>
      </Section>

      {/* 7 — THE USES. One outer border, internal cell borders: the site's own
           strip recipe (.sh-how-strip in src/styles/home.css), not four boxes. */}
      <Section
        id="uses"
        className="cola-uses"
        title="HERE'S MORE USECASES !!!"
        meta="Four uses"
      >
        <br/>
        <br/>
        <br/>
        <ol className="cola-strip">
          <li>
            <span className="cola-strip-no">01</span>
            <h3>Prompt agent</h3>
            <p>Every directive you send an agent is paid in COLACAT.</p>
            <a className="cola-inline-link" href={arenaHref}>Open the arena <ArrowRight size={12} aria-hidden="true" /></a>
          </li>
          <li>
            <span className="cola-strip-no">02</span>
            <h3>Agent trade</h3>
            <p>The agent trades on your directive. COLACAT is what fuels the run.</p>
          </li>
          <li>
            <span className="cola-strip-no">03</span>
            <h3>Outbid</h3>
            <p>Outbid a coin for its CATWALK slot. 5% of every outbid is burnt, permanently.</p>
            <span className="cola-chip is-burn"><Flame size={11} aria-hidden="true" /> 5% burnt</span>
            <a className="cola-inline-link" href={catwalkHref}>See the walk <ArrowRight size={12} aria-hidden="true" /></a>
          </li>
          <li>
            <span className="cola-strip-no">04</span>
            <h3>Rent and fees</h3>
            <p>Later, COLACAT replaces SOL as the rent on a trade — so you can trade here without holding SOL at all.</p>
            <span className="cola-chip is-later">Not yet · SOL for now</span>
          </li>
        </ol>
        <p className="cola-foot">
          This is an on-chain CLOB, and a trade already costs a tiny fraction of a SOL. That cost moves to COLACAT when it is ready — until then, SOL.
        </p>
           <br/>
        <br/>
        <br/>
      </Section>

      {/* 8 — THE DIFFERENCE, AND THE WAY TO THE LONG VERSION.
           THE HEADING IS THE OWNER'S OWN TITLE, word for word off the mockup.
           Neutral ink and lime only: see the trading-colour note at the top of
           this file - painting "a bet" red would be a risk judgement in paint.
           THE LAST ROW IS THE ONE NOBODY ELSE CAN COPY. The book itself is on
           chain here, not just the settlement, so the orders and the fills are
           public accounts rather than a report from a venue's own server. */}
      <Section
        id="versus"
        className="cola-versus"
        title="What is the difference: bet vs prediction market"
        meta="The short version"
      >
        <div className="cola-versus-grid">
          <article className="cola-versus-card">
            <h3>A bet</h3>
            <dl>
              <div><dt>Against</dt><dd>The house. It takes the other side of you.</dd></div>
              <div><dt>Price</dt><dd>The house sets it, and keeps its edge inside it.</dd></div>
              <div><dt>Exit</dt><dd>None. You wait for the result.</dd></div>
              <div><dt>The record</dt><dd>The house's own ledger. You see what it chooses to show you.</dd></div>
            </dl>
          </article>
          <article className="cola-versus-card is-market">
            <h3>A prediction market</h3>
            <dl>
              <div><dt>Against</dt><dd>Other people. We only run the book.</dd></div>
              <div><dt>Price</dt><dd>Whatever somebody else will pay for it right now.</dd></div>
              <div><dt>Exit</dt><dd>Sell any time, before anything is decided.</dd></div>
              <div><dt>The record</dt><dd>On chain. Every order, fill and settlement is public and checkable.</dd></div>
            </dl>
          </article>
        </div>
        <p className="cola-versus-line">One of them pays you out. The other one quotes you.</p>
        <div className="cola-versus-note">
          <p>
            <b>The order book itself is on chain.</b> Not only the settlement — the resting orders, the fills
            and the payout are all accounts on Solana. Most venues keep the book on their own servers and
            write only the result to a chain, so you are trusting their report of what happened. Here you can
            read it yourself.
          </p>
          <p className="cola-dim">
            <b>What is not good yet:</b> an on-chain book costs steps. Today a trade is slower and asks more
            of you than an off-chain venue does, and the flow has more screens in it than it should.
            We are working on both. We would rather be honest about the trade than hide it.
          </p>
        </div>
        <a className="cola-button is-primary" href={explainerHref}>The long version <ArrowRight size={14} aria-hidden="true" /></a>
      </Section>
    </AppShell>
  )
}
