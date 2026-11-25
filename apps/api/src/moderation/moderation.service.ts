import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import {
  bots,
  moderationItems,
  moderationLog,
  moderationReports,
  teams,
  udtTeams,
  udtTrades,
  users,
} from '../db/schema.js';
import { badRequest, conflict, forbidden, notFound } from '../common/http.js';
import { randomId } from '../common/ids.js';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { nameKey } from '../common/names.js';
import { isModerator } from '../auth/guard.js';
import { UsersService, type User } from '../auth/users.service.js';
import { BotsService } from '../bots/bots.service.js';
import { SettingsService, type ModerationSettings } from '../settings/settings.service.js';
import { checkText, cleanList, type FilterHit, type FilterLists } from './filter.js';
import { BUILTIN_BLOCK, BUILTIN_FLAG } from './word-lists.js';

/** What a moderated text belongs to (decision 283). */
export const MOD_KINDS = ['name', 'udt-team', 'udt-bot', 'bot-lines', 'team', 'trade'] as const;
export type ModKind = (typeof MOD_KINDS)[number];

export type Sanction = 'warn' | 'text-ban' | 'ban' | 'unban';

/** "For good": a ban that never ends. */
const FOREVER = '9999-12-31T00:00:00.000Z';
const DAY = 86_400_000;

type Item = typeof moderationItems.$inferSelect;

/**
 * Moderation (decision 283): the word filter for what players type, the queue of flagged and
 * reported texts, resets, sanctions and the log. Post-moderation: a blocked word is refused when
 * typed, a flagged one is saved and queued, everything else shows at once and can be reported.
 */
