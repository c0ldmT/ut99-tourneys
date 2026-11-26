import { udtAreas } from './udt-areas';

/** A page the quick search finds by its name (decision 313). */
export interface SearchPage {
  /** i18n keys of the name and the group it belongs to. */
  label: string;
  group: string;
  link: string;
}

/**
 * The pages the quick search offers to this user: the main pages and the account, the Dream
 * Team's pages (league only while it shows), and for admins the administration with the
 * settings tabs (moderators: the moderation queue).
 */
export function searchPages(o: {
  meId: string;
  admin: boolean;
  moderator: boolean;
  udt: boolean;
  league: boolean;
}): SearchPage[] {
  const main = 'search.group.site';
  const out: SearchPage[] = [
    { label: 'nav.tournaments', group: main, link: '/' },
    { label: 'nav.calendar', group: main, link: '/calendar' },
    { label: 'nav.stats', group: main, link: '/stats' },
    { label: 'nav.myStats', group: main, link: `/stats/p/u:${o.meId}` },
    { label: 'shop.title', group: main, link: '/shop' },
    { label: 'shop.tab.wardrobe', group: 'shop.title', link: '/shop?tab=wardrobe' },
    { label: 'nav.profile', group: main, link: '/profile' },
  ];
  if (o.udt) {
    out.push({ label: 'udt.title', group: 'udt.title', link: '/udt' });
    for (const a of udtAreas(o.league))
      for (const i of a.items)
        out.push({
          label: i.label,
          group: a.label,
          link: i.fragment ? `${i.link}#${i.fragment}` : i.link,
        });
  }
  if (o.admin || o.moderator)
    out.push({ label: 'nav.moderation', group: 'nav.admin', link: '/moderation' });
  if (o.admin) {
    const admin = 'nav.admin';
    out.push(
      { label: 'nav.overview', group: admin, link: '/admin' },
      { label: 'nav.new', group: admin, link: '/new' },
      { label: 'nav.agents', group: admin, link: '/admin/agents' },
      { label: 'series.title', group: admin, link: '/admin/series' },
      { label: 'nav.bots', group: admin, link: '/admin/bots' },
      { label: 'nav.users', group: admin, link: '/admin/users' },
      { label: 'nav.settings', group: admin, link: '/admin/settings' },
    );
    for (const t of ['season', 'bets', 'bots', 'udt', 'league', 'system'])
      out.push({
        label: `settings.tab.${t}`,
        group: 'nav.settings',
        link: t === 'season' ? '/admin/settings' : `/admin/settings?tab=${t}`,
      });
  }
  return out;
}
