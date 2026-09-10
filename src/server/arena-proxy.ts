const paths:Record<string,string>={agents:'/api/v1/genesis-agents',matches:'/api/v1/agent-arena/matches',current:'/api/v1/agent-arena'};
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
    for(const key of ['agentId','gameMode','teamFormat','status','limit','cursor']){const value=url.searchParams.get(key);if(value)target.searchParams.set(key,value);}
    const upstream=await fetcher(target,{signal:AbortSignal.timeout(10000),redirect:'error',headers:{accept:'application/json'}});
    if(!upstream.ok)return Response.json({error:'ARENA_SOURCE_UNAVAILABLE'},{status:upstream.status===404?404:502});
    // Do not forward cookies, authorization or upstream response headers.
    return Response.json(await upstream.json(),{headers:{'cache-control':'public, max-age=5, s-maxage=10','x-content-type-options':'nosniff'}});
  }catch{return Response.json({error:'ARENA_SOURCE_UNAVAILABLE'},{status:503});}
}
