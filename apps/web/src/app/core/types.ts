import type { BracketState, MatchState, Standing } from '@tourney/bracket';
import type {
  AgentProfile,
  BotSpec,
  Entrant,
  MapInfo,
  TournamentProjection,
  TournamentSettings,
  TournamentSettingsInput,
} from '@tourney/protocol';

export type {
  BracketState,
  MatchState,
  Standing,
  Entrant,
  BotSpec,
  MapInfo,
  TournamentSettings,
  TournamentSettingsInput,
};

export interface SiteConfig {
  siteName: string;
  discordLogin: boolean;
  devLogin: boolean;
  /** The website can send Discord direct messages (a bot is configured). */
  notify?: { directMessages: boolean; defaultChannel: boolean };
}

export interface Me {
  id: string;
  displayName: string;
  username: string;
  avatar: string | null;
  isAdmin: boolean;
  joinToken: string;
  notifyDm?: boolean;
  /** Logged in with Discord (development logins cannot get direct messages). */
  discordAccount?: boolean;
}

export interface PublicUser {
  id: string;
  displayName: string;
  username: string;
  avatar: string | null;
  isAdmin: boolean;
}

export type Phase = 'draft' | 'seeded' | 'checkIn' | 'running' | 'paused' | 'finished' | 'aborted';

export interface TournamentSummary {
  id: string;
  name: string;
  phase: Phase;
  format: 'single' | 'double';
  size: number;
  teamSize: number;
  /** dm: deathmatch (1v1 or teams), mh: Monster Hunt time race. */
  game?: 'dm' | 'mh';
  teams: number;
  registered: number;
  registeredMe: boolean;
  registrationOpen: boolean;
  scheduledAt: string | null;
  createdAt: string;
  champion?: string;
}

export interface LiveInfo {
  tournamentId: string;
  matchId: string;
  game: number;
  phase:
    'voting' | 'loading' | 'readyCheck' | 'countdown' | 'live' | 'overtime' | 'paused' | 'post';
  map?: string;
  scores?: Record<string, number>;
  ready?: Record<string, boolean>;
  deadline?: number;
  /** Monster Hunt: the run in progress. */
  race?: {
    runner: string;
    run: number;
    timeMs: number;
    deaths: number;
    penaltyMs: number;
    points: number;
  };
}

export interface TournamentDetail {
  id: string;
  name: string;
  phase: Phase;
  headSeq: number;
  agentId: string;
  profileId: string;
  connectAddress: string | null;
  connectAddressOverride: string | null;
  settings: TournamentSettings;
  botPool: BotSpec[];
  registrationOpen: boolean;
  /** Counts for the statistics page. */
  statsEnabled: boolean;
  /** Counts for the ratings. */
  ranked: boolean;
  scheduledAt: string | null;
  createdAt: string;
  registrations: {
    userId: string;
    displayName: string;
    avatar: string | null;
    teamId: string | null;
    sub: boolean;
  }[];
  teams: TeamView[];
  watchers: number;
  /** Admins only: Discord channel of this tournament and what the installation offers. */
  notify: {
    mode: 'default' | 'custom' | 'off';
    webhookUrl: string | null;
    defaultChannel: boolean;
    directMessages: boolean;
  } | null;
  me: {
    registered: boolean;
    watching: boolean;
    entrantId: string | null;
    hasAccess: boolean;
    teamId: string | null;
    captain: boolean;
  };
  projection: (TournamentProjection & { bracket?: BracketState }) | null;
  live: LiveInfo | null;
  agent: { online: boolean };
}

export interface TeamView {
  id: string;
  name: string;
  tag: string | null;
  captainId: string;
  members: { userId: string; displayName: string; avatar: string | null; sub: boolean }[];
  /** Only for the team's members and admins. */
  inviteCode: string | null;
}

export interface InvitePreview {
  teamId: string;
  name: string;
  tag: string | null;
  members: { displayName: string; sub: boolean }[];
}

