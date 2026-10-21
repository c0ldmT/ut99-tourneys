/**
 * Bot duel simulator for tuning the mod's skill curve (TourneySkillCurve, mod 0.13.0) together
 * with the Dream Team traits: two bots meet (1v1, same weapon, both in sight of each other) and
 * fight until one dies. The model follows UT's Bot code (AdjustAim, NeedToTurn, Acquisition,
 * PlayHit, WarnTarget) and the curve's additions (drifting aim, dodge windows, flinch share, turn
 * to hits from out of view). It is an abstract encounter (no map, items, cover or height), so its
 * numbers are to be read relative to each other. Deterministic for a seed.
 */
import { FORM_EFFECT, PHASE_EFFECT, type CareerForm, type CareerPhase } from './career.js';
import { effectiveValues, gameEdge, modCodes, type GameEdge, type TraitOnBot } from './traits.js';

// ---------- the skill curve ----------

/** One value per level 0..7 (Novice .. Godlike). */
export type CurveRow = readonly number[];

export interface SkillCurve {
  /** MaxDesiredSpeed (also in fights). */
  speed: CurveRow;
  /** RotationRate.Yaw (units per second, 65536 = 360°). */
  yaw: CurveRow;
  /** Field of view in degrees (both sides). */
  fov: CurveRow;
  /** Accuracy before the bot's own value. */
  acc: CurveRow;
  /** Hearing, relative. */
  hear: CurveRow;
  /** Share of the game's optional flinches that stay. */
  flinch: CurveRow;
  /** Chance to dodge a projectile it sees coming. */
  duck: CurveRow;
  /** Chance of a dodge when it picks a fighting move. */
  tact: CurveRow;
  /** Seconds between two dodges while running (not in a duel, kept for the file). */
  runDodge: CurveRow;
  /** Seconds until it turns to a hit from out of view. */
  react: CurveRow;
  /** Chance it turns the right way then. */
  right: CurveRow;
  /** Aim error: how often it picks a new direction (Hz). */
  driftHz: CurveRow;
  /** Aim: seconds it is behind a moving target. */
  lag: CurveRow;
  /** Seconds it fires at a target it no longer sees (not in a duel, kept for the file). */
  blind: CurveRow;
  blindSplash: CurveRow;
  /** Mod 0.14.0: how much of the bot's own accuracy value counts at this level (value × this). */
  accGain: CurveRow;
  /** Mod 0.14.0: seconds from seeing or hearing a new enemy to turning and firing. */
  sightReact: CurveRow;
  /**
   * Mod 0.14.0: fire pauses; the bot holds fire D / (1 + D) of the time, here as longer pauses
   * between shots (weapon rate × (1 + D)).
   */
  fireDelay: CurveRow;
  /**
   * Planned for mod 0.15.0 (0 = mod 0.14.0): the mod dodges projectiles itself; seconds from the
   * shot to the dodge (too late when the shot is there first).
   */
  dodgeLate: CurveRow;
  /** Planned for mod 0.15.0 (0 = mod 0.14.0): chance a dodge goes to the wrong side. */
  dodgeErr: CurveRow;
  /** Planned for mod 0.15.0 (0 = mod 0.14.0): chance it does not lead its target (per 2 s). */
  leadOff: CurveRow;
  /**
   * Planned for mod 0.15.0 (0 = mod 0.14.0): the strafing value scales the dodge chances,
   * × (1 + this × strafing) (strafing -1..1).
   */
  strafeDodge: CurveRow;
}

export type CurveKey = keyof SkillCurve;

/** The rows the mod has, with their property in TourneySkillCurve's defaultproperties. */
export const CURVE_PROPS: Readonly<Partial<Record<CurveKey, string>>> = {
  speed: 'TSpeed',
  yaw: 'TYaw',
  fov: 'TFov',
  acc: 'TAcc',
  hear: 'THear',
  flinch: 'TFlinch',
  duck: 'TDuck',
  tact: 'TTact',
  runDodge: 'TRunDodge',
  react: 'TReact',
  right: 'TRight',
  driftHz: 'TDriftHz',
  lag: 'TLag',
  blind: 'TBlind',
  blindSplash: 'TBlindSplash',
  accGain: 'TAccGain',
  sightReact: 'TSightReact',
  fireDelay: 'TFireDelay',
};

