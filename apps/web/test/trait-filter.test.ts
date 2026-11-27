import { describe, expect, it } from 'vitest';
import {
  filterActive,
  NO_FILTER,
  readFilter,
  toggleRarity,
  traitMatches,
} from '../src/app/core/trait-filter';

const eagle = { rarity: 'rare' as const, category: 'values' };
const text = 'Eagle eye Zielfehler −14 %';

describe('trait search and filter of the packs page (decision 323)', () => {
  it('finds by name and effect, every word, without case or accents', () => {
    expect(traitMatches(eagle, text, { ...NO_FILTER, q: 'eagle' })).toBe(true);
    expect(traitMatches(eagle, text, { ...NO_FILTER, q: 'ZIELFEHLER eye' })).toBe(true);
    expect(traitMatches(eagle, text, { ...NO_FILTER, q: 'eagle schaden' })).toBe(false);
    expect(traitMatches(eagle, 'Kämpfer', { ...NO_FILTER, q: 'kampf' })).toBe(true);
    expect(traitMatches(eagle, text, { ...NO_FILTER, q: '   ' })).toBe(true);
  });

  it('filters by rarities (any of them) and category', () => {
    expect(traitMatches(eagle, text, { ...NO_FILTER, rarities: ['common', 'rare'] })).toBe(true);
    expect(traitMatches(eagle, text, { ...NO_FILTER, rarities: ['epic'] })).toBe(false);
    expect(traitMatches(eagle, text, { ...NO_FILTER, category: 'values' })).toBe(true);
    expect(traitMatches(eagle, text, { ...NO_FILTER, category: 'body' })).toBe(false);
  });

  it('knows when a filter narrows the list', () => {
    expect(filterActive(NO_FILTER)).toBe(false);
    expect(filterActive({ ...NO_FILTER, q: ' x ' })).toBe(true);
    // "Craftable only" narrows the crafting list, not the inventory.
    expect(filterActive({ ...NO_FILTER, craftable: true })).toBe(false);
    expect(filterActive({ ...NO_FILTER, craftable: true }, true)).toBe(true);
  });

  it('reads a remembered filter and drops what it does not know', () => {
    expect(readFilter(null)).toEqual(NO_FILTER);
    expect(readFilter('not json')).toEqual(NO_FILTER);
    expect(
      readFilter(
        JSON.stringify({
          q: 'eye',
          rarities: ['epic', 'bogus', 'common'],
          category: 'body',
          craftable: true,
        }),
      ),
    ).toEqual({ q: 'eye', rarities: ['common', 'epic'], category: 'body', craftable: true });
    expect(readFilter(JSON.stringify({ category: 'weapons', craftable: 'yes' }))).toEqual(
      NO_FILTER,
    );
  });

  it('toggles a rarity in the order of the scale', () => {
    expect(toggleRarity(['epic'], 'common')).toEqual(['common', 'epic']);
    expect(toggleRarity(['common', 'epic'], 'common')).toEqual(['epic']);
  });
});
