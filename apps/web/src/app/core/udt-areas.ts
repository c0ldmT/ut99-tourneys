/**
 * The areas of Dream Team (decision 228): the hub's segments and the two rows of the Dream Team
 * navigation. Each area has its pages (tabs); the league only while it shows.
 */
export type UdtAreaId = 'team' | 'league' | 'packs' | 'cups' | 'trans';

export interface UdtAreaItem {
  /** i18n key of the label. */
  label: string;
  link: string;
  fragment?: string;
  /** A count shown next to it (trade offers waiting). */
  badge?: 'trades';
}

export interface UdtArea {
  id: UdtAreaId;
  /** i18n key (long and short for phones). */
  label: string;
  short: string;
  color: string;
  /** The colour as "r,g,b" for transparent tints. */
  rgb: string;
  /** SVG path (24 × 24, stroke). */
  icon: string;
  items: UdtAreaItem[];
  /** Pages of the area (path prefixes; the first item's link is the area's start). */
  paths: string[];
}

export const UDT_AREAS: readonly UdtArea[] = [
  {
    id: 'team',
    label: 'udt.area.team',
    short: 'udt.area.teamShort',
    color: '#22d3ee',
    rgb: '34,211,238',
    icon: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    items: [
      { label: 'udt.tab.team', link: '/udt/team' },
      { label: 'udt.nav.academy', link: '/udt/academy' },
      { label: 'udt.nav.yearbook', link: '/udt/yearbook' },
    ],
    paths: ['/udt/team', '/udt/academy', '/udt/yearbook', '/udt/bot/'],
  },
  {
    id: 'league',
    label: 'udt.area.league',
    short: 'udt.area.league',
    color: '#b26bff',
    rgb: '178,107,255',
    icon: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
    items: [
      { label: 'league.view.table', link: '/udt/league' },
      { label: 'league.view.day', link: '/udt/league/day' },
      { label: 'league.view.plan', link: '/udt/league/plan' },
      { label: 'league.view.final', link: '/udt/league/final' },
      { label: 'league.view.history', link: '/udt/league/history' },
    ],
    paths: ['/udt/league'],
  },
  {
    id: 'packs',
    label: 'udt.area.packs',
    short: 'udt.area.packs',
    color: '#a3e635',
    rgb: '163,230,53',
    icon: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
    items: [
      { label: 'udt.tab.open', link: '/udt/packs' },
      { label: 'udt.tab.inventory', link: '/udt/packs', fragment: 'inventory' },
      { label: 'udt.tab.craft', link: '/udt/packs', fragment: 'craft' },
    ],
    paths: ['/udt/packs'],
  },
  {
    id: 'cups',
    label: 'udt.area.cups',
    short: 'udt.area.cups',
    color: '#f0468c',
    rgb: '240,70,140',
    icon: 'M7 4h10v5a5 5 0 0 1-10 0zM5 5H3v2a4 4 0 0 0 4 4M19 5h2v2a4 4 0 0 1-4 4M12 14v4M8 21h8',
    items: [
      { label: 'udt.nav.events', link: '/udt/events' },
      { label: 'udt.nav.table', link: '/udt/table' },
    ],
    paths: ['/udt/events', '/udt/table'],
  },
  {
    id: 'trans',
    label: 'udt.area.trans',
    short: 'udt.area.transShort',
    color: '#7aa9ff',
    rgb: '122,169,255',
    icon: 'M4 8h14l-4-4M20 16H6l4 4',
    items: [
      { label: 'udt.nav.market', link: '/udt/market' },
      { label: 'udt.nav.trades', link: '/udt/trades', badge: 'trades' },
      { label: 'udt.nav.squads', link: '/udt/squads' },
    ],
    paths: ['/udt/market', '/udt/trades', '/udt/squads'],
  },
];

/** The areas shown (the league only while it shows). */
export function udtAreas(league: boolean): UdtArea[] {
  return UDT_AREAS.filter((a) => league || a.id !== 'league');
}

/** The area of a page (by its path), null for the hub and unknown pages. */
export function udtAreaOf(path: string): UdtAreaId | null {
  const p = path.split(/[?#]/)[0]!;
  return UDT_AREAS.find((a) => a.paths.some((x) => p === x || p.startsWith(x)))?.id ?? null;
}

export interface Pt {
  x: number;
  y: number;
}

/** One segment of the hub's shape: the triangle centre - corner - corner, its outer edge. */
export interface Segment {
  /** Corners of the segment (centre first). */
  points: [Pt, Pt, Pt];
  /** Middle of the outer edge and the outward direction (unit vector). */
  mid: Pt;
  normal: Pt;
  /** Centre of the segment (its label goes here). */
  centroid: Pt;
}

/**
 * The hub's shape: a regular polygon with `n` edges around `c` (corner radius `r`), cut from
 * the centre into one triangle per edge. Even n: a flat top edge (a square); odd n: a corner
 * on top (triangle, pentagon). Segment 0 is the top edge (even) or the upper left edge (odd),
 * then clockwise.
 */
export function hubShape(n: number, c: Pt, r: number): { corners: Pt[]; segments: Segment[] } {
  const start = n % 2 ? 270 - 360 / n : 270 - 180 / n;
  const corners = Array.from({ length: n }, (_, k) => {
    const a = ((start + (k * 360) / n) * Math.PI) / 180;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
  const segments = corners.map((p, k): Segment => {
    const q = corners[(k + 1) % n]!;
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const len = Math.hypot(mid.x - c.x, mid.y - c.y) || 1;
    return {
      points: [c, p, q],
      mid,
      normal: { x: (mid.x - c.x) / len, y: (mid.y - c.y) / len },
      centroid: { x: (c.x + p.x + q.x) / 3, y: (c.y + p.y + q.y) / 3 },
    };
  });
  return { corners, segments };
}
