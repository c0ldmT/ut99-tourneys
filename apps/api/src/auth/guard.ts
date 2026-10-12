import {
  createParamDecorator,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { parseCookies } from '../common/http.js';
import { SESSION_COOKIE, SessionsService } from './sessions.service.js';
import type { User } from './users.service.js';

const PUBLIC = 'tourney:public';
const ADMIN = 'tourney:admin';

/** No login needed. */
export const Public = () => SetMetadata(PUBLIC, true);
/** Admins only. */
export const AdminOnly = () => SetMetadata(ADMIN, true);

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
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[CSRF_HEADER] !== '1') {
      throw new ForbiddenException(`missing ${CSRF_HEADER} header`);
    }
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const user = this.sessions.resolve(sid);
    if (user) {
      req.user = user;
      req.sessionId = sid;
    }
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    if (!user) throw new UnauthorizedException('login required');
    if (this.reflector.getAllAndOverride<boolean>(ADMIN, targets) && !user.isAdmin) {
      throw new ForbiddenException('admins only');
    }
    return true;
  }
}
