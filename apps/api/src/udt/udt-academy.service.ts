import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  drawPotentialWindow,
  apprenticeTraitChance,
  inheritedTrait,
  mentorLesson,
  BLUEPRINTS,
  blueprintPotential,
  BREAKTHROUGH_LEVEL,
  BREAKTHROUGH_VALUE,
  breakthroughStep,
  breakthroughValues,
  buildCost,
  cannotBreakthrough,
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
import {
  BotLookBody,
  gameName,
  lookFields,
  UdtService,
  windowOf,
  type BotLook,
  type RosterBot,
} from './udt.service.js';

export const BotName = z
  .string()
  .trim()
  .min(2)
  .max(20)
  .regex(/^[\x20-\x7e]+$/, 'ASCII letters, digits and signs only (UT99 names)');

export const SignBody = z.object({
  pick: z.number().int().min(0).max(2),
  name: BotName,
  look: BotLookBody.optional(),
});
export const MentorBody = z.object({
  mentorId: z.string().min(1).max(40),
  /** A bot the team made: it learns from the mentor (no new bot, decision 208). */
  apprenticeId: z.string().min(1).max(40),
});
const Value = z.number().min(-1).max(1);
export const BuildBody = z.object({
  blueprintId: z.string().min(1).max(40),
  name: BotName,
  /** Blueprints build skill 3; another skill is refused (older clients sent their choice). */
  skill: z.number().int().min(0).max(7).optional(),
  traits: z.object({ accuracy: Value, alertness: Value, strafing: Value }),
  botClass: z.string().max(128).optional(),
  look: BotLookBody.optional(),
});
export type BuildInput = z.infer<typeof BuildBody>;

export const DevelopBody = z.object({
  stat: z.enum(['accuracy', 'alertness', 'strafing', 'skill']),
});

const rng = () => randomInt(0, 2 ** 32) / 2 ** 32;

/** A mentor needs some experience in the team: level 3 (bought or own bots, decision 207). */
const MENTOR_LEVEL = 3;

/**
 * Dream Team academy: scouting (three talents, values and potential as ranges), creation
 * licences (the starter is the first, then 2,000 / 4,000 / 8,000 × index), apprentices of
 * mentors (any roster bot of level 3+, one apprentice each per season), developing own bots with
 * points from their levels up to their potential.
 */