/** Mod 0.14.0, curve v1 (TourneySkillCurve defaultproperties; a test compares them with the .uc file). */
export const CURRENT_CURVE: SkillCurve = {
  speed: [0.7, 0.76, 0.82, 0.88, 0.94, 1, 1, 1],
  yaw: [26000, 30000, 34000, 39000, 45000, 55000, 68000, 100000],
  fov: [100, 110, 120, 130, 140, 155, 180, 200],
  acc: [-1.8, -1.35, -0.95, -0.6, -0.3, 0, 0.12, -0.2],
  hear: [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.2],
  flinch: [0.5, 0.4, 0.3, 0.2, 0.15, 0.1, 0, 0],
  duck: [0.1, 0.15, 0.22, 0.3, 0.33, 0.55, 0.77, 0.95],
  tact: [0.05, 0.08, 0.12, 0.16, 0.2, 0.24, 0.28, 0.3],
  runDodge: [6, 5, 4, 3, 2.2, 1.5, 0.8, 0.4],
  react: [1.0, 0.85, 0.7, 0.55, 0.4, 0.3, 0.2, 0.12],
  right: [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1],
  driftHz: [0.8, 1, 1.2, 1.4, 1.7, 2, 2.4, 3],
  lag: [0.1, 0.08, 0.07, 0.06, 0.04, 0.03, 0.02, 0.01],
  blind: [1.5, 1.3, 1.1, 1, 0.9, 0.8, 0.7, 0.6],
  blindSplash: [1, 1, 1, 1, 1.2, 1.2, 1.5, 1.5],
  accGain: [0.532, 0.447, 0.39, 0.336, 0.364, 0.33, 0.308, 0.396],
  sightReact: [0.6, 0.48, 0.37, 0.28, 0.2, 0.13, 0.07, 0.03],
  fireDelay: [0.4, 0.3, 0.2, 0.12, 0.05, 0, 0, 0],
  dodgeLate: [0, 0, 0, 0, 0, 0, 0, 0],
  dodgeErr: [0, 0, 0, 0, 0, 0, 0, 0],
  leadOff: [0, 0, 0, 0, 0, 0, 0, 0],
  strafeDodge: [0, 0, 0, 0, 0, 0, 0, 0],
};

export const LEVEL_NAMES = [
  'Novice',
  'Average',
  'Experienced',
  'Skilled',
  'Adept',
  'Masterful',
  'Inhuman',
  'Godlike',
] as const;

/** A curve with some rows replaced (a curve file); rows must have 8 numbers. */
export function withCurve(base: SkillCurve, patch: Partial<Record<string, unknown>>): SkillCurve {
  const out: Record<string, CurveRow> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (k.startsWith('$')) continue; // comments
    if (!(k in base)) throw new Error(`unknown curve row "${k}"`);
    if (!Array.isArray(v) || v.length !== 8 || v.some((x) => typeof x !== 'number' || !isFinite(x)))
      throw new Error(`curve row "${k}" needs 8 numbers`);
    out[k] = v as number[];
  }
  return out as unknown as SkillCurve;
}

/** The mod's rows from TourneySkillCurve.uc (defaultproperties, `TSpeed(0)=0.70`). */
export function curveFromUc(text: string, base: SkillCurve = CURRENT_CURVE): SkillCurve {
  const patch: Record<string, number[]> = {};
  for (const [key, prop] of Object.entries(CURVE_PROPS)) {
    const row: number[] = [];
    for (let i = 0; i < 8; i++) {
      const m = new RegExp(`^\\s*${prop}\\(${i}\\)=([-0-9.]+)\\s*$`, 'mi').exec(text);
      if (!m) throw new Error(`${prop}(${i}) not found`);
      row.push(Number(m[1]));
    }
    patch[key] = row;
  }
  return withCurve(base, patch);
}

// ---------- weapons ----------

export type WeaponCode = 'enforcer' | 'shock' | 'minigun' | 'sniper' | 'pulse' | 'rocket' | 'flak';

export interface WeaponDef {
  code: WeaponCode;
  name: string;
  /** The aim error the weapon passes to AdjustAim (Weapon.AimError 550 × its factor). */
  aimError: number;
  /** Projectile speed (uu/s); 0 = instant hit. */
  speed: number;
  /** Seconds between two shots of a bot. */
  interval: number;
  damage: number;
  /** Damage varies by up to this much more (minigun 9..14). */
  damageRand?: number;
  /** Distance of a meeting with this weapon (uu). */
  range: readonly [number, number];
  /** Splash radius (rocket): bots aim at the feet. */
  splash?: number;
  /** Chunks (flak) with a lateral spread (radians, ±). */
  pellets?: number;
  spread?: number;
  /** Share of hits that are head shots (sniper: 100 damage). */
  headShots?: number;
  /** Sniper: a bot standing still aims better (AimError / clamp(still / 2, 1, 3), "zoom"). */
  still?: boolean;
}

/** Assumptions from Botpack (damage, speed, aim error factors); rates are rough bot rates. */
export const WEAPONS: readonly WeaponDef[] = [
  {
    code: 'enforcer',
    name: 'Enforcer',
    aimError: 1100,
    speed: 0,
    interval: 0.4,
    damage: 17,
    range: [300, 1200],
  },
  {
    code: 'shock',
    name: 'Shock Rifle',
    aimError: 1512.5,
    speed: 0,
    interval: 0.75,
    damage: 40,
    range: [400, 1600],
  },
  {
    code: 'minigun',
    name: 'Minigun',
    aimError: 1512.5,
    speed: 0,
    interval: 0.13,
    damage: 9,
    damageRand: 5,
    range: [300, 1200],
  },
  {
    code: 'sniper',
    name: 'Sniper Rifle',
    aimError: 1100,
    speed: 0,
    interval: 1,
    damage: 45,
    range: [1000, 3000],
    headShots: 0.15,
    still: true,
  },
  {
    code: 'pulse',
    name: 'Pulse Gun',
    aimError: 550,
    speed: 1450,
    interval: 0.18,
    damage: 20,
    range: [250, 1000],
  },
  {
    code: 'rocket',
    name: 'Rocket Launcher',
    aimError: 550,
    speed: 1200,
    interval: 0.9,
    damage: 75,
    range: [300, 1300],
    splash: 220,
  },
  {
    code: 'flak',
    name: 'Flak Cannon',
    aimError: 700,
    speed: 2500,
    interval: 1.1,
    damage: 16,
    range: [200, 800],
    pellets: 8,
    spread: 0.07,
  },
];

