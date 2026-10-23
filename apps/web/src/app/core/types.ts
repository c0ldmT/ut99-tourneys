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
  seasonal?: boolean;
  /** "udt": a Dream Team tournament. */
  kind?: string;
  /** Created by this series. */
  seriesId?: string | null;
  /** The match being played now (running tournaments). */
  now?: {
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
  };
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
  kind?: 'classic' | 'udt' | 'season';
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
  /** Dream Team: whether AI managers play (and how many). */
  signup?: { aiOn?: boolean; aiCount?: number };
  phase: Phase;
  headSeq: number;
  agentId: string;
  profileId: string;
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
  botAi: { level: number; skillCurve: boolean };
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

// --- Betting with Neuro (€) ----------------------------------------------------------------

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

export interface SeriesTemplate {
  agentId: string;
  profileId: string;
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
  kind?: 'kill' | 'chat' | 'item' | 'thought';
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
    /** Fully developed for good: points have nothing left to buy (no plaque). */
    maxed?: boolean;
  } | null;
  career?: UdtCareer | null;
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
  blueprints: { id: string; rarity: UdtRarity }[];
  weapons: AssetItem[];
  catalog: UdtCatalogTrait[];
}

export interface UdtPullCard {
  id: string | null;
  code: string;
  rarity: UdtRarity;
  duplicate: boolean;
  scrap: number;
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
  open: boolean;
  lineup: { bots: string[]; value: number; problems: string[] } | null;
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
  blocked: 'starter' | 'playing' | 'striking' | 'locked' | null;
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
  ranges: Record<'accuracy' | 'alertness' | 'strafing', [number, number]>;
  potential: [number, number];
}

export interface UdtMentor {
  botId: string;
  name: string;
  skill: number;
  level: number;
  mentorTrait: boolean;
  ready: boolean;
  used: boolean;
}

export interface UdtAcademy {
  hasTeam: boolean;
  tag: string;
  index: number;
  scoutPrice: number;
  licence: { made: number; nextPrice: number | null };
  rosterFull: boolean;
  report: UdtTalentReport[] | null;
  mentors: UdtMentor[];
  own: UdtRosterBot[];
  developCost: Record<'accuracy' | 'alertness' | 'strafing' | 'skill', number>;
  mentorLevel: number;
  apprentice?: { botId: string; inherited: string | null };
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
  /** Null while the season runs and the bot is below level 5 (hidden like in the roster). */
  potential: number | null;
  games: number;
  xp: number;
  level: number;
  breeder: string;
  team: string;
  tag: string;
  active: boolean;
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
