import { describe, expect, it } from 'vitest';
import { formOf, peekTarget } from '../src/app/core/peek';

describe('hover cards (decision 318)', () => {
  it('knows bot and team links', () => {
    expect(peekTarget('/udt/bot/Xan')).toEqual({ kind: 'bot', id: 'Xan' });
    expect(peekTarget('/bots/Bot%20One')).toEqual({ kind: 'bot', id: 'Bot One' });
    expect(peekTarget('/udt/squads/u42')).toEqual({ kind: 'team', id: 'u42' });
  });

  it('ignores other pages', () => {
    expect(peekTarget('/udt/squads')).toBeNull();
    expect(peekTarget('/udt/bot/Xan/career')).toBeNull();
    expect(peekTarget('/stats/p/b:xan')).toBeNull();
    expect(peekTarget('/udt/team')).toBeNull();
  });

  it('shows the form of the last five games, newest first', () => {
    const r = [true, false, true, true, false, true].map((won) => ({ won }));
    expect(formOf(r)).toEqual(['w', 'l', 'w', 'w', 'l']);
    expect(formOf([])).toEqual([]);
  });
});