export const weaponDef = (c: WeaponCode): WeaponDef => WEAPONS.find((w) => w.code === c)!;

// ---------- bots ----------

export interface DuelBotSpec {
  name?: string;
  /** Tournament skill 0..7. */
  level: number;
  /** Play-style values as the website keeps them (-1..1; the Dream Team pages show 0..100). */
  accuracy?: number;
  alertness?: number;
  strafing?: number;
  /** Combat style -1 (cautious) .. 1 (aggressive): charges and backs off. */
  combatStyle?: number;
  jumpy?: boolean;
  /** Dream Team traits (values and body traits act in the duel). */
  traits?: readonly TraitOnBot[];
  /** Stock bot class (aim drifts); false: own models such as Skaarj or NaliCow (aim jumps). */
  stock?: boolean;
  /** Stamina below the limit: one step worse in accuracy (Dream Team). */
  tired?: boolean;
  phase?: CareerPhase;
  /** Form of the day (Dream Team). */
  form?: CareerForm;
}

/** 0..100 (Dream Team pages) to the stored -1..1. */
export const fromPct = (p: number) => Math.max(-1, Math.min(1, (p - 50) / 50));
export const toPct = (v: number) => Math.round((v + 1) * 50);

export interface ResolvedBot {
  level: number;
  accuracy: number;
  alertness: number;
  strafing: number;
  /** The game's CombatStyle (default 0.1 + 0.7 × the value, as the mod sets it). */
  combatStyle: number;
  jumpy: boolean;
  stock: boolean;
  body: { armour: boolean; thick: boolean; glass: boolean; vampire: boolean; phoenix: boolean };
  /** Values traits in the game (mod 0.14.0): multipliers on the curve. */
  edge: GameEdge;
}

/** The values the game gets for a bot (traits, tiredness, career phase and form as the website sends). */
export function resolveBot(b: DuelBotSpec): ResolvedBot {
  const e = effectiveValues(
    Math.max(0, Math.min(7, Math.round(b.level))),
    {
      accuracy: b.accuracy ?? 0,
      alertness: b.alertness ?? 0,
      strafing: b.strafing ?? 0,
      combatStyle: b.combatStyle ?? 0,
      jumpy: !!b.jumpy,
    },
    b.traits ?? [],
  );
  let acc = e.values.accuracy ?? 0;
  if (b.tired) acc = Math.max(-1, acc - 0.2);
  if (b.phase) acc = Math.max(-1, Math.min(1, acc + PHASE_EFFECT[b.phase].accuracy / 50));
  if (b.form) acc = Math.max(-1, Math.min(1, acc + FORM_EFFECT[b.form] / 50));
  const codes = new Set(modCodes(b.traits ?? []));
  return {
    level: e.skill,
    accuracy: acc,
    alertness: e.values.alertness ?? 0,
    strafing: e.values.strafing ?? 0,
    combatStyle: 0.1 + 0.7 * Math.max(-1, Math.min(1, e.values.combatStyle ?? 0)),
    jumpy: !!e.values.jumpy,
    stock: b.stock ?? true,
    body: {
      armour: codes.has('sa'),
      thick: codes.has('tf'),
      glass: codes.has('gc'),
      vampire: codes.has('vp'),
      phoenix: codes.has('px'),
    },
    edge: gameEdge(b.traits ?? []),
  };
}

// ---------- the duel ----------

/** Building blocks of a level; "neutral" sets one to Adept for both bots (what it adds). */
export type Component = 'aim' | 'turn' | 'view' | 'react' | 'dodge' | 'speed' | 'flinch';
export const COMPONENTS: readonly Component[] = [
  'aim',
  'turn',
  'view',
  'react',
  'dodge',
  'speed',
  'flinch',
];

export interface DuelOptions {
  curve?: SkillCurve;
  /** Weapons drawn evenly; default all. */
  weapons?: readonly WeaponCode[];
  /** Number of meetings (each played twice with the sides swapped). */
  duels?: number;
  seed?: number;
  neutral?: readonly Component[];
  /** Seconds before a meeting counts as a draw. */
  maxTime?: number;
  /**
   * open: both in sight, views random (each meeting played twice, sides swapped); ambush: bot A
   * already aims at bot B, which looks 90..180° away and has not noticed A yet.
   */
  setup?: 'open' | 'ambush';
  /** Model check, not a curve value: all aim errors × this (0.5: bots hit about twice as well). */
  aimModel?: number;
}

export interface SideStats {
  shots: number;
  hits: number;
  damage: number;
  /** Seconds from the meeting to its first shot (median over meetings it fired in). */
  firstShot: number;
  /** Share of meetings in which it saw the enemy first (or heard / was hit first). */
  awareFirst: number;
}

