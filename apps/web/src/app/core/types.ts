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
}

export interface Me {
  id: string;
  displayName: string;
  username: string;
  avatar: string | null;
  isAdmin: boolean;
  joinToken: string;
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
