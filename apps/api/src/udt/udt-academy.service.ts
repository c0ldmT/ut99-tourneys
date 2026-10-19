import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  apprentice,
  BLUEPRINTS,
  buildCost,
  cannotBuild,
  cannotDevelop,
  DEVELOP_COST,
  developPoints,
  developValue,
  levelOf,
  licencePrice,
  scoutPrice,
  scoutTalents,
  talentReport,
  traitOfRarity,
  type DevelopStat,
  type Rarity,
  type Talent,
  type TalentReport,
} from '@tourney/udt';
import { z } from 'zod';
import type { User } from '../auth/users.service.js';
import { BotsService } from '../bots/bots.service.js';
import { badRequest, conflict, notFound } from '../common/http.js';
import { randomId } from '../common/ids.js';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { bots, udtBlueprints, udtBots, udtRoster, udtScouts, udtTraits } from '../db/schema.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { ROSTER_MAX } from './udt-market.service.js';
import { gameName, UdtService } from './udt.service.js';

const BotName = z
  .string()
  .trim()
  .min(2)
  .max(20)
  .regex(/^[\x20-\x7e]+$/, 'ASCII letters, digits and signs only (UT99 names)');

export const SignBody = z.object({ pick: z.number().int().min(0).max(2), name: BotName });
export const MentorBody = z.object({ mentorId: z.string().min(1).max(40), name: BotName });
const Value = z.number().min(-1).max(1);
export const BuildBody = z.object({
  blueprintId: z.string().min(1).max(40),
  name: BotName,
  skill: z.number().int().min(0).max(7),
  traits: z.object({ accuracy: Value, alertness: Value, strafing: Value }),
  botClass: z.string().max(128).optional(),
});
export type BuildInput = z.infer<typeof BuildBody>;

export const DevelopBody = z.object({
  stat: z.enum(['accuracy', 'alertness', 'strafing', 'skill']),
});

const rng = () => randomInt(0, 2 ** 32) / 2 ** 32;

/** A mentor needs some experience in the team: level 3. */
const MENTOR_LEVEL = 3;

/**
 * Dream Team academy: scouting (three talents, values and potential as ranges), creation
 * licences (the starter is the first, then 2,000 / 4,000 / 8,000 × index), apprentices of
 * mentors (bought bots of level 3+, one apprentice each per season), developing own bots with
 * points from their levels up to their potential.
 */