export interface DuelSeries {
  /** Share of points of bot A (win 1, draw ½). */
  winA: number;
  /** Share of the decided meetings bot A won (draws left out; 0.5 when none was decided). */
  winDecided: number;
  draws: number;
  /** Median seconds to the kill. */
  time: number;
  a: SideStats;
  b: SideStats;
  perWeapon: Partial<Record<WeaponCode, number>>;
  n: number;
}

const STEP = 0.05;
const RADIUS = 17;
const UNITS = 65536;
const toRad = (u: number) => (u * 2 * Math.PI) / UNITS;
const GROUND_SPEED = 400;
const DODGE_SPEED = 600;
const DODGE_TIME = 0.6;
const FLINCH_TIME = 0.4;
/** UT NeedToTurn: it fires within 4000 units (22°). */
const FIRE_CONE = 4000;
/** WarnTarget: the shooter within dot 0.8 of the view. */
const WARN_CONE = 6711;

export function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Fighter {
  r: ResolvedBot;
  /** Level used per building block (Adept where neutral). */
  lv: Record<Component, number>;
  hp: number;
  armour: number;
  phoenixUsed: boolean;
  aware: boolean;
  awareAt: number;
  turnAt: number;
  /** Yaw away from the enemy (units, 0..32768). */
  off: number;
  /** Turned the wrong way after a hit from out of view: target offset and until when. */
  wrongOff: number;
  wrongUntil: number;
  wrongAt: number;
  engagedAt: number;
  lockIn: boolean;
  nextShot: number;
  y: number;
  vy: number;
  moveUntil: number;
  strafeDir: number;
  /** Speed towards (-) or away from (+) the enemy. */
  vr: number;
  /** Planned 0.15.0: a projectile dodge waiting for its reaction time. */
  dodgeAt: number;
  dodgeDir: number;
  /** Planned 0.15.0: no leading until leadAt (rolled every 2 s). */
  noLead: boolean;
  leadAt: number;
  airUntil: number;
  flinchUntil: number;
  lastPain: number;
  lastFire: number;
  /** Shots fired / the enemy's shots it already had a chance to hear. */
  shotSeq: number;
  heardSeq: number;
  stillSince: number;
  duckWindow: boolean;
  duckRollAt: number;
  noise: number;
  goal: number;
  pickAt: number;
  aimAt: number;
  shots: number;
  hits: number;
  damage: number;
  firstShot: number;
}

interface Projectile {
  from: number;
  arrive: number;
  aimY: number;
  feet: boolean;
  offsets: number[];
}

const internal = (L: number) => Math.max(0, L - 4);

function fighter(
  r: ResolvedBot,
  neutral: readonly Component[],
  off: number,
  rng: () => number,
  c: SkillCurve,
): Fighter {
  const lv = Object.fromEntries(
    COMPONENTS.map((k) => [k, neutral.includes(k) ? 4 : r.level]),
  ) as Record<Component, number>;
  return {
    r,
    lv,
    hp: 100,
    armour: r.body.armour ? 25 : 0,
    phoenixUsed: false,
    aware: false,
    awareAt: Infinity,
    turnAt: Infinity,
    off,
    wrongOff: 0,
    wrongUntil: -1,
    wrongAt: Infinity,
    engagedAt: Infinity,
    lockIn: true,
    nextShot: 0,
    y: 0,
    vy: (2 * rng() - 1) * 0.7 * GROUND_SPEED * c.speed[lv.speed]!,
    moveUntil: 0.5 + rng(),
    strafeDir: rng() < 0.5 ? -1 : 1,
    vr: 0,
    dodgeAt: Infinity,
    dodgeDir: 1,
    noLead: false,
    leadAt: 0,
    airUntil: -1,
    flinchUntil: -1,
    lastPain: -9,
    lastFire: -9,
    shotSeq: 0,
    heardSeq: 0,
    stillSince: 0,
    duckWindow: false,
    duckRollAt: 0,
    noise: 0,
    goal: 0,
    pickAt: 0,
    aimAt: 0,
    shots: 0,
    hits: 0,
    damage: 0,
    firstShot: Infinity,
  };
}

/** The enemy in the bot's view (Bot.SetPeripheralVision with the curve's BaseAlertness). */
function sees(f: Fighter, c: SkillCurve): boolean {
  const fov = Math.min(360, c.fov[f.lv.view]! + f.r.edge.view);
  const pv = Math.min(0.9, Math.cos(((fov / 2) * Math.PI) / 180) - f.r.alertness);
  return Math.cos(toRad(f.off)) > pv;
}

function becomeAware(f: Fighter, t: number, delay: number) {
  if (f.aware) return;
  f.aware = true;
  f.awareAt = t;
  f.turnAt = t + delay;
}

interface Meeting {
  weapon: WeaponDef;
  dist: number;
  offA: number;
  offB: number;
  seed: number;
  ambush: boolean;
}

interface MeetingResult {
  /** 1: first wins, 0: second, 0.5 draw. */
  score: number;
  time: number;
  f: [Fighter, Fighter];
}

