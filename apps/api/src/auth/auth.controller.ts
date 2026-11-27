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
import { CLOCK, CONFIG, type ApiClock, type ApiConfig } from '../config.js';
import { cookie, forbidden, parseCookies, ZodPipe } from '../common/http.js';
import { randomId } from '../common/ids.js';
import { LATEST_PATCH, PATCH_NOTES } from '../common/patch-notes.js';
import { FeedbackService } from '../feedback/feedback.service.js';
import type { ApiLogger } from '../common/logger.js';
import { LOGGER } from '../common/logger.js';
import { DISCORD, type DiscordApi } from './discord.js';
import { isWebhookUrl } from '../notify/discord-out.js';
import { UdtLeagueService } from '../udt/udt-league.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  AdminOnly,
  bannedNow,
  CurrentUser,
  isModerator,
  Public,
  type AuthedRequest,
} from './guard.js';
import { ModerationService } from '../moderation/moderation.service.js';
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
const AdminBody = z.object({
  isAdmin: z.boolean().optional(),
  isModerator: z.boolean().optional(),
});
const PatchSeenBody = z.object({ id: z.number().int().min(0) });

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
    @Inject(FeedbackService) private readonly feedback: FeedbackService,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(ModerationService) private readonly moderation: ModerationService,
  ) {}

  /** Login: a new player's name goes through the word filter (decision 283). */
  private loggedIn(user: User): User {
    return user.createdAt === user.lastLoginAt ? this.moderation.newPlayer(user) : user;
  }

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
      /** Dream Team challenges show (their area, decision 337). */
      udtChallenges: this.settings.get().udt.enabled && this.settings.get().udt.challenge.enabled,
      testMode: this.config.testMode,
      /** The newest patch note (decision 243): above what the visitor saw, the modal shows. */
      patchLatest: LATEST_PATCH,
      notify: {
        directMessages: Boolean(this.config.notify.botToken),
        defaultChannel: isWebhookUrl(this.config.notify.webhookUrl),
      },
    };
  }

  /** All patch notes, newest first (decision 243; the footer opens them). */
  @Public()
  @Get('patch-notes')
  patchNotes() {
    return { latest: LATEST_PATCH, notes: PATCH_NOTES };
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
      const user = this.loggedIn(this.users.login(identity));
      if (bannedNow(user, this.clock.now())) return fail('banned');
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
    const user = this.loggedIn(
      this.users.login(
        {
          discordId: `dev:${body.name.toLowerCase()}`,
          username: body.name,
          displayName: body.name,
        },
        { admin: body.admin },
      ),
    );
    if (bannedNow(user, this.clock.now()))
      throw forbidden('your account is blocked until {until}', {
        until: user.bannedUntil!.slice(0, 10),
      });
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
      /** The last patch note the user saw (decision 243). */
      patchSeen: user.patchSeen,
      /** A season survey waiting for the user (decision 245). */
      survey: this.feedback.pending(user.id),
      /** Moderation (decision 283): the queue for moderators, a running text ban. */
      isModerator: isModerator(user),
      textBanUntil: user.textBanUntil,
    };
  }

  /** The update modal was closed: the patch notes up to `id` do not come again. */
  @Post('me/patch-notes/seen')
  @HttpCode(200)
  seePatch(
    @CurrentUser() user: User,
    @Body(new ZodPipe(PatchSeenBody)) body: z.infer<typeof PatchSeenBody>,
  ) {
    return { patchSeen: this.users.seePatch(user.id, body.id) };
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
    if (body.displayName !== undefined && body.displayName !== u.displayName) {
      this.moderation.screen(u, [body.displayName]);
      u = this.users.setDisplayName(u.id, body.displayName);
      this.moderation.review('name', u.id);
    }
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
    return this.users.list().map((u) => {
      // Dream Team AI managers (discord id "ai:<n>") never log in (decision 292).
      const ai = u.discordId.startsWith('ai:');
      return {
        ...publicUser(u),
        isModerator: u.isModerator,
        warnings: u.warnings,
        textBanUntil: u.textBanUntil,
        bannedUntil: u.bannedUntil,
        createdAt: u.createdAt,
        ...(ai
          ? { ai: true }
          : {
              // Inactive players (decision 290): last login and last request.
              lastLoginAt: u.lastLoginAt,
              lastSeenAt: u.lastSeenAt ?? u.lastLoginAt,
            }),
      };
    });
  }

  @AdminOnly()
  @Patch('users/:id')
  setAdmin(
    @CurrentUser() me: User,
    @Param('id') id: string,
    @Body(new ZodPipe(AdminBody)) body: z.infer<typeof AdminBody>,
  ) {
    if (body.isAdmin !== undefined) {
      if (id === me.id && !body.isAdmin) throw forbidden('you cannot remove your own admin rights');
      this.users.setAdmin(id, body.isAdmin);
    }
    if (body.isModerator !== undefined) this.moderation.setModerator(me, id, body.isModerator);
    const u = this.users.require(id);
    return { ...publicUser(u), isModerator: u.isModerator };
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
