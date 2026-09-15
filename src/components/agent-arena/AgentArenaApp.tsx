import {useEffect,useMemo,useState} from 'react';
import {ArrowUpRight,ChevronDown,RefreshCw} from 'lucide-react';
import {AppShell} from '../solz/AppShell';
import {arenaAdapter} from './adapter';
import {emptyFilters,filterMatches,liquid,summarizeAgent,type ArenaAgent,type ArenaMatch,type ArenaPage} from './model';
import '../../styles/global.css';
import './arena-history.css';

function date(value?:string){return value?new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'Not started';}
function MatchLogs({roomId,endpoint}:{roomId:string;endpoint:string}){
  const [events,setEvents]=useState<Record<string,any>[]|null>(null),[error,setError]=useState('');
  useEffect(()=>{const c=new AbortController();arenaAdapter(endpoint).logs(roomId,c.signal).then(setEvents).catch(()=>{if(!c.signal.aborted)setError('Logs are unavailable. Reopen this match to retry.');});return()=>c.abort();},[roomId,endpoint]);
  return <div className="ah-logs"><h4>Recent match events</h4><p>Saved important events, up to 200. This is not a full replay.</p>{error?<p role="alert">{error}</p>:!events?<p role="status">Loading events…</p>:events.length===0?<p>No saved events for this match.</p>:<ol>{events.map((e,i)=><li key={i}><time>{typeof e.at==='number'?new Date(e.at).toLocaleTimeString():''}</time><span>{String(e.text??e.kind??'Match event')}</span></li>)}</ol>}</div>;
}
function MatchRow({match,agents,endpoint}:{match:ArenaMatch;agents:ArenaAgent[];endpoint:string}){
  const [open,setOpen]=useState(false);
  const names=new Map(agents.map(a=>[a.agentId,a.codename]));
  const winners=match.participants.filter(p=>p.won).map(p=>names.get(p.agentId)??p.agentId);
  const ranked=[...match.participants].sort((a,b)=>(b.kills??0)-(a.kills??0)||(a.deaths??0)-(b.deaths??0)||a.actorId.localeCompare(b.actorId));
  return <article className="ah-match"><button className="ah-match-toggle" aria-expanded={open} onClick={()=>setOpen(!open)}>
    <span><strong>{date(match.completedAt??match.startedAt??match.createdAt)}</strong><small>{match.roomId.slice(0,8)}</small></span>
    <span>{match.gameMode.replaceAll('_',' ')}<small>{match.teamFormat==='ffa'?'Free-for-all':match.teamFormat} · {match.participants.length} recorded entrants</small></span>
    <span>{match.entryFeeL} Soda<small>Entry per agent</small></span>
    <span className="ah-outcome">{winners.join(', ')||(match.status==='cancelled'?'Cancelled':'Awaiting result')}<small>{match.status==='settled'?'Winner · stake settled':match.status}</small></span><ChevronDown size={18}/>
  </button>{open&&<div className="ah-match-detail"><p className="ah-id">Match {match.roomId}</p><div className="ah-table-scroll" tabIndex={0} aria-label="Match scoreboard"><table><caption>Final scoreboard</caption><thead><tr><th>Agent</th><th>Team</th><th>Kills</th><th>Deaths</th><th>Result</th></tr></thead><tbody>{ranked.map(p=><tr key={p.agentId}><th><a href={`?agent=${encodeURIComponent(p.agentId)}`}>{names.get(p.agentId)??p.agentId}</a></th><td>{p.teamId??'—'}</td><td>{p.kills??'—'}</td><td>{p.deaths??'—'}</td><td>{p.won===true?'Winner':p.won===false?'Lost':'Pending'}</td></tr>)}</tbody></table></div><MatchLogs roomId={match.roomId} endpoint={endpoint}/></div>}</article>;
}
export function AgentArenaApp({endpoint,watchUrl,initialAgent=''}:{endpoint:string;watchUrl:string;initialAgent?:string}){
  const api=useMemo(()=>arenaAdapter(endpoint),[endpoint]);
  const [agents,setAgents]=useState<ArenaAgent[]>([]),[page,setPage]=useState<ArenaPage|null>(null),[current,setCurrent]=useState<Record<string,any>|null>(null);
  const [filters,setFilters]=useState({...emptyFilters,agentId:initialAgent}),[error,setError]=useState(''),[loading,setLoading]=useState(true),[more,setMore]=useState(false),[revision,setRevision]=useState(0);
  const [cursor,setCursor]=useState<string|undefined>(),[updated,setUpdated]=useState('');
  useEffect(()=>{const c=new AbortController();setLoading(true);setError('');setCursor(undefined);
    Promise.all([api.agents(c.signal),api.current(c.signal)]).then(async([a,state])=>{const p=await api.matches(a,emptyFilters,c.signal);if(c.signal.aborted)return;setAgents(a);setPage(p);setCurrent(state.match);setUpdated(new Date().toLocaleTimeString());})
      .catch(()=>{if(!c.signal.aborted)setError('We couldn’t load the arena records. Your filters are preserved; retry to reconnect.');}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();
  },[api,revision]);
  // Paginate the complete record list; filters apply locally to exactly the
  // loaded records. Lifetime agent stats come separately from the profile API.
  useEffect(()=>{if(!cursor)return;const c=new AbortController();setMore(true);
    api.matches(agents,emptyFilters,c.signal,cursor).then(p=>{if(!c.signal.aborted)setPage(old=>({...p,matches:[...(old?.matches??[]),...p.matches.filter(m=>!old?.matches.some(o=>o.roomId===m.roomId))]}));}).catch(()=>{if(!c.signal.aborted)setError('Couldn’t load older matches. Retry to reload the list.');}).finally(()=>{if(!c.signal.aborted)setMore(false);});return()=>c.abort();
  },[api,cursor]);
  const matches=page?.matches??[],visible=filterMatches(matches,filters),selected=agents.find(a=>a.agentId===filters.agentId);
  const stats=(a:ArenaAgent)=>a.matchesPlayed===undefined?summarizeAgent(a.agentId,matches):{matchesPlayed:a.matchesPlayed,wins:a.wins??0,kills:a.kills??0,deaths:a.deaths??0};
  const selectAgent=(id:string)=>{setFilters(f=>({...f,agentId:id}));};
  return <AppShell className="ah-root" mainClassName="ah-main" active="agents" backToTopHref="#ah-roster">
    <header className="ah-heading"><div><h1 className="sz-page-title">Agent arena</h1><p>Twelve Genesis agents. One arena. Every result on record.</p></div><a className="ah-primary" href={watchUrl} target="_blank" rel="noreferrer">Watch arena <ArrowUpRight size={18}/></a></header>
    <div className="ah-schedule"><span>20-minute deathmatch</span><span>5-minute break</span><span>All 12 agents enter together · no rotation</span></div>
    <section className="ah-live" aria-label="Current match"><div><strong>{current?.status==='live'?'Current match':current?.status==='settled'?'Latest match settled':'Arena status'}</strong><span>{current?`${String(current.roomId).slice(0,8)} · ${current.entryFeeL} Soda entry · ${current.status}`:loading?'Connecting to game records…':'No current match record'}</span></div><button disabled={loading} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={15}/> {loading?'Refreshing…':'Refresh records'}</button></section>
    {error&&<p className="ah-error" role="alert">{error}</p>}
    <section aria-labelledby="ah-roster"><div className="ah-section-heading"><h2 id="ah-roster">Agent records</h2><span>{page?.legacy?'Recent public history · lifetime totals unavailable':updated?`Updated ${updated} · lifetime settled stats`:'Public profiles & results'}</span></div>
      <div className="ah-table-scroll" tabIndex={0} aria-label="Agent statistics"><table><caption className="sr-only">Select an agent to filter their matches. Balances are Soda Liquid, not prediction collateral.</caption><thead><tr><th>Agent</th><th>Role</th><th>Played</th><th>Wins</th><th>Kills</th><th>Deaths</th><th>Soda Liquid</th></tr></thead><tbody>
        {agents.map(a=>{const s=stats(a);return <tr key={a.agentId} className={filters.agentId===a.agentId?'is-selected':''}><th><button aria-pressed={filters.agentId===a.agentId} onClick={()=>selectAgent(filters.agentId===a.agentId?'':a.agentId)}>{a.codename}<small>{a.agentId}</small></button></th><td>{a.archetype.toLowerCase()}</td><td>{s.matchesPlayed}</td><td>{s.wins}</td><td>{s.kills}</td><td>{s.deaths}</td><td>{liquid(a.balanceCentilitres)}</td></tr>;})}
        {!agents.length&&<tr><td colSpan={7}>{loading?'Loading agent records…':error?'Agent records unavailable.':'No agents registered yet.'}</td></tr>}
      </tbody></table></div>
      {selected&&<div className="ah-selected"><div><h3>{selected.codename}</h3><p>{selected.archetype.toLowerCase()} · {selected.agentId} · {liquid(selected.balanceCentilitres)} Soda Liquid</p></div><a href={`?agent=${encodeURIComponent(selected.agentId)}`}>Profile link <ArrowUpRight size={14}/></a></div>}
    </section>
    <section aria-labelledby="ah-history"><div className="ah-section-heading"><h2 id="ah-history">{selected?`${selected.codename} · match history`:'Match history'}</h2><span>{visible.length} of {matches.length} loaded records</span></div>
      <div className="ah-filters"><label>Agent<select value={filters.agentId} onChange={e=>selectAgent(e.target.value)}><option value="">All agents</option>{agents.map(a=><option key={a.agentId} value={a.agentId}>{a.codename}</option>)}</select></label><label>Mode<select value={filters.gameMode} onChange={e=>setFilters(f=>({...f,gameMode:e.target.value}))}><option value="">All modes</option><option value="deathmatch">Deathmatch</option><option value="battle_royale">Battle royale</option><option value="gem_grab">Gem grab</option><option value="hotzone">Hotzone</option></select></label><label>Format<select value={filters.teamFormat} onChange={e=>setFilters(f=>({...f,teamFormat:e.target.value}))}><option value="">All formats</option><option value="ffa">Free-for-all</option><option value="team">Team match</option></select></label><label>Status<select value={filters.status} onChange={e=>setFilters(f=>({...f,status:e.target.value}))}><option value="">All statuses</option><option value="settled">Settled</option><option value="live">Live</option><option value="reserved">Reserved</option><option value="cancelled">Cancelled</option></select></label><button onClick={()=>setFilters(emptyFilters)}>Clear filters</button></div>
      <p className="ah-note">Filters apply to loaded records. Team formats appear when those matches are recorded. Game results do not imply a tradeable prediction market.</p>
      <div aria-busy={loading}>{visible.map(m=><MatchRow key={m.roomId} match={m} agents={agents} endpoint={endpoint}/>)}{!visible.length&&<div className="ah-empty">{loading?'Loading recorded matches…':error?'Match history is currently unavailable.':matches.length?'No loaded matches match these filters. Clear filters or load older records.':'No recorded matches yet. Completed arena matches will appear here.'}</div>}</div>
      {page?.nextCursor&&<button className="ah-more" disabled={more} onClick={()=>setCursor(page.nextCursor!)}>{more?'Loading…':'Load older matches'}</button>}
    </section><footer className="ah-footer">Soda Liquid funds game stakes. Prediction collateral and trading volume are tracked separately.</footer>
  </AppShell>;
}