function play(
  ra: ResolvedBot,
  rb: ResolvedBot,
  m: Meeting,
  c: SkillCurve,
  neutral: readonly Component[],
  maxTime: number,
  aimModel: number,
): MeetingResult {
  const rng = rngOf(m.seed);
  const w = m.weapon;
  let D = m.dist;
  // Charging and backing off change the distance, within the weapon's reach.
  const dMin = Math.max(150, m.weapon.range[0] * 0.5);
  const dMax = m.weapon.range[1] * 1.3;
  const f: [Fighter, Fighter] = [
    fighter(ra, neutral, m.offA, rng, c),
    fighter(rb, neutral, m.offB, rng, c),
  ];
  if (m.ambush) {
    f[0].aware = true;
    f[0].awareAt = 0;
    f[0].turnAt = 0;
    f[0].engagedAt = 0;
    f[0].lockIn = false;
  }
  const flying: Projectile[] = [];
  let t = 0;
  for (; t < maxTime; t += STEP) {
    // Random order each tick, so neither side always acts first.
    if (rng() < 0.5) {
      step(0, t);
      step(1, t);
    } else {
      step(1, t);
      step(0, t);
    }
    D = Math.min(dMax, Math.max(dMin, D + (f[0].vr + f[1].vr) * STEP));
    // Projectiles arriving.
    for (let k = flying.length - 1; k >= 0; k--) {
      const p = flying[k]!;
      if (p.arrive > t) continue;
      flying.splice(k, 1);
      const v = f[1 - p.from]!;
      let dmg = 0;
      if (w.pellets) {
        for (const o of p.offsets) if (Math.abs(p.aimY + o - v.y) < RADIUS + 3) dmg += w.damage;
      } else {
        const miss = Math.abs(p.aimY - v.y);
        if (p.feet && w.splash) {
          const d = Math.sqrt(miss * miss + 39 * 39);
          dmg = Math.max(0, w.damage * (1 - Math.max(0, d - RADIUS) / w.splash));
        } else if (miss < RADIUS) dmg = w.damage;
      }
      if (dmg > 0) hit(p.from, Math.round(dmg), t);
    }
    if (f[0].hp <= 0 || f[1].hp <= 0) break;
  }
  const score = f[0].hp <= 0 && f[1].hp <= 0 ? 0.5 : f[1].hp <= 0 ? 1 : f[0].hp <= 0 ? 0 : 0.5;
  return { score, time: t, f };

  function step(i: number, t: number) {
    const x = f[i]!;
    const e = f[1 - i]!;
    if (x.hp <= 0 || e.hp <= 0) return;
    // Awareness: sight (polled), hearing the enemy's shots of the last step.
    if (!x.aware) {
      if (sees(x, c)) becomeAware(x, t, rng() * 0.1 + c.sightReact[x.lv.react]! * x.r.edge.react);
      else if (e.shotSeq > x.heardSeq) {
        x.heardSeq = e.shotSeq;
        const p =
          0.3 *
          c.hear[x.lv.view]! *
          (1 + 0.3 * x.r.alertness) *
          Math.min(1.5, Math.max(0.5, 1200 / D));
        if (rng() < p) becomeAware(x, t, 0.1 + c.sightReact[x.lv.react]! * x.r.edge.react);
      }
      if (!x.aware) {
        // Roaming: the view swings with the path.
        x.off = Math.abs(x.off + (rng() * 2 - 1) * 9000 * STEP);
        if (x.off > 32768) x.off = UNITS - x.off;
      }
    }
    // Turning (Acquisition: stand, turn, 0.2 s tween; then fight). A wrong turn after a hit.
    if (x.aware && t >= x.turnAt) {
      if (t >= x.wrongAt) {
        x.wrongAt = Infinity;
        x.wrongOff = 9000 + rng() * 9000;
        x.wrongUntil = t + c.react[x.lv.react]! * x.r.edge.react;
        x.engagedAt = Infinity;
      }
      const goal = t < x.wrongUntil ? x.wrongOff : 0;
      const turn = c.yaw[x.lv.turn]! * x.r.edge.turn * STEP;
      x.off = x.off > goal ? Math.max(goal, x.off - turn) : Math.min(goal, x.off + turn);
      if (x.off === 0 && x.engagedAt === Infinity) x.engagedAt = t + 0.2;
    }
    // Planned 0.15.0: the mod's own projectile dodge after its reaction time.
    if (t >= x.dodgeAt) {
      x.dodgeAt = Infinity;
      if (t >= x.airUntil && t >= x.flinchUntil) dodge(x, t, x.dodgeDir);
    }
    if (t >= x.leadAt) {
      x.leadAt = t + 2;
      x.noLead = rng() < c.leadOff[x.lv.aim]!;
    }
    move(x, t);
    // Dodge window, rolled once a second (curve: bCanDuck).
    if (t >= x.duckRollAt) {
      x.duckRollAt = t + 1;
      const P = 0.33 + 0.22 * internal(x.lv.dodge);
      x.duckWindow = rng() * P < c.duck[x.lv.dodge]! * dodgeMul(x);
    }
    // Fire.
    if (t >= x.engagedAt && x.off < FIRE_CONE && t >= x.nextShot && t >= x.flinchUntil) fire(i, t);
  }

  function move(x: Fighter, t: number) {
    const spd = GROUND_SPEED * c.speed[x.lv.speed]!;
    if (t < x.flinchUntil) {
      x.vy = 0;
      x.vr = 0;
    } else if (t < x.airUntil) {
      // dodging: keeps its speed
    } else if (x.aware && t < x.engagedAt) {
      x.vy = 0; // Acquisition: stands while it turns
      x.vr = 0;
    } else if (x.aware) {
      if (t >= x.moveUntil) {
        const share = Math.min(0.9, Math.max(0.1, 0.5 + 0.4 * x.r.strafing));
        const cs = x.r.combatStyle;
        // Bot.Attacking: aggression 2 (CombatStyle + rand) - 1.1, +1 beyond 1000 uu; it charges
        // when that beats 2 rand; cautious bots (style < 0) back off now and then.
        const aggression = 2 * (cs + rng()) - 1.1 + (D > 1000 ? 1 : 0);
        x.vr = 0;
        if (aggression > 2 * rng()) {
          // Charging: straight at the enemy; strafing bots keep more of a sideways part.
          x.strafeDir = (rng() < 0.5 ? -1 : 1) * (0.15 + 0.35 * Math.max(0, x.r.strafing));
          x.vy = x.strafeDir * spd;
          x.vr = -0.9 * spd;
          x.moveUntil = t + 1 + rng() * 0.5;
          if (x.r.jumpy && rng() < 0.4) x.airUntil = t + 0.5; // jumpy bots hop
        } else if (cs < 0 && rng() < -cs * 0.5) {
          x.strafeDir = (rng() < 0.5 ? -1 : 1) * 0.3;
          x.vy = x.strafeDir * spd;
          x.vr = 0.8 * spd;
          x.moveUntil = t + 0.8 + rng() * 0.6;
        } else if (rng() < share) {
          // A fighting move in a random direction: its sideways part counts.
          x.strafeDir = (rng() < 0.5 ? -1 : 1) * (0.3 + 0.7 * Math.sin((rng() * Math.PI) / 2));
          x.vy = x.strafeDir * spd;
          x.moveUntil = t + 0.8 + rng() * 0.8;
          // Dodge in the fighting move: none with the rocket launcher (splash); jumpy bots and
          // skill 1+ the game's own 35 % (× chance skill × rand > 0.4), below the curve's TTact.
          const Sd = internal(x.lv.dodge);
          const pd =
            (w.splash
              ? 0
              : x.r.jumpy
                ? 0.35
                : Sd >= 1
                  ? 0.35 * Math.max(0, 1 - 0.4 / Sd)
                  : c.tact[x.lv.dodge]!) * dodgeMul(x);
          if (rng() < pd) dodge(x, t, Math.sign(x.strafeDir));
          else if (x.r.jumpy && rng() < 0.4) x.airUntil = t + 0.5; // jumpy bots hop
        } else {
          x.vy = 0;
          x.moveUntil = t + 0.6 + rng() * 0.6;
        }
      } else if (x.vy !== 0) x.vy = x.strafeDir * spd;
    } else if (t >= x.moveUntil) {
      x.vy = (2 * rng() - 1) * 0.7 * spd;
      x.moveUntil = t + 0.5 + rng();
    }
    if (x.vy !== 0) x.stillSince = t + STEP;
    x.y += x.vy * STEP;
  }

  /** Dodge chances ×: the trait edge and (planned 0.15.0) the strafing value. */
  function dodgeMul(x: Fighter): number {
    return x.r.edge.dodge * Math.max(0, 1 + c.strafeDodge[x.lv.dodge]! * x.r.strafing);
  }

  function dodge(x: Fighter, t: number, dir: number) {
    x.vy = dir * DODGE_SPEED;
    x.airUntil = t + DODGE_TIME;
    x.moveUntil = Math.max(x.moveUntil, x.airUntil);
  }

  function aimError(x: Fighter, e: Fighter, t: number): number {
    const L = x.lv.aim;
    const S = internal(L);
    // (Target + 1.25 * its velocity) - (bot + its velocity): the sideways part.
    const lat = 1.25 * e.vy - x.vy;
    const dot = D / Math.sqrt(D * D + lat * lat);
    let E = w.aimError * (11 - 10 * dot);
    if (w.still) E /= Math.min(3, Math.max(1, 0.5 * (t - x.stillSince)));
    if (w.speed === 0) E *= 0.5 + 0.19 * S;
    E *= 1.7 - 0.4 * (S + (x.r.stock ? 0.5 : rng()));
    if (S < 2 && (t - x.lastPain < 0.15 || t < x.airUntil || t < e.airUntil)) E *= 1.2;
    // A new target (LastAcquireTime within 2.5 - skill s): the first shot ×2.
    if (x.lockIn) {
      x.lockIn = false;
      if (t - x.engagedAt < 2.5 - S) E *= 2;
    }
    const acc = c.acc[L]! + c.accGain[L]! * x.r.accuracy;
    E *= x.r.edge.aim;
    if (x.r.stock) E *= Math.max(0, 1 - acc);
    else if (w.speed === 0 || acc < 0) E -= E * acc;
    return Math.max(0, E * aimModel);
  }

  /** The yaw error of this shot (units). */
  function yawError(x: Fighter, E: number, t: number): number {
    if (!x.r.stock) return (2 * rng() - 1) * E;
    const hz = c.driftHz[x.lv.aim]!;
    const dt = Math.min(1, Math.max(0, t - x.aimAt));
    x.aimAt = t;
    if (t >= x.pickAt) {
      x.goal = 2 * rng() - 1;
      x.pickAt = t + (0.5 + rng()) / hz;
    }
    x.noise += (x.goal - x.noise) * Math.min(1, dt * hz * 2.5);
    return 1.1 * x.noise * E + (2 * rng() - 1) * 0.1 * E;
  }

  function fire(i: number, t: number) {
    const x = f[i]!;
    const e = f[1 - i]!;
    x.nextShot = t + w.interval * (0.9 + 0.2 * rng()) * (1 + c.fireDelay[x.lv.react]!);
    x.lastFire = t;
    x.shotSeq++;
    x.shots++;
    if (x.firstShot === Infinity) x.firstShot = t;
    const E = aimError(x, e, t);
    // Far off (beyond ~80°) is a miss anyway; keeps tan finite.
    const miss = D * Math.tan(toRad(Math.max(-15000, Math.min(15000, yawError(x, E, t)))));
    const lag = x.r.stock ? e.vy * c.lag[x.lv.aim]! : 0;
    if (w.speed === 0) {
      if (Math.abs(miss - lag) < RADIUS) {
        const head = w.headShots && rng() < w.headShots;
        hit(
          i,
          head ? 100 : w.damage + (w.damageRand ? Math.floor(rng() * (w.damageRand + 1)) : 0),
          t,
        );
      }
      return;
    }
    const tf = D / w.speed;
    const lead = x.noLead ? 0 : Math.min(1, 0.7 + 0.6 * rng()) * e.vy * tf;
    const S = internal(x.lv.aim);
    const feet = !!w.splash && S > 2.5 * rng() - 0.5;
    const p: Projectile = {
      from: i,
      arrive: t + tf,
      aimY: e.y + lead - lag + miss,
      feet,
      offsets: w.pellets
        ? Array.from({ length: w.pellets }, () => (2 * rng() - 1) * (w.spread ?? 0) * D)
        : [],
    };
    flying.push(p);
    // WarnTarget: a fighting bot facing the shooter (within ~37°) may dodge when the shot takes
    // long enough (window, then 0.33 + 0.22 * skill).
    if (
      t >= e.engagedAt &&
      e.off < WARN_CONE &&
      t >= e.airUntil &&
      t >= e.flinchUntil &&
      e.duckWindow &&
      tf >= 0.11 + 0.15 * rng()
    ) {
      if (rng() < 0.33 + 0.22 * internal(e.lv.dodge)) {
        let side = e.y === p.aimY ? (rng() < 0.5 ? -1 : 1) : Math.sign(e.y - p.aimY);
        // Planned 0.15.0: wrong side, reaction time (too late when the shot is there first).
        if (rng() < c.dodgeErr[e.lv.dodge]!) side = -side;
        const late = c.dodgeLate[e.lv.dodge]! * (0.8 + 0.4 * rng());
        if (late <= 0) dodge(e, t, side);
        else if (t + late < p.arrive - 0.05) {
          e.dodgeAt = t + late;
          e.dodgeDir = side;
        }
      }
    }
  }

  function hit(from: number, raw: number, t: number) {
    const x = f[from]!;
    const v = f[1 - from]!;
    if (v.hp <= 0) return;
    let dmg = raw;
    if (x.r.body.glass) dmg = Math.round(dmg * 1.2);
    if (v.r.body.glass) dmg = Math.round(dmg * 1.2);
    if (v.r.body.thick) dmg = Math.max(1, Math.round(dmg * 0.9));
    if (v.armour > 0) {
      const a = Math.min(v.armour, Math.floor(dmg * 0.5));
      v.armour -= a;
      dmg -= a;
    }
    if (x.r.body.vampire && x.hp > 0 && x.hp < 100)
      x.hp = Math.min(100, x.hp + Math.round(Math.min(dmg, Math.max(0, v.hp)) * 0.15));
    if (v.r.body.phoenix && !v.phoenixUsed && dmg >= v.hp) {
      v.phoenixUsed = true;
      dmg = Math.max(0, v.hp - 50);
      if (v.hp <= 50) v.hp = 50;
    }
    v.hp -= dmg;
    x.hits++;
    x.damage += dmg;
    if (v.hp <= 0) return;
    // Flinch (Bot.PlayHit, health already reduced): the curve's damage hook first sets
    // LastPainTime with 1 - TFlinch below skill 2 (no optional flinch then); optional flinches
    // below skill 2, heavy hits always; not while the weapon points (firing) or in a dodge;
    // with skill × rand > 0.5 it fires while falling instead.
    const S = internal(v.lv.flinch);
    if (S < 2 && rng() >= c.flinch[v.lv.flinch]!) v.lastPain = t;
    const optional = S < 2 && t - v.lastPain > 0.3 + 0.25 * S && dmg * rng() > 0.08 * v.hp;
    const heavy = dmg * rng() > (0.17 + 0.04 * S) * v.hp;
    const pointing = t - v.lastFire < 0.3;
    let flinched = false;
    if (!pointing && t >= v.airUntil && (optional || heavy)) {
      v.lastPain = t;
      if (!(rng() * S > 0.5)) {
        v.flinchUntil = t + FLINCH_TIME;
        flinched = true;
      }
    }
    // Hit while it has not noticed the enemy (Roaming.TakeDamage): after a flinch it attacks,
    // else with skill / 3 at once; otherwise the curve's TurnToHit turns it after TReact, first
    // the wrong way with 1 - TRight.
    if (!v.aware) {
      v.aware = true;
      v.awareAt = t;
      const L = v.lv.react;
      if (flinched) v.turnAt = v.flinchUntil;
      else if (internal(L) > 3 * rng()) v.turnAt = t + 0.05;
      else {
        v.turnAt = t + c.react[L]! * v.r.edge.react * (0.8 + 0.4 * rng());
        if (rng() >= c.right[L]!) v.wrongAt = v.turnAt;
      }
    }
  }
}

