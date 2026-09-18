import {filterMatches, type ArenaAgent, type ArenaDefinition, type ArenaFilters, type ArenaMatch, type ArenaPage, type ArenaScheduleEntry, type ArenaTeam} from './model';
function object(value: unknown): Record<string, any> {
  const v=typeof value==='string'?JSON.parse(value):value;
  if (!v || typeof v!=='object' || Array.isArray(v)) throw Error('The arena returned an invalid record.');
  return v;
}
export function parseAgents(value: unknown): ArenaAgent[] {
  const data=object(value);if(data.ok!==true || !Array.isArray(data.agents)) throw Error('Agent profiles are unavailable.');
  return data.agents.map((raw: unknown)=>{const a=object(raw);
    if(typeof a.agentId!=='string'||typeof a.codename!=='string'||typeof a.archetype!=='string'||!Number.isInteger(a.slot)||!/^\d+$/.test(a.balanceCentilitres)) throw Error('Invalid agent profile.');
    for(const key of ['matchesPlayed','wins','kills','deaths']) if(a[key]!==undefined && (!Number.isSafeInteger(a[key])||a[key]<0)) throw Error('Invalid agent statistics.');
    // An API predating the identity migration returns null for these columns
    // rather than omitting them; drop those so the UI falls back to its seed.
    for(const key of ['subname','skinSlug','accentColor']) if(a[key]!==undefined && typeof a[key]!=='string') delete a[key];
    return a as ArenaAgent;
  });
}
const positive=(raw:unknown):number|undefined=>typeof raw==='number'&&Number.isSafeInteger(raw)&&raw>0?raw:undefined;
/** The catalog rows a room capsule is completed from, keyed by definition id.
 *  `/agent-arena` returns them on `policy.definitions`. */
export function arenaCatalog(policy: unknown): Map<string, Record<string, any>> {
  const rows=policy&&typeof policy==='object'&&Array.isArray((policy as {definitions?:unknown}).definitions)?(policy as {definitions:unknown[]}).definitions:[];
  const catalog=new Map<string,Record<string,any>>();
  for(const raw of rows){
    if(!raw||typeof raw!=='object')continue;
    const entry=raw as Record<string,any>;
    if(typeof entry.id==='string'&&entry.id)catalog.set(entry.id,entry);
  }
  return catalog;
}
/** Two shapes reach this: the SCHEDULE returns a full catalog definition, while
 *  a live room persists a signed presentation capsule that carries the match's
 *  own timings but none of the roster shape — an FFA room ships `teams: []`,
 *  no `teamCount`, no `playersPerTeam` and no `requiredPlayers`. Those live in
 *  the catalog, which the capsule names through `definitionId`. Completing the
 *  capsule from the catalog is the normalisation this comment always promised;
 *  without it every live FFA room failed validation and took the whole arena
 *  snapshot — and therefore every page — down with it. */
