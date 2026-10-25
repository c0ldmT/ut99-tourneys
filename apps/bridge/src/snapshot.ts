import {
  BOT_REF_CHARS,
  isBotEntrant,
  wireName,
  wireText,
  type BotPersonality,
  type AccessEntry,
  type BotSpec,
  type Dedication,
  type BridgeToMod,
  type Entrant,
  type ModPhase,
  type TournamentProjection,
} from '@tourney/protocol';
import { ADAPTER_MH, travelOptions, type Ut99DmRules } from '@tourney/adapter-ut99';

/** Builds the bridge -> mod lines from the tournament projection. Pure functions. */

export type Side = 'a' | 'b';

export function entrantName(proj: TournamentProjection, id: string | null | undefined): string {
  if (!id) return '';
  return wireName(proj.entrants[id]?.displayName ?? id);
}

/** Team games: who plays in the current game, and who is out for the rest of the match. */
export interface RoleContext {
  /** User ids per entrant id playing the current game; undefined while the map is voted. */
  lineup?: Readonly<Record<string, readonly string[]>>;
  /** Users who may only watch (too many disconnects in this match). */
  excluded?: ReadonlySet<string>;
}

/**
 * Role of a website user on the game server: match player a/b of the current match, else
 * spectator. In team games every member is a/b while the map is voted (they all vote); once the
 * line-up is fixed, only the players of the line-up are, the substitutes on the bench watch.
 */
export function roleOf(
  proj: TournamentProjection,
  entry: AccessEntry,
  matchEntrants: readonly [string, string] | undefined,
  ctx: RoleContext = {},
): 'a' | 'b' | 's' {
  if (!entry.entrantId || !matchEntrants) return 's';
  const entrant = proj.entrants[entry.entrantId];
  // A user replaced by a bot is a spectator from then on.
  if (!entrant) return 's';
  if (entrant.kind === 'human') {
    if (entrant.userId !== entry.userId) return 's';
  } else if (entrant.kind === 'team') {
    if (!entrant.members.some((m) => m.userId === entry.userId)) return 's';
    if (ctx.excluded?.has(entry.userId)) return 's';
    const lineup = ctx.lineup?.[entrant.id];
    if (ctx.lineup && !lineup?.includes(entry.userId)) return 's';
  } else return 's';
  if (matchEntrants[0] === entry.entrantId) return 'a';
  if (matchEntrants[1] === entry.entrantId) return 'b';
  return 's';
}

export function aclLines(
  proj: TournamentProjection,
  access: readonly AccessEntry[],
  matchEntrants: readonly [string, string] | undefined,
  rev: number,
  ctx: RoleContext = {},
): BridgeToMod[] {
  return [
    { t: 'acl', n: access.length, rev },
    ...access.map((e): BridgeToMod => ({
      t: 'acle',
      tk: e.token,
      name: wireName(e.displayName),
      r: roleOf(proj, e, matchEntrants, ctx),
    })),
  ];
}

export function seriesWins(
  proj: TournamentProjection,
  matchId: string,
  entrants: readonly [string, string],
) {
  const games = proj.games[matchId] ?? [];
  return [
    games.filter((g) => g.winnerId === entrants[0]).length,
    games.filter((g) => g.winnerId === entrants[1]).length,
  ] as [number, number];
}

/** Dedication lines (Neuro shop) for the mod; empty lines are left out. */
export function dedicationLines(list: readonly Dedication[] | undefined): BridgeToMod[] {
  const lines: BridgeToMod[] = [];
  for (const d of list ?? [])
    for (const k of ['kill', 'death'] as const)
      if (d[k].trim()) lines.push({ t: 'ded', to: wireName(d.name), k, x: wireText(d[k], 120) });
  return lines;
}

/** Bot personalities by lower-case name in the game. */
export type Personalities = ReadonlyMap<string, BotPersonality>;

const ref = (s: string | undefined) => (s ?? '').slice(0, BOT_REF_CHARS);
const x100 = (v: number | undefined, lo: number) =>
  Math.max(lo, Math.min(100, Math.round((v ?? 0) * 100)));
const SAY_KIND = {
  start: 'start',
  kill: 'kill',
  death: 'death',
  win: 'win',
  loss: 'loss',
  rivalKill: 'rkill',
  rivalDeath: 'rdeath',
  betWon: 'bwon',
  betLost: 'blost',
} as const;

/**
 * Config lines of a website bot (look, play style, personality), sent before its `bot` or
 * `botadd` line. Bots of the server's configuration (no id) get none: the mod uses the ini.
 */
export function botConfigLines(b: BotSpec, personas?: Personalities): BridgeToMod[] {
  if (!b.id) return [];
  const name = wireName(b.name);
  const t = b.traits ?? {};
  const lines: BridgeToMod[] = [
    { t: 'bcfg', name, skn: ref(b.skin), fac: ref(b.face), vc: ref(t.voice) },
    {
      t: 'btr',
      name,
      fw: ref(t.favoriteWeapon),
      acc: x100(t.accuracy, -100),
      alt: x100(t.alertness, -100),
      cs: x100(t.combatStyle, -100),
      cmp: x100(t.camping, 0),
      str: x100(t.strafing, -100),
      jmp: !!t.jumpy,
    },
  ];
  if (b.gameTraits?.length) lines.push({ t: 'btrt', name, c: b.gameTraits.join(',') });
  const p = personas?.get(b.name.toLowerCase());
  if (p) {
    lines.push({ t: 'bpers', name, tk: p.talk });
    if (p.bet)
      lines.push({
        t: 'bbet',
        name,
        w: p.bet.won,
        amt: Math.max(0, Math.round(p.bet.amount)),
        pk: wireName(p.bet.pick),
      });
    for (const l of p.lines)
      lines.push({ t: 'bsay', name, k: SAY_KIND[l.kind], x: wireText(l.text, 120) });
    for (const r of p.rivals)
      lines.push({ t: 'brv', name, r: wireName(r.name), lv: r.level === 'nemesis' ? 2 : 1 });
  }
  return lines;
}

