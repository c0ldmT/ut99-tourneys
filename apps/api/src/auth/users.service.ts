import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { CLOCK, CONFIG, type ApiClock, type ApiConfig } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { users } from '../db/schema.js';
import { newJoinToken, randomId } from '../common/ids.js';
import { conflict, badRequest, notFound } from '../common/http.js';
import { nameKey, sanitizeName, uniqueName } from '../common/names.js';

export type User = typeof users.$inferSelect;

export interface PublicUser {
  id: string;
  displayName: string;
  username: string;
  avatar: string | null;
  isAdmin: boolean;
}

export const publicUser = (u: User): PublicUser => ({
  id: u.id,
  displayName: u.displayName,
  username: u.username,
  avatar: u.avatar,
  isAdmin: u.isAdmin,
});

export interface ExternalIdentity {
  discordId: string;
  username: string;
  /** Preferred in-game name for new users. */
  displayName: string;
  avatar?: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(CLOCK) private readonly clock: ApiClock,
  ) {}

  private now() {
    return new Date(this.clock.now()).toISOString();
  }

  byId(id: string): User | undefined {
    return this.db.select().from(users).where(eq(users.id, id)).get();
  }

  require(id: string): User {
    const u = this.byId(id);
    if (!u) throw notFound('user');
    return u;
  }

  list(): User[] {
    return this.db.select().from(users).orderBy(asc(users.displayKey)).all();
  }

  private nameTaken = (key: string) =>
    this.db.select({ id: users.id }).from(users).where(eq(users.displayKey, key)).get() !==
    undefined;

  /** Creates the user on first login, refreshes profile data afterwards. */
  login(identity: ExternalIdentity, opts: { admin?: boolean } = {}): User {
    const now = this.now();
    const forcedAdmin =
      this.config.adminDiscordIds.includes(identity.discordId) || opts.admin === true;
    const existing = this.db
      .select()
      .from(users)
      .where(eq(users.discordId, identity.discordId))
      .get();
    if (existing) {
      this.db
        .update(users)
        .set({
          username: identity.username,
          avatar: identity.avatar ?? existing.avatar,
          lastLoginAt: now,
          isAdmin: existing.isAdmin || forcedAdmin,
        })
        .where(eq(users.id, existing.id))
        .run();
      return this.require(existing.id);
    }
    const displayName = uniqueName(identity.displayName || identity.username, this.nameTaken);
    const id = randomId(12);
    this.db
      .insert(users)
      .values({
        id,
        discordId: identity.discordId,
        username: identity.username,
        displayName,
        displayKey: nameKey(displayName),
        avatar: identity.avatar ?? null,
        isAdmin: forcedAdmin,
        joinToken: newJoinToken(),
        createdAt: now,
        lastLoginAt: now,
      })
      .run();
    return this.require(id);
  }

  setDisplayName(userId: string, raw: string): User {
    const name = sanitizeName(raw);
    if (name.length < 2) throw badRequest('name must have at least 2 printable ASCII characters');
    const key = nameKey(name);
    const owner = this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.displayKey, key))
      .get();
    if (owner && owner.id !== userId) throw conflict(`the name ${name} is already taken`);
    this.db
      .update(users)
      .set({ displayName: name, displayKey: key })
      .where(eq(users.id, userId))
      .run();
    return this.require(userId);
  }

  rotateToken(userId: string): User {
    this.db.update(users).set({ joinToken: newJoinToken() }).where(eq(users.id, userId)).run();
    return this.require(userId);
  }

  setAdmin(userId: string, isAdmin: boolean): User {
    this.require(userId);
    this.db.update(users).set({ isAdmin }).where(eq(users.id, userId)).run();
    return this.require(userId);
  }
}
