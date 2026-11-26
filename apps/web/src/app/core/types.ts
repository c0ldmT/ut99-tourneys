import type { BracketState, MatchState, Standing } from '@tourney/bracket';
import type {
  AgentProfile,
  BotSpec,
  Entrant,
  MapInfo,
  MeshPreview,
  TournamentProjection,
  TournamentSettings,
  TournamentSettingsInput,
} from '@tourney/protocol';

export type {
  MeshPreview,
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
  /** Unreal Dream Team switched on. */
  udt?: boolean;
  /** Dream Team test mode (local test instance). */
  testMode?: boolean;
  /** The Dream Team league shows (its area in Dream Team). */
  udtLeague?: boolean;
  /** The newest patch note's id (decision 243). */
  patchLatest?: number;
}

/** A patch note (`GET /patch-notes`, decision 243), newest first. */
export interface PatchNote {
  id: number;
  date: string;
  /** Mod version the patch needs on the game servers. */
  mod?: string;
  en: { title: string; items: string[] };
  de: { title: string; items: string[] };
}

/** The Dream Team hub (`GET /udt/hub`): a short state per area. */
export interface UdtHub {
  season: number | null;
  today: string;
  /** The server's time (test mode: with its offset), for "soon" (decision 311). */
  now: string;
  /** First steps of a manager new this season; null for managers of earlier seasons (312). */
  onboarding: { cup: boolean; market: boolean; pack: boolean } | null;
  team: {
    name: string;
    tag: string;
    bots: number;
    lineup: number;
    tired: number;
    striking: number;
    points: number;
    /** Free prestige points of the own bots (decision 265). */
    prestige?: number;
    /** The trophy room's crest (decision 268). */
    crest?: UdtCrest | null;
  } | null;
  league: {
    visible: boolean;
    running: boolean;
    next: {
      at: string;
      kind: 'league' | 'relegation' | 'semi' | 'final' | 'third';
      matchday: number | null;
      opponent: string;
      home: boolean;
    } | null;
    place: number | null;
    tier: number | null;
  };
  packs: { legendaryIn: number; traits: number } | null;
  cups: {
    live: boolean;
    open: number;
    entered: number;
    next: { id: string; name: string; at: string | null; entered: boolean } | null;
  } | null;
  transfers: { tradesIn: number; marketAt: string | null };
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
  /** Messages to show once after login (a modal). */
  notices?: UserNotice[];
  /** The last patch note the user saw: newer ones show once (decision 243). */
  patchSeen?: number;
  /** A season survey waiting for the user (decision 245). */
  survey?: { season: number } | null;
  /** May work the moderation queue (decision 283; admins too). */
  isModerator?: boolean;
  /** No name or text changes until then. */
  textBanUntil?: string | null;
}

/** What a moderated text belongs to (decision 283). */
export type ModKind = 'name' | 'udt-team' | 'udt-bot' | 'bot-lines' | 'team' | 'trade';

/** An item of the moderation queue. */
export interface ModItem {
  id: string;
  kind: ModKind;
  ref: string;
  text: string;
  current: string | null;
  source: 'filter' | 'report' | 'scan';
  term: string | null;
  reports: number;
  reasons: { by: string | null; reason: string; at: string }[];
  status: 'open' | 'ok' | 'reset' | 'edited';
  /** What an admin edits by hand (open items, decision 287). */
  fields?: { text?: string; name?: string; tag?: string; lines?: string[] } | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  author: {
    id: string;
    displayName: string;
    warnings: number;
    textBanUntil: string | null;
    bannedUntil: string | null;
    moderator: boolean;
  } | null;
}

export interface ModSettings {
  builtin: boolean;
  block: string[];
  flag: string[];
  allow: string[];
  builtinBlock: number;
  builtinFlag: number;
}

export interface ModLogEntry {
  id: string;
  at: string;
  by: string | null;
  action: string;
  target: string | null;
  kind: string | null;
  ref: string | null;
  detail: Record<string, unknown>;
}

/** A question of the season survey (decision 245): texts `fb.q.<id>`, `fb.o.<id>.<option>`. */
export interface SurveyQuestion {
  id: string;
  kind: 'scale' | 'choice';
  options?: string[];
}

/** The season survey for the user (`GET /feedback/survey`). */
export interface SurveyView {
  season: number | null;
  open: boolean;
  eligible: boolean;
  questions: SurveyQuestion[];
  texts: string[];
  answer: {
    answers: Record<string, number | string>;
    texts: Record<string, string>;
    updatedAt: string;
  } | null;
}

/** Survey state for admins (`GET /feedback/admin`). */
export interface FeedbackAdmin {
  season: number | null;
  open: boolean;
  openedAt: string | null;
  closedAt: string | null;
  answers: number;
  managers: number;
  notes: number;
}

/** Answers and notes without names (`GET /feedback/export`). */
export interface FeedbackExport {
  season: number | null;
  questions: string[];
  texts: string[];
  survey: {
    manager: number;
    createdAt: string;
    updatedAt: string;
    answers: Record<string, number | string>;
    texts: Record<string, string>;
  }[];
  notes: {
    manager: number;
    season: number | null;
    createdAt: string;
    area: string;
    text: string;
  }[];
}

export interface UserNotice {
  id: string;
  /** "blueprint-apology": a legendary blueprint for the blueprints a full inventory scrapped. */
  kind: string;
  data: Record<string, unknown>;
}

export interface PublicUser {
  id: string;
  displayName: string;
  username: string;
  avatar: string | null;
  isAdmin: boolean;
  /** Admin list only (decision 283). */
  isModerator?: boolean;
  warnings?: number;
  textBanUntil?: string | null;
  bannedUntil?: string | null;
  /** Admin list only (decision 290). */
  createdAt?: string;
  lastLoginAt?: string;
  /** Dream Team AI manager: never logs in (decision 292). */
  ai?: boolean;
  lastSeenAt?: string | null;
}

export type Phase = 'draft' | 'seeded' | 'checkIn' | 'running' | 'paused' | 'finished' | 'aborted';

export interface LeagueTag {
  season: number;
  kind: 'league' | 'relegation' | 'semi' | 'final' | 'third';
  day: string;
  matchday: number | null;
  home: string;
  away: string;
  mine: boolean;
}

export interface TournamentSummary {
  id: string;
  name: string;
  phase: Phase;
  format: 'single' | 'double' | 'fixtures';
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
  /** The server it runs on (check-in and running tournaments). */
  server?: string;
  champion?: string;
  seasonal?: boolean;
  /** "udt": a Dream Team tournament. */
  kind?: string;
  /** Created by this series. */
  seriesId?: string | null;
  /** A game of the Dream Team league: its evening (server day), matchday and clubs. */
  league?: LeagueTag;
  /** The match being played now (running tournaments). */
  now?: NowMatch;
  /** Parallel matches (decision 291): the other matches being played at the same time. */
  alsoNow?: NowMatch[];
}

/** A match being played (overview tiles). */
export interface NowMatch {
  matchId: string;
  game: number;
  map?: string;
  status: 'called' | 'mapSelected' | 'live';
  entrants: [string, string];
  names: [string, string];
  wins: [number, number];
  bestOf: number;
  runs?: {
    entrantId: string;
    timeMs: number;
    penaltyMs: number;
    finished: boolean;
    forfeit?: boolean;
  }[];
  live?: LiveInfo;
  /** The server playing it. */
  server?: string;
}

