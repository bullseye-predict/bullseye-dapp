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
