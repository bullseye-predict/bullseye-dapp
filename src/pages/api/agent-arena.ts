import type { APIRoute } from 'astro';
import { proxyArena } from '../../server/arena-proxy';
export const prerender=false;
export const GET:APIRoute=({request,locals})=>{
  const runtime=(locals as {runtime?:{env?:Record<string,unknown>}}).runtime?.env??{};
  const origin=String(runtime.SOLZ_GAME_API_ORIGIN??(typeof process!=='undefined'?process.env.SOLZ_GAME_API_ORIGIN:undefined)??import.meta.env.SOLZ_GAME_API_ORIGIN??'https://solz-elysia-production.up.railway.app');
  return proxyArena(request,origin);
};
