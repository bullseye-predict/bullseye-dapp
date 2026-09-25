import { useState, type ReactNode } from 'react'
import { AgentThinkingFeed } from '../events/AgentThinkingFeed'
import { OutcomeRow } from '../markets/OutcomeRow'
import { BrandLogo } from '../solz/BrandLogo'
import { brands } from '../solz/brand'
import { accuracyBands, contact, convictionSteps, demoNow, demoScore, demoThoughts, ladder, openAi, preStocks, source, stocks, type Company } from './pitchDeck'

// The deck is Bullseye's whatever brand the site runs, so it names the brand
// directly instead of reading the active one.
function Logo({ large = false }: { large?: boolean }) {
  return <p className={`pd-logo ${large ? 'is-large' : ''}`}><BrandLogo of={brands.bullseye} /></p>
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="pd-eyebrow">{children}</p>
}

function CompanyLogo({ company }: { company: Company }) {
  return <img className="pd-company-logo" src={company.logo} alt="" width={40} height={40} />
}

function Companies({ list }: { list: Company[] }) {
  return <p className="pd-chips">{list.map((company) => <span key={company.name}><CompanyLogo company={company} />{company.name}</span>)}</p>
}

/** Yes / No picks for one answer row, with one pressed pick across the list. */
function yesNo(id: string, chance: number, picked: string, pick: (key: string) => void) {
  return (['yes', 'no'] as const).map((tone) => {
    const key = `${id}:${tone}`
    return {
      key,
      label: tone === 'yes' ? 'Yes' : 'No',
      price: `${tone === 'yes' ? chance : 100 - chance}¢`,
      tone,
      pressed: picked === key,
      onClick: () => pick(key),
    }
  })
}

/** A desktop browser frame around real app components. */
function Desktop({ url, label, children }: { url: string, label: string, children: ReactNode }) {
  return <figure className="pd-desktop" aria-label={label}>
    <div className="pd-desktop-bar" aria-hidden="true"><i /><i /><i /><span>{url}</span></div>
    <div className="pd-desktop-body">{children}</div>
  </figure>
}

/** A phone frame around a real app component, so the slide shows the product. */
function Phone({ label, children }: { label: string, children: ReactNode }) {
  return <figure className="pd-phone" aria-label={label}>
    <div className="pd-phone-screen">
      <div className="pd-phone-status" aria-hidden="true"><span>9:41</span><i /><span>5G</span></div>
      <div className="pd-phone-bar"><Logo /></div>
      <div className="pd-phone-body">{children}</div>
    </div>
  </figure>
}

export function CoverSlide() {
  return <div className="pd-layout pd-center">
    <Logo large />
    <h1>A transparent AI agent for pre-stock and stock prediction and trading.</h1>
  </div>
}

export function ProblemSlide() {
  return <div className="pd-layout">
    <Eyebrow>The problem</Eyebrow>
    <h2>People ask AI about investing.<br /><em>Few let it trade their money.</em></h2>
    <ul className="pd-missing">
      <li>No transparency</li>
      <li>No history</li>
      <li>No view of what it thinks</li>
    </ul>
    <p className="pd-foot">30% of U.S. retail investors already use AI to pick investments. <a href={source.url} target="_blank" rel="noreferrer">{source.label}</a></p>
  </div>
}

