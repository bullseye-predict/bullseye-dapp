import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SolanaProfile } from '../src/components/portfolio/SolanaProfile'
import { SolanaPnlChart } from '../src/components/portfolio/SolanaPnlChart'
import { bootstrap, owner, questions, sol, venue } from './fixtures/profile'
const render=(isSelf:boolean,section:'positions'|'orders'|'activity'='positions')=>renderToStaticMarkup(<SolanaProfile apiUrl="" bootstrap={bootstrap} initialSection={section} owner={owner} venue={venue} isSelf={isSelf} questions={questions} sol={sol} retry={0} onRefresh={()=>{}} />)
describe('Solana profile surfaces',()=>{
 test('owner has management tabs and cost/payout metrics',()=>{const html=render(true);expect(html).toContain('Open orders');expect(html).toContain('History');expect(html).toContain('Avg → Now');expect(html).toContain('To win');expect(html).not.toContain('Sign &')})
 test('public positions have prices and P/L without trading controls',()=>{const html=render(false);expect(html).toContain('Activity');expect(html).toContain('Current');expect(html).not.toContain('Open orders');expect(html).not.toContain('>Sell<');expect(html).not.toContain('<th title="Gross payout if this outcome wins">To win');expect(html).toContain('50¢');expect(html).toContain('+2.5');expect(html).toContain('10 shares')})
 test('separates pending buys from holdings and shows semantic badges',()=>{const positions=render(true);expect(positions).not.toContain('3 shares');expect(positions).toContain('Yes 50¢');expect(positions).toContain('Los Angeles Dodgers 50¢');expect(positions).toContain('Over 50¢');const orders=render(true,'orders');expect(orders).toContain('3 shares');expect(orders).toContain('1.5 fUSDC');expect(orders).toContain('>Cancel<')})
 test('activity reports execution amount and shares',()=>{const html=render(false,'activity');expect(html).toContain('buy');expect(html).toContain('50¢');expect(html).toContain('View transaction');expect(html).not.toContain('>Sell<')})
 test('does not draw through missing historical points',()=>{const html=renderToStaticMarkup(<SolanaPnlChart points={[{at:1,value:'0'},{at:2,value:null},{at:3,value:'1000000'}]} symbol="fUSDC" decimals={6} range="ALL" onRange={()=>{}}/>);expect(html).toMatch(/d="M[^\"]* M/);expect(html).not.toContain('NaN')})
})
