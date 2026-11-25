import {
  createParamDecorator,
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { forbidden, parseCookies, unauthorized } from '../common/http.js';
import { SESSION_COOKIE, SessionsService } from './sessions.service.js';
import type { User } from './users.service.js';
import { CLOCK, type ApiClock } from '../config.js';

const PUBLIC = 'tourney:public';
const ADMIN = 'tourney:admin';
const MOD = 'tourney:moderator';

/** No login needed. */
export const Public = () => SetMetadata(PUBLIC, true);
/** Admins only. */
export const AdminOnly = () => SetMetadata(ADMIN, true);
/** Moderators and admins (decision 283). */
export const ModOnly = () => SetMetadata(MOD, true);

/** Admins are moderators too. */
export const isModerator = (u: User) => u.isAdmin || u.isModerator;

/** A login ban that still runs (decision 283). */
export const bannedNow = (u: User, now: number) =>
  !!u.bannedUntil && Date.parse(u.bannedUntil) > now;

export type AuthedRequest = Request & { user?: User; sessionId?: string };

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.user;
});

/** Header every state-changing request must carry (cross-site forms cannot set it). */
export const CSRF_HEADER = 'x-tourney';

/**
 * Global guard: resolves the session cookie, enforces login (the website is a closed system),
 * admin rights and the CSRF header on state-changing requests.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(CLOCK) private readonly clock: ApiClock,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[CSRF_HEADER] !== '1') {
      throw forbidden('missing {header} header', { header: CSRF_HEADER });
    }
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    let user = this.sessions.resolve(sid);
    // A banned player's sessions end (decision 283): the login page tells why.
    if (user && bannedNow(user, this.clock.now())) user = undefined;
    if (user) {
      req.user = user;
      req.sessionId = sid;
    }
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    if (!user) throw unauthorized();
    if (this.reflector.getAllAndOverride<boolean>(ADMIN, targets) && !user.isAdmin) {
      throw forbidden('admins only');
    }
    if (this.reflector.getAllAndOverride<boolean>(MOD, targets) && !isModerator(user)) {
      throw forbidden('moderators only');
    }
    return true;
  }
}