export function ConvictionSlide() {
  const [picked, setPicked] = useState('1275:yes')
  return <div className="pd-layout">
    <Eyebrow>What I want to see</Eyebrow>
    <h2>How its conviction changes.</h2>
    <Desktop url="bullseye / events / openai-prestock" label="An OpenAI pre-stock question and its agent sub-question on a desktop screen">
      <div className="pd-event">
        <section className="pd-pane">
          <span className="pd-pane-tag">1 · Pre-stock question</span>
          <header className="pd-event-head">
            <CompanyLogo company={openAi} />
            <strong>OpenAI PreStock above ___ on October 31?</strong>
          </header>
          <div className="pd-rows">
            {ladder.map((rung) => <OutcomeRow
              key={rung.id}
              id={`pd-rung-${rung.id}`}
              title={rung.label}
              chance={`${rung.chance}%`}
              picks={yesNo(rung.id, rung.chance, picked, setPicked)}
            />)}
          </div>
        </section>
        <span className="pd-link" aria-hidden="true">→</span>
        <section className="pd-pane pd-pane-agent">
          <span className="pd-pane-tag">2 · Agent sub-question</span>
          <header className="pd-event-head">
            <img className="pd-company-logo" src={brands.bullseye.badge} alt="" width={40} height={40} />
            <strong>Agent: OpenAI PreStock above ___ on October 31?</strong>
          </header>
          <ol className="pd-conviction">
            {convictionSteps.map((step) => <li key={step.time} className={step.action === 'BUY' ? 'is-up' : ''}>
              <span>{step.time}</span>
              <strong>{step.value}%</strong>
              <small>bullish</small>
              <em>{step.why}</em>
              <b>{step.action}</b>
            </li>)}
          </ol>
        </section>
      </div>
    </Desktop>
  </div>
}

export function ProductSlide() {
  return <div className="pd-layout pd-with-phone">
    <div className="pd-copy">
      <Eyebrow>Bullseye</Eyebrow>
      <h2>A public AI trader. Starting with pre-stocks.</h2>
      <dl className="pd-pairs">
        <div><dt>Pre-stocks</dt><dd><Companies list={preStocks} /></dd></div>
        <div><dt>Stocks</dt><dd><Companies list={stocks} /></dd></div>
        <div><dt>Follows</dt><dd>News · price · volume · momentum</dd></div>
        <div><dt>Publishes</dt><dd>What it knew. What changed.</dd></div>
      </dl>
    </div>
    <Phone label="The Bullseye agent thinking feed on a phone">
      <AgentThinkingFeed thoughts={demoThoughts} loaded score={demoScore} now={demoNow} />
    </Phone>
  </div>
}

export function TrustSlide() {
  return <div className="pd-layout pd-center pd-statement">
    <h2>Trust is earned,<br /><em>not given.</em></h2>
    <p className="pd-sub">Watch first.</p>
  </div>
}

export function PredictSlide() {
  const [picked, setPicked] = useState('80-99:yes')
  return <div className="pd-layout pd-with-phone">
    <div className="pd-copy">
      <Eyebrow>Predict the agent</Eyebrow>
      <h2>How many times will Bullseye hit the bullseye?</h2>
      <ol className="pd-loop">
        <li>Bullseye makes its calls</li>
        <li>Doubters want to prove it wrong</li>
        <li>They trade the pre-stock</li>
        <li><strong>Pre-stock volume grows</strong></li>
      </ol>
    </div>
    <Phone label="The agent accuracy question on a phone">
      <div className="pd-question">
        <span>Agent: OpenAI PreStock above ___ on October 31?</span>
        <strong>How many of 14 calls will Bullseye get right?</strong>
      </div>
      {accuracyBands.map((band) => <OutcomeRow
        key={band.id}
        id={`pd-band-${band.id}`}
        title={band.label}
        chance={`${band.chance}%`}
        picks={yesNo(band.id, band.chance, picked, setPicked)}
      />)}
    </Phone>
  </div>
}

export function CloseSlide() {
  return <div className="pd-layout">
    <ol className="pd-horizons">
      <li><span>Today</span><strong>Watch its conviction.</strong></li>
      <li><span>Tomorrow</span><strong>Follow the agents you trust.</strong></li>
    </ol>
    <p className="pd-tagline">Watch how it thinks.<br />Watch how it trades.<br /><em>Then decide if it's worth following.</em></p>
    <div className="pd-sign">
      <Logo />
      <a className="pd-contact" href={contact.url} target="_blank" rel="noreferrer"><span>Contact</span>{contact.label}</a>
    </div>
  </div>
}

export const slides = [
  { title: 'Bullseye', Component: CoverSlide },
  { title: 'The problem', Component: ProblemSlide },
  { title: 'How its conviction changes', Component: ConvictionSlide },
  { title: 'A public AI trader', Component: ProductSlide },
  { title: 'Trust is earned, not given', Component: TrustSlide },
  { title: 'Predict the agent', Component: PredictSlide },
  { title: "That's Bullseye", Component: CloseSlide },
] as const
