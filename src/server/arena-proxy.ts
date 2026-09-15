// Agent Arena is the long-running FFA show; Agent Colosseum is the separate
// team programme the CATWALK board feeds. They have independent catalogs and
// must not be collapsed into one `schedule` kind.
const paths:Record<string,string>={agents:'/api/v1/genesis-agents',matches:'/api/v1/agent-arena/matches',current:'/api/v1/agent-arena',schedule:'/api/v1/agent-arena/schedule',colosseum:'/api/v1/agent-colosseum',colosseumSchedule:'/api/v1/agent-colosseum/schedule',catwalk:'/api/v1/catwalk',standings:'/api/v1/catwalk/standings',catwalkSpots:'/api/v1/catwalk/spots',miawPrix:'/api/v1/miaw-prix'};
export async function proxyArena(request:Request,origin:string,fetcher:(input:string|URL,init?:RequestInit)=>Promise<Response>=fetch) {
  const url=new URL(request.url),kind=url.searchParams.get('kind')??'';
  let path=paths[kind];
  if(kind==='history'&&url.searchParams.get('agentId'))path=`/api/v1/genesis-agents/${encodeURIComponent(url.searchParams.get('agentId')!)}/history`;
  if(kind==='logs'&&url.searchParams.get('roomId'))path=`/api/v1/agent-arena/matches/${encodeURIComponent(url.searchParams.get('roomId')!)}/logs`;
  if(!path)return Response.json({error:'UNKNOWN_ARENA_RESOURCE'},{status:400});
  try {
    const base=new URL(origin);
    if(base.username||base.password||!(base.protocol==='https:'||(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname))))throw Error('Invalid origin');
    const target=new URL(path,base);
    // An allowlist, not a passthrough: only these reach the game API. `seasonId`
    // is here because the MIAW PRIX season picker is otherwise inert — it would
    // silently serve the live season under whatever season the viewer chose.
    for(const key of ['agentId','gameMode','teamFormat','status','limit','cursor','seasonId']){const value=url.searchParams.get(key);if(value)target.searchParams.set(key,value);}
    const upstream=await fetcher(target,{signal:AbortSignal.timeout(10000),redirect:'error',headers:{accept:'application/json'}});
    if(!upstream.ok)return Response.json({error:'ARENA_SOURCE_UNAVAILABLE'},{status:upstream.status===404?404:502});
    // Do not forward cookies, authorization or upstream response headers.
    return Response.json(await upstream.json(),{headers:{'cache-control':'public, max-age=5, s-maxage=10','x-content-type-options':'nosniff'}});
  }catch{return Response.json({error:'ARENA_SOURCE_UNAVAILABLE'},{status:503});}
}
