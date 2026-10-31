import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CONFIG, type ApiConfig } from '../config.js';
import { cookie, forbidden, parseCookies, ZodPipe } from '../common/http.js';
import { randomId } from '../common/ids.js';
import type { ApiLogger } from '../common/logger.js';
import { LOGGER } from '../common/logger.js';
import { DISCORD, type DiscordApi } from './discord.js';
import { isWebhookUrl } from '../notify/discord-out.js';
import { UdtLeagueService } from '../udt/udt-league.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { AdminOnly, CurrentUser, Public, type AuthedRequest } from './guard.js';
import { SESSION_COOKIE, SessionsService } from './sessions.service.js';
import { publicUser, UsersService, type User } from './users.service.js';

const STATE_COOKIE = 'toauth';

const DevLoginBody = z.object({
  name: z.string().min(2).max(32),
  admin: z.boolean().optional(),
});
const MeBody = z.object({
  displayName: z.string().min(2).max(32).optional(),
  /** Discord direct messages from the bot. */
  notifyDm: z.boolean().optional(),
});
const AdminBody = z.object({ isAdmin: z.boolean() });

@Controller()
export class AuthController {
  constructor(
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(DISCORD) private readonly discord: DiscordApi | null,
    @Inject(LOGGER) private readonly log: ApiLogger,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(UdtLeagueService) private readonly league: UdtLeagueService,
  ) {}

  /** What the frontend needs before login. */
  @Public()
  @Get('config')
  getConfig() {
    return {
      siteName: this.config.siteName,
      discordLogin: this.config.discord.enabled,
      devLogin: this.config.devLogin,
      /** Unreal Dream Team switched on (menu), test mode of a local instance. */
      udt: this.settings.get().udt.enabled,
      /** The Dream Team league shows (its area in Dream Team, decision 228). */
      udtLeague: this.settings.get().udt.enabled && this.league.visible(),
      testMode: this.config.testMode,
      notify: {
        directMessages: Boolean(this.config.notify.botToken),
        defaultChannel: isWebhookUrl(this.config.notify.webhookUrl),
      },
    };
  }

  @Public()
  @Get('auth/discord')
  discordStart(@Res() res: Response, @Query('next') next?: string) {
    if (!this.discord) throw forbidden('Discord login is not configured');
    const state = randomId(24);
    const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    res.setHeader(
      'Set-Cookie',
      cookie(STATE_COOKIE, `${state}|${safeNext}`, {
        maxAgeSec: 600,
        secure: this.config.secureCookies,
        path: '/api/auth',
      }),
    );
    res.redirect(this.discord.authorizeUrl(state));
  }

  @Public()
  @Get('auth/discord/callback')
  async discordCallback(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    const fail = (reason: string) => res.redirect(`/login?error=${encodeURIComponent(reason)}`);
    if (!this.discord) return fail('discord-disabled');
    const [expected, next = '/'] = (parseCookies(req.headers.cookie)[STATE_COOKIE] ?? '').split(
      '|',
    );
    res.append(
      'Set-Cookie',
      cookie(STATE_COOKIE, '', {
        maxAgeSec: 0,
        secure: this.config.secureCookies,
        path: '/api/auth',
      }),
    );
    if (error) return fail(error);
    if (!code || !state || !expected || state !== expected) return fail('state');
    try {
      const identity = await this.discord.identify(code);
      const guild = this.config.discord.guildId;
      if (guild && !identity.guildIds?.includes(guild)) return fail('guild');
      const user = this.users.login(identity);
      this.log.info(`login ${user.displayName} (discord ${identity.discordId})`);
      this.startSession(res, user);
      return res.redirect(next);
    } catch (e) {
      this.log.warn(`discord login failed: ${(e as Error).message}`);
      return fail('discord');
    }
  }

  @Public()
  @Post('auth/dev-login')
  @HttpCode(200)
  devLogin(
    @Body(new ZodPipe(DevLoginBody)) body: z.infer<typeof DevLoginBody>,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.config.devLogin) throw forbidden('dev login is disabled');
    const user = this.users.login(
      { discordId: `dev:${body.name.toLowerCase()}`, username: body.name, displayName: body.name },
      { admin: body.admin },
    );
    this.startSession(res, user);
    return this.me(user);
  }

  @Post('auth/logout')
  @HttpCode(204)
  logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    this.sessions.destroy(req.sessionId);
    res.setHeader(
      'Set-Cookie',
      cookie(SESSION_COOKIE, '', { maxAgeSec: 0, secure: this.config.secureCookies }),
    );
  }

  @Get('me')
  me(@CurrentUser() user: User) {
    return {
      ...publicUser(user),
      joinToken: user.joinToken,
      notifyDm: user.notifyDm,
      // Direct messages need a Discord account (not a development login).
      discordAccount: /^\d+$/.test(user.discordId),
      /** Messages to show once (a modal after login). */
      notices: this.users.notices(user.id),
    };
  }

  /** A notice was shown: it does not come again. */
  @Post('me/notices/:id/seen')
  @HttpCode(204)
  seeNotice(@CurrentUser() user: User, @Param('id') id: string) {
    this.users.seeNotice(user.id, id);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: User, @Body(new ZodPipe(MeBody)) body: z.infer<typeof MeBody>) {
    let u = user;
    if (body.displayName !== undefined) u = this.users.setDisplayName(u.id, body.displayName);
    if (body.notifyDm !== undefined) u = this.users.setNotifyDm(u.id, body.notifyDm);
    return this.me(u);
  }

  @Post('me/token')
  @HttpCode(200)
  rotateToken(@CurrentUser() user: User) {
    return this.me(this.users.rotateToken(user.id));
  }

  @AdminOnly()
  @Get('users')
  listUsers() {
    return this.users.list().map(publicUser);
  }

  @AdminOnly()
  @Patch('users/:id')
  setAdmin(
    @CurrentUser() me: User,
    @Param('id') id: string,
    @Body(new ZodPipe(AdminBody)) body: z.infer<typeof AdminBody>,
  ) {
    if (id === me.id && !body.isAdmin) throw forbidden('you cannot remove your own admin rights');
    return publicUser(this.users.setAdmin(id, body.isAdmin));
  }

  private startSession(res: Response, user: User) {
    const sid = this.sessions.create(user.id);
    res.append(
      'Set-Cookie',
      cookie(SESSION_COOKIE, sid, {
        maxAgeSec: this.sessions.maxAgeSec,
        secure: this.config.secureCookies,
      }),
    );
  }
}