function meetings(o: DuelOptions): Meeting[] {
  const rng = rngOf(o.seed ?? 1);
  const codes = o.weapons?.length ? o.weapons : WEAPONS.map((w) => w.code);
  const ambush = o.setup === 'ambush';
  return Array.from({ length: o.duels ?? 300 }, (_, i) => {
    const weapon = weaponDef(codes[i % codes.length]!);
    return {
      weapon,
      dist: weapon.range[0] + rng() * (weapon.range[1] - weapon.range[0]),
      offA: ambush ? 0 : rng() * 32768,
      offB: ambush ? 16384 + rng() * 16384 : rng() * 32768,
      seed: Math.floor(rng() * 2 ** 31),
      ambush,
    };
  });
}

const median = (l: number[]) => {
  const a = l.filter((x) => isFinite(x)).sort((x, y) => x - y);
  return a.length ? a[Math.floor((a.length - 1) / 2)]! : NaN;
};

/**
 * Bot A against bot B: every meeting is played twice, with the starting views swapped, so
 * neither side gets the luckier draws.
 */
export function duelSeries(a: DuelBotSpec, b: DuelBotSpec, o: DuelOptions = {}): DuelSeries {
  const c = o.curve ?? CURRENT_CURVE;
  const ra = resolveBot(a);
  const rb = resolveBot(b);
  const neutral = o.neutral ?? [];
  const maxTime = o.maxTime ?? 60;
  let points = 0;
  let draws = 0;
  const times: number[] = [];
  const side = () => ({ shots: 0, hits: 0, damage: 0, first: [] as number[], aware: 0 });
  const sa = side();
  const sb = side();
  const wp = new Map<WeaponCode, { p: number; n: number }>();
  const ms = meetings(o);
  const sides = o.setup === 'ambush' ? [false] : [false, true];
  for (const m of ms)
    for (const swap of sides) {
      const mm = swap ? { ...m, offA: m.offB, offB: m.offA } : m;
      const r = play(ra, rb, mm, c, neutral, maxTime, o.aimModel ?? 1);
      points += r.score;
      if (r.score === 0.5) draws++;
      else times.push(r.time);
      const [fa, fb] = r.f;
      for (const [s, x, y] of [
        [sa, fa, fb],
        [sb, fb, fa],
      ] as const) {
        s.shots += x.shots;
        s.hits += x.hits;
        s.damage += x.damage;
        s.first.push(x.firstShot);
        s.aware += x.awareAt < y.awareAt ? 1 : x.awareAt === y.awareAt ? 0.5 : 0;
      }
      const e = wp.get(m.weapon.code) ?? { p: 0, n: 0 };
      e.p += r.score;
      e.n++;
      wp.set(m.weapon.code, e);
    }
  const n = ms.length * sides.length;
  const stats = (s: ReturnType<typeof side>): SideStats => ({
    shots: s.shots,
    hits: s.hits,
    damage: s.damage,
    firstShot: median(s.first),
    awareFirst: s.aware / n,
  });
  return {
    winA: points / n,
    winDecided: n > draws ? (points - draws / 2) / (n - draws) : 0.5,
    draws: draws / n,
    time: median(times),
    a: stats(sa),
    b: stats(sb),
    perWeapon: Object.fromEntries([...wp].map(([k, v]) => [k, v.p / v.n])),
    n,
  };
}

/**
 * The accuracy (0..100, Dream Team scale) bot `low` needs to draw level with `high` (by
 * bisection; null: not even at 100, -1: already at 0).
 */
export function accuracyToMatch(
  low: DuelBotSpec,
  high: DuelBotSpec,
  o: DuelOptions = {},
): number | null {
  const at = (p: number) => duelSeries({ ...low, accuracy: fromPct(p) }, high, o).winDecided;
  if (at(100) < 0.5) return null;
  if (at(0) >= 0.5) return -1;
  let lo = 0;
  let hi = 100;
  for (let k = 0; k < 7; k++) {
    const mid = (lo + hi) / 2;
    if (at(mid) >= 0.5) hi = mid;
    else lo = mid;
  }
  return Math.round((lo + hi) / 2);
}
