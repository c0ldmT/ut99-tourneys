import { describe, expect, it } from 'vitest';
import { GUIDES, type GuideDef, guideKeys } from '../src/app/core/guides';

const ALL = Object.entries(GUIDES) as [string, GuideDef][];
import { DICT } from '../src/app/core/i18n-dict';

describe('guides "How it works" (decisions 327–329)', () => {
  it('has every text of every guide in English and German', () => {
    for (const [id, g] of ALL) {
      for (const k of guideKeys(g)) {
        expect(DICT.en[k], `${id}: ${k}`).toBeDefined();
        expect(DICT.de[k], `${id}: ${k}`).toBeDefined();
      }
    }
  });

  it('keeps a guide short: one sentence, a few facts, three to five steps', () => {
    for (const [id, g] of ALL) {
      expect(g.facts.length, id).toBeGreaterThanOrEqual(2);
      expect(g.facts.length, id).toBeLessThanOrEqual(5);
      expect(g.steps.length, id).toBeGreaterThanOrEqual(3);
      expect(g.steps.length, id).toBeLessThanOrEqual(5);
      const ids = (g.more ?? []).map((m) => m.id);
      expect(new Set(ids).size, id).toBe(ids.length);
    }
  });

  it('has the Dream Team pages', () => {
    expect(Object.keys(GUIDES)).toEqual(
      expect.arrayContaining([
        'dt',
        'team',
        'league',
        'packs',
        'cups',
        'market',
        'trades',
        'academy',
        'club',
        'yearbook',
      ]),
    );
  });

  it('has the player pages, in cyan (decision 328)', () => {
    const play = ['overview', 'tournament', 'match', 'calendar', 'stats', 'shop', 'account'];
    for (const id of play) expect((GUIDES as Record<string, GuideDef>)[id]?.area, id).toBe('play');
  });

  it('has the administration pages (decision 329)', () => {
    const admin = ['admin', 'form', 'series', 'servers', 'bots', 'settings'];
    for (const id of admin)
      expect((GUIDES as Record<string, GuideDef>)[id]?.area, id).toBe('admin');
  });

  it('opens "How betting works" as a section of the tournament guide', () => {
    expect(GUIDES.tournament.more.map((m) => m.id)).toContain('bets');
    expect(GUIDES.tournament.more.find((m) => m.id === 'bets')?.paras.at(-1)?.needs).toBe('floor');
  });
});
