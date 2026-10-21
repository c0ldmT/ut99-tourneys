import { describe, expect, it } from 'vitest';
import { createRng } from '@tourney/bracket';
import { pickTeamNames } from '../src/common/names.js';

describe('team names of the list', () => {
  const list = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];

  it('picks at random, never twice and never a taken one', () => {
    const taken = new Set(['bravo', 'echo']);
    const names = pickTeamNames(list, 4, taken, createRng('a'), (i) => `Bots ${i + 1}`);
    expect(names).toHaveLength(4);
    expect(new Set(names).size).toBe(4);
    expect(names).not.toContain('Bravo');
    expect(names).not.toContain('Echo');
    // Taken now as well.
    for (const n of names) expect(taken.has(n.toLowerCase())).toBe(true);
  });

  it('is not always the top of the list', () => {
    const firsts = new Set(
      Array.from(
        { length: 20 },
        (_, i) => pickTeamNames(list, 1, new Set(), createRng(`s${i}`), () => 'x')[0],
      ),
    );
    expect(firsts.size).toBeGreaterThan(2);
  });

  it('falls back to unique names when the list runs out', () => {
    const names = pickTeamNames(
      ['Alpha'],
      3,
      new Set(['bots 1']),
      createRng('b'),
      (i) => `Bots ${i + 1}`,
    );
    expect(names).toEqual(['Alpha', 'Bots 2', 'Bots 3']);
  });
});