export function parseArenaDefinition(value: unknown, catalog?: Map<string, Record<string, any>>): ArenaDefinition {
  const capsule=object(value);
  const id=typeof capsule.id==='string'&&capsule.id?capsule.id:capsule.definitionId;
  if(typeof id!=='string'||!id)throw Error('Invalid arena definition.');
  // The capsule wins on anything it states; the catalog fills the rest.
  const definition={...(catalog?.get(id)??{}),...capsule};
  const teams:Array<ArenaTeam>=Array.isArray(definition.teams)?definition.teams.map((raw:unknown)=>{
    const team=object(raw);
    if(typeof team.id!=='string'||typeof team.label!=='string'||!Array.isArray(team.members))throw Error('Invalid arena team.');
    return {id:team.id,label:team.label,members:team.members.map((member:unknown)=>{const value=object(member);if(typeof value.agentId!=='string'||typeof value.actorId!=='string'||typeof value.name!=='string')throw Error('Invalid arena team member.');return {agentId:value.agentId,actorId:value.actorId,name:value.name};})};
  }):[];
  const objectiveKind=definition.objective&&typeof definition.objective==='object'&&typeof definition.objective.kind==='string'?definition.objective.kind:'';
  const teamFormatRaw=typeof definition.teamFormat==='string'&&definition.teamFormat?definition.teamFormat:'';
  // A free-for-all is one side of many players, so an empty `teams` array is
  // its correct shape rather than a missing roster. Reading teamCount off
  // teams.length rejected every FFA room ever persisted.
  const ffa=teamFormatRaw==='ffa'||(!teamFormatRaw&&!teams.length);
  const teamCount=positive(definition.teamCount)??(teams.length||(ffa?1:undefined));
  const playersPerTeam=positive(definition.playersPerTeam)??(teams.length&&teams.every(team=>team.members.length===teams[0]!.members.length)?teams[0]!.members.length:ffa?1:undefined);
  const requiredPlayers=positive(definition.requiredPlayers)??(teams.reduce((total,team)=>total+team.members.length,0)||undefined);
  // The catalog states durations as {development, production}; a capsule states
  // the one the room actually runs on.
  const durations=definition.durationMs&&typeof definition.durationMs==='object'?definition.durationMs as Record<string,unknown>:{};
  const matchDurationMs=positive(definition.matchDurationMs)??positive(durations.production)??positive(durations.development);
  const breakMs=positive(definition.breakMs),previewMs=positive(definition.previewMs);
  if(typeof definition.title!=='string'||!definition.title||typeof definition.summary!=='string'||!definition.summary||!teamCount||!playersPerTeam||!requiredPlayers||!matchDurationMs||!breakMs||!previewMs)throw Error('Invalid arena definition.');
  const gameMode=typeof definition.gameMode==='string'&&definition.gameMode?definition.gameMode:objectiveKind==='time_control'?'hotzone':'deathmatch';
  const teamFormat=teamFormatRaw||(teamCount===2?`${playersPerTeam}v${playersPerTeam}`:'ffa');
  return {id,title:definition.title,summary:definition.summary,gameMode,teamFormat,teamCount,playersPerTeam,requiredPlayers,matchDurationMs,breakMs,previewMs,teams};
}
export function parseMatch(value: unknown, agents: ArenaAgent[], catalog?: Map<string, Record<string, any>>): ArenaMatch {
  const m=object(value),r=m.result?object(m.result):{};
  if(typeof m.roomId!=='string'||!['planned','reserved','live','settled','cancelled'].includes(m.status)||!Number.isFinite(m.entryFeeL)) throw Error('Invalid match record.');
  const participants=m.participants??r.participants??[];
  if(!Array.isArray(participants)) throw Error('Invalid participation record.');
  const definition=(()=>{
    if(m.definition==null)return undefined;
    try{return parseArenaDefinition(m.definition,catalog);}
    // Enrichment, not the record. The match itself is still valid and every
    // field the UI reads has its own source; a capsule this build cannot parse
    // must degrade to "no definition", never to a blank page.
    catch{return undefined;}
  })();
  const matchDurationMs=Number(m.matchDurationMs??m.policy?.matchDurationMs??definition?.matchDurationMs),matchNumber=Number(m.matchNumber);
  return {...m,gameMode:m.gameMode??'deathmatch',teamFormat:m.teamFormat??'ffa',
    matchNumber:Number.isSafeInteger(matchNumber)&&matchNumber>0?matchNumber:undefined,
    definition,
    matchDurationMs:Number.isFinite(matchDurationMs)&&matchDurationMs>0?matchDurationMs:undefined,
    timingType:m.timingType==='open-ended'?'open-ended':Number.isFinite(matchDurationMs)&&matchDurationMs>0?'countdown':undefined,
    participants:participants.map((raw:unknown)=>{
    const p=object(raw),agentId=p.agentId??agents.find(a=>`server-bot-0-${a.slot}`===p.actorId)?.agentId;
    if(typeof agentId!=='string'||typeof p.actorId!=='string') throw Error('An arena participant has no persistent identity.');
    for(const k of ['kills','deaths']) if(p[k]!=null&&(!Number.isSafeInteger(p[k])||p[k]<0))throw Error('Invalid participant statistics.');
    if(p.won!=null&&typeof p.won!=='boolean')throw Error('Invalid participant outcome.');
    return {agentId,actorId:p.actorId,teamId:p.teamId??null,kills:p.kills??null,deaths:p.deaths??null,won:p.won??null};
  })} as ArenaMatch;
}
export function parseArenaSchedule(value: unknown): ArenaScheduleEntry[] {
  const data=object(value);
  if(data.ok!==true||!Array.isArray(data.upcoming))throw Error('Arena schedule is unavailable.');
  const catalog=arenaCatalog(data.policy);
  return data.upcoming.map((raw:unknown)=>{
    const entry=object(raw);
    if(!['planned','reserved','live'].includes(entry.state))throw Error('Invalid arena schedule entry.');
    if(entry.roomId!=null&&typeof entry.roomId!=='string')throw Error('Invalid arena schedule entry.');
    if(entry.matchId!=null&&typeof entry.matchId!=='string')throw Error('Invalid arena schedule entry.');
    if(entry.scheduledStartAt!=null&&typeof entry.scheduledStartAt!=='string')throw Error('Invalid arena schedule entry.');
    return {state:entry.state,definition:parseArenaDefinition(entry.definition,catalog),...(typeof entry.roomId==='string'?{roomId:entry.roomId}:{}),...(typeof entry.matchId==='string'?{matchId:entry.matchId}:{}),...(typeof entry.scheduledStartAt==='string'?{scheduledStartAt:entry.scheduledStartAt}:{})};
  });
}
export function arenaAdapter(endpoint: string, fetcher: (input:string|URL,init?:RequestInit)=>Promise<Response> = fetch) {
  async function read(kind: string, params: Record<string,string>, signal: AbortSignal) {
    const query=new URLSearchParams({kind,...params});
    const response=await fetcher(`${endpoint}?${query}`,{signal,headers:{accept:'application/json'}});
    if(!response.ok) {const e=new Error(`Arena data unavailable (${response.status}).`) as Error & {status:number};e.status=response.status;throw e;}
    return object(await response.json());
  }
  return {
    async agents(signal:AbortSignal){return parseAgents(await read('agents',{},signal));},
    async matches(agents:ArenaAgent[],filters:ArenaFilters,signal:AbortSignal,cursor?:string):Promise<ArenaPage> {
      try {
        // The original API masks unknown routes as HTTP 500. Its profiles have
        // no aggregate stats, so detect that version without hiding real 5xxs.
        if(agents.some(a=>a.matchesPlayed===undefined))throw Object.assign(new Error('Legacy history API'),{status:404});
        const data=await read('matches',{...Object.fromEntries(Object.entries(filters).filter(([,v])=>v)),...(cursor?{cursor}:{}),limit:'25'},signal);
        if(data.ok!==true||!Array.isArray(data.matches))throw Error('Invalid match history.');
        return {matches:data.matches.map((m:unknown)=>parseMatch(m,agents)),nextCursor:data.nextCursor??null,legacy:false};
      }catch(error){
        if((error as {status?:number}).status!==404)throw error;
        // Transitional compatibility with the public pre-pagination API. Query
        // each identity, deduplicate matches and filter actual participant rows.
        const all=new Map<string,ArenaMatch>();
        for(let i=0;i<agents.length;i+=4){
          const histories=await Promise.all(agents.slice(i,i+4).map(a=>read('history',{agentId:a.agentId},signal)));
          for(const h of histories){if(!Array.isArray(h.matches))throw Error('Invalid match history.');for(const raw of h.matches){const m=parseMatch(raw,agents);all.set(m.roomId,m);}}
        }
        return {matches:filterMatches([...all.values()].sort((a,b)=>(b.completedAt??'').localeCompare(a.completedAt??'')),filters),nextCursor:null,legacy:true};
      }
    },
    async current(signal:AbortSignal){return read('current',{},signal);},
    async schedule(signal:AbortSignal){return parseArenaSchedule(await read('schedule',{},signal));},
    async logs(roomId:string,signal:AbortSignal){const d=await read('logs',{roomId},signal);if(!Array.isArray(d.events))throw Error('Match logs unavailable.');return d.events.map((v:unknown)=>object(object(v).event));},
  };
}
