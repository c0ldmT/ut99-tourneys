import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { I18n } from './i18n';
import { errorMessage, type ErrorBody } from './i18n-errors';
import { Loading } from './loading';
import type { NeuroWallet } from './neuro';
import { Toasts } from './toast';
import type { UdtLooks } from '../components/udt-bot-look';
import type {
  UdtBotLookBody,
  UdtTeam,
  UdtSquad,
  UdtSquadRow,
  UdtEvent,
  UdtLedgerEntry,
  UdtMarket,
  UdtRosterBot,
  UdtBox,
  UdtPacks,
  UdtPull,
  UdtTableRow,
  UdtCareer,
  UdtHall,
  UdtHallEntry,
  UdtAcademy,
  UdtBreeder,
  UdtGraduation,
  UdtYearbook,
  UdtYearbookEntry,
  UdtPartner,
  UdtTradeOffer,
  UdtTradePreview,
  UdtTrades,
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

/**
 * Error of an API call: `message` in English (as the server sent it), `text` translated into
 * the language of the page (see `errorMessage`), `key`/`params` the server's template.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly text: string = message,
    readonly key?: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(message);
  }
}

/** The translated text of an error (the toast shows it already for every failed call). */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.text;
  if (e instanceof Error) return e.message;
  return String(e);
}

