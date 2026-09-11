export interface ArenaAgent {
  agentId: string; slot: number; codename: string; archetype: string; balanceCentilitres: string;
  matchesPlayed?: number; wins?: number; kills?: number; deaths?: number;
}
export interface Participation { agentId: string; actorId: string; teamId: string | null; kills: number | null; deaths: number | null; won: boolean | null }
export interface ArenaMatch {
  roomId: string; status: 'reserved'|'live'|'settled'|'cancelled'; entryFeeL: number;
  matchId?: string; displayMatchId?: string; scheduledStartAt?: string;
  createdAt?: string; startedAt?: string; completedAt?: string; gameMode: string; teamFormat: string;
  participants: Participation[];
}
export interface ArenaFilters { agentId: string; gameMode: string; teamFormat: string; status: string }
export interface ArenaPage { matches: ArenaMatch[]; nextCursor: string | null; legacy: boolean }
export const emptyFilters: ArenaFilters = {agentId:'',gameMode:'',teamFormat:'',status:''};
export function filterMatches(matches: ArenaMatch[], filters: ArenaFilters) {
  return matches.filter(m=>(!filters.agentId || m.participants.some(p=>p.agentId===filters.agentId)) &&
    (!filters.gameMode || m.gameMode===filters.gameMode) && (!filters.status || m.status===filters.status) &&
    (!filters.teamFormat || (filters.teamFormat==='ffa' ? m.teamFormat==='ffa' : m.teamFormat!=='ffa')));
}
export function summarizeAgent(agentId: string, matches: ArenaMatch[]) {
  const rows=matches.filter(m=>m.status==='settled').flatMap(m=>m.participants.filter(p=>p.agentId===agentId));
  return {matchesPlayed:rows.length,wins:rows.filter(p=>p.won).length,kills:rows.reduce((sum,p)=>sum+(p.kills??0),0),deaths:rows.reduce((sum,p)=>sum+(p.deaths??0),0)};
}
export function liquid(value: string) { const n=BigInt(value);return `${(n/100n).toLocaleString()}${n%100n ? '.'+(n%100n).toString().padStart(2,'0') : ''}`; }
