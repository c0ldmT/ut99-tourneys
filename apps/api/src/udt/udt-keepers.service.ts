import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { User } from '../auth/users.service.js';
import { badRequest, conflict } from '../common/http.js';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { udtKeepers } from '../db/schema.js';
import { SeasonsService } from '../seasons/seasons.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { UdtService } from './udt.service.js';

export const KeepersBody = z.object({ botIds: z.array(z.string().min(1).max(64)).max(5) });

/** Days before `date` (YYYY-MM-DD), as a date. */
function daysBefore(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

/**
 * Keepers (league plan L-E7): at the end of a season a manager chooses up to two own bots
 * (never bought or nominated ones) that play for them again next season. The choice is open on
 * the season's last days (setting `udt.keepers.days`) and between two seasons; the bots move over
 * when the manager founds the team of the next season (UdtService.createTeam).
 */
@Injectable()
export class UdtKeepersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(UdtService) private readonly udt: UdtService,
  ) {}

  /**
   * The season whose keepers can be chosen now: the running one on its last days, else the
   * newest ended one until the next season starts. `until` is the last day of the choice
   * (null between seasons without a next one planned).
   */
  window(): { season: number; from: string; until: string | null; open: boolean } | null {
    const cfg = this.settings.get().udt.keepers;
    const today = this.udt.today();
    const running = this.seasons.current();
    if (running) {
      const from = daysBefore(running.endDate, cfg.days - 1);
      return { season: running.number, from, until: running.endDate, open: today >= from };
    }
    const last = this.seasons.latestStarted();
    if (!last) return null;
    const next = this.seasons.list().find((s) => s.number === last.number + 1);
    return {
      season: last.number,
      from: daysBefore(last.endDate, cfg.days - 1),
      until: next ? daysBefore(next.startDate, 1) : null,
      open: true,
    };
  }

  /** The keeper choice of a manager: open or not, the bots that can be kept, the ones chosen. */
  view(user: User) {
    this.udt.assertOn();
    const cfg = this.settings.get().udt.keepers;
    const w = this.window();
    const team = w ? this.udt.team(user.id, w.season) : null;
    if (!w || !team || cfg.max <= 0)
      return { open: false, season: w?.season ?? null, max: cfg.max, bots: [], chosen: [] };
    const bots = this.udt.keeperCandidates(user.id, w.season);
    const ok = new Set(bots.filter((b) => b.ok).map((b) => b.botId));
    return {
      open: w.open,
      season: w.season,
      from: w.from,
      until: w.until,
      max: cfg.max,
      skillLoss: cfg.skillLoss,
      tag: team.tag,
      bots,
      // A chosen bot that left the roster or was nominated since does not count.
      chosen: this.chosen(user.id, w.season).filter((id) => ok.has(id)),
    };
  }

  private chosen(userId: string, season: number): string[] {
    return this.db
      .select({ id: udtKeepers.botId })
      .from(udtKeepers)
      .where(and(eq(udtKeepers.season, season), eq(udtKeepers.userId, userId)))
      .all()
      .map((k) => k.id);
  }

  /** Sets the manager's keepers of the season (replaces the earlier choice; empty: none). */
  choose(user: User, botIds: string[]) {
    this.udt.assertOn();
    const cfg = this.settings.get().udt.keepers;
    const w = this.window();
    if (!w || !w.open) throw conflict('keepers are chosen at the end of the season');
    if (!this.udt.team(user.id, w.season)) throw conflict('found your team first');
    const ids = [...new Set(botIds)];
    if (ids.length > cfg.max) throw badRequest('at most {n} keepers', { n: cfg.max });
    const cands = new Map(this.udt.keeperCandidates(user.id, w.season).map((c) => [c.botId, c]));
    for (const id of ids) {
      const c = cands.get(id);
      if (!c) throw badRequest('bot {id} is not yours', { id });
      if (c.why === 'bought')
        throw conflict('{name} was bought: only bots your team made can be kept', {
          name: c.name,
        });
      if (!c.ok) throw conflict('the bot is {status}', { status: c.why ?? '' });
    }
    const now = new Date(this.clock.now()).toISOString();
    this.db.transaction((tx) => {
      tx.delete(udtKeepers)
        .where(and(eq(udtKeepers.season, w.season), eq(udtKeepers.userId, user.id)))
        .run();
      for (const id of ids)
        tx.insert(udtKeepers)
          .values({ season: w.season, userId: user.id, botId: id, chosenAt: now })
          .run();
    });
    return this.view(user);
  }
}