@Injectable()
export class UdtAcademyService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(BotsService) private readonly bots: BotsService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(UdtService) private readonly udt: UdtService,
  ) {}

  private now() {
    return new Date(this.clock.now()).toISOString();
  }

  private made(season: number, userId: string): number {
    return this.udt.ownBots(season, userId).size;
  }

  private scout(season: number, userId: string) {
    return this.db
      .select()
      .from(udtScouts)
      .where(and(eq(udtScouts.season, season), eq(udtScouts.userId, userId)))
      .get();
  }

  private mentorsUsed(season: number): Set<string> {
    return new Set(
      [...this.udt.ownBots(season).values()].flatMap((b) => (b.mentorId ? [b.mentorId] : [])),
    );
  }

  view(user: User) {
    this.udt.assertOn();
    const season = this.udt.season().number;
    const index = this.udt.index(season);
    const team = this.udt.team(user.id, season);
    const made = this.made(season, user.id);
    const roster = team ? this.udt.roster(user.id, season) : [];
    const used = this.mentorsUsed(season);
    const s = this.scout(season, user.id);
    return {
      hasTeam: !!team,
      tag: team?.tag ?? '',
      index,
      scoutPrice: scoutPrice(index),
      licence: { made, nextPrice: licencePrice(made, index) },
      rosterFull: roster.length >= ROSTER_MAX,
      report: s ? (JSON.parse(s.reportJson) as TalentReport[]) : null,
      mentors: roster
        .filter((r) => !r.own && !r.starter)
        .map((r) => ({
          botId: r.botId,
          name: r.name,
          skill: r.skill,
          level: r.level,
          mentorTrait: r.udtTraits.some((t) => t.code === 'mentor'),
          ready: r.level >= MENTOR_LEVEL && !used.has(r.botId),
          used: used.has(r.botId),
        })),
      own: roster.filter((r) => r.own),
      blueprints: this.blueprintsOf(season, user.id).map((b) => ({
        id: b.id,
        rarity: b.rarity,
        rule: BLUEPRINTS[b.rarity as Rarity],
      })),
      /** Models for blueprints of rare and better. */
      botClasses: this.bots.assets().botClasses,
      developCost: DEVELOP_COST,
      mentorLevel: MENTOR_LEVEL,
    };
  }

  /** A new scout report: three talents (replaces the last report). */
  scoutNow(user: User) {
    this.udt.assertOn();
    const season = this.udt.season().number;
    if (!this.udt.team(user.id, season)) throw conflict('found your team first');
    const price = scoutPrice(this.udt.index(season));
    this.ledger.charge({
      userId: user.id,
      kind: 'udt_scout',
      amount: price,
      ref: `scout:${season}:${user.id}:${randomId(8)}`,
    });
    const taken = this.bots.list().map((b) => b.name);
    const talents = scoutTalents(rng, taken);
    const report = talents.map((t) => talentReport(t, rng));
    this.db
      .insert(udtScouts)
      .values({
        season,
        userId: user.id,
        talentsJson: JSON.stringify(talents),
        reportJson: JSON.stringify(report),
        createdAt: this.now(),
      })
      .onConflictDoUpdate({
        target: [udtScouts.season, udtScouts.userId],
        set: {
          talentsJson: JSON.stringify(talents),
          reportJson: JSON.stringify(report),
          createdAt: this.now(),
        },
      })
      .run();
    return this.view(user);
  }

  /** Checks room, the game name and the licence; charges it. */
  private licence(user: User, season: number, name: string): void {
    const team = this.udt.team(user.id, season);
    if (!team) throw conflict('found your team first');
    if (this.udt.roster(user.id, season).length >= ROSTER_MAX)
      throw conflict(`at most ${ROSTER_MAX} bots: make room first`);
    if (gameName(team.tag, name).length < `${team.tag}${name}`.length)
      throw badRequest(`${team.tag}${name} is too long for the game`);
    const made = this.made(season, user.id);
    const price = licencePrice(made, this.udt.index(season));
    if (price === null) throw conflict(`at most ${made} own bots per season`);
    if (price > 0)
      this.ledger.charge({
        userId: user.id,
        kind: 'udt_licence',
        amount: price,
        ref: `licence:${season}:${user.id}:${made}`,
        meta: { name },
      });
  }

  /** Makes the bot in the library (the manager's, inactive) and puts it into the roster. */
  private create(
    user: User,
    season: number,
    t: Talent,
    name: string,
    origin: 'academy' | 'apprentice' | 'blueprint',
    mentorId: string | null,
    botClass?: string,
  ): string {
    const bot = this.bots.create({
      name,
      skill: t.skill,
      ...(botClass ? { botClass } : {}),
      traits: {
        accuracy: t.values.accuracy,
        alertness: t.values.alertness,
        strafing: t.values.strafing,
        combatStyle: t.values.combatStyle,
        camping: t.values.camping,
      },
      active: false,
    });
    this.db
      .update(bots)
      .set({ udtOwner: user.id, udtOrigin: origin })
      .where(eq(bots.id, bot.id))
      .run();
    const now = this.now();
    this.db
      .insert(udtRoster)
      .values({ season, botId: bot.id, userId: user.id, price: 0, acquiredAt: now })
      .run();
    this.db
      .insert(udtBots)
      .values({
        botId: bot.id,
        season,
        userId: user.id,
        origin,
        potential: t.potential,
        mentorId,
        createdAt: now,
      })
      .run();
    return bot.id;
  }

  /** Signs a talent of the report (needs a licence); the report is used up. */
  sign(user: User, body: z.infer<typeof SignBody>) {
    this.udt.assertOn();
    const season = this.udt.season().number;
    const s = this.scout(season, user.id);
    if (!s) throw conflict('scout first');
    const talent = (JSON.parse(s.talentsJson) as Talent[])[body.pick];
    if (!talent) throw notFound('talent');
    if (this.bots.list().some((b) => b.name.toLowerCase() === body.name.toLowerCase()))
      throw conflict(`a bot is called ${body.name} already`);
    this.licence(user, season, body.name);
    this.create(user, season, talent, body.name, 'academy', null);
    this.db
      .delete(udtScouts)
      .where(and(eq(udtScouts.season, season), eq(udtScouts.userId, user.id)))
      .run();
    return this.view(user);
  }

  /** A mentor (bought bot of level 3+) takes an apprentice: leaning values, maybe a trait. */
  mentor(user: User, body: z.infer<typeof MentorBody>) {
    this.udt.assertOn();
    const season = this.udt.season().number;
    const m = this.udt.roster(user.id, season).find((r) => r.botId === body.mentorId);
    if (!m) throw notFound('mentor in your roster');
    if (m.own || m.starter) throw conflict('a mentor is a bought bot, not one you made');
    if (m.level < MENTOR_LEVEL) throw conflict(`a mentor needs level ${MENTOR_LEVEL}`);
    if (this.mentorsUsed(season).has(m.botId))
      throw conflict(`${m.name} has an apprentice this season`);
    if (this.bots.list().some((b) => b.name.toLowerCase() === body.name.toLowerCase()))
      throw conflict(`a bot is called ${body.name} already`);
    this.licence(user, season, body.name);
    const t = apprentice(
      {
        skill: m.skill,
        values: { ...m.traits },
        traitCodes: m.udtTraits.map((x) => x.code),
      },
      body.name,
      m.udtTraits.some((x) => x.code === 'mentor'),
      rng,
    );
    const id = this.create(user, season, t, body.name, 'apprentice', m.botId);
    if (t.inherited)
      this.db
        .insert(udtTraits)
        .values({
          id: `t${randomId(12)}`,
          season,
          userId: user.id,
          code: t.inherited,
          botId: id,
          source: 'mentor',
          createdAt: this.now(),
          assignedAt: this.now(),
        })
        .run();
    return { ...this.view(user), apprentice: { botId: id, inherited: t.inherited } };
  }

  private blueprintsOf(season: number, userId: string) {
    return this.db
      .select()
      .from(udtBlueprints)
      .where(
        and(
          eq(udtBlueprints.season, season),
          eq(udtBlueprints.userId, userId),
          isNull(udtBlueprints.usedAt),
        ),
      )
      .all();
  }

  /**
   * Builds an own bot from a blueprint (needs a licence): skill and values within the
   * blueprint's points, the model from rare on, a start trait from signature blueprints.
   */
  build(user: User, body: BuildInput) {
    this.udt.assertOn();
    const season = this.udt.season().number;
    const bp = this.blueprintsOf(season, user.id).find((b) => b.id === body.blueprintId);
    if (!bp) throw notFound('blueprint');
    const rarity = bp.rarity as Rarity;
    const rule = BLUEPRINTS[rarity];
    const why = cannotBuild(rarity, body.skill, body.traits);
    if (why === 'skill') throw badRequest(`this blueprint builds up to skill ${rule.skillCap}`);
    if (why === 'budget')
      throw badRequest(
        `the build costs ${buildCost(body.skill, body.traits)} of ${rule.budget} points: lower skill or values`,
      );
    if (body.botClass && !rule.models)
      throw badRequest('the model can be chosen from rare blueprints');
    if (body.botClass && !this.bots.assets().botClasses.some((c) => c.name === body.botClass))
      throw badRequest('unknown bot class');
    if (this.bots.list().some((b) => b.name.toLowerCase() === body.name.toLowerCase()))
      throw conflict(`a bot is called ${body.name} already`);
    this.licence(user, season, body.name);
    const id = this.create(
      user,
      season,
      {
        name: body.name,
        skill: body.skill,
        values: { ...body.traits, combatStyle: 0, camping: 0 },
        potential: Math.min(7, body.skill + rule.potentialUp),
      },
      body.name,
      'blueprint',
      null,
      body.botClass,
    );
    let startTrait: string | null = null;
    if (rule.startTrait) {
      startTrait = traitOfRarity(rule.startTrait, rng).code;
      this.db
        .insert(udtTraits)
        .values({
          id: `t${randomId(12)}`,
          season,
          userId: user.id,
          code: startTrait,
          botId: id,
          source: 'blueprint',
          createdAt: this.now(),
          assignedAt: this.now(),
        })
        .run();
    }
    this.db
      .update(udtBlueprints)
      .set({ usedAt: this.now(), botId: id })
      .where(eq(udtBlueprints.id, bp.id))
      .run();
    return { ...this.view(user), built: { botId: id, startTrait } };
  }

  /** Spends development points of an own bot: +5 on a value, or a skill step up to the potential. */
  develop(user: User, botId: string, stat: DevelopStat) {
    this.udt.assertOn();
    const season = this.udt.season().number;
    const own = this.udt.ownBots(season, user.id).get(botId);
    const r = this.udt.roster(user.id, season).find((x) => x.botId === botId);
    if (!own || !r) throw notFound('own bot in your roster');
    const level = levelOf(r.xp);
    const points = developPoints(level, own.pointsSpent);
    const why = cannotDevelop(
      stat,
      { skill: r.skill, potential: own.potential, values: r.traits },
      points,
    );
    if (why === 'points') throw conflict('not enough development points (one per level)');
    if (why === 'potential') throw conflict(`the potential is skill ${own.potential}`);
    if (why === 'max') throw conflict('the value is at its maximum');
    if (stat === 'skill') this.bots.update(botId, { skill: Math.round(r.skill) + 1 });
    else this.bots.update(botId, { traits: { ...r.traits, [stat]: developValue(r.traits[stat]) } });
    this.db
      .update(udtBots)
      .set({ pointsSpent: own.pointsSpent + DEVELOP_COST[stat] })
      .where(eq(udtBots.botId, botId))
      .run();
    return this.udt.view(user);
  }
}