export interface CallOptions<T> {
  /** i18n key of the success toast (actions). */
  ok?: string;
  /** Parameters of the success text (also from the answer). */
  okParams?: Record<string, string | number> | ((res: T) => Record<string, string | number>);
  /** No error toast (background loads, previews with their own display). */
  quiet?: boolean;
  /** A POST that changes nothing (previews): no Neuro reload. */
  read?: boolean;
  /** Decoration or a refresh the page does not wait for: no loading display. */
  background?: boolean;
}

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  private i18n = inject(I18n);
  private toasts = inject(Toasts);
  private loading = inject(Loading);
  /** Counts successful changes (POST/PUT/PATCH/DELETE): the Neuro store reloads on it. */
  readonly changes = signal(0);

  private async call<T>(
    method: string,
    url: string,
    body?: unknown,
    opts: CallOptions<T> = {},
  ): Promise<T> {
    let res: T;
    const done = this.loading.track({
      get: method === 'GET',
      background: !!(opts.read || opts.background) || this.loading.inBackground,
    });
    try {
      res = await firstValueFrom(
        this.http.request<T>(method, `/api${url}`, {
          body,
          headers: method === 'GET' ? {} : { 'x-tourney': '1' },
          withCredentials: true,
        }),
      );
    } catch (e) {
      const err = this.toApiError(e);
      if (!opts.quiet) this.toasts.error(err.text);
      throw err;
    } finally {
      done();
    }
    if (method !== 'GET' && !opts.read) this.changes.update((n) => n + 1);
    if (opts.ok) {
      const p = typeof opts.okParams === 'function' ? opts.okParams(res) : opts.okParams;
      this.toasts.success(this.i18n.t(opts.ok, p));
    }
    return res;
  }

  private toApiError(e: unknown): ApiError {
    if (e instanceof HttpErrorResponse) {
      const b = (e.error && typeof e.error === 'object' ? e.error : {}) as ErrorBody;
      const msg = Array.isArray(b.message) ? b.message.join(', ') : b.message;
      const message = msg ?? e.statusText ?? 'request failed';
      const text = errorMessage(this.i18n.lang(), {
        status: e.status,
        message,
        key: b.key,
        params: b.params,
      });
      return new ApiError(message, e.status, text, b.key, b.params);
    }
    if (e instanceof Error) return new ApiError(e.message, 0, this.i18n.t('err.unknown'));
    return new ApiError(String(e), 0, this.i18n.t('err.unknown'));
  }

  config = () => this.call<SiteConfig>('GET', '/config', undefined, { quiet: true });
  me = () => this.call<Me>('GET', '/me', undefined, { quiet: true });
  myNeuro = () =>
    this.call<NeuroWallet>('GET', '/me/neuro', undefined, { quiet: true, background: true });
  devLogin = (name: string, admin: boolean) =>
    this.call<Me>('POST', '/auth/dev-login', { name, admin });
  logout = () => this.call<void>('POST', '/auth/logout');
  updateMe = (displayName: string) =>
    this.call<Me>('PATCH', '/me', { displayName }, { ok: 'ok.profile' });
  setNotifyDm = (notifyDm: boolean) =>
    this.call<Me>('PATCH', '/me', { notifyDm }, { ok: 'ok.saved' });
  rotateToken = () => this.call<Me>('POST', '/me/token', undefined, { ok: 'ok.token' });

  users = () => this.call<PublicUser[]>('GET', '/users');
  setAdmin = (id: string, isAdmin: boolean) =>
    this.call<PublicUser>('PATCH', `/users/${id}`, { isAdmin }, { ok: 'ok.saved' });

  statsPlayers = (scope: StatScope, mode: StatMode | '', bots: boolean) =>
    this.call<StatsPlayerRow[]>(
      'GET',
      `/stats/players?season=${scope}&${mode ? `mode=${mode}&` : ''}bots=${bots ? 1 : 0}`,
    );
  statsPlayer = (key: string, scope: StatScope, quiet = false) =>
    this.call<StatsPlayerDetail>(
      'GET',
      `/stats/players/${encodeURIComponent(key)}?season=${scope}`,
      undefined,
      { quiet },
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
  playerRatings = (key: string, season: number, quiet = false) =>
    this.call<PlayerRatings>(
      'GET',
      `/stats/players/${encodeURIComponent(key)}/ratings?season=${season}`,
      undefined,
      { quiet },
    );
  matchDetail = (id: string, matchId: string) =>
    this.call<MatchDetailView>('GET', `/tournaments/${id}/matches/${encodeURIComponent(matchId)}`);
  tournamentRatings = (id: string) => this.call<RatedGame[]>('GET', `/tournaments/${id}/ratings`);
  settings = () => this.call<WebsiteSettings>('GET', '/settings');
  setRatingSettings = (body: Partial<WebsiteSettings['rating']>) =>
    this.call<WebsiteSettings>('PUT', '/settings/rating', body, { ok: 'ok.settings' });
  setUdtSettings = (body: Partial<WebsiteSettings['udt']>) =>
    this.call<WebsiteSettings>('PUT', '/settings/udt', body, { ok: 'ok.settings' });

  // --- Unreal Dream Team
  udt = () => this.call<UdtView>('GET', '/udt');
  udtCreateTeam = (body: unknown) =>
    this.call<UdtView>('POST', '/udt/team', body, { ok: 'ok.udt.team' });
  udtLineup = (body: {
    dm?: (string | null)[];
    mh?: (string | null)[];
    bench?: (string | null)[];
  }) => this.call<UdtRosterBot[]>('PUT', '/udt/lineup', body);
  udtMarket = () => this.call<UdtMarket>('GET', '/udt/market');
  udtBuy = (botId: string) =>
    this.call<UdtMarket>('POST', '/udt/market/buy', { botId }, { ok: 'ok.udt.bought' });
  udtSell = (botId: string) =>
    this.call<UdtView>('POST', `/udt/roster/${encodeURIComponent(botId)}/sell`, undefined, {
      ok: 'ok.udt.sold',
    });
  udtEvents = () => this.call<UdtEvent[]>('GET', '/udt/events');
  udtEnter = (id: string) =>
    this.call<UdtEvent[]>('POST', `/udt/events/${encodeURIComponent(id)}/enter`, undefined, {
      ok: 'ok.udt.entered',
    });
  udtLeave = (id: string) =>
    this.call<UdtEvent[]>('DELETE', `/udt/events/${encodeURIComponent(id)}/enter`, undefined, {
      ok: 'ok.udt.left',
    });
  udtPacks = () => this.call<UdtPacks>('GET', '/udt/packs');
  udtOpen = (box: UdtBox, ten: boolean) =>
    this.call<UdtPull>('POST', '/udt/packs/open', { box, ten });
  udtCraft = (code: string) =>
    this.call<UdtPacks>('POST', '/udt/packs/craft', { code }, { ok: 'ok.udt.crafted' });
  udtAssign = (cardId: string, botId: string, weapon?: string) =>
    this.call<UdtView>(
      'POST',
      `/udt/traits/${encodeURIComponent(cardId)}/assign`,
      {
        botId,
        ...(weapon ? { weapon } : {}),
      },
      { ok: 'ok.udt.traitOn' },
    );
  udtUnassign = (cardId: string) =>
    this.call<UdtView>('DELETE', `/udt/traits/${encodeURIComponent(cardId)}/assign`, undefined, {
      ok: 'ok.udt.traitOff',
    });
  udtScrap = (cardId: string) =>
    this.call<UdtPacks>('DELETE', `/udt/traits/${encodeURIComponent(cardId)}`, undefined, {
      ok: 'ok.udt.scrapped',
    });
  udtTrades = (quiet = false) => this.call<UdtTrades>('GET', '/udt/trades', undefined, { quiet });
  udtPartners = () => this.call<UdtPartner[]>('GET', '/udt/trades/partners');
  udtTradePreview = (body: UdtTradeOffer) =>
    this.call<UdtTradePreview>('POST', '/udt/trades/preview', body, { quiet: true, read: true });
  udtPropose = (body: UdtTradeOffer) =>
    this.call<UdtTrades>('POST', '/udt/trades', body, { ok: 'ok.udt.tradeSent' });
  udtAccept = (id: string) =>
    this.call<UdtTrades>('POST', `/udt/trades/${encodeURIComponent(id)}/accept`, undefined, {
      ok: 'ok.udt.tradeAccepted',
    });
  udtDecline = (id: string) =>
    this.call<UdtTrades>('POST', `/udt/trades/${encodeURIComponent(id)}/decline`, undefined, {
      ok: 'ok.udt.tradeDeclined',
    });
  udtWithdrawTrade = (id: string) =>
    this.call<UdtTrades>('DELETE', `/udt/trades/${encodeURIComponent(id)}`, undefined, {
      ok: 'ok.udt.tradeWithdrawn',
    });
  udtAcademy = () => this.call<UdtAcademy>('GET', '/udt/academy');
  udtScout = () =>
    this.call<UdtAcademy>('POST', '/udt/academy/scout', undefined, { ok: 'ok.udt.scouted' });
  udtSign = (pick: number, name: string) =>
    this.call<UdtAcademy>('POST', '/udt/academy/sign', { pick, name }, { ok: 'ok.udt.signed' });
  udtApprentice = (mentorId: string, name: string) =>
    this.call<UdtAcademy>(
      'POST',
      '/udt/academy/mentor',
      { mentorId, name },
      { ok: 'ok.udt.apprentice' },
    );
  udtBuild = (body: {
    blueprintId: string;
    name: string;
    skill: number;
    traits: { accuracy: number; alertness: number; strafing: number };
    botClass?: string;
    look?: UdtBotLookBody;
  }) => this.call<UdtAcademy>('POST', '/udt/academy/build', body, { ok: 'ok.udt.built' });
  udtLooks = () => this.call<UdtLooks>('GET', '/udt/looks');
  udtAutoEnter = (on: boolean) =>
    this.call<{ team: UdtTeam; entered: number; events: UdtEvent[] }>(
      'PUT',
      '/udt/auto-enter',
      { on },
      { ok: on ? 'ok.udt.autoOn' : 'ok.udt.autoOff', okParams: (r) => ({ n: r.entered }) },
    );
  udtRest = (botId: string, points: number) =>
    this.call<UdtView>(
      'POST',
      `/udt/roster/${encodeURIComponent(botId)}/rest`,
      { points },
      { ok: 'ok.udt.rested' },
    );
  udtEditBot = (botId: string, body: UdtBotLookBody) =>
    this.call<LibraryBot>('PUT', `/udt/bots/${encodeURIComponent(botId)}`, body, {
      ok: 'ok.udt.botSaved',
    });
  udtRenameBot = (botId: string, name: string) =>
    this.call<LibraryBot>(
      'POST',
      `/udt/bots/${encodeURIComponent(botId)}/rename`,
      { name },
      { ok: 'ok.udt.renamed', okParams: { name } },
    );
  udtSquads = () => this.call<UdtSquadRow[]>('GET', '/udt/squads');
  udtSquad = (userId: string) =>
    this.call<UdtSquad>('GET', `/udt/teams/${encodeURIComponent(userId)}`);
  udtDevelop = (botId: string, stat: 'accuracy' | 'alertness' | 'strafing' | 'skill') =>
    this.call<UdtView>(
      'POST',
      `/udt/roster/${encodeURIComponent(botId)}/develop`,
      { stat },
      { ok: 'ok.udt.developed' },
    );
  udtGraduation = () => this.call<UdtGraduation>('GET', '/udt/graduation');
  udtNominate = (botId: string) =>
    this.call<UdtGraduation>('POST', `/udt/graduation/${encodeURIComponent(botId)}`, undefined, {
      ok: 'ok.udt.nominated',
    });
  udtUnnominate = (botId: string) =>
    this.call<UdtGraduation>('DELETE', `/udt/graduation/${encodeURIComponent(botId)}`, undefined, {
      ok: 'ok.udt.unnominated',
    });
  udtNominations = () => this.call<UdtYearbookEntry[]>('GET', '/udt/nominations');
  udtApprove = (botId: string, name?: string) =>
    this.call<UdtYearbookEntry[]>(
      'POST',
      `/udt/nominations/${encodeURIComponent(botId)}/approve`,
      name ? { name } : {},
      { ok: 'ok.udt.approved' },
    );
  udtReject = (botId: string) =>
    this.call<UdtYearbookEntry[]>(
      'POST',
      `/udt/nominations/${encodeURIComponent(botId)}/reject`,
      undefined,
      { ok: 'ok.udt.rejected' },
    );
  udtYearbook = (season?: number) =>
    this.call<UdtYearbook>('GET', `/udt/yearbook${season ? `?season=${season}` : ''}`);
  udtBreeders = () => this.call<UdtBreeder[]>('GET', '/udt/breeders');
  udtCareer = (botId: string, quiet = false) =>
    this.call<UdtCareer | null>('GET', `/udt/career/${encodeURIComponent(botId)}`, undefined, {
      quiet,
    });
  udtHall = () => this.call<UdtHall>('GET', '/udt/hall');
  udtRetire = (botId: string) =>
    this.call<UdtHallEntry[]>(
      'POST',
      `/udt/career/${encodeURIComponent(botId)}/retire`,
      undefined,
      { ok: 'ok.udt.retired' },
    );
  udtTable = () => this.call<UdtTableRow[]>('GET', '/udt/table');
  udtLedger = () => this.call<UdtLedgerEntry[]>('GET', '/udt/ledger');
  udtTest = (quiet = false) => this.call<UdtTestState>('GET', '/udt/test', undefined, { quiet });
  udtTestDo = (what: string, body?: unknown) =>
    this.call<unknown>('POST', `/udt/test/${what}`, body ?? {});

  setBotAiSettings = (body: Partial<WebsiteSettings['botAi']>) =>
    this.call<WebsiteSettings>('PUT', '/settings/bot-ai', body, { ok: 'ok.settings' });
  setBettingSettings = (body: Partial<WebsiteSettings['betting']>) =>
    this.call<WebsiteSettings>('PUT', '/settings/betting', body, { ok: 'ok.settings' });

  tournamentBets = (id: string, quiet = false) =>
    this.call<TournamentBets>('GET', `/bets/tournaments/${id}`, undefined, { quiet });
  placeBet = (id: string, matchId: string, pick: string, amount: number) =>
    this.call<TournamentBets>(
      'PUT',
      `/bets/tournaments/${id}/${matchId}`,
      { pick, amount },
      { ok: 'ok.bet.placed' },
    );
  withdrawBet = (id: string, matchId: string) =>
    this.call<TournamentBets>('DELETE', `/bets/tournaments/${id}/${matchId}`, undefined, {
      ok: 'ok.bet.withdrawn',
    });
  betBoard = (season?: number) =>
    this.call<BetBoard>('GET', `/bets/leaderboard${season ? `?season=${season}` : ''}`);
  betRecords = (season?: number) =>
    this.call<{ season: number | null; records: BetRecordView[]; botRecords: BetRecordView[] }>(
      'GET',
      `/bets/records${season ? `?season=${season}` : ''}`,
    );
  botBets = (botId: string, season?: number, quiet = false) =>
    this.call<UserBets>(
      'GET',
      `/bets/bots/${encodeURIComponent(botId)}${season ? `?season=${season}` : ''}`,
      undefined,
      { quiet },
    );
  userBets = (userId: string, season?: number, quiet = false) =>
    this.call<UserBets>(
      'GET',
      `/bets/users/${encodeURIComponent(userId)}${season ? `?season=${season}` : ''}`,
      undefined,
      { quiet },
    );

  setTeamNames = (names: string[]) =>
    this.call<WebsiteSettings>('PUT', '/settings/team-names', { names }, { ok: 'ok.settings' });

  bots = () => this.call<{ bots: LibraryBot[]; clans: BotClan[] }>('GET', '/bots');
  botAssets = () => this.call<BotAssets>('GET', '/bots/assets');
  botProfile = (id: string, quiet = false) =>
    this.call<BotProfile>('GET', `/bots/${encodeURIComponent(id)}`, undefined, { quiet });
  createBot = (body: unknown) =>
    this.call<LibraryBot>('POST', '/bots', body, { ok: 'ok.bot.created' });
  updateBot = (id: string, body: unknown) =>
    this.call<LibraryBot>('PATCH', `/bots/${id}`, body, { ok: 'ok.saved' });
  deleteBot = (id: string) =>
    this.call<void>('DELETE', `/bots/${id}`, undefined, { ok: 'ok.bot.deleted' });
  randomBots = (body: { count: number; clanId?: string; skill?: number }) =>
    this.call<LibraryBot[]>('POST', '/bots-random', body, {
      ok: 'ok.bot.random',
      okParams: (r) => ({ n: r.length }),
    });
  importBots = (agentId: string, profileId?: string) =>
    this.call<{ created: LibraryBot[]; skipped: string[] }>(
      'POST',
      '/bots-import',
      {
        agentId,
        ...(profileId ? { profileId } : {}),
      },
      { ok: 'ok.bot.imported', okParams: (r) => ({ n: r.created.length }) },
    );
  createClan = (body: unknown) =>
    this.call<BotClan>('POST', '/bot-clans', body, { ok: 'ok.clan.created' });
  updateClan = (id: string, body: unknown) =>
    this.call<BotClan>('PATCH', `/bot-clans/${id}`, body, { ok: 'ok.saved' });
  deleteClan = (id: string) =>
    this.call<void>('DELETE', `/bot-clans/${id}`, undefined, { ok: 'ok.clan.deleted' });

  /** Deletes all tournaments, statistics and seasons (the word RESET must be typed). */
  resetAll = (confirm: string) =>
    this.call<{ tournaments: number; seasons: number }>(
      'POST',
      '/settings/reset',
      { confirm },
      { ok: 'ok.reset' },
    );
  seasons = () => this.call<SeasonsOverview>('GET', '/seasons');
  createSeason = (startDate: string, endDate: string) =>
    this.call<Season>('POST', '/seasons', { startDate, endDate }, { ok: 'ok.season.created' });
  updateSeason = (n: number, body: { startDate?: string; endDate?: string }) =>
    this.call<Season>('PATCH', `/seasons/${n}`, body, { ok: 'ok.saved' });
  endSeason = (n: number) =>
    this.call<Season>('POST', `/seasons/${n}/end`, undefined, { ok: 'ok.season.ended' });
  deleteSeason = (n: number) =>
    this.call<void>('DELETE', `/seasons/${n}`, undefined, { ok: 'ok.season.deleted' });

  tournaments = () => this.call<TournamentSummary[]>('GET', '/tournaments');
  tournament = (id: string) => this.call<TournamentDetail>('GET', `/tournaments/${id}`);
  killFeed = (id: string) => this.call<KillFeedEntry[]>('GET', `/tournaments/${id}/feed`);
  /** Decoration only (names in the looks of their owners): never an error toast. */
  looks = () =>
    this.call<{ userId: string; name: string; look: LookView }[]>('GET', '/shop/looks', undefined, {
      quiet: true,
      background: true,
    });
  shop = () => this.call<ShopView>('GET', '/shop');
  buy = (item: string, dedication?: Pick<ShopDedication, 'kill' | 'death'>) =>
    this.call<ShopView>(
      'POST',
      '/shop/buy',
      { item, ...(dedication ? { dedication } : {}) },
      { ok: 'ok.shop.bought' },
    );
  wear = (slot: string, item: string | null) =>
    this.call<ShopView>('PUT', '/shop/look', { slot, item }, { ok: 'ok.shop.look' });
  setDedication = (d: Pick<ShopDedication, 'kill' | 'death'>) =>
    this.call<ShopView>('PUT', '/shop/dedication', d, { ok: 'ok.saved' });
  shopAdmin = () =>
    this.call<{ catalog: ShopItem[]; log: ShopPurchaseView[] }>('GET', '/shop/admin');
  reviewDedication = (id: string, approve: boolean) =>
    this.call<ShopPurchaseView[]>(
      'POST',
      `/shop/admin/dedications/${id}`,
      { approve },
      { ok: approve ? 'ok.shop.approved' : 'ok.shop.rejected' },
    );
  setShopSettings = (body: Partial<ShopSettings>) =>
    this.call<WebsiteSettings>('PUT', '/settings/shop', body, { ok: 'ok.settings' });
  series = () => this.call<SeriesView[]>('GET', '/series');
  createSeries = (body: SeriesFields & { fromTournament?: string; template?: unknown }) =>
    this.call<SeriesView>('POST', '/series', body, { ok: 'ok.series.created' });
  updateSeries = (
    id: string,
    body: Partial<SeriesFields> & { active?: boolean; template?: unknown },
  ) => this.call<SeriesView>('PATCH', `/series/${id}`, body, { ok: 'ok.saved' });
  previewSeries = (body: unknown) =>
    this.call<SeriesPreview>('POST', '/series/preview', body, { quiet: true, read: true });
  runSeries = (id: string) =>
    this.call<SeriesView>('POST', `/series/${id}/run`, undefined, { ok: 'ok.series.run' });
  deleteSeries = (id: string) =>
    this.call<void>('DELETE', `/series/${id}`, undefined, { ok: 'ok.series.deleted' });
  createTournament = (body: unknown) =>
    this.call<TournamentDetail>('POST', '/tournaments', body, { ok: 'ok.tournament.created' });
  updateTournament = (id: string, body: unknown) =>
    this.call<TournamentDetail>('PATCH', `/tournaments/${id}`, body, { ok: 'ok.saved' });
  deleteTournament = (id: string) =>
    this.call<void>('DELETE', `/tournaments/${id}`, undefined, { ok: 'ok.tournament.deleted' });
  events = (id: string) => this.call<TournamentEventView[]>('GET', `/tournaments/${id}/events`);
  register = (id: string) =>
    this.call<void>('POST', `/tournaments/${id}/registration`, undefined, { ok: 'ok.registered' });
  unregister = (id: string) =>
    this.call<void>('DELETE', `/tournaments/${id}/registration`, undefined, {
      ok: 'ok.unregistered',
    });
  kick = (id: string, userId: string) =>
    this.call<void>('DELETE', `/tournaments/${id}/registrations/${userId}`, undefined, {
      ok: 'ok.kicked',
    });
  createTeam = (id: string, name: string, tag: string | null) =>
    this.call<TournamentDetail>(
      'POST',
      `/tournaments/${id}/teams`,
      { name, tag },
      { ok: 'ok.team.created' },
    );
  invitePreview = (id: string, code: string) =>
    this.call<InvitePreview>('GET', `/tournaments/${id}/teams/invite/${encodeURIComponent(code)}`);
  joinTeam = (id: string, code: string) =>
    this.call<TournamentDetail>(
      'POST',
      `/tournaments/${id}/teams/join`,
      { code },
      { ok: 'ok.team.joined' },
    );
  updateTeam = (id: string, teamId: string, body: unknown) =>
    this.call<TournamentDetail>('PATCH', `/tournaments/${id}/teams/${teamId}`, body, {
      ok: 'ok.saved',
    });
  deleteTeam = (id: string, teamId: string) =>
    this.call<void>('DELETE', `/tournaments/${id}/teams/${teamId}`, undefined, {
      ok: 'ok.team.deleted',
    });
  newInvite = (id: string, teamId: string) =>
    this.call<{ inviteCode: string }>(
      'POST',
      `/tournaments/${id}/teams/${teamId}/invite`,
      undefined,
      { ok: 'ok.team.invite' },
    );
  setLineup = (id: string, teamId: string, starters: string[]) =>
    this.call<void>(
      'PUT',
      `/tournaments/${id}/teams/${teamId}/lineup`,
      { starters },
      { ok: 'ok.team.lineup' },
    );
  removeMember = (id: string, teamId: string, userId: string) =>
    this.call<void>('DELETE', `/tournaments/${id}/teams/${teamId}/members/${userId}`, undefined, {
      ok: 'ok.team.removed',
    });
  moveMember = (id: string, userId: string, teamId: string | null, sub = false) =>
    this.call<void>(
      'PUT',
      `/tournaments/${id}/registrations/${userId}`,
      { teamId, sub },
      { ok: 'ok.moved' },
    );
  buildTeams = (id: string) =>
    this.call<TournamentDetail>('POST', `/tournaments/${id}/teams/build`, undefined, {
      ok: 'ok.team.built',
    });
  watch = (id: string) =>
    this.call<void>('POST', `/tournaments/${id}/watch`, undefined, { ok: 'ok.watch.on' });
  unwatch = (id: string) =>
    this.call<void>('DELETE', `/tournaments/${id}/watch`, undefined, { ok: 'ok.watch.off' });
  seed = (id: string, body: unknown) =>
    this.call<TournamentDetail>('POST', `/tournaments/${id}/seed`, body, { ok: 'ok.seeded' });
  reset = (id: string) =>
    this.call<TournamentDetail>('POST', `/tournaments/${id}/reset`, undefined, {
      ok: 'ok.seedReset',
    });
  run = (id: string) =>
    this.call<void>('POST', `/tournaments/${id}/run`, undefined, { ok: 'ok.run' });
  command = (id: string, body: unknown) =>
    this.call<void>('POST', `/tournaments/${id}/command`, body, { ok: 'ok.command' });
  override = (id: string, matchId: string, winnerId: string) =>
    this.call<void>(
      'POST',
      `/tournaments/${id}/override`,
      { matchId, winnerId },
      { ok: 'ok.override' },
    );

  agents = () => this.call<AgentView[]>('GET', '/agents');
  createAgent = (id: string, name: string) =>
    this.call<{ agent: AgentView; token: string }>(
      'POST',
      '/agents',
      { id, name },
      { ok: 'ok.agent.created' },
    );
  rotateAgentToken = (id: string) =>
    this.call<{ token: string }>('POST', `/agents/${id}/token`, undefined, { ok: 'ok.token' });
  deleteAgent = (id: string) =>
    this.call<void>('DELETE', `/agents/${id}`, undefined, { ok: 'ok.agent.deleted' });
  rescan = (id: string, profileId: string) =>
    this.call<void>('POST', `/agents/${id}/profiles/${profileId}/rescan`, undefined, {
      ok: 'ok.rescan',
    });
}
