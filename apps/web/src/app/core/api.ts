import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  UdtEvent,
  UdtLedgerEntry,
  UdtMarket,
  UdtRosterBot,
  UdtBox,
  UdtPacks,
  UdtPull,
  UdtTableRow,
  UdtTestState,
  UdtView,
  AgentView,
  BetBoard,
  BetRecordView,
  BotAssets,
  BotClan,
  BotProfile,
  InvitePreview,
  LibraryBot,
  MatchDetailView,
  Me,
  MapRecord,
  PlayerRatings,
  PublicUser,
  RatedGame,
  RatingRow,
  Season,
  SeasonsOverview,
  SeriesFields,
  SeriesPreview,
  SeriesView,
  LookView,
  ShopView,
  ShopItem,
  ShopPurchaseView,
  ShopSettings,
  ShopDedication,
  KillFeedEntry,
  SiteConfig,
  StatMode,
  StatScope,
  StatsPlayerDetail,
  StatsPlayerRow,
  StatsRecord,
  TournamentDetail,
  TournamentEventView,
  TournamentBets,
  TournamentSummary,
  UserBets,
  WebsiteSettings,
} from './types';

/** Error with the server's message (Nest puts it into `message`). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);

  private async call<T>(method: string, url: string, body?: unknown): Promise<T> {
    try {
      return await firstValueFrom(
        this.http.request<T>(method, `/api${url}`, {
          body,
          headers: method === 'GET' ? {} : { 'x-tourney': '1' },
          withCredentials: true,
        }),
      );
    } catch (e) {
      if (e instanceof HttpErrorResponse) {
        const msg = e.error?.message;
        throw new ApiError(
          Array.isArray(msg) ? msg.join(', ') : (msg ?? e.statusText ?? 'request failed'),
          e.status,
        );
      }
      throw e;
    }
  }

  config = () => this.call<SiteConfig>('GET', '/config');
  me = () => this.call<Me>('GET', '/me');
  devLogin = (name: string, admin: boolean) =>
    this.call<Me>('POST', '/auth/dev-login', { name, admin });
  logout = () => this.call<void>('POST', '/auth/logout');
  updateMe = (displayName: string) => this.call<Me>('PATCH', '/me', { displayName });
  setNotifyDm = (notifyDm: boolean) => this.call<Me>('PATCH', '/me', { notifyDm });
  rotateToken = () => this.call<Me>('POST', '/me/token');

  users = () => this.call<PublicUser[]>('GET', '/users');
  setAdmin = (id: string, isAdmin: boolean) =>
    this.call<PublicUser>('PATCH', `/users/${id}`, { isAdmin });

  statsPlayers = (scope: StatScope, mode: StatMode | '', bots: boolean) =>
    this.call<StatsPlayerRow[]>(
      'GET',
      `/stats/players?season=${scope}&${mode ? `mode=${mode}&` : ''}bots=${bots ? 1 : 0}`,
    );
  statsPlayer = (key: string, scope: StatScope) =>
    this.call<StatsPlayerDetail>(
      'GET',
      `/stats/players/${encodeURIComponent(key)}?season=${scope}`,
    );
  statsRecords = (season: number, mode: StatMode | '') =>
    this.call<{ records: StatsRecord[]; maps: MapRecord[] }>(
      'GET',
      `/stats/records?season=${season}${mode ? `&mode=${mode}` : ''}`,
    );
  statsRatings = (season: number, mode: StatMode, bots: boolean) =>
    this.call<RatingRow[]>(
      'GET',
      `/stats/ratings?season=${season}&mode=${mode}&bots=${bots ? 1 : 0}`,
    );
  playerRatings = (key: string, season: number) =>
    this.call<PlayerRatings>(
      'GET',
      `/stats/players/${encodeURIComponent(key)}/ratings?season=${season}`,
    );
  matchDetail = (id: string, matchId: string) =>
    this.call<MatchDetailView>('GET', `/tournaments/${id}/matches/${encodeURIComponent(matchId)}`);
  tournamentRatings = (id: string) => this.call<RatedGame[]>('GET', `/tournaments/${id}/ratings`);
  settings = () => this.call<WebsiteSettings>('GET', '/settings');
  setRatingSettings = (body: Partial<WebsiteSettings['rating']>) =>
    this.call<WebsiteSettings>('PUT', '/settings/rating', body);
  setUdtSettings = (body: Partial<WebsiteSettings['udt']>) =>
    this.call<WebsiteSettings>('PUT', '/settings/udt', body);

  // --- Unreal Dream Team
  udt = () => this.call<UdtView>('GET', '/udt');
  udtCreateTeam = (body: unknown) => this.call<UdtView>('POST', '/udt/team', body);
  udtLineup = (body: {
    dm?: (string | null)[];
    mh?: (string | null)[];
    bench?: (string | null)[];
  }) => this.call<UdtRosterBot[]>('PUT', '/udt/lineup', body);
  udtMarket = () => this.call<UdtMarket>('GET', '/udt/market');
  udtBid = (botId: string, amount: number) =>
    this.call<UdtMarket>('POST', '/udt/market/bid', { botId, amount });
  udtWithdraw = (botId: string) =>
    this.call<UdtMarket>('DELETE', `/udt/market/bid/${encodeURIComponent(botId)}`);
  udtSell = (botId: string) =>
    this.call<UdtView>('POST', `/udt/roster/${encodeURIComponent(botId)}/sell`);
  udtEvents = () => this.call<UdtEvent[]>('GET', '/udt/events');
  udtEnter = (id: string) =>
    this.call<UdtEvent[]>('POST', `/udt/events/${encodeURIComponent(id)}/enter`);
  udtLeave = (id: string) =>
    this.call<UdtEvent[]>('DELETE', `/udt/events/${encodeURIComponent(id)}/enter`);
  udtPacks = () => this.call<UdtPacks>('GET', '/udt/packs');
  udtOpen = (box: UdtBox, ten: boolean) =>
    this.call<UdtPull>('POST', '/udt/packs/open', { box, ten });
  udtCraft = (code: string) => this.call<UdtPacks>('POST', '/udt/packs/craft', { code });
  udtAssign = (cardId: string, botId: string, weapon?: string) =>
    this.call<UdtView>('POST', `/udt/traits/${encodeURIComponent(cardId)}/assign`, {
      botId,
      ...(weapon ? { weapon } : {}),
    });
  udtUnassign = (cardId: string) =>
    this.call<UdtView>('DELETE', `/udt/traits/${encodeURIComponent(cardId)}/assign`);
  udtScrap = (cardId: string) =>
    this.call<UdtPacks>('DELETE', `/udt/traits/${encodeURIComponent(cardId)}`);
  udtTable = () => this.call<UdtTableRow[]>('GET', '/udt/table');
  udtLedger = () => this.call<UdtLedgerEntry[]>('GET', '/udt/ledger');
  udtTest = () => this.call<UdtTestState>('GET', '/udt/test');
  udtTestDo = (what: string, body?: unknown) =>
    this.call<unknown>('POST', `/udt/test/${what}`, body ?? {});

  setBotAiSettings = (body: Partial<WebsiteSettings['botAi']>) =>
    this.call<WebsiteSettings>('PUT', '/settings/bot-ai', body);
  setBettingSettings = (body: Partial<WebsiteSettings['betting']>) =>
    this.call<WebsiteSettings>('PUT', '/settings/betting', body);

  tournamentBets = (id: string) => this.call<TournamentBets>('GET', `/bets/tournaments/${id}`);
  placeBet = (id: string, matchId: string, pick: string, amount: number) =>
    this.call<TournamentBets>('PUT', `/bets/tournaments/${id}/${matchId}`, { pick, amount });
  withdrawBet = (id: string, matchId: string) =>
    this.call<TournamentBets>('DELETE', `/bets/tournaments/${id}/${matchId}`);
  betBoard = (season?: number) =>
    this.call<BetBoard>('GET', `/bets/leaderboard${season ? `?season=${season}` : ''}`);
  betRecords = (season?: number) =>
    this.call<{ season: number | null; records: BetRecordView[]; botRecords: BetRecordView[] }>(
      'GET',
      `/bets/records${season ? `?season=${season}` : ''}`,
    );
  botBets = (botId: string, season?: number) =>
    this.call<UserBets>(
      'GET',
      `/bets/bots/${encodeURIComponent(botId)}${season ? `?season=${season}` : ''}`,
    );
  userBets = (userId: string, season?: number) =>
    this.call<UserBets>(
      'GET',
      `/bets/users/${encodeURIComponent(userId)}${season ? `?season=${season}` : ''}`,
    );

  setTeamNames = (names: string[]) =>
    this.call<WebsiteSettings>('PUT', '/settings/team-names', { names });

  bots = () => this.call<{ bots: LibraryBot[]; clans: BotClan[] }>('GET', '/bots');
  botAssets = () => this.call<BotAssets>('GET', '/bots/assets');
  botProfile = (id: string) => this.call<BotProfile>('GET', `/bots/${encodeURIComponent(id)}`);
  createBot = (body: unknown) => this.call<LibraryBot>('POST', '/bots', body);
  updateBot = (id: string, body: unknown) => this.call<LibraryBot>('PATCH', `/bots/${id}`, body);
  deleteBot = (id: string) => this.call<void>('DELETE', `/bots/${id}`);
  randomBots = (body: { count: number; clanId?: string; skill?: number }) =>
    this.call<LibraryBot[]>('POST', '/bots-random', body);
  importBots = (agentId: string, profileId?: string) =>
    this.call<{ created: LibraryBot[]; skipped: string[] }>('POST', '/bots-import', {
      agentId,
      ...(profileId ? { profileId } : {}),
    });
  createClan = (body: unknown) => this.call<BotClan>('POST', '/bot-clans', body);
  updateClan = (id: string, body: unknown) => this.call<BotClan>('PATCH', `/bot-clans/${id}`, body);
  deleteClan = (id: string) => this.call<void>('DELETE', `/bot-clans/${id}`);

  /** Deletes all tournaments, statistics and seasons (the word RESET must be typed). */
  resetAll = (confirm: string) =>
    this.call<{ tournaments: number; seasons: number }>('POST', '/settings/reset', { confirm });
  seasons = () => this.call<SeasonsOverview>('GET', '/seasons');
  createSeason = (startDate: string, endDate: string) =>
    this.call<Season>('POST', '/seasons', { startDate, endDate });
  updateSeason = (n: number, body: { startDate?: string; endDate?: string }) =>
    this.call<Season>('PATCH', `/seasons/${n}`, body);
  endSeason = (n: number) => this.call<Season>('POST', `/seasons/${n}/end`);
  deleteSeason = (n: number) => this.call<void>('DELETE', `/seasons/${n}`);

  tournaments = () => this.call<TournamentSummary[]>('GET', '/tournaments');
  tournament = (id: string) => this.call<TournamentDetail>('GET', `/tournaments/${id}`);
  killFeed = (id: string) => this.call<KillFeedEntry[]>('GET', `/tournaments/${id}/feed`);
  looks = () => this.call<{ userId: string; name: string; look: LookView }[]>('GET', '/shop/looks');
  shop = () => this.call<ShopView>('GET', '/shop');
  buy = (item: string, dedication?: Pick<ShopDedication, 'kill' | 'death'>) =>
    this.call<ShopView>('POST', '/shop/buy', { item, ...(dedication ? { dedication } : {}) });
  wear = (slot: string, item: string | null) =>
    this.call<ShopView>('PUT', '/shop/look', { slot, item });
  setDedication = (d: Pick<ShopDedication, 'kill' | 'death'>) =>
    this.call<ShopView>('PUT', '/shop/dedication', d);
  shopAdmin = () =>
    this.call<{ catalog: ShopItem[]; log: ShopPurchaseView[] }>('GET', '/shop/admin');
  reviewDedication = (id: string, approve: boolean) =>
    this.call<ShopPurchaseView[]>('POST', `/shop/admin/dedications/${id}`, { approve });
  setShopSettings = (body: Partial<ShopSettings>) =>
    this.call<WebsiteSettings>('PUT', '/settings/shop', body);
  series = () => this.call<SeriesView[]>('GET', '/series');
  createSeries = (body: SeriesFields & { fromTournament?: string; template?: unknown }) =>
    this.call<SeriesView>('POST', '/series', body);
  updateSeries = (
    id: string,
    body: Partial<SeriesFields> & { active?: boolean; template?: unknown },
  ) => this.call<SeriesView>('PATCH', `/series/${id}`, body);
  previewSeries = (body: unknown) => this.call<SeriesPreview>('POST', '/series/preview', body);
  runSeries = (id: string) => this.call<SeriesView>('POST', `/series/${id}/run`);
  deleteSeries = (id: string) => this.call<void>('DELETE', `/series/${id}`);
  createTournament = (body: unknown) => this.call<TournamentDetail>('POST', '/tournaments', body);
  updateTournament = (id: string, body: unknown) =>
    this.call<TournamentDetail>('PATCH', `/tournaments/${id}`, body);
  deleteTournament = (id: string) => this.call<void>('DELETE', `/tournaments/${id}`);
  events = (id: string) => this.call<TournamentEventView[]>('GET', `/tournaments/${id}/events`);
  register = (id: string) => this.call<void>('POST', `/tournaments/${id}/registration`);
  unregister = (id: string) => this.call<void>('DELETE', `/tournaments/${id}/registration`);
  kick = (id: string, userId: string) =>
    this.call<void>('DELETE', `/tournaments/${id}/registrations/${userId}`);
  createTeam = (id: string, name: string, tag: string | null) =>
    this.call<TournamentDetail>('POST', `/tournaments/${id}/teams`, { name, tag });
  invitePreview = (id: string, code: string) =>
    this.call<InvitePreview>('GET', `/tournaments/${id}/teams/invite/${encodeURIComponent(code)}`);
  joinTeam = (id: string, code: string) =>
    this.call<TournamentDetail>('POST', `/tournaments/${id}/teams/join`, { code });
  updateTeam = (id: string, teamId: string, body: unknown) =>
    this.call<TournamentDetail>('PATCH', `/tournaments/${id}/teams/${teamId}`, body);
  deleteTeam = (id: string, teamId: string) =>
    this.call<void>('DELETE', `/tournaments/${id}/teams/${teamId}`);
  newInvite = (id: string, teamId: string) =>
    this.call<{ inviteCode: string }>('POST', `/tournaments/${id}/teams/${teamId}/invite`);
  setLineup = (id: string, teamId: string, starters: string[]) =>
    this.call<void>('PUT', `/tournaments/${id}/teams/${teamId}/lineup`, { starters });
  removeMember = (id: string, teamId: string, userId: string) =>
    this.call<void>('DELETE', `/tournaments/${id}/teams/${teamId}/members/${userId}`);
  moveMember = (id: string, userId: string, teamId: string | null, sub = false) =>
    this.call<void>('PUT', `/tournaments/${id}/registrations/${userId}`, { teamId, sub });
  buildTeams = (id: string) =>
    this.call<TournamentDetail>('POST', `/tournaments/${id}/teams/build`);
  watch = (id: string) => this.call<void>('POST', `/tournaments/${id}/watch`);
  unwatch = (id: string) => this.call<void>('DELETE', `/tournaments/${id}/watch`);
  seed = (id: string, body: unknown) =>
    this.call<TournamentDetail>('POST', `/tournaments/${id}/seed`, body);
  reset = (id: string) => this.call<TournamentDetail>('POST', `/tournaments/${id}/reset`);
  run = (id: string) => this.call<void>('POST', `/tournaments/${id}/run`);
  command = (id: string, body: unknown) =>
    this.call<void>('POST', `/tournaments/${id}/command`, body);
  override = (id: string, matchId: string, winnerId: string) =>
    this.call<void>('POST', `/tournaments/${id}/override`, { matchId, winnerId });

  agents = () => this.call<AgentView[]>('GET', '/agents');
  createAgent = (id: string, name: string) =>
    this.call<{ agent: AgentView; token: string }>('POST', '/agents', { id, name });
  rotateAgentToken = (id: string) => this.call<{ token: string }>('POST', `/agents/${id}/token`);
  deleteAgent = (id: string) => this.call<void>('DELETE', `/agents/${id}`);
  rescan = (id: string, profileId: string) =>
    this.call<void>('POST', `/agents/${id}/profiles/${profileId}/rescan`);
}