export interface Inventory {
  profileId: string;
  maps: MapInfo[];
  bots: BotSpec[];
  packages?: string[];
  scannedAt: string;
  warnings: string[];
}

export interface AgentView {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
  online: boolean;
  status: {
    state: string;
    tournamentId?: string;
    map?: string;
    modConnected: boolean;
    players: { name: string; role: string }[];
    uptimeSec?: number;
  } | null;
  agentVersion?: string;
  os?: string;
  arch?: string;
  activeTournamentId?: string;
  profiles: (AgentProfile & { inventory: Inventory | null })[];
}

export interface TournamentEventView {
  type: string;
  seq: number;
  at: string;
  actor: { kind: string; id?: string };
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------
// Statistics (see apps/api/src/stats/aggregate.ts)

export type StatMode = 'dm' | 'tdm' | 'mh';

export interface StatsPlayerRow {
  key: string;
  name: string;
  bot: boolean;
  userId?: string;
  tournaments: number;
  titles: number;
  matches: number;
  matchesWon: number;
  games: number;
  gamesWon: number;
  statGames: number;
  kills: number;
  deaths: number;
  suicides: number;
  teamKills: number;
  frags: number;
  kd: number;
  efficiency: number;
  headshots: number;
  firstBloods: number;
  bestSpree: number;
  sprees: number;
  multiKills: number;
  timeSec: number;
  favoriteWeapon?: { name: string; kills: number };
  runs: number;
  runsFinished: number;
  monsters: number;
  monsterPoints: number;
}

export interface RecordHolder {
  key: string;
  name: string;
  bot: boolean;
}

export interface StatsRecord {
  id: string;
  mode: StatMode | 'all';
  value: number;
  unit: 'count' | 'ratio' | 'sec' | 'ms';
  holders: RecordHolder[];
  label: string;
  tournamentId?: string;
  tournamentName?: string;
  matchId?: string;
  map?: string;
  at?: string;
}

export interface MapRecord {
  map: string;
  finalMs: number;
  timeMs: number;
  deaths: number;
  penaltyMs: number;
  monsterSkill: number;
  team: string;
  members: RecordHolder[];
  tournamentId: string;
  tournamentName: string;
  at: string;
}

export interface StatsPlayerDetail {
  row: StatsPlayerRow;
  byMode: Partial<Record<StatMode, StatsPlayerRow>>;
  weapons: { name: string; kills: number }[];
  recent: {
    tournamentId: string;
    tournamentName: string;
    matchId: string;
    mode: StatMode;
    at: string;
    won: boolean;
    team: string;
    opponent: string;
  }[];
  mapBests: {
    map: string;
    finalMs: number;
    deaths: number;
    team: string;
    tournamentName: string;
    at: string;
  }[];
  records: StatsRecord[];
  mapRecords: MapRecord[];
}

/** Rating of a player or bot in one mode (OpenSkill, shown like Elo: start 1500). */
export interface PlayerRating {
  key: string;
  name: string;
  bot: boolean;
  userId?: string;
  rating: number;
  games: number;
  wins: number;
  provisional: boolean;
  lastAt: string;
}

export interface RatingRow extends PlayerRating {
  /** Place among the non-provisional ratings. */
  rank?: number;
}

export interface RatingChange {
  key: string;
  name: string;
  bot: boolean;
  entrantId: string;
  skill?: number;
  before: number;
  after: number;
  delta: number;
}

export interface RatedGame {
  tournamentId: string;
  matchId: string;
  game: number;
  at: string;
  mode: StatMode;
  winnerEntrantId: string;
  factor: number;
  changes: RatingChange[];
}

export interface PlayerRatings {
  modes: Partial<Record<StatMode, PlayerRating>>;
  recent: (RatedGame & { delta: number; after: number })[];
}

export interface WebsiteSettings {
  rating: { botGames: boolean; levelPoints: number };
}
