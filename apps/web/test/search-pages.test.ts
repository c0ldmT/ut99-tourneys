import { describe, expect, it } from 'vitest';
import { DICT } from '../src/app/core/i18n-dict';
import { searchPages } from '../src/app/core/search-pages';

describe('pages of the quick search (decision 313)', () => {
  const base = { meId: 'u1', admin: false, moderator: false, udt: false, league: false };

  it('offers the administration to admins only and the Dream Team while it is on', () => {
    const plain = searchPages(base).map((p) => p.link);
    expect(plain).toContain('/profile');
    expect(plain).toContain('/stats/p/u:u1');
    expect(plain.some((l) => l.startsWith('/admin') || l.startsWith('/udt'))).toBe(false);
    expect(searchPages({ ...base, moderator: true }).map((p) => p.link)).toContain('/moderation');
    const admin = searchPages({ ...base, admin: true, udt: true, league: true }).map((p) => p.link);
    expect(admin).toEqual(expect.arrayContaining(['/admin/users', '/admin/settings?tab=league']));
    expect(admin).toEqual(
      expect.arrayContaining(['/udt/market', '/udt/league', '/udt/packs#craft']),
    );
    expect(
      searchPages({ ...base, udt: true, league: false }).some((p) =>
        p.link.startsWith('/udt/league'),
      ),
    ).toBe(false);
  });

  it('has every name in both languages', () => {
    const all = searchPages({ ...base, admin: true, udt: true, league: true });
    for (const lang of ['en', 'de'] as const)
      for (const p of all)
        for (const k of [p.label, p.group]) expect(DICT[lang][k], `${lang} ${k}`).toBeDefined();
  });
});
