import type { UdtRarity } from './types';

/** Trait categories in the order of the packs page (decision 323). */
export const TRAIT_CATEGORIES = ['values', 'body', 'behaviour', 'manager'] as const;
export type TraitCategory = (typeof TRAIT_CATEGORIES)[number];

const RARITY_ORDER: readonly UdtRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/**
 * Search and filter of the trait inventory and the crafting list (decision 323): text (name and
 * effect in the language shown), rarities (any of them; none = all), a category and, for
 * crafting, only what can be crafted now. Remembered per browser (`FILTER_KEY`).
 */
export interface TraitFilter {
  q: string;
  rarities: UdtRarity[];
  category: TraitCategory | 'all';
  craftable: boolean;
}

export const NO_FILTER: TraitFilter = { q: '', rarities: [], category: 'all', craftable: false };
export const FILTER_KEY = 'tourney.packs.filter';

/** Lower case without accents, so "kafer" finds "Käfer" and "eagle" finds "Eagle eye". */
function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Something narrows the list (the "craftable only" switch counts on the crafting tab only). */
export function filterActive(f: TraitFilter, craft = false): boolean {
  return (
    f.q.trim() !== '' || f.rarities.length > 0 || f.category !== 'all' || (craft && f.craftable)
  );
}

/**
 * A trait passes search, rarity and category. `text` is what the search looks at (name and
 * effect); every word of the search has to appear in it.
 */
export function traitMatches(
  t: { rarity: UdtRarity; category: string },
  text: string,
  f: TraitFilter,
): boolean {
  if (f.category !== 'all' && t.category !== f.category) return false;
  if (f.rarities.length && !f.rarities.includes(t.rarity)) return false;
  const words = fold(f.q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(text);
  return words.every((w) => hay.includes(w));
}

/** A remembered filter, cleaned (unknown values dropped, the search capped). */
export function readFilter(raw: string | null): TraitFilter {
  if (!raw) return { ...NO_FILTER };
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof TraitFilter, unknown>>;
    const rarities = Array.isArray(v.rarities)
      ? RARITY_ORDER.filter((r) => (v.rarities as unknown[]).includes(r))
      : [];
    const category = (TRAIT_CATEGORIES as readonly unknown[]).includes(v.category)
      ? (v.category as TraitCategory)
      : 'all';
    return {
      q: typeof v.q === 'string' ? v.q.slice(0, 60) : '',
      rarities,
      category,
      craftable: v.craftable === true,
    };
  } catch {
    return { ...NO_FILTER };
  }
}

/** Toggles one rarity, keeping the order common … legendary. */
export function toggleRarity(list: readonly UdtRarity[], r: UdtRarity): UdtRarity[] {
  const on = list.includes(r) ? list.filter((x) => x !== r) : [...list, r];
  return RARITY_ORDER.filter((x) => on.includes(x));
}
