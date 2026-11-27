/**
 * "How it works" per page (decisions 327–329): one sentence, fact chips, three to five steps and
 * sections to unfold. Every value is an i18n key; the page passes the numbers (`params`). A
 * section can be opened directly (`Guides.open(page, section)`), e.g. stamina on My team.
 */

/** A paragraph of a section: its text, optionally a bold lead-in; `needs` a param to show. */
export interface GuidePara {
  key: string;
  title?: string;
  needs?: string;
}

export interface GuideSection {
  id: string;
  title: string;
  paras: GuidePara[];
}

export interface GuideStep {
  title: string;
  text: string;
  /** A page that does the step. */
  link?: string;
}

export interface GuideDef {
  /** Dream Team pages in violet, the others in cyan. */
  area: 'udt' | 'play' | 'admin';
  title: string;
  lead: string;
  facts: string[];
  steps: GuideStep[];
  more?: GuideSection[];
}

const g = (id: string) => (k: string) => `guide.${id}.${k}`;
const p = (key: string, title?: string, needs?: string): GuidePara => ({
  key,
  ...(title ? { title } : {}),
  ...(needs ? { needs } : {}),
});
/** Title, lead, `facts` facts and `steps` steps of a guide under `guide.<id>.*`. */
function base(id: string, area: GuideDef['area'], facts: number, steps: number, lead?: string) {
  const k = g(id);
  return {
    area,
    title: k('title'),
    lead: lead ?? k('lead'),
    facts: Array.from({ length: facts }, (_, i) => k(`f${i + 1}`)),
    steps: Array.from({ length: steps }, (_, i) => ({
      title: k(`s${i + 1}`),
      text: k(`s${i + 1}d`),
    })),
  };
}

export const GUIDES = {
  // --- Dream Team (decision 327)
  dt: {
    ...base('dt', 'udt', 4, 5),
    more: [
      {
        id: 'ways',
        title: 'udt.help.bots.title',
        paras: (['market', 'academy', 'packs', 'trades'] as const).map((w) =>
          p(`udt.help.way.${w}.text`, `udt.help.way.${w}.title`),
        ),
      },
      { id: 'roster', title: 'guide.dt.mRoster', paras: [p('udt.help.bots.roster')] },
      { id: 'neuro', title: 'udt.help.neuro.title', paras: [p('udt.help.neuro.text')] },
    ],
  },
  team: {
    ...base('team', 'udt', 4, 4),
    more: [
      {
        id: 'stamina',
        title: 'udt.staminaHelp.title',
        paras: ['loss', 'rest', 'tired', 'bench', 'traits', 'buy'].map((x) =>
          p(`udt.staminaHelp.${x}`),
        ),
      },
      { id: 'points', title: 'guide.team.mPoints', paras: [p('udt.points.explain')] },
    ],
  },
  league: {
    ...base('league', 'udt', 4, 4),
    more: [
      { id: 'scoring', title: 'guide.league.mScoring', paras: [p('league.scoringText')] },
      {
        id: 'games',
        title: 'guide.league.mGames',
        paras: [p('league.serverHint'), p('league.conferenceHint'), p('league.fallback')],
      },
    ],
  },
  packs: {
    ...base('packs', 'udt', 4, 4),
    more: [
      { id: 'craft', title: 'udt.tab.craft', paras: [p('udt.packs.craftText')] },
      { id: 'workshop', title: 'udt.tab.workshop', paras: [p('udt.workshop.text')] },
      { id: 'mod', title: 'guide.packs.mMod', paras: [p('udt.packs.mod')] },
    ],
  },
  cups: {
    ...base('cups', 'udt', 4, 4),
    more: [
      { id: 'auto', title: 'guide.cups.mAuto', paras: [p('udt.events.autoHint')] },
      { id: 'limits', title: 'guide.cups.mLimits', paras: [p('guide.cups.mLimitsd')] },
    ],
  },
  market: {
    ...base('market', 'udt', 4, 4, 'udt.market.intro'),
    more: [
      { id: 'price', title: 'guide.market.mPrice', paras: [p('udt.market.surcharge')] },
      { id: 'loan', title: 'guide.market.mLoan', paras: [p('udt.market.loanText')] },
      { id: 'legend', title: 'udt.market.legendLink', paras: [p('udt.market.legend')] },
    ],
  },
  trades: {
    ...base('trades', 'udt', 3, 4, 'udt.trades.lead'),
    more: [
      {
        id: 'rules',
        title: 'guide.trades.mRules',
        paras: [p('udt.trades.rules'), p('udt.trades.pair', undefined, 'pair')],
      },
    ],
  },
  academy: {
    ...base('academy', 'udt', 4, 4, 'udt.academy.intro'),
    more: [
      {
        id: 'talents',
        title: 'guide.academy.mTalents',
        paras: [p('udt.scout.intro'), p('udt.scout.note')],
      },
      { id: 'mentors', title: 'udt.academy.mentors', paras: [p('udt.mentor.intro')] },
    ],
  },
  club: base('club', 'udt', 3, 3, 'udt.club.intro'),
  yearbook: {
    ...base('yearbook', 'udt', 3, 3, 'udt.yearbook.intro'),
    more: [
      {
        id: 'nominations',
        title: 'udt.yearbook.nominations',
        paras: [p('udt.yearbook.nominationsText')],
      },
    ],
  },
} satisfies Record<string, GuideDef>;

export type GuideId = keyof typeof GUIDES;

/** Every i18n key a guide uses (for the test). */
export function guideKeys(d: GuideDef): string[] {
  return [
    d.title,
    d.lead,
    ...d.facts,
    ...d.steps.flatMap((s) => [s.title, s.text]),
    ...(d.more ?? []).flatMap((m) => [
      m.title,
      ...m.paras.flatMap((x) => [x.key, ...(x.title ? [x.title] : [])]),
    ]),
  ];
}
