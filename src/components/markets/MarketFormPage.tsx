import '../../styles/home.css'
import '../../styles/home-markets.css'
import '../../styles/markets-directory.css'
import '../../styles/general-questions.css'
import { ArrowLeft } from 'lucide-react'
import { AppShell } from '../solz/AppShell'
import { MarketProposalForm } from './MarketProposalForm'
import { PantaCreateForm } from '../panta/PantaCreateForm'

/** Proposing and creating a market are tasks, not catalogue filters, so each
 *  gets its own page instead of unfolding above the market grid. */
export function MarketFormPage({ form, apiUrl = '', backHref = '/markets' }: { form: 'propose' | 'create'; apiUrl?: string; backHref?: string }) {
  return <AppShell className="solz-home mk-app" mainId="market-form" mainClassName="mk-main" marketsHref="/markets" active="markets" skipTo="#market-form" skipLabel="Skip to form" backToTopHref="#market-form">
    <div className="mk-form-page">
      <a className="mk-back-link" href={backHref}><ArrowLeft size={16}/>All markets</a>
      {form === 'propose' ? <MarketProposalForm apiUrl={apiUrl} standalone/> : <PantaCreateForm apiUrl={apiUrl} standalone/>}
    </div>
  </AppShell>
}
