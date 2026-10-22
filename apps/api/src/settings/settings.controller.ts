import { Body, Controller, Get, HttpCode, Inject, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly } from '../auth/guard.js';
import { PatchPipe, ZodPipe } from '../common/http.js';
import { SeasonsService } from '../seasons/seasons.service.js';
import { TournamentsService } from '../tournaments/tournaments.service.js';
import {
  BettingFieldsSchema,
  BotAiSettingsSchema,
  type BotAiSettings,
  UdtSettingsSchema,
  type UdtSettings,
  LiveSettingsSchema,
  type LiveSettings,
  RatingSettingsSchema,
  SettingsService,
  ShopSettingsSchema,
  type ShopSettings,
  TeamNamesSchema,
  type BettingSettings,
  type RatingSettings,
} from './settings.service.js';

/** Website settings (admins). */
@AdminOnly()
@Controller('settings')
export class SettingsController {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(TournamentsService) private readonly tournaments: TournamentsService,
  ) {}

  /**
   * Deletes all tournaments, statistics and seasons for good. The body must carry the word
   * RESET (typed by the admin), so that no stray request can do it.
   */
  @Post('reset')
  @HttpCode(200)
  reset(@Body(new ZodPipe(z.object({ confirm: z.literal('RESET') }))) _body: { confirm: 'RESET' }) {
    return this.tournaments.resetAll();
  }

  @Get()
  get() {
    return this.settings.get();
  }

  @Put('rating')
  rating(@Body(new PatchPipe(RatingSettingsSchema.partial())) body: Partial<RatingSettings>) {
    const next = this.settings.setRating(body);
    // The running and the planned season use the new settings; ended seasons keep theirs.
    this.seasons.applyRating(next.rating);
    return next;
  }

  /** Betting with Neuro: start balance and rescue floor (running and planned season too). */
  @Put('betting')
  betting(
    @Body(new PatchPipe(BettingFieldsSchema.partial()))
    body: Partial<BettingSettings>,
  ) {
    const next = this.settings.setBetting(body);
    this.seasons.applyBetting(next.betting);
    return next;
  }

  /** Neuro shop: on/off, prices, items taken out. */
  @Put('shop')
  shop(@Body(new PatchPipe(ShopSettingsSchema.partial())) body: Partial<ShopSettings>) {
    return this.settings.setShop(body);
  }

  /** Help for the bot AI in deathmatch games (sent to the bridge with the next sync). */
  @Put('bot-ai')
  botAi(@Body(new PatchPipe(BotAiSettingsSchema.partial())) body: Partial<BotAiSettings>) {
    return this.settings.setBotAi(body);
  }

  /** Unreal Dream Team: on/off, market time, offers per day, starter budget. */
  @Put('udt')
  udt(@Body(new PatchPipe(UdtSettingsSchema.partial())) body: Partial<UdtSettings>) {
    return this.settings.setUdt(body);
  }

  /** Live data: replay retention and the delay while humans play. */
  @Put('live')
  live(@Body(new PatchPipe(LiveSettingsSchema.partial())) body: Partial<LiveSettings>) {
    return this.settings.setLive(body);
  }

  /** Names for teams made of bots only. */
  @Put('team-names')
  teamNames(@Body(new ZodPipe(z.object({ names: TeamNamesSchema }))) body: { names: string[] }) {
    return this.settings.setTeamNames(body.names);
  }
}
