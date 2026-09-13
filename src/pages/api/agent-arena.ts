import type { APIRoute } from 'astro';
import { proxyArena } from '../../server/arena-proxy';
export const prerender=false;
export const GET:APIRoute=({request,locals})=>{
  const runtime=(locals as {runtime?:{env?:Record<string,unknown>}}).runtime?.env??{};
  // No production fallback. An unset origin must fail loudly instead of
  // silently proxying local development traffic to the deployed game API.
  const origin=String(runtime.SOLZ_GAME_API_ORIGIN??(typeof process!=='undefined'?process.env.SOLZ_GAME_API_ORIGIN:undefined)??import.meta.env.SOLZ_GAME_API_ORIGIN??'').trim();
  if(!origin)return Response.json({error:'SOLZ_GAME_API_ORIGIN is unset in solz-prediction-market. Refusing to guess an upstream.'},{status:503});
  return proxyArena(request,origin);
};
