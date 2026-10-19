/**
 * The Neuro shop's catalogue (pure): cosmetics only, no advantage in the game. Prices are the
 * defaults for a start balance of 1,000 Neuro; the admin can change them or take items out.
 */

export const SLOTS = ['title', 'color', 'frame', 'badge', 'banner', 'fanfare'] as const;
export type Slot = (typeof SLOTS)[number] | 'dedication';

export interface ShopItem {
  id: string;
  slot: Slot;
  /** Display name (titles: the title itself). */
  name: string;
  price: number;
  /** 1 common .. 3 rare, 4 legendary. */
  tier: 1 | 2 | 3 | 4;
  /**
   * What the item looks like: a colour or gradient (color), a frame style (frame), an icon name
   * (badge), a banner motif (banner). The website draws it.
   */
  value: string;
  /** Awarded at the end of a season, never sold. */
  awarded?: boolean;
}

const title = (id: string, name: string, tier: 1 | 2 | 3 | 4, price: number): ShopItem => ({
  id: `title.${id}`,
  slot: 'title',
  name,
  price,
  tier,
  value: name,
});

export const CATALOG: readonly ShopItem[] = [
  // Titles under the name
  title('fresh-meat', 'Fresh Meat', 1, 300),
  title('flak-monkey', 'Flak Monkey', 1, 300),
  title('stylish-camper', 'Stylish Camper', 1, 300),
  title('frag-machine', 'Frag Machine', 2, 600),
  title('headhunter', 'Headhunter', 2, 600),
  title('combo-king', 'Combo King', 2, 600),
  title('underdog-whisperer', 'Underdog Whisperer', 2, 600),
  title('neuro-baron', 'Neuro Baron', 3, 1200),
  title('rocket-scientist', 'Rocket Scientist', 3, 1200),
  title('last-man-standing', 'Last Man Standing', 3, 1200),
  title('godlike', 'Godlike', 4, 5000),
  // Name colours
  { id: 'color.ember', slot: 'color', name: 'Ember', price: 500, tier: 1, value: '#ff8a3d' },
  { id: 'color.lime', slot: 'color', name: 'Lime', price: 500, tier: 1, value: '#a3e635' },
  { id: 'color.teal', slot: 'color', name: 'Teal', price: 500, tier: 1, value: '#2dd4bf' },
  { id: 'color.violet', slot: 'color', name: 'Violet', price: 500, tier: 1, value: '#a78bfa' },
  { id: 'color.rose', slot: 'color', name: 'Rose', price: 500, tier: 1, value: '#fb7185' },
  { id: 'color.gold', slot: 'color', name: 'Gold', price: 500, tier: 1, value: '#fbbf24' },
  { id: 'color.ice', slot: 'color', name: 'Ice', price: 500, tier: 1, value: '#a5f3fc' },
  { id: 'color.silver', slot: 'color', name: 'Silver', price: 500, tier: 1, value: '#cbd5e1' },
  {
    id: 'color.neon',
    slot: 'color',
    name: 'Neon',
    price: 1500,
    tier: 3,
    value: 'linear-gradient(90deg,#22d3ee,#f0468c)',
  },
  {
    id: 'color.inferno',
    slot: 'color',
    name: 'Inferno',
    price: 1500,
    tier: 3,
    value: 'linear-gradient(90deg,#fbbf24,#ff4d5e)',
  },
  {
    id: 'color.aurora',
    slot: 'color',
    name: 'Aurora',
    price: 5000,
    tier: 4,
    value: 'aurora',
  },
  // Frames around the avatar / initial
  { id: 'frame.bronze', slot: 'frame', name: 'Bronze', price: 400, tier: 1, value: 'bronze' },
  { id: 'frame.silver', slot: 'frame', name: 'Silver', price: 800, tier: 2, value: 'silver' },
  { id: 'frame.gold', slot: 'frame', name: 'Gold', price: 1400, tier: 3, value: 'gold' },
  { id: 'frame.neon', slot: 'frame', name: 'Neon', price: 2000, tier: 3, value: 'neon' },
  {
    id: 'frame.throne',
    slot: 'frame',
    name: 'Neuro Throne',
    price: 5000,
    tier: 4,
    value: 'throne',
  },
  // Badges behind the name
  ...['crown', 'bolt', 'skull', 'dice', 'star', 'flame', 'target', 'ghost'].map((b): ShopItem => ({
    id: `badge.${b}`,
    slot: 'badge',
    name: b[0]!.toUpperCase() + b.slice(1),
    price: 250,
    tier: 1,
    value: b,
  })),
  // Banners on the player page
  ...['grid', 'lava', 'ice', 'circuit', 'sunset', 'night'].map((b): ShopItem => ({
    id: `banner.${b}`,
    slot: 'banner',
    name: b[0]!.toUpperCase() + b.slice(1),
    price: 800,
    tier: 2,
    value: b,
  })),
  // Victory fanfare: the champion post and the tournament page in the winner's look
  { id: 'fanfare', slot: 'fanfare', name: 'Fanfare', price: 1000, tier: 2, value: 'confetti' },
  // A line the website bots say when they frag you or you frag them (approved by an admin)
  { id: 'dedication', slot: 'dedication', name: 'Dedication', price: 1500, tier: 3, value: '' },
];

/** Items given at the end of a season (`{n}`: the season), not for sale. */
export const AWARDS = {
  champion: (n: number): ShopItem => ({
    id: `award.champion.${n}`,
    slot: 'frame',
    name: `Champion S${n}`,
    price: 0,
    tier: 4,
    value: 'champion',
    awarded: true,
  }),
  topBettor: (n: number): ShopItem => ({
    id: `award.bettor.${n}`,
    slot: 'title',
    name: `Top Bettor S${n}`,
    price: 0,
    tier: 4,
    value: `Top Bettor S${n}`,
    awarded: true,
  }),
};

/** An awarded item from its id ("award.champion.3"). */
export function awardById(id: string): ShopItem | undefined {
  const m = /^award\.(champion|bettor)\.(\d+)$/.exec(id);
  if (!m) return undefined;
  const n = Number(m[2]);
  return m[1] === 'champion' ? AWARDS.champion(n) : AWARDS.topBettor(n);
}

export const itemById = (id: string): ShopItem | undefined =>
  CATALOG.find((i) => i.id === id) ?? awardById(id);

/** What a user wears: item id per slot. */
export type Look = Partial<Record<(typeof SLOTS)[number], string>>;

/** The look as the website draws it (values instead of ids). */
export interface LookView {
  title?: string;
  color?: string;
  frame?: string;
  badge?: string;
  banner?: string;
  fanfare?: boolean;
}

export function lookView(look: Look): LookView {
  const v: LookView = {};
  for (const slot of SLOTS) {
    const id = look[slot];
    const item = id ? itemById(id) : undefined;
    if (!item || item.slot !== slot) continue;
    if (slot === 'fanfare') v.fanfare = true;
    else v[slot] = item.value;
  }
  return v;
}
