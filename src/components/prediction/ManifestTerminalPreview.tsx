const asks = [
  ['Ask', '52¢', '18.0'],
  ['Ask', '51¢', '12.0'],
]
const bids = [
  ['Bid', '49¢', '10.0'],
  ['Bid', '48¢', '24.0'],
]

export function ManifestTerminalPreview() {
  return <section className="pt-preview" aria-label="Solana Manifest terminal preview">
    <div className="pt-preview-bar"><span className="pt-preview-badge">Preview · backend offline</span><span>Solana Devnet · Manifest order book</span></div>
    <div className="pt-preview-question"><div><span className="pt-preview-kicker">Manifest question</span><h2>Will the highlighted team win?</h2><p>YES / NO market · indicative pricing before activation</p></div><span className="pt-preview-price">50¢<small>50:50</small></span></div>
    <div className="pt-preview-outcomes"><button className="pt-yes" disabled>YES <strong>50¢</strong></button><button className="pt-no" disabled>NO <strong>50¢</strong></button></div>
    <div className="pt-preview-grid"><div><div className="pt-preview-section-title"><h3>Order book</h3><span>Read-only preview</span></div><table className="pt-book"><thead><tr><th>Side</th><th>Price</th><th>Shares</th></tr></thead><tbody>{[...asks, ...bids].map(([side, price, shares]) => <tr className={side === 'Bid' ? 'pt-bid' : 'pt-ask'} key={`${side}-${price}`}><td>{side}</td><td>{price}</td><td>{shares}</td></tr>)}</tbody></table></div><aside className="pt-preview-ticket"><h3>Trade YES</h3><div className="pt-side"><button className="pt-buy" aria-pressed="true" disabled>Buy</button><button className="pt-sell" disabled>Sell</button></div><label>Order type<select disabled defaultValue="IOC"><option>Immediate · cancel unfilled</option></select></label><label>Shares<input disabled value="10" readOnly /></label><label>Maximum price · cents<input disabled value="50" readOnly /></label><button className="pt-primary" disabled>Connect wallet to review</button><p className="pt-muted">Trading unlocks after the verified question is activated and the guarded books exist.</p></aside></div>
  </section>
}
