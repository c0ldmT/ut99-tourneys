import { SeasonsService } from '../seasons/seasons.service.js';
import { StatsService } from '../stats/stats.service.js';
import { traitReport } from '../stats/trait-report.js';
import { udtEntrantId } from '@tourney/protocol';
import { z } from 'zod';
import {
  CLUB_UPGRADES,
  CREST_COLORS,
  CREST_SHAPES,
  PRESTIGE_STATS,
  type ClubUpgrade,
  type Crest,
  type PrestigeStat,
} from '@tourney/udt';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { AdminOnly, CurrentUser } from '../auth/guard.js';
import { UsersService, type User } from '../auth/users.service.js';
import { notFound, ZodPipe } from '../common/http.js';
import { UdtEventsService } from './udt-events.service.js';
import { UdtRewardsService } from './udt-rewards.service.js';
import { ApproveBody, UdtCareerService } from './udt-career.service.js';
import { KeepersBody, UdtKeepersService } from './udt-keepers.service.js';
import {
  aiClubEntrantId,
  EstimateQuery,
  FitQuery,
  TestLeagueBody,
  UdtLeagueService,
  type TestLeagueInput,
} from './udt-league.service.js';
import { UdtAiService } from './udt-ai.service.js';
import {
  BuildBody,
  DevelopBody,
  MentorBody,
  SignBody,
  UdtAcademyService,
  type BuildInput,
  BotName,
} from './udt-academy.service.js';
import { TradeBody, UdtTradesService, type TradeInput } from './udt-trades.service.js';
import {
  ChallengeBody,
  CounterBody,
  OpponentsQuery,
  RematchBody,
  SlotsQuery,
  UdtChallengesService,
  type ChallengeInput,
  type RematchInput,
  type SlotsInput,
} from './udt-challenges.service.js';
import {
  AssignBody,
  CraftBody,
  OpenBody,
  UdtPacksService,
  WorkshopBody,
  type AssignInput,
  type OpenInput,
} from './udt-packs.service.js';
import { BuyBody, UdtMarketService, type BuyInput } from './udt-market.service.js';
import { ModerationService } from '../moderation/moderation.service.js';
import {
  BotLookBody,
  LineupBody,
  TeamBody,
  UdtService,
  type BotLook,
  type LineupInput,
  type TeamInput,
} from './udt.service.js';

/** Unreal Dream Team: a manager's team, roster and lineups. */
@Controller('udt')
export class UdtController {
  constructor(
    @Inject(UdtService) private readonly udt: UdtService,
    @Inject(UdtMarketService) private readonly market: UdtMarketService,
    @Inject(UdtEventsService) private readonly events: UdtEventsService,
    @Inject(UdtRewardsService) private readonly rewards: UdtRewardsService,
    @Inject(UdtPacksService) private readonly packs: UdtPacksService,
    @Inject(UdtTradesService) private readonly trades: UdtTradesService,
    @Inject(UdtChallengesService) private readonly challenges: UdtChallengesService,
    @Inject(UdtAcademyService) private readonly academy: UdtAcademyService,
    @Inject(UdtCareerService) private readonly career: UdtCareerService,
    @Inject(UdtAiService) private readonly ai: UdtAiService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(UdtKeepersService) private readonly keepers: UdtKeepersService,
    @Inject(UdtLeagueService) private readonly league: UdtLeagueService,
    @Inject(ModerationService) private readonly moderation: ModerationService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(StatsService) private readonly stats: StatsService,
  ) {}

  @Get()
  view(@CurrentUser() user: User) {
    const v = this.udt.view(user);
    // Offers waiting for the manager (badge on "Trades").
    const tradesIn = v.team && v.season !== null ? this.trades.incoming(user.id) : 0;
    const careers = v.roster.length ? this.career.careers() : new Map();
    return {
      ...v,
      roster: v.roster.map((r) => ({ ...r, career: careers.get(r.botId) ?? null })),
      tradesIn,
      /** Hidden traits that came free since the last look (decision 268): told once. */
      anlagen: v.team && v.season !== null ? this.udt.takeAnlageNews(v.season, user.id) : [],
    };
  }