/** The model a new bot gets: the look's (even empty: the default) before the blueprint's. */
function modelOf(botClass: string | undefined, look: BotLook | undefined): string | undefined {
  return look?.botClass !== undefined ? look.botClass : botClass;
}

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

  /** Bots the manager made this season (licences count them, also after a trade). */
  private made(season: number, userId: string): number {
    return this.udt.madeCount(season, userId);
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
    const own = this.udt.ownBots(season, user.id);
    const s = this.scout(season, user.id);
    return {
      hasTeam: !!team,
      tag: team?.tag ?? '',
      index,
      scoutPrice: scoutPrice(index),
      licence: { made, nextPrice: licencePrice(made, index) },
      rosterFull: roster.length >= ROSTER_MAX,
      report: s ? (JSON.parse(s.reportJson) as TalentReport[]) : null,
      mentors: roster.map((r) => {
        const mentorTrait = r.udtTraits.some((t) => t.code === 'mentor');
        return {
          botId: r.botId,
          name: r.name,
          skill: r.skill,
          level: r.level,
          own: !!r.own,
          mentorTrait,
          ready: r.level >= MENTOR_LEVEL && !used.has(r.botId),
          used: used.has(r.botId),
          /** Traits that can be passed on and the chance that one is. */
          traits: r.udtTraits.filter((x) => x.code !== 'mentor').map((x) => x.code),
          inheritChance: apprenticeTraitChance(mentorTrait),
          /** Bots the team made that could learn from it, with their values before and after. */
          pupils: roster
            .filter((p) => canLearn(p, r, own))
            .map((p) => ({
              botId: p.botId,
              name: p.name,
              skill: p.skill,
              level: p.level,
              before: pick(p.traits),
              after: mentorLesson(r.traits, p.traits, mentorTrait),
            })),
        };
      }),
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
      throw conflict('at most {max} bots: make room first', { max: ROSTER_MAX });
    if (gameName(team.tag, name).length < `${team.tag}${name}`.length)
      throw badRequest('{tag}{name} is too long for the game', { tag: team.tag, name });
    const made = this.made(season, user.id);
    const price = licencePrice(made, this.udt.index(season));
    if (price === null) throw conflict('at most {made} own bots per season', { made });
    if (price > 0)
      this.ledger.charge({
        userId: user.id,
        kind: 'udt_licence',
        amount: price,
        ref: `licence:${season}:${user.id}:${made}`,
        meta: { name },
      });
  }

  /** Model, skin, face and voice must fit (checked before the licence is paid). */
  private checkLook(botClass: string | undefined, look: BotLook | undefined): void {
    if (!botClass && !look) return;
    this.bots.assertLook({
      botClass: modelOf(botClass, look),
      skin: look?.skin,
      face: look?.face,
      voice: look?.voice,
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
    window: [number, number],
    botClass?: string,
    look?: BotLook,
  ): string {
    const cls = modelOf(botClass, look);
    const bot = this.bots.create({
      name,
      skill: t.skill,
      ...lookFields(look),
      ...(cls ? { botClass: cls } : {}),
      traits: {
        accuracy: t.values.accuracy,
        alertness: t.values.alertness,
        strafing: t.values.strafing,
        combatStyle: t.values.combatStyle,
        camping: t.values.camping,
        ...(look?.voice ? { voice: look.voice } : {}),
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
        madeBy: user.id,
        origin,
        potential: t.potential,
        ...windowOf(window),
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
    // The roster keeps the window the report showed (no second window to cross with it).
    const shown = (JSON.parse(s.reportJson) as TalentReport[])[body.pick]?.potential;
    if (this.bots.list().some((b) => b.name.toLowerCase() === body.name.toLowerCase()))
      throw conflict('a bot is called {name} already', { name: body.name });
    this.checkLook(undefined, body.look);
    this.licence(user, season, body.name);
    this.create(
      user,
      season,
      talent,
      body.name,
      'academy',
      null,
      shown ?? drawPotentialWindow(talent.potential, talent.skill, [talent.skill, 7], Math.random),
      undefined,
      body.look,
    );
    this.db
      .delete(udtScouts)
      .where(and(eq(udtScouts.season, season), eq(udtScouts.userId, user.id)))
      .run();
    return this.view(user);
  }

  /**
   * A mentor (any roster bot of level 3+, one apprentice per season) takes a bot the team made
   * as its apprentice (owner, 25.10.): the apprentice's values rise towards the mentor's, its
   * play style moves towards it, a trait may be passed on. Each bot is an apprentice once.
   */
  mentor(user: User, body: z.infer<typeof MentorBody>) {
    this.udt.assertOn();
    const season = this.udt.season().number;
    const roster = this.udt.roster(user.id, season);
    const m = roster.find((r) => r.botId === body.mentorId);
    if (!m) throw notFound('mentor in your roster');
    if (m.level < MENTOR_LEVEL)
      throw conflict('a mentor needs level {level}', { level: MENTOR_LEVEL });
    if (this.mentorsUsed(season).has(m.botId))
      throw conflict('{name} has an apprentice this season', { name: m.name });
    const p = roster.find((r) => r.botId === body.apprenticeId);
    if (!p) throw notFound('apprentice in your roster');
    const own = this.udt.ownBots(season, user.id);
    const row = own.get(p.botId);
    if (p.botId === m.botId) throw badRequest('mentor and apprentice are two bots');
    if (!row || row.status !== 'own') throw conflict('an apprentice is a bot your team made');
    if (row.mentorId) throw conflict('{name} had a mentor already', { name: p.name });
    if (p.skill >= m.skill) throw conflict('the apprentice needs a lower skill than its mentor');
    const mentorTrait = m.udtTraits.some((x) => x.code === 'mentor');
    const lesson = mentorLesson(m.traits, p.traits, mentorTrait);
    const inherited = inheritedTrait(
      m.udtTraits.map((x) => x.code),
      p.udtTraits.map((x) => x.code),
      mentorTrait,
      rng,
    );
    this.db.transaction(() => {
      this.bots.update(p.botId, { traits: { ...p.traits, ...lesson } });
      this.db.update(udtBots).set({ mentorId: m.botId }).where(eq(udtBots.botId, p.botId)).run();
      if (inherited)
        this.db
          .insert(udtTraits)
          .values({
            id: `t${randomId(12)}`,
            season,
            userId: user.id,
            code: inherited,
            botId: p.botId,
            source: 'mentor',
            createdAt: this.now(),
            assignedAt: this.now(),
          })
          .run();
    });
    return { ...this.view(user), apprentice: { botId: p.botId, inherited } };
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
    const skill = body.skill ?? rule.skill;
    const why = cannotBuild(rarity, skill, body.traits);
    if (why === 'skill') throw badRequest('blueprints build skill {skill}', { skill: rule.skill });
    if (why === 'budget')
      throw badRequest('the build costs {cost} of {budget} points: lower the values', {
        cost: buildCost(skill, body.traits),
        budget: rule.budget,
      });
    if (this.bots.list().some((b) => b.name.toLowerCase() === body.name.toLowerCase()))
      throw conflict('a bot is called {name} already', { name: body.name });
    this.checkLook(body.botClass, body.look);
    this.licence(user, season, body.name);
    const potential = blueprintPotential(rarity, rng);
    const id = this.create(
      user,
      season,
      {
        name: body.name,
        skill,
        values: { ...body.traits, combatStyle: 0, camping: 0 },
        potential,
      },
      body.name,
      'blueprint',
      null,
      // Inside the rarity's public range: the window never tells more than the blueprint.
      drawPotentialWindow(potential, skill, BLUEPRINTS[rarity].potential, rng),
      body.botClass,
      body.look,
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
    // Before level 5 the potential is a range: the refusal must not tell the exact step.
    if (why === 'potential' && level < 5) throw conflict('the potential is reached');
    if (why === 'potential')
      throw conflict('the potential is skill {potential}', { potential: own.potential });
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

  /**
   * The one breakthrough of a fully developed own bot (level 10, skill at the potential, every
   * value at 100): potential and skill +1, the values lose the step's share, for points.
   */
  breakthrough(user: User, botId: string) {
    this.udt.assertOn();
    const season = this.udt.season().number;
    const own = this.udt.ownBots(season, user.id).get(botId);
    const r = this.udt.roster(user.id, season).find((x) => x.botId === botId);
    if (!own || !r) throw notFound('own bot in your roster');
    const level = levelOf(r.xp);
    const points = developPoints(level, own.pointsSpent);
    const step = breakthroughStep(r.skill);
    const why = cannotBreakthrough(
      {
        skill: r.skill,
        potential: own.potential,
        level,
        done: own.breakthrough,
        values: r.traits,
      },
      points,
    );
    if (why === 'done') throw conflict('a bot has one breakthrough');
    if (why === 'godlike') throw conflict('the bot is Godlike already');
    // Before level 10 the potential may still be hidden: the level comes first then.
    if (level < BREAKTHROUGH_LEVEL)
      throw conflict('a breakthrough needs level {level}', { level: BREAKTHROUGH_LEVEL });
    if (why === 'potential') throw conflict('a breakthrough needs the potential reached');
    if (why === 'values')
      throw conflict('a breakthrough needs every value at {value} or more', {
        value: BREAKTHROUGH_VALUE,
      });
    if (why === 'points')
      throw conflict('the breakthrough costs {cost} points', { cost: step.cost });
    this.db.transaction(() => {
      this.bots.update(botId, {
        skill: Math.round(r.skill) + 1,
        traits: { ...r.traits, ...breakthroughValues(r.skill, r.traits) },
      });
      this.db
        .update(udtBots)
        .set({
          potential: Math.max(own.potential, Math.round(r.skill)) + 1,
          pointsSpent: own.pointsSpent + step.cost,
          breakthrough: true,
        })
        .where(eq(udtBots.botId, botId))
        .run();
    });
    return this.udt.view(user);
  }
}

/** The values a mentor teaches (the rest of a bot's play style stays). */
function pick(t: RosterBot['traits']) {
  return {
    accuracy: t.accuracy ?? 0,
    alertness: t.alertness ?? 0,
    strafing: t.strafing ?? 0,
    combatStyle: t.combatStyle ?? 0,
    camping: t.camping ?? 0,
  };
}

/** Whether a roster bot can be the apprentice of `mentor` (made by the team, never taught). */
function canLearn(
  p: RosterBot,
  mentor: RosterBot,
  own: ReadonlyMap<string, { status: string; mentorId: string | null }>,
): boolean {
  const row = own.get(p.botId);
  return (
    p.botId !== mentor.botId &&
    !!row &&
    row.status === 'own' &&
    !row.mentorId &&
    p.skill < mentor.skill
  );
}