@Injectable()
export class ModerationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(LOGGER) private readonly log: ApiLogger,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(BotsService) private readonly bots: BotsService,
  ) {}

  private now() {
    return new Date(this.clock.now()).toISOString();
  }

  // ------------------------------------------------------------------------------------------
  // Filter
  // ------------------------------------------------------------------------------------------

  lists(): FilterLists {
    const m = this.settings.get().moderation;
    return {
      block: [...(m.builtin ? BUILTIN_BLOCK : []), ...m.block],
      flag: [...(m.builtin ? BUILTIN_FLAG : []), ...m.flag],
      allow: m.allow,
    };
  }

  /** The worst hit among texts (block before flag). */
  check(texts: readonly (string | null | undefined)[]): FilterHit | null {
    const lists = this.lists();
    let flagged: FilterHit | null = null;
    for (const t of texts) {
      if (!t) continue;
      const hit = checkText(t, lists);
      if (hit?.level === 'block') return hit;
      flagged ??= hit;
    }
    return flagged;
  }

  /**
   * Before a player's text is saved: a text ban and blocked words refuse it (the writer never
   * learns which word). Flagged texts are queued afterwards with `review`.
   */
  screen(user: User, texts: readonly (string | null | undefined)[]): FilterHit | null {
    if (user.textBanUntil && Date.parse(user.textBanUntil) > this.clock.now())
      throw forbidden('you cannot change names and texts until {until}', {
        until: user.textBanUntil.slice(0, 10),
      });
    const hit = this.check(texts);
    if (hit?.level === 'block') {
      this.log.info(`moderation: blocked a text of ${user.displayName} (${hit.term})`);
      throw badRequest('this text is not allowed here');
    }
    return hit;
  }

  /**
   * After a player's text was saved: a flagged one goes into the queue (one open item per
   * text). Never throws (the text is saved already).
   */
  review(kind: ModKind, ref: string): void {
    try {
      const cur = this.currentText(kind, ref);
      if (!cur) return;
      const hit = this.check([cur.text]);
      if (hit) this.upsert(kind, ref, cur.userId, cur.text, 'filter', hit.term);
    } catch (e) {
      this.log.warn(`moderation: review ${kind}:${ref}: ${(e as Error).message}`);
    }
  }

  /**
   * A new player's name from Discord (decision 283): a blocked one becomes "Player1234", a
   * flagged one is queued.
   */
  newPlayer(user: User): User {
    const hit = this.check([user.displayName]);
    if (hit?.level === 'block') {
      this.reset('name', user.id);
      this.audit(null, 'reset', user.id, 'name', user.id, { text: user.displayName, auto: true });
      return this.users.require(user.id);
    }
    if (hit) this.review('name', user.id);
    return user;
  }

  private open(kind: string, ref: string): Item | undefined {
    return this.db
      .select()
      .from(moderationItems)
      .where(
        and(
          eq(moderationItems.kind, kind),
          eq(moderationItems.ref, ref),
          eq(moderationItems.status, 'open'),
        ),
      )
      .get();
  }

  private upsert(
    kind: ModKind,
    ref: string,
    userId: string | null,
    text: string,
    source: 'filter' | 'report' | 'scan',
    term: string | null,
  ): Item {
    const now = this.now();
    const cur = this.open(kind, ref);
    if (cur) {
      this.db
        .update(moderationItems)
        .set({ text, updatedAt: now, ...(term && !cur.term ? { term } : {}) })
        .where(eq(moderationItems.id, cur.id))
        .run();
      return this.db.select().from(moderationItems).where(eq(moderationItems.id, cur.id)).get()!;
    }
    const id = `m${randomId(12)}`;
    this.db
      .insert(moderationItems)
      .values({ id, kind, ref, userId, text, source, term, createdAt: now, updatedAt: now })
      .run();
    return this.db.select().from(moderationItems).where(eq(moderationItems.id, id)).get()!;
  }

  // ------------------------------------------------------------------------------------------
  // The texts
  // ------------------------------------------------------------------------------------------

  /** The text a kind and ref stand for now, and who wrote it. */
  currentText(kind: string, ref: string): { text: string; userId: string | null } | null {
    switch (kind) {
      case 'name': {
        const u = this.users.byId(ref);
        return u ? { text: u.displayName, userId: u.id } : null;
      }
      case 'udt-team': {
        const [season, userId] = ref.split('/');
        const t = this.db
          .select()
          .from(udtTeams)
          .where(and(eq(udtTeams.season, Number(season)), eq(udtTeams.userId, userId ?? '')))
          .get();
        return t ? { text: `${t.tag} ${t.name}`, userId: t.userId } : null;
      }
      case 'udt-bot': {
        const b = this.bots.get(ref);
        return b ? { text: b.name, userId: b.udtOwner ?? null } : null;
      }
      case 'bot-lines': {
        const b = this.bots.get(ref);
        const lines = b?.personality.lines.map((l) => l.text) ?? [];
        return b && lines.length ? { text: lines.join(' | '), userId: b.udtOwner ?? null } : null;
      }
      case 'team': {
        const t = this.db.select().from(teams).where(eq(teams.id, ref)).get();
        return t ? { text: `${t.tag ? `${t.tag} ` : ''}${t.name}`, userId: t.captainId } : null;
      }
      case 'trade': {
        const t = this.db.select().from(udtTrades).where(eq(udtTrades.id, ref)).get();
        return t?.message ? { text: t.message, userId: t.fromUser } : null;
      }
      default:
        return null;
    }
  }

  /** Replaces a text with a neutral one (the writer is told). */
  private reset(kind: string, ref: string): void {
    const n = () => String(1000 + Math.floor(Math.random() * 9000));
    switch (kind) {
      case 'name': {
        for (let i = 0; i < 50; i++) {
          try {
            this.users.setDisplayName(ref, `Player${n()}`);
            return;
          } catch {
            // taken: another number
          }
        }
        throw conflict('no free name');
      }
      case 'udt-team': {
        const [season, userId] = ref.split('/');
        const num = n();
        this.db
          .update(udtTeams)
          .set({
            name: `Team ${num}`,
            nameKey: `team ${num}`,
            tag: `T${num}`,
            tagKey: `t${num}`,
          })
          .where(and(eq(udtTeams.season, Number(season)), eq(udtTeams.userId, userId ?? '')))
          .run();
        return;
      }
      case 'udt-bot': {
        for (let i = 0; i < 50; i++) {
          try {
            this.bots.update(ref, { name: `Bot${n()}` });
            return;
          } catch {
            // taken: another number
          }
        }
        throw conflict('no free name');
      }
      case 'bot-lines':
        this.bots.update(ref, { personality: { lines: [] } });
        return;
      case 'team': {
        const num = n();
        this.db
          .update(teams)
          .set({ name: `Team ${num}`, nameKey: nameKey(`Team ${num}`), tag: null })
          .where(eq(teams.id, ref))
          .run();
        return;
      }
      case 'trade':
        this.db.update(udtTrades).set({ message: null }).where(eq(udtTrades.id, ref)).run();
        return;
      default:
        throw badRequest('unknown kind {kind}', { kind });
    }
  }

  // ------------------------------------------------------------------------------------------
  // Reports
  // ------------------------------------------------------------------------------------------

  /** A player reports a text (once per player and item; reasons for the moderators). */
  report(user: User, kind: ModKind, ref: string, reason: string): void {
    const cur = this.currentText(kind, ref);
    if (!cur) throw conflict('nothing to report');
    if (cur.userId === user.id) throw conflict('you cannot report your own text');
    const item = this.upsert(kind, ref, cur.userId, cur.text, 'report', null);
    const done = this.db
      .insert(moderationReports)
      .values({ itemId: item.id, userId: user.id, reason, createdAt: this.now() })
      .onConflictDoNothing()
      .run();
    if (done.changes)
      this.db
        .update(moderationItems)
        .set({ reports: sql`${moderationItems.reports} + 1` })
        .where(eq(moderationItems.id, item.id))
        .run();
  }

  // ------------------------------------------------------------------------------------------
  // The queue
  // ------------------------------------------------------------------------------------------

  /** Open items first (most reports, then oldest), or decided ones (newest first). */
  queue(status: 'open' | 'done') {
    const rows = this.db
      .select()
      .from(moderationItems)
      .where(
        status === 'open'
          ? eq(moderationItems.status, 'open')
          : inArray(moderationItems.status, ['ok', 'reset']),
      )
      .orderBy(status === 'open' ? desc(moderationItems.reports) : desc(moderationItems.decidedAt))
      .limit(200)
      .all();
    if (status === 'open')
      rows.sort((a, b) => b.reports - a.reports || cmp(a.createdAt, b.createdAt));
    const reasons = rows.length
      ? this.db
          .select()
          .from(moderationReports)
          .where(
            inArray(
              moderationReports.itemId,
              rows.map((r) => r.id),
            ),
          )
          .all()
      : [];
    const name = (id: string | null) => (id ? (this.users.byId(id)?.displayName ?? id) : null);
    return rows.map((r) => {
      const author = r.userId ? this.users.byId(r.userId) : undefined;
      return {
        id: r.id,
        kind: r.kind,
        ref: r.ref,
        text: r.text,
        // The text now (it may have changed or been reset meanwhile).
        current: this.currentText(r.kind, r.ref)?.text ?? null,
        source: r.source,
        term: r.term,
        reports: r.reports,
        reasons: reasons
          .filter((x) => x.itemId === r.id)
          .map((x) => ({ by: name(x.userId), reason: x.reason, at: x.createdAt })),
        status: r.status,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt,
        decidedBy: name(r.decidedBy),
        author: author
          ? {
              id: author.id,
              displayName: author.displayName,
              warnings: author.warnings,
              textBanUntil: author.textBanUntil,
              bannedUntil: author.bannedUntil,
              moderator: isModerator(author),
            }
          : null,
      };
    });
  }

  /** Leaves a text as it is, or resets it (the writer gets a notice). */
  decide(mod: User, itemId: string, action: 'ok' | 'reset'): void {
    const item = this.db.select().from(moderationItems).where(eq(moderationItems.id, itemId)).get();
    if (!item) throw notFound('moderation item');
    if (item.status !== 'open') throw conflict('already decided');
    if (action === 'reset') {
      this.reset(item.kind, item.ref);
      if (item.userId) this.users.notify(item.userId, 'mod-reset', { kind: item.kind });
    }
    this.db
      .update(moderationItems)
      .set({ status: action, decidedBy: mod.id, decidedAt: this.now() })
      .where(eq(moderationItems.id, itemId))
      .run();
    this.audit(mod, action, item.userId, item.kind, item.ref, { text: item.text });
  }

  // ------------------------------------------------------------------------------------------
  // Sanctions and roles
  // ------------------------------------------------------------------------------------------

  /**
   * Warn, text ban (n days), login ban (n days, 0 = for good) or lift both bans. Moderators and
   * admins can only be sanctioned by an admin; nobody sanctions themselves.
   */
  sanction(mod: User, userId: string, action: Sanction, days = 0, reason = ''): User {
    const target = this.users.require(userId);
    if (target.id === mod.id) throw forbidden('not yourself');
    if (isModerator(target) && !mod.isAdmin)
      throw forbidden('only admins can do this to moderators');
    if (target.isAdmin && action !== 'warn') throw forbidden('admins cannot be banned');
    const until = (d: number) =>
      d > 0 ? new Date(this.clock.now() + d * DAY).toISOString() : FOREVER;
    switch (action) {
      case 'warn':
        this.db
          .update(users)
          .set({ warnings: sql`${users.warnings} + 1` })
          .where(eq(users.id, userId))
          .run();
        this.users.notify(userId, 'mod-warn', { reason });
        break;
      case 'text-ban': {
        if (days <= 0) throw badRequest('a text ban needs days');
        const at = until(days);
        this.db.update(users).set({ textBanUntil: at }).where(eq(users.id, userId)).run();
        this.users.notify(userId, 'mod-textban', { until: at, reason });
        break;
      }
      case 'ban':
        this.db
          .update(users)
          .set({ bannedUntil: until(days) })
          .where(eq(users.id, userId))
          .run();
        break;
      case 'unban':
        this.db
          .update(users)
          .set({ bannedUntil: null, textBanUntil: null })
          .where(eq(users.id, userId))
          .run();
        break;
    }
    this.audit(mod, action, userId, null, null, { days, reason });
    return this.users.require(userId);
  }

  setModerator(admin: User, userId: string, on: boolean): User {
    this.users.require(userId);
    this.db.update(users).set({ isModerator: on }).where(eq(users.id, userId)).run();
    this.audit(admin, on ? 'moderator' : 'moderator-off', userId, null, null, {});
    return this.users.require(userId);
  }

  // ------------------------------------------------------------------------------------------
  // Lists, scan, log
  // ------------------------------------------------------------------------------------------

  settingsView() {
    const m = this.settings.get().moderation;
    return { ...m, builtinBlock: BUILTIN_BLOCK.length, builtinFlag: BUILTIN_FLAG.length };
  }

  setLists(mod: User, value: Partial<ModerationSettings>) {
    const clean = {
      ...(value.builtin !== undefined ? { builtin: value.builtin } : {}),
      ...(value.block ? { block: cleanList(value.block) } : {}),
      ...(value.flag ? { flag: cleanList(value.flag) } : {}),
      ...(value.allow ? { allow: cleanList(value.allow) } : {}),
    };
    this.settings.setModeration(clean);
    this.audit(mod, 'lists', null, null, null, clean);
    return this.settingsView();
  }

  /**
   * Checks every existing text against the lists (after the lists changed, or going live):
   * hits go into the queue as "scan" (nothing is changed by itself).
   */
  scan(mod: User): { checked: number; queued: number } {
    let checked = 0;
    let queued = 0;
    const take = (kind: ModKind, ref: string, text: string, userId: string | null) => {
      checked++;
      const hit = this.check([text]);
      if (!hit) return;
      const had = this.open(kind, ref);
      this.upsert(kind, ref, userId, text, 'scan', hit.term);
      if (!had) queued++;
    };
    for (const u of this.users.list()) take('name', u.id, u.displayName, u.id);
    for (const t of this.db.select().from(udtTeams).all())
      take('udt-team', `${t.season}/${t.userId}`, `${t.tag} ${t.name}`, t.userId);
    for (const b of this.db.select().from(bots).all()) {
      const lib = this.bots.get(b.id);
      if (!lib?.udtOwner) continue;
      take('udt-bot', b.id, lib.name, lib.udtOwner);
      const lines = lib.personality.lines.map((l) => l.text);
      if (lines.length) take('bot-lines', b.id, lines.join(' | '), lib.udtOwner);
    }
    for (const t of this.db.select().from(teams).all())
      take('team', t.id, `${t.tag ? `${t.tag} ` : ''}${t.name}`, t.captainId);
    for (const t of this.db.select().from(udtTrades).all())
      if (t.message) take('trade', t.id, t.message, t.fromUser);
    this.audit(mod, 'scan', null, null, null, { checked, queued });
    return { checked, queued };
  }

  private audit(
    by: User | null,
    action: string,
    targetUser: string | null,
    kind: string | null,
    ref: string | null,
    detail: Record<string, unknown>,
  ): void {
    this.db
      .insert(moderationLog)
      .values({
        id: `l${randomId(12)}`,
        at: this.now(),
        byUser: by?.id ?? null,
        action,
        targetUser,
        kind,
        ref,
        detailJson: JSON.stringify(detail),
      })
      .run();
    this.log.info(
      `moderation: ${by?.displayName ?? 'system'} ${action}${targetUser ? ` ${targetUser}` : ''}${kind ? ` ${kind}:${ref}` : ''}`,
    );
  }

  auditLog() {
    const name = (id: string | null) => (id ? (this.users.byId(id)?.displayName ?? id) : null);
    return this.db
      .select()
      .from(moderationLog)
      .orderBy(desc(moderationLog.at))
      .limit(200)
      .all()
      .map((l) => ({
        id: l.id,
        at: l.at,
        by: name(l.byUser),
        action: l.action,
        target: name(l.targetUser),
        kind: l.kind,
        ref: l.ref,
        detail: l.detailJson ? (JSON.parse(l.detailJson) as Record<string, unknown>) : {},
      }));
  }

  /** Open items for the moderators' counter in the header. */
  openCount(): number {
    return (
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(moderationItems)
        .where(eq(moderationItems.status, 'open'))
        .get()?.n ?? 0
    );
  }
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
