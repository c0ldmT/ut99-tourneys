import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { UsersService } from '../auth/users.service.js';
import { AdminOnly } from '../auth/guard.js';
import { notFound, PatchPipe, ZodPipe } from '../common/http.js';
import { botKey, userKey } from '../stats/facts.js';
import { StatsService } from '../stats/stats.service.js';
import { BotBody, BotsService, ClanBody, type BotInput, type ClanInput } from './bots.service.js';

const RandomBody = z.object({
  count: z.number().int().min(1).max(50),
  clanId: z.string().max(40).optional(),
  skill: z.number().min(0).max(7).optional(),
  seed: z.string().max(100).optional(),
});
const ImportBody = z.object({
  agentId: z.string().min(1).max(64),
  profileId: z.string().max(64).optional(),
});

/** Bot control center (admins) and bot profiles (everybody logged in). */
@Controller()
export class BotsController {
  constructor(
    @Inject(BotsService) private readonly bots: BotsService,
    @Inject(StatsService) private readonly stats: StatsService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  @AdminOnly()
  @Get('bots')
  list() {
    // Bots made by Dream Team managers are theirs, not part of the control center.
    return { bots: this.bots.list().filter((b) => !b.udtOwner), clans: this.bots.clans() };
  }

  @AdminOnly()
  @Get('bots/assets')
  assets() {
    return this.bots.assets();
  }

  /** Bot profile: look, play style, clan, bio, rivals with the head-to-head record. */
  @Get('bots/:id')
  profile(@Param('id') id: string) {
    const b = this.bots.get(id);
    if (!b) throw notFound('bot {id}', { id });
    const users = new Map(this.users.list().map((u) => [u.id, u.displayName]));
    const all = this.bots.list();
    const rivalKey = (r: { kind: 'user' | 'bot'; id: string }) =>
      r.kind === 'user' ? userKey(r.id) : botKey(r.id);
    const h2h = this.stats.headToHead(botKey(b.id), b.personality.rivals.map(rivalKey));
    const assets = this.bots.assets();
    const label = (list: { name: string; label: string }[], n: string | null | undefined) =>
      n ? (list.find((x) => x.name.toLowerCase() === n.toLowerCase())?.label ?? null) : null;
    return {
      ...b,
      statsKey: botKey(b.id),
      /** Display names of the look (stock material and scanned servers). */
      labels: {
        botClass: label(assets.botClasses, b.botClass),
        skin: label(assets.skins, b.skin),
        face: label(assets.faces, b.face),
        voice: label(assets.voices, b.traits.voice),
        weapon: label(assets.weapons, b.traits.favoriteWeapon),
      },
      clan: b.clanId ? this.bots.clans().find((c) => c.id === b.clanId) : null,
      rivals: b.personality.rivals.map((r) => ({
        ...r,
        name:
          r.kind === 'user'
            ? (users.get(r.id) ?? r.id)
            : (all.find((x) => x.id === r.id)?.gameName ?? r.id),
        key: rivalKey(r),
        record: h2h[rivalKey(r)] ?? { games: 0, wins: 0 },
      })),
      /** Bots that have this one as a rival or nemesis. */
      rivalOf: all
        .filter((x) => x.personality.rivals.some((r) => r.kind === 'bot' && r.id === b.id))
        .map((x) => ({ id: x.id, name: x.gameName })),
    };
  }

  @AdminOnly()
  @Post('bots')
  create(@Body(new ZodPipe(BotBody)) body: BotInput) {
    return this.bots.create(body);
  }

  @AdminOnly()
  @Patch('bots/:id')
  update(@Param('id') id: string, @Body(new PatchPipe(BotBody.partial())) body: Partial<BotInput>) {
    return this.bots.update(id, body);
  }

  @AdminOnly()
  @Delete('bots/:id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    this.bots.remove(id);
  }

  @AdminOnly()
  @Post('bots-random')
  random(@Body(new ZodPipe(RandomBody)) body: z.infer<typeof RandomBody>) {
    return this.bots.random(body.count, {
      ...(body.clanId ? { clanId: body.clanId } : {}),
      ...(body.skill !== undefined ? { skill: body.skill } : {}),
      ...(body.seed ? { seed: body.seed } : {}),
    });
  }

  @AdminOnly()
  @Post('bots-import')
  importBots(@Body(new ZodPipe(ImportBody)) body: z.infer<typeof ImportBody>) {
    return this.bots.importFrom(body.agentId, body.profileId);
  }

  @AdminOnly()
  @Post('bot-clans')
  createClan(@Body(new ZodPipe(ClanBody)) body: ClanInput) {
    return this.bots.createClan(body);
  }

  @AdminOnly()
  @Patch('bot-clans/:id')
  updateClan(
    @Param('id') id: string,
    @Body(new PatchPipe(ClanBody.partial())) body: Partial<ClanInput>,
  ) {
    return this.bots.updateClan(id, body);
  }

  @AdminOnly()
  @Delete('bot-clans/:id')
  @HttpCode(204)
  deleteClan(@Param('id') id: string) {
    this.bots.deleteClan(id);
  }
}
