import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, lt } from 'drizzle-orm';
import { CLOCK, CONFIG, type ApiClock, type ApiConfig } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { sessions, users } from '../db/schema.js';
import { newSessionId, sha256 } from '../common/ids.js';
import type { User } from './users.service.js';

export const SESSION_COOKIE = 'tsid';

/** Server-side sessions; the cookie holds a random id, the database only its hash. */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(CLOCK) private readonly clock: ApiClock,
  ) {}

  get maxAgeSec(): number {
    return this.config.sessionDays * 86_400;
  }

  create(userId: string): string {
    const id = newSessionId();
    const now = this.clock.now();
    this.db
      .insert(sessions)
      .values({
        idHash: sha256(id),
        userId,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + this.maxAgeSec * 1000).toISOString(),
      })
      .run();
    // Housekeeping: drop expired sessions now and then.
    this.db
      .delete(sessions)
      .where(lt(sessions.expiresAt, new Date(now).toISOString()))
      .run();
    return id;
  }

  resolve(id: string | undefined): User | undefined {
    if (!id) return undefined;
    const row = this.db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.idHash, sha256(id)),
          gt(sessions.expiresAt, new Date(this.clock.now()).toISOString()),
        ),
      )
      .get();
    return row?.user;
  }

  destroy(id: string | undefined): void {
    if (id)
      this.db
        .delete(sessions)
        .where(eq(sessions.idHash, sha256(id)))
        .run();
  }
}
