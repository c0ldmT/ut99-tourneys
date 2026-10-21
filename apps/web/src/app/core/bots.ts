import type { AssetItem } from './types';

/** UT's combat styles (UTIndivBotSetupClient): value and translation key. */
export const COMBAT_STYLES: { value: number; key: string }[] = [
  { value: -1, key: 'bots.style.avoidant' },
  { value: -0.5, key: 'bots.style.cautious' },
  { value: 0, key: 'bots.style.normal' },
  { value: 0.5, key: 'bots.style.aggressive' },
  { value: 1, key: 'bots.style.berserk' },
];

/** The nearest combat style of a value. */
export function combatStyleKey(v: number | undefined): string {
  const x = v ?? 0;
  let best = COMBAT_STYLES[2]!;
  for (const s of COMBAT_STYLES) if (Math.abs(s.value - x) < Math.abs(best.value - x)) best = s;
  return best.key;
}

/** Label of an asset (class, skin, face, voice, weapon), else the last part of its name. */
export function assetLabel(
  list: readonly AssetItem[] | undefined,
  name: string | null | undefined,
) {
  if (!name) return '';
  const hit = list?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return hit?.label || name.split('.').pop() || name;
}

/** A trait value -1..1 (or 0..1) as a bar width in percent. */
export function traitPercent(v: number | undefined, min = -1): number {
  const x = v ?? 0;
  return Math.round(((x - min) / (1 - min)) * 100);
}