/** A page of the archive (finished and aborted tournaments), see `Api.archive`. */
export interface TournamentArchive {
  items: TournamentSummary[];
  /** All that match the filters; `aborted` of them were aborted. */
  total: number;
  aborted: number;
  /** For the next page (`before`), null: none. */
  next: string | null;
}

/** Filters of the archive (and of the overview, in the browser). */
export interface TournamentFilter {
  q?: string;
  kind?: 'classic' | 'udt' | 'league';
  mode?: '1v1' | 'team' | 'mh';
  status?: 'finished' | 'aborted';
  series?: string;
  mine?: boolean;
}

/** A series in the overview (`GET /series/overview`). */
export interface SeriesOverview {
  id: string;
  name: string;
  active: boolean;
  days: number[];
  times: string[];
  every: { hours: number; from: string; to: string } | null;
  everyWeeks: number;
  kind: string;
  seasonal: boolean;
  game: 'dm' | 'mh';
  teamSize: number;
  size: number;
  finished: number;
  aborted: number;
  /** id null: not created yet (the planned start). */
  next: { id: string | null; name: string; at: string } | null;
  recent: {
    id: string;
    name: string;
    at: string;
    phase: string;
    champion: string | null;
  }[];
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
  /** "udt": Dream Team managers' lineups play. */
  kind?: 'standard' | 'udt';
  udt?: UdtEventRules | null;
  /** A game of the Dream Team league (the league sets the clubs, draws and starts it). */
  league?: LeagueTag;
  /** Dream Team: whether AI managers play (and how many); where the viewer's bots play. */
  signup?: { aiOn?: boolean; aiCount?: number; busyIn?: string[] };
  /** Answer of a Dream Team draw: teams that signed up but are not in the bracket. */
  dropped?: { name: string; reason: 'busy' | 'lineup' | 'full'; busyIn?: string[] }[];
  phase: Phase;
  headSeq: number;
  agentId: string;
  profileId: string;
  /** Takes a free server of the pool when it starts (decision 282). */
  serverAuto: boolean;
  /** Servers it may use at once (decision 291); 1 = its own only. */
  parallel?: number;
  /** The extra servers it plays on now (parallel matches). */
  lanes?: LaneServer[];
  /** The server's name (the preferred one until the start). */
  serverName: string;
  connectAddress: string | null;
  connectAddressOverride: string | null;
  /** The bots are the control center's active ones (fixed at the seeding). */
  botsFromLibrary: boolean;
  seriesId: string | null;
  /** Seeded and started by itself at the start time. */
  autoStart: boolean;
  settings: TournamentSettings;
  botPool: BotSpec[];
  registrationOpen: boolean;
  /** Season tournament: counts for the ratings and the season statistics and records. */
  seasonal: boolean;
  /** The season it counts for (the season of its first game; before it: the running one). */
  season: number | null;
  scheduledAt: string | null;
  createdAt: string;
  registrations: {
    /** Dream Team: the team as it signed up (tag and name). */
    label?: string;
    /** Dream Team: an AI manager's team. */
    ai?: boolean;
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
  /** Telemetry of every match being played (parallel matches). */
  lives?: LiveInfo[];
  /** A league game: the games of its evening that are on now, itself included (decision 294). */
  evening?: { id: string; phase: Phase; league: LeagueTag; server: string; now?: NowMatch }[];
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
  /** Models (bot classes), skins and faces, voices found on the server. */
  assets?: {
    botClasses?: AssetItem[];
    textures?: AssetItem[];
    skinPackages?: { pkg: string; textures: string[] }[];
  };
  scannedAt: string;
  warnings: string[];
}

export interface AgentView {
  id: string;
  name: string;
  /** In the server pool (decision 282): automatic tournaments may take it. */
  inPool: boolean;
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
  /** Mod 0.16.0: games with damage data, damage in them, items taken. */
  damageGames?: number;
  damageDealt?: number;
  damageTaken?: number;
  amps?: number;
  belts?: number;
  armors?: number;
  kegs?: number;
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
  recent: (RatedGame & {
    delta: number;
    before?: number;
    after: number;
    tournamentName?: string;
  })[];
}

export type SeasonStatus = 'planned' | 'running' | 'ended';

export interface Season {
  number: number;
  startDate: string;
  endDate: string;
  endedAt: string | null;
  rating: { botGames: boolean; levelPoints: number };
  status: SeasonStatus;
  from: string;
  to: string;
}

export interface SeasonsOverview {
  seasons: Season[];
  /** The running season ("in season"); null: out of season. */
  current: number | null;
  planned: number | null;
  today: string;
  timeZone: string;
}

/** Statistics scope: lifetime or a season number. */
export type StatScope = 'lifetime' | number;

export interface WebsiteSettings {
  rating: { botGames: boolean; levelPoints: number };
  /** Names for bot teams (team tournaments), in order. */
  teamNames: string[];
  /** Betting with Neuro: start balance per season, rescue floor. */
  betting: {
    startBalance: number;
    floor: number;
    botsBet: boolean;
    botsPerMatch: number;
    windowSec: number;
    discord: boolean;
  };
  shop: ShopSettings;
  /** Bot AI help in deathmatch: 0 off, 1 failsafe, 2 failsafe and duel mode. */
  botAi: { level: number; skillCurve: boolean; smartStockBots: 'auto' | 'on' | 'off' };
  udt: UdtSettings;
  /** Live data: replay retention (days, 0 = for good) and the delay while humans play. */
  live: { replayDays: number; delaySec: number };
}

// --- Bot control center ---------------------------------------------------------------------

export const BOT_LINE_KINDS = [
  'start',
  'kill',
  'death',
  'win',
  'loss',
  'rivalKill',
  'rivalDeath',
  'betWon',
  'betLost',
] as const;
export type BotLineKind = (typeof BOT_LINE_KINDS)[number];

export interface BotRival {
  kind: 'user' | 'bot';
  id: string;
  level: 'rival' | 'nemesis';
}

export interface BotPersonality {
  talk: number;
  lines: { kind: BotLineKind; text: string }[];
  rivals: BotRival[];
}

export interface BotTraitsView {
  accuracy?: number;
  alertness?: number;
  combatStyle?: number;
  camping?: number;
  strafing?: number;
  jumpy?: boolean;
  favoriteWeapon?: string;
  voice?: string;
}

export interface LibraryBot {
  id: string;
  name: string;
  /** Name in the game: clan tag + name. */
  gameName: string;
  clanId: string | null;
  skill: number;
  botClass: string | null;
  skin: string | null;
  face: string | null;
  traits: BotTraitsView;
  personality: BotPersonality;
  bio: string | null;
  color: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BotClan {
  id: string;
  name: string;
  tag: string;
  color: string | null;
  description: string | null;
}

export interface AssetItem {
  name: string;
  label: string;
}

export interface BotAssets {
  botClasses: AssetItem[];
  textures: AssetItem[];
  voices: AssetItem[];
  weapons: AssetItem[];
  skins: AssetItem[];
  faces: (AssetItem & { pkg: string })[];
  /** Skin package per stock bot class. */
  packages: Record<string, string>;
  /** Per model its skins (with faces) and voices, as UT's setup menu offers them. */
  models?: ModelChoice[];
}

export interface SkinChoice extends AssetItem {
  faces: AssetItem[];
}

/** A model for the look editors (API: models.ts, decision 172). */
export interface ModelChoice extends AssetItem {
  /** Its skins are known (else only the default, or typed by an admin). */
  known: boolean;
  /** New skin format: skins with faces. */
  multi: boolean;
  skins: SkinChoice[];
  voices: AssetItem[];
  /** What UT takes when nothing is set. */
  defaults: { skin: string; face: string; voice: string };
}

export interface BotProfile extends LibraryBot {
  statsKey: string;
  /** Unreal Dream Team: made by this manager (only plays Dream Team). */
  udtOwner?: string | null;
  labels: {
    botClass: string | null;
    skin?: string | null;
    face: string | null;
    voice: string | null;
    weapon: string | null;
  };
  clan: BotClan | null;
  rivals: (BotRival & { name: string; key: string; record: { games: number; wins: number } })[];
  rivalOf: { id: string; name: string }[];
}

// --- Betting with Neuro (N) ----------------------------------------------------------------

export type BookState = 'waiting' | 'open' | 'closed' | 'settled' | 'refunded';
export type BetStatus = 'open' | 'won' | 'lost' | 'refunded';

export interface NeuroWalletView {
  balance: number;
  staked: number;
  free: number;
  floor: number;
  /** What a rescue tops up to now (floor minus Neuro in Dream Team bots; in debt: 0). */
  rescueTo?: number;
  startBalance: number;
}

export interface BetMatchView {
  matchId: string;
  entrants: [string, string];
  state: BookState;
  closedAt?: string;
  winnerId?: string;
  playing: boolean;
  mine: { pick: string; amount: number; status: BetStatus; payout: number } | null;
  pools: Record<string, { amount: number; bettors: number }> | null;
  bettors: number;
  /** After the window: what one Neuro on a side brings back (also after the match). */
  odds: Record<string, number | null> | null;
  /** After the window: every bet, players' and bots', biggest first. */
  bets: {
    bot: boolean;
    /** User id or bot id. */
    id: string;
    name: string;
    pick: string;
    pickName?: string;
    amount: number;
    status: BetStatus;
    payout: number;
  }[];
  /** While open: the side of the strongest bot that bet. */
  expert: { botId: string; name: string; pick: string; pickName?: string } | null;
}

export interface TournamentBets {
  open: boolean;
  reason: 'notSeasonal' | 'noSeason' | 'phase' | null;
  season: number | null;
  wallet: NeuroWalletView | null;
  matches: BetMatchView[];
}

export interface NeuroWallet {
  userId: string;
  balance: number;
  staked: number;
  free: number;
  peak: number;
  bets: number;
  won: number;
  lost: number;
  refunded: number;
  open: number;
  profit: number;
  bailouts: number;
  bailedOut: number;
  bestWin: number;
  worstLoss: number;
  bestOdds: number;
  winStreak: number;
  loseStreak: number;
  allInWin: number;
}

export interface BetBoard {
  season: number | null;
  startBalance?: number;
  rows: (NeuroWallet & { name: string; bot: boolean; id: string })[];
  /** Man against machine: Neuro won (+) or lost (-) by all players and all bots. */
  versus: { humans: number; bots: number };
}

export interface BetRecordView {
  key: string;
  userId?: string;
  /** Bot records: the bot's id. */
  botId?: string;
  name?: string;
  value: number;
  tournamentId?: string;
  tournamentName?: string;
  matchId?: string;
}

export interface UserBets {
  season: number | null;
  name: string | null;
  /** Bots: their betting type (analyst, gambler, ...). */
  type?: string;
  wallet: NeuroWallet | null;
  recent: {
    tournamentId: string;
    tournamentName: string;
    matchId: string;
    pick: string;
    amount: number;
    status: BetStatus;
    payout: number;
    at: string;
  }[];
}

// --- Match page -------------------------------------------------------------------------------

export interface MatchSideView {
  id: string;
  name: string;
  kind: 'human' | 'bot' | 'team';
  tag?: string;
  rating?: number;
  members: { userId: string; name: string; sub?: boolean }[];
  bots: { id?: string; name: string }[];
}

export interface MatchPlayerView {
  name: string;
  userId?: string;
  bot?: boolean;
  botId?: string;
  entrantId: string;
  run?: number;
  kills: number;
  deaths: number;
  suicides: number;
  teamKills: number;
  headshots: number;
  firstBlood: boolean;
  bestSpree: number;
  sprees: number;
  multi2: number;
  multi3: number;
  multi4: number;
  multi5: number;
  timeSec: number;
  monsters: number;
  monsterPoints: number;
  weapons: Record<string, number>;
  /** Mod 0.16.0: damage dealt (Monster Hunt: to monsters) and taken, items taken. */
  damageDealt?: number;
  damageTaken?: number;
  items?: ItemCounts;
  /** Mod 0.17.0: what the bot's Dream Team traits did (trait log). */
  traits?: TraitGameStats[];
}

/** Trait report of a season (admins, decision 237): summary per trait, one row per bot game. */
export interface TraitReport {
  season: number;
  games: number;
  baseline: { games: number; won: number; kills: number; deaths: number };
  summary: Record<string, string | number>[];
  rows: Record<string, string | number | boolean>[];
  /** Mod 0.19.0 (decision 257): the bots' measures per skill, suicides per map. */
  measures?: {
    bySkill: Record<string, string | number | null>[];
    byMap: Record<string, string | number>[];
  };
}

/** A trait in one game of a bot (mod code; see `traitByMod`, decision 237). */
export interface TraitGameStats {
  code: string;
  uses: number;
  sec: number;
  kills: number;
  deaths: number;
  value: number;
  value2: number;
  episodes?: { at: number; sec: number; kills: number; died: boolean }[];
}

export interface ItemCounts {
  amp: number;
  belt: number;
  armor: number;
  keg: number;
}

export interface MatchRunView {
  entrantId: string;
  map: string;
  timeMs: number;
  deaths: number;
  penaltyMs: number;
  points: number;
  finished: boolean;
  forfeit?: boolean;
}

export interface MatchGameView {
  game: number;
  map?: string;
  scores?: Partial<Record<string, number>>;
  winnerId?: string;
  endReason?: string;
  durationSec?: number;
  runs?: MatchRunView[];
  players: MatchPlayerView[];
  live?: boolean;
}

export interface MatchDetailView {
  matchId: string;
  status: string;
  bestOf: number;
  side: string;
  round: number;
  winnerId?: string;
  outcome?: string;
  entrants: MatchSideView[];
  games: MatchGameView[];
  wins: Partial<Record<string, number>>;
}

// --- Tournament series ------------------------------------------------------------------------

export interface SeriesFields {
  name: string;
  /** ISO weekdays 1 (Monday) .. 7 (Sunday); all seven = daily. */
  days: number[];
  /** Fixed start times "HH:MM", local time of the season time zone … */
  times: string[];
  /** … and/or every n hours from `from` to `to`. */
  every: { hours: number; from: string; to: string } | null;
  everyWeeks: number;
  /** The tournament is created this many minutes before its start. */
  leadMinutes: number;
}

export interface SeriesView extends SeriesFields {
  id: string;
  active: boolean;
  /** Its tournaments start by themselves. */
  autoStart: boolean;
  nextNumber: number;
  nextStart: string | null;
  nextCreateAt: string | null;
  nextName: string | null;
  lastStart: string | null;
  settings: TournamentSettings;
  /** What every tournament of the series gets (no botPool: the control center's bots). */
  template: SeriesTemplate;
  tournaments: number;
  timeZone: string;
}

/** An extra server of a tournament (parallel matches, decision 291). */
export interface LaneServer {
  agentId: string;
  name: string;
  connectAddress: string | null;
  online: boolean;
}

export interface SeriesTemplate {
  agentId: string;
  profileId: string;
  serverAuto?: boolean;
  parallel?: number;
  connectAddress?: string | null;
  settings: TournamentSettings;
  botPool?: BotSpec[];
  notifyMode?: 'default' | 'custom' | 'off';
  webhookUrl?: string | null;
  seasonal?: boolean;
  autoStart?: boolean;
  kind?: 'standard' | 'udt';
  udt?: UdtEventRules;
}

/** The next starts of a schedule (form preview). */
export interface SeriesPreview {
  timeZone: string;
  perDay: number;
  next: { start: string; name: string | null }[];
}

export type FeedItem = 'amp' | 'belt' | 'armor' | 'keg' | 'invis' | 'boots' | 'redeemer';
export type BotState = 'atk' | 'chg' | 'tac' | 'ret' | 'hunt' | 'roam' | 'item' | 'camp';

/** One entry of the feed of a game: a kill, a bot's chat line, an item taken, a bot's thought. */
export interface KillFeedEntry {
  tournamentId: string;
  matchId: string;
  game: number;
  /** Monster Hunt: the run. */
  run?: number;
  at: number;
  /** Seconds since the game (run) went live. */
  sec?: number;
  kind?: 'kill' | 'chat' | 'item' | 'thought' | 'trait';
  humans?: boolean;
  killerHealth?: number;
  /** Unreal units. */
  distance?: number;
  amp?: boolean;
  item?: FeedItem;
  thought?: { state: BotState; target: string };
  killer: string;
  killerSide: string | null;
  victim: string;
  victimSide: string | null;
  weapon: string;
  headshot: boolean;
  firstBlood: boolean;
  suicide: boolean;
  teamKill: boolean;
  monster: boolean;
  spree: number;
  multi: number;
  /** A bot's chat line (mod 0.12.0): `killer` is the bot. */
  chat?: string;
  /** kind "trait" (mod 0.17.0): an episode of the bot `killer`'s trait ended. */
  trait?: { code: string; dur: number; kills: number; died: boolean };
}

/** A player or bot of the game in progress (mod 0.16.0). */
export interface LivePlayer {
  name: string;
  side: string | null;
  bot: boolean;
  userId?: string;
  alive: boolean;
  health: number;
  armor: number;
  weapon: string;
  /** Bits: 1 damage amplifier, 2 shield belt, 4 invisibility, 8 jump boots. */
  powerups: number;
  ampSec: number;
  kills: number;
  /** Monster Hunt: monsters killed. */
  monsters?: number;
  deaths: number;
  suicides: number;
  damageDealt: number;
  damageTaken: number;
  ping?: number;
  loss?: number;
  items: ItemCounts;
}

export interface LiveStateView {
  tournamentId: string;
  matchId: string;
  game: number;
  run?: number;
  at: number;
  sec: number;
  humans: boolean;
  players: LivePlayer[];
  monsters?: { alive: number; total: number; bosses: number };
  /** Monster Hunt (mod 0.17.0): the map's objectives, 0 open, 1 active, 2 done. */
  objectives?: { text: string; state: number }[];
}

/** Timeline of the game in progress: `[sec, scoreA, scoreB]`; a race: `[sec, points, deaths, monstersAlive]`. */
export interface LiveTimeline {
  matchId: string;
  game: number;
  run?: number;
  sides: string[];
  samples: number[][];
}

export interface LiveSnapshot {
  state: LiveStateView | null;
  timeline: LiveTimeline | null;
  /** Seconds the state is held back while a human plays. */
  delaySec: number;
}

/** A finished game (Monster Hunt: run): its feed, timeline and players at the end. */
export interface ReplayView {
  game: number;
  run?: number;
  sides: string[];
  /** `[sec, scoreA, scoreB, damageA, damageB]`; a race: `[sec, points, deaths, monstersAlive]`. */
  samples: number[][];
  feed: Omit<KillFeedEntry, 'tournamentId' | 'matchId' | 'game' | 'run'>[];
  players: LivePlayer[];
  monsters?: { alive: number; total: number; bosses: number };
}

// --- Neuro shop -------------------------------------------------------------------------------

export type ShopSlot = 'title' | 'color' | 'frame' | 'badge' | 'banner' | 'fanfare' | 'dedication';

export interface LookView {
  title?: string;
  color?: string;
  frame?: string;
  badge?: string;
  banner?: string;
  fanfare?: boolean;
}

export interface ShopItem {
  id: string;
  slot: ShopSlot;
  name: string;
  price: number;
  tier: 1 | 2 | 3 | 4;
  value: string;
  awarded?: boolean;
  owned?: boolean;
  hidden?: boolean;
  basePrice?: number;
}

export interface ShopDedication {
  status: 'pending' | 'approved' | 'rejected';
  kill: string;
  death: string;
}

export interface ShopView {
  enabled: boolean;
  wallet: {
    season: number | null;
    balance: number;
    free: number;
    floor: number;
    spendable: number;
  };
  items: ShopItem[];
  awards: ShopItem[];
  /** Item id per slot. */
  look: Partial<Record<Exclude<ShopSlot, 'dedication'>, string>>;
  dedication: ShopDedication | null;
}

export interface ShopPurchaseView {
  id: string;
  userId: string;
  name: string;
  item: string;
  itemName: string;
  season: number;
  price: number;
  at: string;
  status: 'ok' | 'pending' | 'approved' | 'rejected';
  dedication?: { kill: string; death: string };
}

export interface ShopSettings {
  enabled: boolean;
  prices: Record<string, number>;
  hidden: string[];
}

// --- Unreal Dream Team ----------------------------------------------------------------------

export type UdtRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface UdtRosterBot {
  botId: string;
  name: string;
  gameName: string;
  skill: number;
  rarity: UdtRarity;
  botClass: string | null;
  skin: string | null;
  face: string | null;
  traits: BotTraitsView;
  price: number;
  value: number;
  starter: boolean;
  dmSlot: number | null;
  mhSlot: number | null;
  bench: number | null;
  stamina: number;
  xp: number;
  level: number;
  slots: number;
  udtTraits: UdtTraitOnBot[];
  effective: { skill: number; traits: BotTraitsView; overflow: boolean };
  striking: boolean;
  games: number;
  /** Monster Hunt focus: -2 hunter … 0 standard … 2 sprinter (decision 239). */
  mhFocus?: number;
  /** Neuro per stamina point (thrifty: less, decision 242). */
  restPrice?: number;
  /** A bot the manager made: potential (a range until level 5), development points. */
  own: {
    origin: string;
    potential: [number, number];
    points: number;
    spent: number;
    /** The one free renaming is still open. */
    canRename: boolean;
    /** The one breakthrough happened. */
    breakthrough?: boolean;
    /** A keeper: the season it came from (plays for free). */
    keptFrom?: number | null;
    /** Fully developed for good: points have nothing left to buy (no plaque). */
    maxed?: boolean;
    /** Level points of a fully developed bot: kept for prestige (decision 256), not to give. */
    banked?: number;
    /** The mentor it learned from; `here`: in the roster (faster XP). */
    mentor?: { botId: string; name: string; here: boolean } | null;
    /** Prestige (decision 262): null while it is still developing. */
    prestige?: UdtPrestige | null;
    /** A talent's hidden trait waits for level 10 (decision 267; which one stays hidden). */
    anlage?: boolean;
  } | null;
  /** A bought bot settling in (decision 269): games, games needed, its prestige once settled. */
  settle?: { games: number; need: number; prestige: UdtPrestige | null } | null;
  /** The prestige that plays (an own bot's or a settled bought bot's). */
  prestige?: UdtPrestige | null;
  /** A loan (decision 270): the market day it goes back, the fee paid. */
  loan?: { until: string; fee: number; price: number } | null;
  /** Its signature (decision 273): a library bot's for good, an apprentice's for the season. */
  signature?: UdtSignature | null;
  career?: UdtCareer | null;
}

export type UdtPrestigeStat =
  'aim' | 'react' | 'dodge' | 'view' | 'tough' | 'fire' | 'armour' | 'sprint' | 'ammo';

/** An own bot's prestige (decision 262). */
export interface UdtPrestige {
  stage: 'mature' | 'godlike' | 'ascended' | 'settled';
  cap: number;
  points: number;
  fromLevels: number;
  bought: number;
  alloc: Partial<Record<UdtPrestigeStat, number>>;
  spent: number;
  free: number;
  stars: number;
  maxStars: number;
  ascended: boolean;
  /** Why it cannot ascend now (null: it can). */
  ascend: 'done' | 'godlike' | 'level' | 'values' | null;
  prices: {
    point: number | null;
    respec: number | null;
    ascend: number | null;
    star: number | null;
  };
}

/** A club upgrade of the season (decision 264). */
/** A club house building (decision 266): its level, the next level's price (null at the top). */
export interface UdtClubUpgrade {
  kind: string;
  level: number;
  max: number;
  price: number | null;
  /** What the fan shop earned this season (fan shop only). */
  earned: number;
}

export interface UdtTraitOnBot {
  id: string;
  code: string;
  rarity: UdtRarity;
  weapon?: string | null;
}

export type UdtBox = 'standard' | 'premium' | 'elite';

export interface UdtPackBox {
  box: UdtBox;
  price: number;
  tenPrice: number;
  rates: [number, number, number, number, number];
  epicIn: number;
  legendaryIn: number;
  opened: number;
}

export interface UdtInventoryCard {
  id: string;
  code: string;
  rarity: UdtRarity;
  category: 'values' | 'body' | 'behaviour' | 'manager';
  needsWeapon: boolean;
  /** Trait workshop (decision 255): what rerolling / upgrading costs (null: not possible). */
  workshop?: { reroll: UdtWorkshopCost | null; upgrade: UdtWorkshopCost | null };
}

export interface UdtWorkshopCost {
  scrap: number;
  neuro: number;
}

/** A workshop step: the card's new trait and the packs page. */
export interface UdtWorkshopResult {
  card: { id: string; from: string; code: string; rarity: UdtRarity };
  view: UdtPacks;
}

export interface UdtCatalogTrait {
  code: string;
  rarity: UdtRarity;
  category: 'values' | 'body' | 'behaviour' | 'manager';
  needsWeapon?: boolean;
  scrap: number;
  craft: number;
  owned: boolean;
}

export interface UdtPacks {
  index: number;
  hasTeam: boolean;
  scrap: number;
  spendable: number;
  boxes: UdtPackBox[];
  inventory: UdtInventoryCard[];
  blueprints: { id: string; rarity: UdtRarity; scrap: number; gift?: boolean }[];
  /** Pack blueprints a manager keeps (gifts on top). */
  blueprintMax: number;
  /** Pack blueprints over the limit: scrap or build that many before the next pack. */
  blueprintsOver: number;
  weapons: AssetItem[];
  catalog: UdtCatalogTrait[];
}

export interface UdtPullCard {
  id: string | null;
  code: string;
  rarity: UdtRarity;
  duplicate: boolean;
  scrap: number;
  /** A blueprint kept over the limit: choose which blueprint to scrap. */
  full?: boolean;
}

export interface UdtPull {
  box: UdtBox;
  ten: boolean;
  price: number;
  cards: UdtPullCard[];
  view: UdtPacks;
}

export interface UdtTeam {
  userId: string;
  name: string;
  tag: string;
  createdAt: string;
  /** Enters open Dream Team tournaments automatically when possible. */
  autoEnter?: boolean;
}

export interface UdtWallet {
  season: number | null;
  balance: number;
  free: number;
  floor: number;
  spendable: number;
}

export interface UdtView {
  enabled: boolean;
  season: number | null;
  today?: string;
  index: number;
  team: UdtTeam | null;
  roster: UdtRosterBot[];
  wallet?: UdtWallet;
  starterBudget?: number;
  /** Free points on top of the budget (the default starter costs the budget). */
  starterExtra?: number;
  /** Trade offers waiting for the manager. */
  tradesIn?: number;
  /** Without a team: last season's team (the form takes its name and tag). */
  lastTeam?: UdtTeam | null;
  /** Without a team: the keepers that come along when it is founded. */
  keepers?: { botId: string; name: string; skill: number; nextSkill: number }[];
  /** Training camp (decision 254): price, experience, the bots trained today. */
  camp?: UdtCamp;
  /** Club buildings of the season (decisions 264, 266). */
  club?: UdtClubUpgrade[];
  /** The trophy room's crest (decision 266; null without the room). */
  crest?: UdtCrest | null;
  /** Neuro put into the club house this season (decision 268). */
  clubSpent?: number;
  /** Hidden traits that came free since the last look (decision 268; scrap: held already). */
  anlagen?: { code: string; scrap: boolean }[];
}

/** A club's crest (decision 266): shape and colour of CREST_SHAPES / CREST_COLORS. */
export interface UdtCrest {
  shape: string;
  color: string;
}

/** The trophy wall (decisions 266, 268). */
export interface UdtTrophies {
  crest: UdtCrest | null;
  trophyRoom: boolean;
  league: {
    season: number;
    kind: 'champion' | 'final' | 'up';
    tier: number;
    place: number | null;
  }[];
  cups: { season: number; wins: number }[];
  stages: { season: number; botId: string; name: string; stage: string; stars: number }[];
}

/** The analysis room (decision 266): the next league game and the club's map record. */
export interface UdtAnalysis {
  next: {
    fixtureId: string;
    day: string;
    at: string;
    home: boolean;
    opponent: { clubId: string; name: string; tag: string; ai: boolean };
    bots: {
      name: string;
      skill: number;
      accuracy: number;
      alertness: number;
      strafing: number;
      traits: string[];
      prestige: number;
    }[];
    strength: { ours: number; theirs: number };
    chance: number;
  } | null;
  maps: { map: string; won: number; lost: number }[];
}

/** Training camp (decision 254): experience for Neuro, once per bot and day. */
export interface UdtCamp {
  price: number;
  xp: number;
  /** Bots of the roster that were in the camp today. */
  done: string[];
}

/** An own bot at the season's end: can it be kept, its skill next season. */
export interface UdtKeeperBot {
  botId: string;
  name: string;
  origin: string | null;
  skill: number;
  nextSkill: number;
  rarity: UdtRarity;
  traits: BotTraitsView;
  level: number;
  potential: [number, number] | null;
  keptFrom: number | null;
  ok: boolean;
  why: 'bought' | 'nominated' | 'graduated' | 'rejected' | null;
}

/** The keeper choice at a season's end. */
export interface UdtKeepers {
  open: boolean;
  season: number | null;
  from?: string;
  /** Last day of the choice (null: until the next season starts). */
  until?: string | null;
  max: number;
  skillLoss?: number;
  tag?: string;
  bots: UdtKeeperBot[];
  chosen: string[];
}

export interface UdtOffer {
  botId: string;
  name: string;
  skill: number;
  rarity: UdtRarity;
  botClass: string | null;
  skin: string | null;
  face: string | null;
  traits: BotTraitsView;
  /** What buying costs (fixed for the market day). */
  price: number;
  value: number;
  /** Market value per market day with that day's economy index. */
  history: { day: string; value: number; index: number }[];
  /** Demand in the value: >1 in demand, <1 cheaper after unsold days. */
  demand: number;
  sold: boolean;
  /** Tag of the team that bought it (sold). */
  buyer: string | null;
  /** Bought by the own team. */
  mine: boolean;
  /** A graduate of a manager's academy. */
  homegrown?: { breeder: string; honours: boolean } | null;
  career?: UdtCareer | null;
  /** A loan for the market's loan days: its fee; on loan to a team (decision 270). */
  loanFee?: number;
  onLoan?: boolean;
  /** Its signature (decision 273) and whether it can be a mentor (skill 6+). */
  signature?: UdtSignature | null;
  mentor?: boolean;
}

/** A library bot's signature (decisions 271-273). */
export interface UdtSignature {
  code: 'weapon' | 'marksman' | 'streak' | 'multi' | 'tough' | 'opener' | 'home';
  level: 1 | 2;
  /** Leibwaffe: the weapon's class name ("ShockRifle"); Lieblings-Map: the map. */
  weapon?: string;
  map?: string;
  since: number;
}

export interface UdtMarket {
  day: string | null;
  index: number;
  /** Next market day (epoch ms). */
  nextAt: number;
  offers: UdtOffer[];
  /** Bots in the own roster and the most a roster holds. */
  rosterSize: number;
  rosterMax: number;
  /** The team's loan (one at a time) and how many market days a loan lasts (decision 270). */
  loan?: { botId: string; until: string } | null;
  loanDays?: number;
}

export interface UdtEventRules {
  valueCap: number | null;
  starLimit: number | null;
  /** High stakes: entry ticket (null: none), at the index or fixed, fewest human teams. */
  ticket?: number | null;
  ticketIndexed?: boolean;
  minTeams?: number;
  /** Season finale: the top of the season table plays. */
  finale?: boolean;
}

export interface UdtEvent {
  id: string;
  name: string;
  phase: string;
  scheduledAt: string | null;
  teamSize: number;
  size: number;
  game: 'dm' | 'mh';
  rules: UdtEventRules;
  valueCapNow: number | null;
  /** High stakes: the ticket now and the tickets paid in. */
  ticketNow: number;
  pot: number;
  /** Finale: the teams that would play now (user ids). */
  qualified?: string[] | null;
  entries: number;
  /** AI teams among the entries (they make room for humans). */
  aiEntries?: number;
  entered: boolean;
  /** Finished: the own team's place (null: not entered or not placed). */
  place?: number | null;
  open: boolean;
  lineup: {
    bots: string[];
    value: number;
    problems: string[];
    /** Drawn or running tournaments its bots play in: drawn now, the team would drop out. */
    busyIn?: string[];
  } | null;
}

export interface UdtTableRow {
  userId: string;
  name: string;
  tag: string;
  points: number;
  titles: number;
  events: number;
  ai?: boolean;
}

export interface UdtLedgerEntry {
  id: string;
  season: number;
  kind: string;
  amount: number;
  ref: string;
  at: string;
  meta: Record<string, unknown> | null;
}

export interface UdtTestState {
  testMode: boolean;
  now: string;
  offsetHours: number;
  today: string;
  season: number | null;
  udt: boolean;
}

export interface UdtSettings {
  enabled: boolean;
  marketTime: string;
  offersPerDay: number;
  starterBudget: number;
  starterExtra: number;
  tradeEnabled: boolean;
  tradeFeePct: number;
  tradeBalancePct: number;
  tradeLockDays: number;
  tradeExpiryHours: number;
  tradePairPerWeek: number;
  aiEnabled: boolean;
  aiCount: number;
  aiStrength: 'calm' | 'normal' | 'ambitious';
  keepers: { max: number; skillLoss: number; days: number };
  league: LeagueSettings;
  /** Weekly cup bonus (index 1) for places 1-3 of the cup ranking. */
  cupBonus: number[];
}

export type LeagueLength = 'short' | 'medium' | 'long';
export type LeagueAiGames = 'simulate' | 'topGame' | 'all';

/** The Dream Team league's settings (sent as a whole block). */
export interface LeagueSettings {
  enabled: boolean;
  tiers: number;
  size: number;
  startDay: number;
  /** 0 = Monday. */
  slotDays: number[];
  slotTime: string;
  length: LeagueLength;
  aiGames: LeagueAiGames;
  agentId: string | null;
  profileId: string | null;
  /** League games take any free server of the pool (decision 282). */
  serverAuto: boolean;
  mapPool: string[];
  fragLimit: number;
  timeLimitMin: number;
  factors: number[];
  aiFloor: number[];
  tableMoney: number[];
  tierMult: number[];
  betBots: number;
  joinUntil: number;
  keepTestTiers: boolean;
}

export interface LeagueClubRef {
  id: string;
  name: string;
  tag: string;
  /** The trophy room's crest (decision 266). */
  crest?: UdtCrest;
  /** A manager's club (else an AI club). */
  manager: boolean;
  /** An AI manager's club (decision 250; `manager` is true as well). */
  ai?: boolean;
  me: boolean;
}

export type LeagueFormMark = 'W' | 'OW' | 'OL' | 'L';

export interface LeagueRow extends LeagueClubRef {
  club: string;
  place: number;
  played: number;
  won: number;
  wonOt: number;
  lostOt: number;
  lost: number;
  fragsFor: number;
  fragsAgainst: number;
  points: number;
  form: LeagueFormMark[];
  strength: number | null;
  /** Places gained (+) or lost (−) tonight. */
  move: number;
}

export type LeagueKind = 'league' | 'relegation' | 'semi' | 'final' | 'third';

export interface LeagueGame {
  id: string;
  tier: number;
  matchday: number;
  kind: LeagueKind;
  day: string;
  scheduledAt: string;
  home: LeagueClubRef;
  away: LeagueClubRef;
  /** Played on the server (else simulated). */
  real: boolean;
  map: string | null;
  status: 'scheduled' | 'played' | 'simulated' | 'forfeit' | 'void';
  homeFrags: number | null;
  awayFrags: number | null;
  overtime: boolean;
  winner: string | null;
  homeWins: number | null;
  awayWins: number | null;
  postponed: number;
  tournament: { id: string; phase: Phase } | null;
  /** On the server now: status, frags and server (decision 294). */
  live?: NowMatch | null;
}

export interface LeaguePlan {
  slotTime: string;
  evenings: { day: string; matchdays: number[] }[];
  relegation: string;
  final: string;
}

export interface LeagueRunInfo {
  season: number;
  test: boolean;
  status: 'running' | 'done' | 'aborted';
  tiers: number;
  size: number;
  perEvening: number;
  tableMoney: boolean;
  startedAt: string;
  endedAt: string | null;
  plan: LeaguePlan;
  matchdays?: number;
}

export interface LeagueView {
  season: number;
  enabled: boolean;
  seasons: number[];
  /** The website's day (test mode: the shifted clock). */
  today?: string;
  /** The website's time (test mode: the shifted clock). */
  now?: string;
  run: LeagueRunInfo | null;
  myClub?: (LeagueClubRef & { tier: number | null }) | null;
  tables?: { tier: number; rows: LeagueRow[]; final: boolean }[];
  matchdays?: number[];
  conference?: LeagueGame[];
  evening?: {
    day: string;
    slot: string;
    until: string;
    games: number;
    cups: { name: string; scheduledAt: string }[];
  };
  fixtures?: LeagueGame[];
  next?:
    (LeagueGame & { place: number | null; awayPlace: number | null; canPickMap: boolean }) | null;
  mapPool?: string[];
  rules?: { fragLimit: number; timeLimitMin: number; tableMoney: number[]; tierMult: number[] };
  final?: (LeagueClubRef & { place: number })[];
}

export interface LeagueHistorySeason {
  season: number;
  test: boolean;
  champion: { name: string; tag: string; manager: boolean; ai?: boolean } | null;
  tiers: {
    name: string;
    tag: string;
    manager: boolean;
    /** An AI manager's club (decision 250). */
    ai?: boolean;
    place: number | null;
    points: number;
    nextTier: number | null;
    finalPlace: number | null;
  }[][];
}

/** A league plan in short (the settings tab, decision 230). */
export interface LeaguePlanSummary {
  first: string;
  time: string;
  evenings: number;
  perEvening: number;
  last: string;
  relegation: string;
  final: string;
}

/** Where the league stands (settings tab, decision 230). */
export interface LeagueStatus {
  state: 'off' | 'waiting' | 'nextSeason' | 'running' | 'done';
  test: boolean;
  start: { season: number; day: string; plan: LeaguePlanSummary | null } | null;
  now: LeaguePlanSummary | null;
  progress: {
    evenings: number;
    eveningsTotal: number;
    matchdays: number;
    matchdaysTotal: number;
    next: { day: string; matchdays: number[] } | null;
    relegation: string;
    final: string;
    time: string;
    abortable: boolean;
  } | null;
  champion: string | null;
}

export interface LeagueAdmin {
  status: LeagueStatus;
  season: number | null;
  /** The website's day (test mode: the shifted clock). */
  today: string;
  daysLeft: number | null;
  run: LeagueRunInfo | null;
  /** The AI clubs' band per tier of the running league (decisions 251, 252). */
  band?: LeagueBandView[];
  fits: boolean | null;
  managers: number;
  estimate: { minutes: number; realPerMatchday: number };
  evenings: number;
  server: { agentId: string; profileId: string } | null;
  mapPool: string[];
}

/** A tier's band: AI clubs' traits per bot, the self-regulating factor, the humans' wins. */
export interface LeagueBandView {
  tier: number;
  traits: number;
  /** The self-regulating factor (× `settings`, the tier's factor of the settings). */
  factor: number;
  settings: number;
  /** Humans' wins in their last played games against AI clubs (null: none yet). */
  rate: number | null;
  games: number;
}

export interface LeagueEstimate {
  minutes: number;
  realPerMatchday: number;
  evenings: number;
  managers: number;
}

export interface UdtTradeBot {
  botId: string;
  name: string;
  skill: number;
}

export interface UdtTradeSide {
  userId: string;
  team: string;
  tag: string;
  manager: string;
}

export type UdtTradeStatus = 'open' | 'accepted' | 'declined' | 'withdrawn' | 'expired' | 'void';

export interface UdtTrade {
  id: string;
  incoming: boolean;
  from: UdtTradeSide;
  to: UdtTradeSide;
  give: UdtTradeBot[];
  take: UdtTradeBot[];
  giveNeuro: number;
  takeNeuro: number;
  giveValue: number;
  takeValue: number;
  feeFrom: number;
  feeTo: number;
  message: string | null;
  status: UdtTradeStatus;
  reason: string | null;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
}

export interface UdtTradeRules {
  feePct: number;
  balancePct: number;
  lockDays: number;
  expiryHours: number;
  pairPerWeek: number;
}

export interface UdtTrades {
  enabled: boolean;
  rules: UdtTradeRules;
  mine: UdtPartnerBot[];
  open: UdtTrade[];
  done: UdtTrade[];
}

export interface UdtPartnerBot {
  botId: string;
  name: string;
  gameName: string;
  skill: number;
  rarity: UdtRarity;
  traits: BotTraitsView;
  effective: { skill: number; traits: BotTraitsView; overflow: boolean };
  udtTraits: UdtTraitOnBot[];
  level: number;
  slots: number;
  stamina: number;
  value: number;
  starter: boolean;
  /** Made by its team (starter, talent, apprentice, blueprint): no salary, develops. */
  homemade?: boolean;
  blocked: 'nominated' | 'playing' | 'striking' | 'locked' | 'loan' | null;
  unlocksAt: string | null;
}

export interface UdtPartner {
  userId: string;
  name: string;
  tag: string;
  manager: string;
  ai?: boolean;
  roster: UdtPartnerBot[];
}

export interface UdtTradeOffer {
  to: string;
  give: string[];
  take: string[];
  giveNeuro: number;
  takeNeuro: number;
  message?: string;
}

export interface UdtTradePreview {
  giveValue: number;
  takeValue: number;
  feeFrom: number;
  feeTo: number;
  balancePct: number;
  feePct: number;
}

export interface UdtTalentReport {
  name: string;
  skill: number;
  /** A rough diamond with a hidden trait (decision 267). */
  anlage?: boolean;
  ranges: Record<'accuracy' | 'alertness' | 'strafing', [number, number]>;
  potential: [number, number];
}

export interface UdtMentor {
  botId: string;
  name: string;
  skill: number;
  level: number;
  /** Made by the team (any roster bot of level 3+ can be a mentor). */
  own?: boolean;
  mentorTrait: boolean;
  ready: boolean;
  used: boolean;
  /** Why it cannot teach now. */
  why?: 'used' | 'skill' | 'level' | null;
  /** Its apprentice of this season. */
  apprentice?: { botId: string; name: string; here: boolean } | null;
  /** The other roster bots and why they cannot learn from it. */
  notPupils?: { botId: string; why: 'bought' | 'mentored' | 'skill' | 'nominated' }[];
  /** Traits that can be passed on and the chance that one is. */
  traits: string[];
  inheritChance: number;
  /** Its signature passes on with 25 % instead of a trait (decision 273). */
  signature?: UdtSignature | null;
  /** Bots the team made that could learn from it: their values before and after. */
  pupils: UdtPupil[];
}

export interface UdtLessonValues {
  accuracy: number;
  alertness: number;
  strafing: number;
  combatStyle: number;
  camping: number;
}

export interface UdtPupil {
  botId: string;
  name: string;
  skill: number;
  level: number;
  before: UdtLessonValues;
  after: UdtLessonValues;
}

export interface UdtAcademy {
  hasTeam: boolean;
  tag: string;
  index: number;
  scoutPrice: number;
  /** talentPrice: a talent's licence, half the price (decision 267). */
  licence: { made: number; nextPrice: number | null; talentPrice?: number };
  rosterFull: boolean;
  /** The scouting office's level (0: none). */
  scoutLevel?: number;
  report: UdtTalentReport[] | null;
  mentors: UdtMentor[];
  own: UdtRosterBot[];
  developCost: Record<'accuracy' | 'alertness' | 'strafing' | 'skill', number>;
  mentorLevel: number;
  /** The whole roster (cards in the mentor panel). */
  roster?: UdtRosterBot[];
  /** Mentor and apprentice pairs of the season; `active`: both in the roster (XP bonus). */
  mentorships: {
    mentor: { botId: string; name: string; here: boolean };
    apprentice: { botId: string; name: string; here: boolean };
    active: boolean;
  }[];
  /** A mentor needs this skill (6). */
  mentorSkill?: number;
  /** XP factor of an apprentice while its mentor is in the roster (1.5). */
  apprenticeXp?: number;
  apprentice?: { botId: string; inherited: string | null; signature?: UdtSignature | null };
  blueprints: UdtBlueprint[];
  botClasses: AssetItem[];
  built?: { botId: string; startTrait: string | null };
}

export interface UdtGraduationBot {
  botId: string;
  name: string;
  origin: string;
  status: 'own' | 'nominated' | 'graduated' | 'rejected';
  games: number;
  level: number;
  ready: boolean;
  honours: boolean;
  /** In its first season as a keeper: no graduation yet. */
  keeper?: boolean;
}

export interface UdtGraduation {
  games: number;
  level: number;
  honours: number;
  perSeason: number;
  left: number;
  bots: UdtGraduationBot[];
}

export interface UdtYearbookEntry {
  botId: string;
  season: number;
  name: string;
  skill: number;
  traits: BotTraitsView;
  origin: string;
  status: 'own' | 'nominated' | 'graduated' | 'rejected';
  honours: boolean;
  /** Nominations: approvable once the bot's season is over. */
  approvable?: boolean;
  /** Null while the season runs and the bot is below level 5 (hidden like in the roster). */
  potential: number | null;
  games: number;
  xp: number;
  level: number;
  breeder: string;
  team: string;
  tag: string;
  active: boolean;
  /** Kept for that season (keeper). */
  keptTo?: number | null;
  /** Decision 279: the prestige stage it reached that season (stars when ascended). */
  stage?: { stage: 'mature' | 'godlike' | 'ascended' | 'settled'; stars: number } | null;
}

export interface UdtYearbook {
  season: number;
  seasons: number[];
  bots: UdtYearbookEntry[];
}

export interface UdtBreeder {
  userId: string;
  name: string;
  graduates: number;
  honours: number;
  bonus: number;
}

export interface UdtBlueprint {
  id: string;
  rarity: UdtRarity;
  rule: {
    budget: number;
    /** Points on top of a default starter. */
    extra: number;
    /** The skill every blueprint builds. */
    skill: number;
    /** The potential is drawn from this range when the bot is built. */
    potential: [number, number];
    models: boolean;
    startTrait: 'rare' | 'epic' | null;
  };
}

export type UdtCareerPhase = 'rookie' | 'rising' | 'peak' | 'veteran' | 'decline';

export interface UdtCareer {
  age: number;
  phase: UdtCareerPhase;
  level: number;
  games: number;
  wins: number;
  form: 'hot' | 'normal' | 'cold';
  from: number | null;
  to: number | null;
  retire: boolean;
}

export interface UdtHallEntry {
  botId: string;
  name: string;
  skill: number;
  traits: BotTraitsView;
  season: number | null;
  retiredAt: string;
  career: UdtCareer | null;
  homegrown: { breeder: string; honours: boolean } | null;
  /** Decision 279: the highest prestige stage of its seasons as an own bot. */
  stage?: { stage: 'mature' | 'godlike' | 'ascended' | 'settled'; stars: number } | null;
}

export interface UdtHall {
  retired: UdtHallEntry[];
  candidates: { botId: string; name: string; career: UdtCareer }[];
}

/** Look and chat lines of a manager's own bot (API body). */
export interface UdtBotLookBody {
  skin?: string;
  face?: string;
  voice?: string;
  personality?: { talk?: number; lines?: { kind: BotLineKind; text: string }[] };
}

export interface UdtSquadRow extends UdtTeam {
  manager: string;
  ai: boolean;
  mine: boolean;
  bots: number;
  value: number;
}

export interface UdtSquad {
  team: UdtTeam;
  manager: string;
  ai: boolean;
  roster: UdtRosterBot[];
}

/** A bot as Dream Team sees it (`GET /udt/bots/:id`). */
export interface UdtBotPage {
  bot: {
    id: string;
    name: string;
    gameName: string;
    skill: number;
    traits: BotTraitsView;
    active: boolean;
    /** Market value (null between seasons). */
    value: number | null;
  };
  team: {
    userId: string;
    name: string;
    tag: string;
    manager: string;
    ai: boolean;
    mine: boolean;
  } | null;
  roster: UdtRosterBot | null;
  /** A library bot's signature (decision 273). */
  signature?: UdtSignature | null;
  career: UdtCareer | null;
  made: { origin: string; season: number; status: string; breeder: string } | null;
  /** The running season (null between seasons: no team, no season row). */
  season: number | null;
  stats: StatsPlayerRow | null;
  lifetime: StatsPlayerRow | null;
  recent: StatsPlayerDetail['recent'];
  normalGames: number;
}

/** The textures a look puts on the model's skin slots (3D preview, decision 176). */
export interface LookPreview {
  stamp: string;
  /** Texture per skin slot ("Package.Name", '' none). */
  slots: string[];
  portrait: string | null;
  /** The skin has team colours. */
  teams: boolean;
}

/** The calendar (decision 231). */
export type CalendarKind =
  | 'seasonStart'
  | 'seasonEnd'
  | 'keepers'
  | 'tournament'
  | 'cup'
  | 'leagueEvening'
  | 'relegation'
  | 'finalFour'
  | 'payday';

export interface CalendarItem {
  id: string;
  kind: CalendarKind;
  day: string;
  at: string | null;
  until: string | null;
  title: string | null;
  state: 'projected' | 'planned' | 'open' | 'live' | 'done' | 'cancelled';
  mine: boolean;
  link: string | null;
  meta: Record<string, unknown>;
}

export interface CalendarView {
  timeZone: string;
  today: string;
  now: string;
  from: string;
  to: string;
  seasons: { number: number; startDate: string; endDate: string; status: string }[];
  udt: boolean;
  items: CalendarItem[];
}
