import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { dailyForm, valueScore } from '@tourney/udt';
import { BetsService } from '../bets/bets.service.js';
import { DB, type Db } from '../db/database.js';
import { udtBlueprints, udtBotDays, udtTeamDays } from '../db/schema.js';
import type { Season } from '../seasons/seasons.service.js';
import { UdtCareerService } from './udt-career.service.js';
import { UdtService } from './udt.service.js';

/** What the market day already knows (so the snapshot does not compute it again). */
export interface SnapshotInput {
  /** Managers counted for the economy index. */
  active: ReadonlySet<string>;
  /** Weekly salary per roster bot (the market's rule, `botSalary`). */
  salary: ReadonlyMap<string, number>;
}

/**
 * A snapshot of every Dream Team team and roster bot per market day (decision 244): money,
 * roster value, salaries, strikes, and per bot skill, level, experience, points, potential,
 * value, stamina, form and traits. The website keeps no other history of these (wallets can be
 * replayed from bets and ledger, a bot's development cannot), so the analyses of a season (the
 * economy against the simulator, how fast bots develop) read these tables. A day already taken
 * is replaced (test mode: market day again). Written after the market day's salaries, before the
 * AI managers act; never in the way of the market day (errors are only logged by the caller).
 */
@Injectable()
export class UdtSnapshotService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(UdtService) private readonly udt: UdtService,
    @Inject(BetsService) private readonly bets: BetsService,
    @Inject(UdtCareerService) private readonly career: UdtCareerService,
  ) {}

  /** Takes the snapshot of `day`; returns the number of teams and bots written. */
  take(season: Season, day: string, input: SnapshotInput): { teams: number; bots: number } {
    const s = season.number;
    const ai = this.udt.aiIds();
    const own = this.udt.ownBots(s);
    const careers = this.career.careers();
    const blueprints = new Map<string, number>();
    for (const b of this.db
      .select({ userId: udtBlueprints.userId })
      .from(udtBlueprints)
      .where(and(eq(udtBlueprints.season, s), isNull(udtBlueprints.usedAt)))
      .all())
      blueprints.set(b.userId, (blueprints.get(b.userId) ?? 0) + 1);
    let bots = 0;
    const teams = this.udt.teams(s);
    this.db.transaction((tx) => {
      for (const t of teams) {
        const roster = this.udt.roster(t.userId, s);
        const wallet = this.bets.wallet(t.userId, season);
        let rosterValue = 0;
        let salaryWeek = 0;
        let salaryDue = 0;
        let striking = 0;
        let traits = 0;
        for (const r of roster) {
          const o = own.get(r.botId);
          const salary = input.salary.get(r.botId) ?? 0;
          rosterValue += r.starter ? 0 : r.value;
          salaryWeek += salary;
          salaryDue += r.salaryDue;
          if (r.striking) striking++;
          traits += r.udtTraits.length;
          const row = {
            day,
            season: s,
            botId: r.botId,
            userId: t.userId,
            origin: o?.origin ?? 'bought',
            skill: r.skill,
            effSkill: r.effective.skill,
            valueScore: Math.round(valueScore(r.effective.traits) * 1000) / 1000,
            level: r.level,
            xp: r.xp,
            pointsSpent: o?.pointsSpent ?? 0,
            potential: o?.potential ?? null,
            value: r.value,
            capValue: r.capValue,
            price: r.price,
            salary,
            stamina: r.stamina,
            form: dailyForm(r.botId, day),
            phase: careers.get(r.botId)?.phase ?? null,
            games: r.games,
            dmSlot: r.dmSlot,
            bench: r.bench,
            striking: r.striking,
            traitCodes: r.udtTraits.map((c) => c.code).join(' '),
          };
          tx.insert(udtBotDays)
            .values(row)
            .onConflictDoUpdate({ target: [udtBotDays.day, udtBotDays.botId], set: row })
            .run();
          bots++;
        }
        const best = roster
          .map((r) => r.effective.skill)
          .sort((a, b) => b - a)
          .slice(0, 5);
        const row = {
          day,
          season: s,
          userId: t.userId,
          ai: ai.has(t.userId),
          active: input.active.has(t.userId),
          cash: wallet.balance,
          staked: wallet.staked,
          book: roster.reduce((n, r) => n + r.price, 0),
          rosterValue,
          salaryWeek,
          salaryDue,
          roster: roster.length,
          striking,
          top5Skill: best.length
            ? Math.round((best.reduce((a, b) => a + b, 0) / best.length) * 100) / 100
            : 0,
          traits,
          blueprints: blueprints.get(t.userId) ?? 0,
        };
        tx.insert(udtTeamDays)
          .values(row)
          .onConflictDoUpdate({ target: [udtTeamDays.day, udtTeamDays.userId], set: row })
          .run();
      }
    });
    return { teams: teams.length, bots };
  }
}
