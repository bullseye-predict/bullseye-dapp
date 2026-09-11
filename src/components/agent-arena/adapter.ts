import {filterMatches, type ArenaAgent, type ArenaFilters, type ArenaMatch, type ArenaPage} from './model';
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
    return a as ArenaAgent;
  });
}
export function parseMatch(value: unknown, agents: ArenaAgent[]): ArenaMatch {
  const m=object(value),r=m.result?object(m.result):{};
  if(typeof m.roomId!=='string'||!['reserved','live','settled','cancelled'].includes(m.status)||!Number.isFinite(m.entryFeeL)) throw Error('Invalid match record.');
  const participants=m.participants??r.participants??[];
  if(!Array.isArray(participants)) throw Error('Invalid participation record.');
  const matchDurationMs=Number(m.matchDurationMs??m.policy?.matchDurationMs),matchNumber=Number(m.matchNumber);
  return {...m,gameMode:m.gameMode??'deathmatch',teamFormat:m.teamFormat??'ffa',
    matchNumber:Number.isSafeInteger(matchNumber)&&matchNumber>0?matchNumber:undefined,
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
    async logs(roomId:string,signal:AbortSignal){const d=await read('logs',{roomId},signal);if(!Array.isArray(d.events))throw Error('Match logs unavailable.');return d.events.map((v:unknown)=>object(object(v).event));},
  };
}
