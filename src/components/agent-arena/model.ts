export interface ArenaAgent {
  agentId: string; slot: number; codename: string; archetype: string; balanceCentilitres: string;
  /** The second line on the agent's can label, and the wrap artwork it names.
   *  Optional because an API older than the identity migration omits them. */
  subname?: string; skinSlug?: string; accentColor?: string;
  matchesPlayed?: number; wins?: number; kills?: number; deaths?: number;
}
export interface Participation { agentId: string; actorId: string; teamId: string | null; kills: number | null; deaths: number | null; won: boolean | null }
export interface ArenaTeamMember { agentId: string; actorId: string; name: string }
export interface ArenaTeam { id: string; label: string; members: ArenaTeamMember[] }
export interface ArenaDefinition {
  id: string; title: string; summary: string; gameMode: string; teamFormat: string;
  teamCount: number; playersPerTeam: number; requiredPlayers: number;
  matchDurationMs: number; breakMs: number; previewMs: number; teams: ArenaTeam[];
}
export interface ArenaScheduleEntry {
  state: 'planned' | 'reserved' | 'live'; definition: ArenaDefinition;
  roomId?: string; matchId?: string; scheduledStartAt?: string;
}
export interface ArenaMatch {
  /** `planned` is a day-ahead programme slot: a real, publicly committed room
   *  that has not drawn any agent's stake yet. Dropping it from this union made
   *  the whole history page fail once the scheduler filled a day of them. */
  roomId: string; status: 'planned'|'reserved'|'live'|'settled'|'cancelled'; entryFeeL: number;
  matchId?: string; displayMatchId?: string; matchNumber?: number; scheduledStartAt?: string;
  createdAt?: string; startedAt?: string; completedAt?: string; nextMatchAt?: string; gameMode: string; teamFormat: string;
  definition?: ArenaDefinition; matchDurationMs?: number; timingType?: 'countdown'|'open-ended';
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