  /**
   * The Dream Team hub (decision 228): a short state per area for its segments - my team, the
   * league, packs, cups, transfers. Between seasons only what is known without one.
   */
  @Get('hub')
  hub(@CurrentUser() user: User) {
    this.udt.assertOn();
    const season = this.seasons.current();
    const n = season?.number ?? null;
    return {
      season: n,
      today: this.udt.today(),
      now: this.udt.nowIso(),
      team: n !== null ? this.udt.hubTeam(user.id, n) : null,
      onboarding: n !== null ? this.udt.hubOnboarding(user.id, n) : null,
      league: this.league.hubLeague(user.id),
      packs: n !== null ? this.packs.hubPacks(user.id, n) : null,
      cups: n !== null ? this.events.hubCups(user.id, n) : null,
      transfers: {
        tradesIn: n !== null ? this.trades.incoming(user.id) : 0,
        marketAt: n !== null ? new Date(this.market.nextAt()).toISOString() : null,
      },
      /** Challenges waiting for the manager's answer (decision 334). */
      challengesIn: n !== null ? this.challenges.incoming(user.id) : 0,
      /** The challenges area (decision 337): answers waiting, open ones, the next booked. */
      challenges: n !== null ? this.challenges.hub(user.id) : null,
    };
  }

  /** All teams of the running season. */
  @Get('teams')
  teams() {
    this.udt.assertOn();
    return this.udt.teams(this.udt.season().number);
  }

  /** The squads of the season: every human team (AI teams while they play), bots and value. */
  @Get('squads')
  squads(@CurrentUser() user: User) {
    this.udt.assertOn();
    const season = this.udt.season().number;
    const ai = this.udt.aiIds();
    const aiOn = this.udt.aiOn();
    return this.udt
      .teams(season)
      .filter((t) => aiOn || !ai.has(t.userId))
      .map((t) => {
        const roster = this.udt.roster(t.userId, season);
        return {
          ...t,
          manager: this.users.byId(t.userId)?.displayName ?? '?',
          ai: ai.has(t.userId),
          mine: t.userId === user.id,
          bots: roster.length,
          value: roster.reduce((n, r) => n + r.value, 0),
        };
      })
      .sort((a, b) => Number(a.ai) - Number(b.ai) || b.value - a.value);
  }

  /** A manager's squad to look at (everybody can see every team). */
  @Get('teams/:userId')
  squad(@Param('userId') userId: string) {
    this.udt.assertOn();
    const season = this.udt.season().number;
    const team = this.udt.team(userId, season);
    if (!team) throw notFound('team');
    const careers = this.career.careers();
    return {
      team,
      manager: this.users.byId(userId)?.displayName ?? '?',
      ai: this.udt.aiIds().has(userId),
      roster: this.udt
        .roster(userId, season)
        .map((r) => ({ ...r, career: careers.get(r.botId) ?? null })),
    };
  }

  /** Models, skins, faces and voices to choose for own bots. */
  @Get('looks')
  looks() {
    return this.udt.looks();
  }

