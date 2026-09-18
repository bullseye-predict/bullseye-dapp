import {expect,test} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {arenaAdapter,parseAgents,parseMatch} from '../src/components/agent-arena/adapter';
import {emptyFilters,filterMatches,liquid,summarizeAgent} from '../src/components/agent-arena/model';
import {AgentArenaApp} from '../src/components/agent-arena/AgentArenaApp';
import {proxyArena} from '../src/server/arena-proxy';
const agents=parseAgents({ok:true,agents:[{agentId:'genesis-01',slot:0,codename:'COKE',archetype:'BREACHER',balanceCentilitres:'94000'},{agentId:'genesis-02',slot:1,codename:'PEPSI',archetype:'RECON',balanceCentilitres:'100000'}]});
const raw={roomId:'match1',status:'settled',entryFeeL:20,completedAt:'2026-09-10T10:00:00Z',result:JSON.stringify({participants:[{actorId:'server-bot-0-0',kills:8,deaths:2,won:true}]})};
test('legacy JSON results retain actual membership, filters and statistics',()=>{
 const match=parseMatch(raw,agents);
 expect(match.participants[0]!.agentId).toBe('genesis-01');
 expect(filterMatches([match],{...emptyFilters,agentId:'genesis-02'})).toEqual([]);
 expect(filterMatches([match],{...emptyFilters,teamFormat:'team'})).toEqual([]);
 expect(filterMatches([{...match,teamFormat:'3v3'}],{...emptyFilters,teamFormat:'team'})).toHaveLength(1);
 expect(summarizeAgent('genesis-01',[match])).toEqual({matchesPlayed:1,wins:1,kills:8,deaths:2});
 expect(liquid('123456789012345678900')).toContain('1,234,567,890,123,456,789');
});
test('adapter uses new pagination and abort signal',async()=>{
 const signal=new AbortController().signal;
 const api=arenaAdapter('/api/agent-arena',async(input,init)=>{expect(String(input)).toContain('cursor=older');expect(init?.signal).toBe(signal);return Response.json({ok:true,matches:[raw],nextCursor:'next'});});
 expect((await api.matches(agents.map(a=>({...a,matchesPlayed:0})),emptyFilters,signal,'older')).nextCursor).toBe('next');
});
test('legacy fallback deduplicates histories and fails closed for unavailable sources',async()=>{
 const api=arenaAdapter('/api/agent-arena',async(input)=>String(input).includes('kind=matches')?new Response('',{status:404}):Response.json({ok:true,matches:[raw]}));
 const page=await api.matches(agents,emptyFilters,new AbortController().signal);
 expect(page.legacy).toBe(true);expect(page.matches).toHaveLength(1);
 const unavailable=arenaAdapter('/api',async()=>new Response('',{status:503}));
 await expect(unavailable.matches(agents,emptyFilters,new AbortController().signal)).rejects.toThrow('503');
});
test('same-origin proxy restricts resources and never forwards caller credentials',async()=>{
 let target='';
 const fetcher=async(input:string|URL,init?:RequestInit)=>{target=String(input);expect(new Headers(init?.headers).has('authorization')).toBe(false);expect(init?.redirect).toBe('error');return Response.json({ok:true,matches:[]});};
 expect((await proxyArena(new Request('https://app.test/api?kind=matches&teamFormat=team',{headers:{authorization:'secret'}}),'https://game.test',fetcher)).status).toBe(200);
 expect(target).toBe('https://game.test/api/v1/agent-arena/matches?teamFormat=team');
 expect((await proxyArena(new Request('https://app.test/api?kind=../../internal'),'https://game.test',fetcher)).status).toBe(400);
});
test('arena page has accessible filters, loading states and no invented balances',()=>{
 const html=renderToStaticMarkup(createElement(AgentArenaApp,{endpoint:'/api/agent-arena',watchUrl:'https://game.test/watch'}));
 expect(html).toContain('Loading agent records');expect(html).toContain('All formats');expect(html).toContain('Team match');expect(html).not.toContain('1,000');
});

/**
 * `planned` is a real, publicly committed programme slot that has not drawn any
 * agent's stake yet — migration 0046 added it to the room status. The client
 * parser did not, so once the day-ahead scheduler filled a full day of them,
 * twenty of every twenty-five history rows threw and took the whole Agents page
 * down with them: arena records, agent records and match history all "unavailable".
 * A room status the database can produce must always survive this parser.
 */
test('a planned programme slot parses like any other room', () => {
  const planned = parseMatch(
    {
      roomId: 'planned-1',
      status: 'planned',
      entryFeeL: 20,
      scheduledStartAt: '2026-09-17T08:47:02Z',
      participants: [{ actorId: 'server-bot-0-0', agentId: 'genesis-01' }],
    },
    agents,
  );
  expect(planned.status).toBe('planned');
  expect(planned.participants[0]!.agentId).toBe('genesis-01');
  // Every status the schema admits, so a new one cannot be added to the
  // database without this failing first.
  for (const status of ['planned', 'reserved', 'live', 'settled', 'cancelled']) {
    expect(parseMatch({ ...raw, status, result: undefined, participants: [] }, agents).status).toBe(status);
  }
});

/** The identity columns are optional on the wire so an API older than the
 *  migration still parses, but a null must not reach the UI as a name. */
test('agent identity columns survive the wire and nulls are dropped', () => {
  const parsed = parseAgents({
    ok: true,
    agents: [
      { agentId: 'genesis-01', slot: 0, codename: 'c0ke', subname: 'C-ZEROKE', skinSlug: 'c0ke', accentColor: '#d51115', archetype: 'BREACHER', balanceCentilitres: '94000' },
      { agentId: 'genesis-02', slot: 1, codename: 'peps1', subname: null, skinSlug: null, accentColor: null, archetype: 'RECON', balanceCentilitres: '94000' },
    ],
  });
  expect(parsed[0]).toMatchObject({ codename: 'c0ke', subname: 'C-ZEROKE', skinSlug: 'c0ke', accentColor: '#d51115' });
  expect(parsed[1]!.subname).toBeUndefined();
  expect(parsed[1]!.skinSlug).toBeUndefined();
});
