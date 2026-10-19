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
  botAi: { level: number };
  udt: UdtSettings;
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
}

export interface BotProfile extends LibraryBot {
  statsKey: string;
  labels: {
    botClass: string | null;
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
    amount: number;
    status: BetStatus;
    payout: number;
  }[];
  /** While open: the side of the strongest bot that bet. */
  expert: { botId: string; name: string; pick: string } | null;
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

/** One kill of the game in progress (kill feed, live only). */
export interface KillFeedEntry {
  tournamentId: string;
  matchId: string;
  game: number;
  at: number;
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
  category: 'values' | 'manager';
  needsWeapon: boolean;
}

export interface UdtCatalogTrait {
  code: string;
  rarity: UdtRarity;
  category: 'values' | 'manager';
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
  minPrice: number;
  value: number;
  history: { day: string; value: number }[];
  sold: boolean;
  myBid: number | null;
}

export interface UdtMarket {
  day: string | null;
  index: number;
  /** Next market day (epoch ms). */
  nextAt: number;
  offers: UdtOffer[];
  bids: { botId: string; amount: number; status: string }[];
}

export interface UdtEventRules {
  valueCap: number | null;
  starLimit: number | null;
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
  entries: number;
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
}