const botLine = (s: Side, b: BotSpec): BridgeToMod => ({
  t: 'bot',
  s,
  name: wireName(b.name),
  sk: Math.max(0, Math.min(7, Math.round(b.skill))),
  cls: b.botClass ?? '',
});

/**
 * Match header for the mod, plus the bots: in 1v1 the bot side, in team games the bots playing
 * this game per entrant (`teamBots`, known from the countdown on).
 */
export function matchLines(
  proj: TournamentProjection,
  rules: Ut99DmRules,
  matchId: string,
  game: number,
  entrants: readonly [string, string],
  teamBots?: Readonly<Record<string, readonly BotSpec[]>>,
  personas?: Personalities,
  dedications?: readonly Dedication[],
): BridgeToMod[] {
  const node = proj.bracket?.byId[matchId];
  const [wa, wb] = seriesWins(proj, matchId, entrants);
  const lines: BridgeToMod[] = [
    {
      t: 'match',
      mid: matchId,
      g: game,
      bo: node?.bestOf ?? 1,
      wa,
      wb,
      na: entrantName(proj, entrants[0]),
      nb: entrantName(proj, entrants[1]),
      fl: rules.fragLimit,
      tl: rules.timeLimitMin,
      ts: proj.settings.teamSize,
      ff: rules.friendlyFirePct,
    },
  ];
  entrants.forEach((id, i) => {
    const side: Side = i === 0 ? 'a' : 'b';
    const e: Entrant | undefined = proj.entrants[id];
    if (e?.kind === 'bot') lines.push(...botConfigLines(e.bot, personas), botLine(side, e.bot));
    for (const b of teamBots?.[id] ?? [])
      lines.push(...botConfigLines(b, personas), botLine(side, b));
  });
  lines.push(...dedicationLines(dedications));
  return lines;
}

export function bracketLines(
  proj: TournamentProjection,
  liveMatchId: string | undefined,
  rev: number,
): BridgeToMod[] {
  const b = proj.bracket;
  if (!b) return [];
  const lines: BridgeToMod[] = [
    {
      t: 'brh',
      // The mod knows single and double; a league matchday's pairings show like a first round.
      fmt: b.definition.format === 'double' ? 'double' : 'single',
      size: b.definition.size,
      n: b.matches.length,
      rev,
    },
  ];
  // Monster Hunt: game scores are run times in ms; the HUD shows games won instead.
  const race = proj.settings.game.adapter === ADAPTER_MH;
  for (const m of b.matches) {
    let sa = -1;
    let sb = -1;
    const [ea, eb] = m.entrants;
    if (ea && eb) {
      const games = proj.games[m.id] ?? [];
      if (m.bestOf === 1 && games[0] && !race) {
        sa = games[0].scores[ea] ?? -1;
        sb = games[0].scores[eb] ?? -1;
      } else if (games.length) {
        [sa, sb] = seriesWins(proj, m.id, [ea, eb]);
      }
    }
    const st =
      m.id === liveMatchId
        ? 'l'
        : ({ waiting: 'w', ready: 'r', completed: 'c', void: 'v' } as const)[m.status];
    lines.push({
      t: 'brm',
      id: m.id,
      s: m.side,
      r: m.round,
      i: m.index,
      na: entrantName(proj, ea),
      nb: entrantName(proj, eb),
      sa,
      sb,
      st,
      w: m.winnerId ? (m.winnerId === ea ? 'a' : 'b') : '',
    });
  }
  return lines;
}

export function standingsLines(proj: TournamentProjection, rev: number): BridgeToMod[] {
  const s = proj.bracket?.standings ?? [];
  return [
    { t: 'sth', n: s.length, rev },
    ...s.map((x): BridgeToMod => ({
      t: 'ste',
      name: entrantName(proj, x.entrantId),
      pl: x.placement ?? 0,
      w: x.wins,
      l: x.losses,
      bot: isBotEntrant(proj.entrants[x.entrantId]),
    })),
  ];
}

export function voteLines(
  matchId: string,
  pool: readonly { id: string; title?: string }[],
  seconds: number,
): BridgeToMod[] {
  return [
    { t: 'vopen', mid: matchId, n: pool.length, sec: seconds },
    ...pool.map((m, i): BridgeToMod => ({
      t: 'vmap',
      i: i + 1,
      map: m.id,
      title: wireName(m.title ?? m.id),
    })),
  ];
}

export function travelLine(
  rules: Ut99DmRules,
  map: string,
  matchId: string,
  game: number,
): BridgeToMod {
  return { t: 'travel', map, mid: matchId, g: game, opt: travelOptions(rules) };
}

export function phaseLine(p: ModPhase, matchId = '', sec = -1): BridgeToMod {
  return { t: 'phase', p, mid: matchId, sec };
}
