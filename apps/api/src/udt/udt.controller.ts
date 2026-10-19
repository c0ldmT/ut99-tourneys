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
import type { User } from '../auth/users.service.js';
import { ZodPipe } from '../common/http.js';
import { UdtEventsService } from './udt-events.service.js';
import { UdtRewardsService } from './udt-rewards.service.js';
import { ApproveBody, UdtCareerService } from './udt-career.service.js';
import { UdtAiService } from './udt-ai.service.js';
import {
  BuildBody,
  DevelopBody,
  MentorBody,
  SignBody,
  UdtAcademyService,
  type BuildInput,
} from './udt-academy.service.js';
import { TradeBody, UdtTradesService, type TradeInput } from './udt-trades.service.js';
import {
  AssignBody,
  CraftBody,
  OpenBody,
  UdtPacksService,
  type AssignInput,
  type OpenInput,
} from './udt-packs.service.js';
import { BidBody, UdtMarketService, type BidInput } from './udt-market.service.js';
import {
  LineupBody,
  TeamBody,
  UdtService,
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
    @Inject(UdtAcademyService) private readonly academy: UdtAcademyService,
    @Inject(UdtCareerService) private readonly career: UdtCareerService,
    @Inject(UdtAiService) private readonly ai: UdtAiService,
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
    };
  }

  /** All teams of the running season. */
  @Get('teams')
  teams() {
    this.udt.assertOn();
    return this.udt.teams(this.udt.season().number);
  }

  @Post('team')
  createTeam(@CurrentUser() user: User, @Body(new ZodPipe(TeamBody)) body: TeamInput) {
    this.udt.createTeam(user, body);
    return this.udt.view(user);
  }

  @Put('lineup')
  lineup(@CurrentUser() user: User, @Body(new ZodPipe(LineupBody)) body: LineupInput) {
    return this.udt.setLineup(user, body);
  }

  /** Today's offers (values, last 14 days), the manager's hidden bids, the next market day. */
  @Get('market')
  marketView(@CurrentUser() user: User) {
    return this.market.view(user);
  }

  @Post('market/bid')
  @HttpCode(200)
  bid(@CurrentUser() user: User, @Body(new ZodPipe(BidBody)) body: BidInput) {
    return this.market.bid(user, body);
  }

  @Delete('market/bid/:botId')
  withdraw(@CurrentUser() user: User, @Param('botId') botId: string) {
    return this.market.withdraw(user, botId);
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

  /** Turns an inventory card into scrap. */
  @Delete('traits/:id')
  scrap(@CurrentUser() user: User, @Param('id') id: string) {
    return this.packs.scrap(user, id);
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
    return this.trades.propose(user, body);
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
    @Body(new ZodPipe(MentorBody)) body: { mentorId: string; name: string },
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
