import { shuffle, type Rng } from '@tourney/bracket';
import type { BotTraits } from '@tourney/protocol';
import { STOCK_CLASSES, STOCK_FACES, STOCK_VOICES, STOCK_WEAPONS } from './bot-stock.js';

/** Randomizer (pure): new bots with a made-up name, a stock look and a random play style. */

const START = [
  'Kr',
  'Vor',
  'Dra',
  'Zy',
  'Th',
  'Mal',
  'Ner',
  'Ka',
  'Sar',
  'Ix',
  'Gor',
  'Vel',
  'Ra',
  'Xe',
  'Bel',
  'Tor',
  'Ly',
  'Quor',
  'Hal',
  'Mor',
];
const MIDDLE = ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'or', 'yn', 'ar', 'is', 'eth', 'ok', 'ul'];
const END = [
  'x',
  'th',
  'n',
  'ra',
  'gor',
  'ss',
  'ris',
  'vak',
  'loq',
  'dra',
  'nix',
  'sis',
  'rak',
  'mus',
  'ka',
  'yr',
];

const pick = <T>(xs: readonly T[], rng: Rng): T => xs[Math.floor(rng() * xs.length)] as T;
/** A value in [lo, hi], rounded to 0.05. */
const between = (lo: number, hi: number, rng: Rng) =>
  Math.round((lo + rng() * (hi - lo)) * 20) / 20;

/** A pronounceable name of 4 to 10 letters that is not in `taken` (lower case). */
export function randomName(taken: ReadonlySet<string>, rng: Rng): string {
  for (let i = 0; i < 200; i++) {
    const n =
      pick(START, rng) +
      pick(MIDDLE, rng) +
      (rng() < 0.5 ? pick(MIDDLE, rng) : '') +
      pick(END, rng);
    const name = n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
    if (name.length >= 4 && name.length <= 10 && !taken.has(name.toLowerCase())) return name;
  }
  // Very unlikely: fall back to a numbered name.
  let k = 1;
  while (taken.has(`bot${k}`)) k++;
  return `Bot${k}`;
}

export interface RandomBot {
  name: string;
  botClass: string;
  skin: string;
  face?: string;
  traits: BotTraits;
}

/** A complete random bot (stock class, matching skin/face/voice, random play style). */
export function randomBot(taken: ReadonlySet<string>, rng: Rng): RandomBot {
  const cls = pick(STOCK_CLASSES, rng);
  const faces = STOCK_FACES[cls.pkg] ?? [];
  const traits: BotTraits = {
    accuracy: between(-0.6, 0.8, rng),
    alertness: between(-0.6, 0.8, rng),
    combatStyle: pick([-1, -0.5, 0, 0, 0.5, 1], rng),
    camping: between(0, 0.6, rng),
    strafing: between(-0.75, 1, rng),
    jumpy: rng() < 0.3,
    voice: rng() < 0.8 ? cls.voice : pick(STOCK_VOICES, rng),
    ...(rng() < 0.6 ? { favoriteWeapon: pick(shuffle(STOCK_WEAPONS, rng), rng) } : {}),
  };
  return {
    name: randomName(taken, rng),
    botClass: cls.botClass,
    skin: cls.defaultSkin,
    ...(faces.length ? { face: `${cls.pkg}.${pick(faces, rng)}` } : {}),
    traits,
  };
}