  /** Skin, face, voice and chat lines of an own bot. */
  @Put('bots/:id')
  editBot(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(BotLookBody)) body: BotLook,
  ) {
    // Chat lines go through the word filter (decision 283).
    if (body.personality?.lines)
      this.moderation.screen(
        user,
        body.personality.lines.map((l) => l.text),
      );
    const out = this.udt.editBot(user, id, body);
    if (body.personality?.lines) this.moderation.review('bot-lines', id);
    return out;
  }

  /** Renames an own bot once (free). */
  @Post('bots/:id/rename')
  @HttpCode(200)
  renameBot(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(z.object({ name: BotName }))) body: { name: string },
  ) {
    this.moderation.screen(user, [body.name]);
    const out = this.udt.rename(user, id, body.name);
    this.moderation.review('udt-bot', id);
    return out;
  }

  @Post('team')
  createTeam(@CurrentUser() user: User, @Body(new ZodPipe(TeamBody)) body: TeamInput) {
    this.moderation.screen(user, [
      body.name,
      body.tag,
      body.starter.name,
      ...(body.starter.personality?.lines ?? []).map((l) => l.text),
    ]);
    this.udt.createTeam(user, body);
    const view = this.udt.view(user);
    if (view.season !== null) this.moderation.review('udt-team', `${view.season}/${user.id}`);
    for (const b of this.udt.ownBotIds(user.id)) {
      this.moderation.review('udt-bot', b);
      this.moderation.review('bot-lines', b);
    }
    return view;
  }

  @Put('lineup')
  lineup(@CurrentUser() user: User, @Body(new ZodPipe(LineupBody)) body: LineupInput) {
    const out = this.udt.setLineup(user, body);
    this.events.autoFill(undefined, user.id); // a lineup that can play now enters
    return out;
  }

  /** The switch "enter automatically when possible" (enters right away where it can). */
  @Put('auto-enter')
  autoEnter(
    @CurrentUser() user: User,
    @Body(new ZodPipe(z.object({ on: z.boolean() }))) body: { on: boolean },
  ) {
    const team = this.udt.setAutoEnter(user, body.on);
    const entered = body.on ? this.events.autoFill(undefined, user.id) : 0;
    return { team, entered, events: this.events.events(user) };
  }

  /** A roster bot's Monster Hunt focus: -2 hunter … 0 standard … 2 sprinter (decision 239). */
  @Put('roster/:botId/mh-focus')
  mhFocus(
    @CurrentUser() user: User,
    @Param('botId') botId: string,
    @Body(new ZodPipe(z.object({ focus: z.number().int().min(-2).max(2) })))
    body: { focus: number },
  ) {
    return this.udt.setMhFocus(user, botId, body.focus);
  }

  /** The trophy room's crest (decision 266). */
  @Put('club/crest')
  crest(
    @CurrentUser() user: User,
    @Body(
      new ZodPipe(
        z.object({
          shape: z.enum(CREST_SHAPES),
          color: z.enum(CREST_COLORS),
        }),
      ),
    )
    body: Crest,
  ) {
    return this.udt.setCrest(user, body);
  }

  /** The trophy wall (decisions 266, 268): league titles, cup wins, the bots' stages, the crest. */
  @Get('trophies')
  trophies(@CurrentUser() user: User) {
    this.udt.assertOn();
    // League titles (decision 268) next to cups and stages.
    return { ...this.udt.trophies(user.id), league: this.league.titles(user.id) };
  }

  /** A club upgrade for the rest of the season (decision 264). */
  @Post('club/:kind')
  @HttpCode(200)
  clubUpgrade(@CurrentUser() user: User, @Param('kind') kind: string) {
    if (!(CLUB_UPGRADES as readonly string[]).includes(kind)) throw notFound('club upgrade');
    return this.udt.buyClubUpgrade(user, kind as ClubUpgrade);
  }

  /** Training camp (decision 254): experience for a roster bot, once per bot and day. */
  @Post('roster/:botId/camp')
  @HttpCode(200)
  camp(@CurrentUser() user: User, @Param('botId') botId: string) {
    return this.udt.camp(user, botId);
  }

  /** Rest with Neuro: stamina points for a roster bot (REST_PRICE Neuro each). */
  @Post('roster/:botId/rest')
  rest(
    @CurrentUser() user: User,
    @Param('botId') botId: string,
    @Body(new ZodPipe(z.object({ points: z.number().int().min(1).max(100) })))
    body: { points: number },
  ) {
    return this.udt.rest(user, botId, body.points);
  }

  /** Today's offers (price, values of the last 14 days, sold to whom), the next market day. */
  @Get('market')
  marketView(@CurrentUser() user: User) {
    return this.market.view(user);
  }

  /** Buys an offer at once (first come, first served). */
  @Post('market/buy')
  @HttpCode(200)
  buy(@CurrentUser() user: User, @Body(new ZodPipe(BuyBody)) body: BuyInput) {
    return this.market.buy(user, body);
  }

  /** Loans an offer for 7 market days without salary (decision 270). */
  @Post('market/loan')
  @HttpCode(200)
  loan(@CurrentUser() user: User, @Body(new ZodPipe(BuyBody)) body: BuyInput) {
    return this.market.loan(user, body);
  }

  /** Sells a roster bot to the market (85 % of its value). */
  @Post('roster/:botId/sell')
  @HttpCode(200)
  sell(@CurrentUser() user: User, @Param('botId') botId: string) {
    return this.market.sell(user, botId);
  }

  /** Dream Team tournaments with the manager's sign-up and what lineup would play. */
  @Get('events')
  eventList(@CurrentUser() user: User) {
    return this.events.events(user);
  }

  @Post('events/:id/enter')
  @HttpCode(200)
  enter(@CurrentUser() user: User, @Param('id') id: string) {
    return this.events.enter(user, id);
  }

  @Delete('events/:id/enter')
  leave(@CurrentUser() user: User, @Param('id') id: string) {
    return this.events.leave(user, id);
  }

  /** Season table: points from the places of finished Dream Team tournaments. */
  @Get('table')
  table() {
    this.udt.assertOn();
    return this.rewards.table(this.udt.season().number);
  }

  /** The manager's ledger bookings of the season (newest first). */
  @Get('ledger')
  ledgerEntries(@CurrentUser() user: User) {
    this.udt.assertOn();
    return this.udt.ledgerOf(user.id);
  }

  /** Boxes (prices, rates, pity), scrap, the trait inventory and the crafting list. */
  @Get('packs')
  packsView(@CurrentUser() user: User) {
    return this.packs.view(user);
  }

  @Post('packs/open')
  @HttpCode(200)
  open(@CurrentUser() user: User, @Body(new ZodPipe(OpenBody)) body: OpenInput) {
    return this.packs.open(user, body);
  }

  @Post('packs/craft')
  @HttpCode(200)
  craft(@CurrentUser() user: User, @Body(new ZodPipe(CraftBody)) body: { code: string }) {
    return this.packs.craft(user, body.code);
  }

  /** Puts a trait card on a roster bot. */
  @Post('traits/:id/assign')
  @HttpCode(200)
  assign(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(AssignBody)) body: AssignInput,
  ) {
    return this.packs.assign(user, id, body);
  }

  /** Takes a trait off its bot (destroyed: scrap). */
  @Delete('traits/:id/assign')
  unassign(@CurrentUser() user: User, @Param('id') id: string) {
    return this.packs.remove(user, id);
  }

  /** Trait workshop (decision 255): reroll an inventory card or upgrade it one rarity. */
  @Post('traits/:id/workshop')
  @HttpCode(200)
  workshop(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(WorkshopBody)) body: { kind: 'reroll' | 'upgrade' },
  ) {
    return this.packs.workshop(user, id, body.kind);
  }

  /** Turns an inventory card into scrap. */
  @Delete('traits/:id')
  scrap(@CurrentUser() user: User, @Param('id') id: string) {
    return this.packs.scrap(user, id);
  }

  /** Turns an unused blueprint into scrap. */
  @Delete('blueprints/:id')
  scrapBlueprint(@CurrentUser() user: User, @Param('id') id: string) {
    return this.packs.scrapBlueprint(user, id);
  }

  /** Open and recent trade offers of the manager, the trade rules. */
  @Get('trades')
  tradeList(@CurrentUser() user: User) {
    return this.trades.list(user);
  }

  /** Other managers with their rosters (what can be traded, why not). */
  @Get('trades/partners')
  partners(@CurrentUser() user: User) {
    return this.trades.partners(user);
  }

  /** Values, balance and fees of a planned offer (409 with the reason when it is not allowed). */
  @Post('trades/preview')
  @HttpCode(200)
  preview(@CurrentUser() user: User, @Body(new ZodPipe(TradeBody)) body: TradeInput) {
    return this.trades.preview(user, body);
  }

  @Post('trades')
  propose(@CurrentUser() user: User, @Body(new ZodPipe(TradeBody)) body: TradeInput) {
    if (body.message) this.moderation.screen(user, [body.message]);
    const out = this.trades.propose(user, body);
    // The new offer: the newest open one of the user with this message.
    const made = out.open
      .filter((t) => !t.incoming && t.message === body.message)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (body.message && made) this.moderation.review('trade', made.id);
    return out;
  }

  @Post('trades/:id/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: User, @Param('id') id: string) {
    return this.trades.accept(user, id);
  }

  @Post('trades/:id/decline')
  @HttpCode(200)
  decline(@CurrentUser() user: User, @Param('id') id: string) {
    return this.trades.decline(user, id);
  }

  /** The proposer takes the offer back (held Neuro and fee come back). */
  @Delete('trades/:id')
  withdrawTrade(@CurrentUser() user: User, @Param('id') id: string) {
    return this.trades.withdraw(user, id);
  }

  /** Challenges (decision 334): incoming, sent, open ones, coming, decided; the window's rules. */
  @Get('challenges')
  challengeList(@CurrentUser() user: User) {
    return this.challenges.view(user);
  }

  /** Challenges waiting for the manager's answer (the count on the navigation). */
  @Get('challenges/count')
  challengeCount(@CurrentUser() user: User) {
    return { incoming: this.challenges.incoming(user.id) };
  }

  /** Teams to challenge: strength for the format, full lineup, Monster Hunt bots, pair limit. */
  @Get('challenges/opponents')
  challengeOpponents(
    @CurrentUser() user: User,
    @Query(new ZodPipe(OpponentsQuery)) q: { mode: 'dm' | 'mh'; teamSize: number },
  ) {
    return this.challenges.opponents(user, q);
  }

  /** Bookable start times of the next days for a mode and length (and an opponent). */
  @Get('challenges/slots')
  challengeSlots(@CurrentUser() user: User, @Query(new ZodPipe(SlotsQuery)) q: SlotsInput) {
    return this.challenges.slots(user, q);
  }

  @Post('challenges')
  challenge(@CurrentUser() user: User, @Body(new ZodPipe(ChallengeBody)) body: ChallengeInput) {
    if (body.message) this.moderation.screen(user, [body.message]);
    const out = this.challenges.create(user, body);
    if (body.message) this.moderation.review('challenge', out.id);
    return out;
  }

  @Post('challenges/:id/accept')
  @HttpCode(200)
  acceptChallenge(@CurrentUser() user: User, @Param('id') id: string) {
    return this.challenges.accept(user, id);
  }

  @Post('challenges/:id/decline')
  @HttpCode(200)
  declineChallenge(@CurrentUser() user: User, @Param('id') id: string) {
    return this.challenges.decline(user, id);
  }

  /** A counter offer: a new challenge the other way, the answered one ends. */
  @Post('challenges/:id/counter')
  counterChallenge(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(CounterBody)) body: ChallengeInput,
  ) {
    if (body.message) this.moderation.screen(user, [body.message]);
    const out = this.challenges.counter(user, id, body);
    if (body.message) this.moderation.review('challenge', out.id);
    return out;
  }

  /** A rematch of a played challenge: the same one the other way round at a new start. */
  @Post('challenges/:id/rematch')
  rematchChallenge(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(RematchBody)) body: RematchInput,
  ) {
    if (body.message) this.moderation.screen(user, [body.message]);
    const out = this.challenges.rematch(user, id, body);
    if (body.message) this.moderation.review('challenge', out.id);
    return out;
  }

  /** The challenger takes a challenge back before the answer (the stake comes back). */
  @Delete('challenges/:id')
  withdrawChallenge(@CurrentUser() user: User, @Param('id') id: string) {
    return this.challenges.withdraw(user, id);
  }

  /** Academy: licences, the scout report, mentors, the manager's own bots. */
  @Get('academy')
  academyView(@CurrentUser() user: User) {
    return this.academy.view(user);
  }

  @Post('academy/scout')
  @HttpCode(200)
  scout(@CurrentUser() user: User) {
    return this.academy.scoutNow(user);
  }

  @Post('academy/sign')
  @HttpCode(200)
  sign(
    @CurrentUser() user: User,
    @Body(new ZodPipe(SignBody)) body: { pick: number; name: string },
  ) {
    return this.academy.sign(user, body);
  }

  @Post('academy/mentor')
  @HttpCode(200)
  takeApprentice(
    @CurrentUser() user: User,
    @Body(new ZodPipe(MentorBody)) body: { mentorId: string; apprenticeId: string },
  ) {
    return this.academy.mentor(user, body);
  }

  /** Builds an own bot from a blueprint of the packs. */
  @Post('academy/build')
  @HttpCode(200)
  build(@CurrentUser() user: User, @Body(new ZodPipe(BuildBody)) body: BuildInput) {
    return this.academy.build(user, body);
  }

  /** Spends development points of an own bot. */
  @Post('roster/:botId/develop')
  @HttpCode(200)
  develop(
    @CurrentUser() user: User,
    @Param('botId') botId: string,
    @Body(new ZodPipe(DevelopBody)) body: { stat: 'accuracy' | 'alertness' | 'strafing' | 'skill' },
  ) {
    return this.academy.develop(user, botId, body.stat);
  }

  /** The one breakthrough of a fully developed own bot. */
  @Post('roster/:botId/breakthrough')
  @HttpCode(200)
  breakthrough(@CurrentUser() user: User, @Param('botId') botId: string) {
    return this.academy.breakthrough(user, botId);
  }

  /** Prestige (decision 262): a free point on a stat of the menu. */
  @Post('roster/:botId/prestige')
  @HttpCode(200)
  prestige(
    @CurrentUser() user: User,
    @Param('botId') botId: string,
    @Body(
      new ZodPipe(z.object({ stat: z.enum(PRESTIGE_STATS as [PrestigeStat, ...PrestigeStat[]]) })),
    )
    body: { stat: PrestigeStat },
  ) {
    return this.academy.prestigeAllocate(user, botId, body.stat);
  }

  /** Prestige: a point for Neuro. */
  @Post('roster/:botId/prestige/buy')
  @HttpCode(200)
  prestigeBuy(@CurrentUser() user: User, @Param('botId') botId: string) {
    return this.academy.prestigeBuy(user, botId);
  }

  /** Prestige: every point of the bot free again (for Neuro). */
  @Post('roster/:botId/prestige/reset')
  @HttpCode(200)
  prestigeReset(@CurrentUser() user: User, @Param('botId') botId: string) {
    return this.academy.prestigeReset(user, botId);
  }

  /** The ascension of a Godlike (stars afterwards). */
  @Post('roster/:botId/ascend')
  @HttpCode(200)
  ascend(@CurrentUser() user: User, @Param('botId') botId: string) {
    return this.academy.ascend(user, botId);
  }

  /** A star for an ascended bot. */
  @Post('roster/:botId/star')
  @HttpCode(200)
  star(@CurrentUser() user: User, @Param('botId') botId: string) {
    return this.academy.buyStar(user, botId);
  }

  /** The manager's own bots of the season and what their graduation needs. */
  @Get('graduation')
  graduation(@CurrentUser() user: User) {
    return this.career.graduation(user);
  }

  @Post('graduation/:botId')
  @HttpCode(200)
  nominate(@CurrentUser() user: User, @Param('botId') botId: string) {
    return this.career.nominate(user, botId);
  }

  @Delete('graduation/:botId')
  unnominate(@CurrentUser() user: User, @Param('botId') botId: string) {
    return this.career.withdraw(user, botId);
  }

  /**
   * Trait report of a season (admins, decision 237): what every trait did in the Dream Team
   * games, from the trait log of mod 0.17.0 - a summary per trait and one row per bot, game
   * and trait (the settings tab downloads it as CSV for a review).
   */
  @AdminOnly()
  @Get('traits/report')
  traitReport(@Query('season') season?: string) {
    const n =
      Number(season) || this.udt.seasonNumber() || this.seasons.latestStarted()?.number || 0;
    // Trait lab (decision 251): AI clubs and AI managers drew their traits at random.
    const ai = new Set([...this.udt.aiIds()].map((id) => udtEntrantId(id)));
    const lab = (entrantId: string) =>
      entrantId.startsWith(aiClubEntrantId('')) || ai.has(entrantId);
    return { season: n, ...traitReport(n ? this.stats.udtFacts(n) : [], lab) };
  }

  /** The analysis room (decision 266): the next league opponent and the club's map record. */
  @Get('league/analysis')
  leagueAnalysis(@CurrentUser() user: User) {
    return this.league.analysis(user);
  }

  /** The league: tables, the matchday as a conference, fixtures, the viewer's next game. */
  @Get('league')
  leagueView(@CurrentUser() user: User, @Query('season') season?: string) {
    return this.league.view(user, season ? Number(season) || undefined : undefined);
  }

  /** Champions and tiers of every finished league season. */
  @Get('league/history')
  leagueHistory() {
    return this.league.history();
  }

  /** The home club's manager picks the map of the next game. */
  @Put('league/fixtures/:id/map')
  leagueMap(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(z.object({ map: z.string().min(1).max(64) }))) body: { map: string },
  ) {
    return this.league.setMap(user, id, body.map);
  }

  /** Admin view of the league (settings tab): the run, its plan, the server time estimate. */
  @AdminOnly()
  @Get('league/admin')
  leagueAdmin() {
    this.udt.assertOn();
    return this.league.adminView();
  }

  @AdminOnly()
  @Get('league/estimate')
  leagueEstimate(@Query(new ZodPipe(EstimateQuery)) q: Record<string, unknown>) {
    return this.league.estimate(q as never);
  }

  /** A test league in the running season (L-E9). */
  @AdminOnly()
  @Post('league/test')
  @HttpCode(200)
  leagueTest(@Body(new ZodPipe(TestLeagueBody)) body: TestLeagueInput) {
    return this.league.startTest(body);
  }

  /** The plan of a league started late (start dialog): null when it does not fit. */
  @AdminOnly()
  @Get('league/fit')
  leagueFit(@Query(new ZodPipe(FitQuery)) q: { startDate?: string }) {
    return { plan: this.league.fit(q.startDate) };
  }

  /** A regular league in the running season, started now (decision 230). */
  @AdminOnly()
  @Post('league/start')
  @HttpCode(200)
  leagueStart(@Body(new ZodPipe(TestLeagueBody)) body: TestLeagueInput) {
    return this.league.startRegular(body);
  }

  /** Calls the league off (a test league; a regular one before its first game). */
  @AdminOnly()
  @Delete('league/test')
  leagueTestAbort() {
    return this.league.abortTest();
  }

  /** The keeper choice at the season's end (open or not, bots that can be kept, the chosen). */
  @Get('keepers')
  keepersView(@CurrentUser() user: User) {
    return this.keepers.view(user);
  }

  /** Chooses the keepers for the next season (replaces the choice; empty list: none). */
  @Put('keepers')
  chooseKeepers(
    @CurrentUser() user: User,
    @Body(new ZodPipe(KeepersBody)) body: { botIds: string[] },
  ) {
    return this.keepers.choose(user, body.botIds);
  }

  /** Graduations waiting for an admin. */
  @AdminOnly()
  @Get('nominations')
  nominations() {
    this.udt.assertOn();
    return this.career.nominations();
  }

  @AdminOnly()
  @Post('nominations/:botId/approve')
  @HttpCode(200)
  approve(@Param('botId') botId: string, @Body(new ZodPipe(ApproveBody)) body: { name?: string }) {
    return this.career.approve(botId, body);
  }

  @AdminOnly()
  @Post('nominations/:botId/reject')
  @HttpCode(200)
  reject(@Param('botId') botId: string) {
    return this.career.reject(botId);
  }

  /** The bots the managers made in a season (latest season by default). */
  @Get('yearbook')
  yearbook(@Query('season') season?: string) {
    return this.career.yearbook(season ? Number(season) || undefined : undefined);
  }

  /** Best breeders of all seasons. */
  @Get('breeders')
  breeders() {
    return this.career.breeders();
  }

  /** A bot's Dream Team page: team, card, career and its Dream Team statistics. */
  @Get('bots/:id')
  botPage(@Param('id') id: string, @CurrentUser() user: User) {
    return this.career.botPage(id, user);
  }

  /** A bot's career (all bots: age, phase, level, form). */
  @Get('career/:botId')
  careerOf(@Param('botId') botId: string) {
    this.udt.assertOn();
    return this.career.careerOf(botId);
  }

  /** The hall of fame; admins also get the bots whose career suggests retirement. */
  @Get('hall')
  hall(@CurrentUser() user: User) {
    this.udt.assertOn();
    return {
      retired: this.career.hall(),
      candidates: user.isAdmin ? this.career.retireCandidates() : [],
    };
  }

  @AdminOnly()
  @Post('career/:botId/retire')
  @HttpCode(200)
  retire(@Param('botId') botId: string) {
    this.udt.assertOn();
    return this.career.retire(botId);
  }

  /** AI managers with their personality (admins). */
  @AdminOnly()
  @Get('ai')
  aiManagers() {
    this.udt.assertOn();
    const season = this.udt.season().number;
    return this.ai.managers().map((m) => ({
      userId: m.user.id,
      n: m.n,
      personality: m.personality,
      team: this.udt.team(m.user.id, season),
    }));
  }

  /** Creates the missing AI teams of the season now (instead of at the next market day). */
  @AdminOnly()
  @Post('ai/ensure')
  @HttpCode(200)
  aiEnsure() {
    this.udt.assertOn();
    return { created: this.ai.ensure(this.udt.season().number) };
  }
}
