import type { MatchResult } from '@tourney/bracket';
import type { TournamentProjection, TournamentSettings } from '@tourney/protocol';
import type { MatchBetSummary, TournamentBetSummary } from '../bets/betting.js';
import type { DiscordPost, Embed } from './discord-out.js';

/** Texts of the Discord notifications (pure functions, one language per installation). */

export type Lang = 'de' | 'en';

const T = {
  de: {
    single: 'Single Elimination',
    double: 'Double Elimination',
    players: 'Plätze',
    teams: 'Teams',
    mode1: '1v1 Deathmatch',
    modeTdm: '{k}on{k} Team-Deathmatch',
    modeMh: '{k}on{k} Monster Hunt (Zeitrennen)',
    announce: '📣 **{name}** – Anmeldung offen! {mode}, {size}, {format}.{start} Anmelden: {link}',
    start: ' Start: {when}.',
    checkIn:
      '🟢 Check-in für **{name}** läuft, der Server ist online. Verbinden mit deinem persönlichen Befehl von der Website: {link} – Start spätestens {when}.',
    forfeit: '{w} gewinnt kampflos gegen {l}',
    simulated: '{w} schlägt {l} (simuliert){score}',
    override: '{w} gewinnt gegen {l} (vom Veranstalter festgelegt)',
    played: '{w} schlägt {l}{score}',
    champion: '🏆 **{w}** gewinnt **{name}**!{places} Turnierbaum: {link}',
    dmCheckIn:
      'Der Server für **{name}** ist online, der Check-in läuft. In der UT-Konsole eingeben:{connect}\n(Persönlicher Zugang, bitte nicht weitergeben.) Turnier: {link}',
    dmCheckInNoAddr:
      'Der Check-in für **{name}** läuft. Deinen Verbindungsbefehl findest du hier: {link}',
    dmMatch:
      'Dein Match **{match}** gegen **{opp}** in **{name}** beginnt jetzt (Map-Vote).{connect}',
    dmReminder: '⏰ **{name}** beginnt {when}. Du bist angemeldet: {link}',
    dmJoinedTeam: 'Du bist jetzt im Team **{team}** für **{name}**: {link}',
    dmTeamJoin: '**{who}** ist deinem Team **{team}** in **{name}** beigetreten.',
    dmOut: '**{name}**: {who} ist ausgeschieden – Platz {place}. Danke fürs Mitspielen!',
    dmOutYou: '**{name}**: Du bist ausgeschieden – Platz {place}. Danke fürs Mitspielen!',
    dmWon: '🏆 Glückwunsch! {who} hat **{name}** gewonnen.',
    dmWonYou: '🏆 Glückwunsch! Du hast **{name}** gewonnen.',
    eChampion: '🏆 {w} gewinnt {name}!',
    eMode: 'Modus',
    eFormat: 'Format',
    eSize: 'Plätze',
    eStart: 'Start',
    eSignUp: 'Anmeldung offen – jetzt auf der Website anmelden.',
    eCheckInTitle: '🟢 Check-in: {name}',
    eCheckIn:
      'Der Server ist online. Verbinde dich mit deinem persönlichen Befehl von der Website.',
    eStartLatest: 'Start spätestens',
    eGame: 'Spiel {n}',
    eSeries: 'Serie',
    eBets: '💰 Wetten',
    ePlaces: 'Platzierungen',
    eBracket: 'Zum Turnierbaum',
    eBetsOpenTitle: '🎲 Wetten offen: {a} vs {b}',
    eBetsOpen: 'Noch mindestens **{sec} s**, dann startet der Countdown. [Jetzt wetten]({link})',
    eBetsClosedTitle: '🔒 Wetten geschlossen: {a} vs {b}',
    ePool: 'Pool',
    eBiggest: 'Größte Wette',
    eOdds: 'Quote {odds}',
    eBetsSummary: '📊 Wetten',
    eNoGame: 'kein Spiel gespielt',
    betsOpen: '🎲 Wetten offen: **{a}** vs **{b}** – noch mindestens {sec} s: {link}',
    betsClosed: '🔒 Wetten geschlossen: **{a}** vs **{b}** – Pool {pool} · {sides}{big}',
    betsSide: '{name} {odds} ({n})',
    betsOne: '1 Wette',
    betsMany: '{n} Wetten',
    betsBig: ' · größte Wette: {who} {amount} auf {pick}',
    betsPaid: '💰 {upset}{bets} auf **{w}**: +{profit}{best}',
    betsUpset: 'Überraschung! ',
    betsBest: ' – größter Gewinn: {who} +{profit} ({odds})',
    betsNoGame: '↩️ Wetten zurückgezahlt (kein Spiel gespielt)',
    betsOneSided: '↩️ Wetten zurückgezahlt (nur auf eine Seite gewettet)',
    betsTournament: '📊 Wetten: {parts}',
    betsTop: 'größter Gewinner {who} {net}',
    betsFlop: 'größter Verlierer {who} {net}',
    betsVersus: 'Mensch vs. Maschine: Menschen {h} / Bots {b}',
  },
  en: {
    single: 'single elimination',
    double: 'double elimination',
    players: 'slots',
    teams: 'teams',
    mode1: '1v1 deathmatch',
    modeTdm: '{k}on{k} team deathmatch',
    modeMh: '{k}on{k} Monster Hunt (time race)',
    announce:
      '📣 **{name}** – registration is open! {mode}, {size}, {format}.{start} Sign up: {link}',
    start: ' Starts {when}.',
    checkIn:
      '🟢 Check-in for **{name}** is open, the server is online. Connect with your personal command from the website: {link} – starts {when} at the latest.',
    forfeit: '{w} wins by forfeit against {l}',
    simulated: '{w} beats {l} (simulated){score}',
    override: '{w} wins against {l} (set by the organizer)',
    played: '{w} beats {l}{score}',
    champion: '🏆 **{w}** wins **{name}**!{places} Bracket: {link}',
    dmCheckIn:
      'The server for **{name}** is online, check-in is open. Type in the UT console:{connect}\n(Personal access, please do not share.) Tournament: {link}',
    dmCheckInNoAddr:
      'Check-in for **{name}** is open. Your connect command is on the website: {link}',
    dmMatch:
      'Your match **{match}** against **{opp}** in **{name}** starts now (map vote).{connect}',
    dmReminder: '⏰ **{name}** starts {when}. You are signed up: {link}',
    dmJoinedTeam: 'You are now in team **{team}** for **{name}**: {link}',
    dmTeamJoin: '**{who}** joined your team **{team}** in **{name}**.',
    dmOut: '**{name}**: {who} is out – place {place}. Thanks for playing!',
    dmOutYou: '**{name}**: you are out – place {place}. Thanks for playing!',
    dmWon: '🏆 Congratulations! {who} won **{name}**.',
    dmWonYou: '🏆 Congratulations! You won **{name}**.',
    eChampion: '🏆 {w} wins {name}!',
    eMode: 'Mode',
    eFormat: 'Format',
    eSize: 'Slots',
    eStart: 'Start',
    eSignUp: 'Registration is open – sign up on the website.',
    eCheckInTitle: '🟢 Check-in: {name}',
    eCheckIn: 'The server is online. Connect with your personal command from the website.',
    eStartLatest: 'Starts at the latest',
    eGame: 'Game {n}',
    eSeries: 'Series',
    eBets: '💰 Bets',
    ePlaces: 'Placements',
    eBracket: 'Open the bracket',
    eBetsOpenTitle: '🎲 Bets open: {a} vs {b}',
    eBetsOpen: 'At least **{sec} s** left, then the countdown starts. [Bet now]({link})',
    eBetsClosedTitle: '🔒 Bets closed: {a} vs {b}',
    ePool: 'Pool',
    eBiggest: 'Biggest bet',
    eOdds: 'odds {odds}',
    eBetsSummary: '📊 Bets',
    eNoGame: 'no game played',
    betsOpen: '🎲 Bets open: **{a}** vs **{b}** – at least {sec} s left: {link}',
    betsClosed: '🔒 Bets closed: **{a}** vs **{b}** – pool {pool} · {sides}{big}',
    betsSide: '{name} {odds} ({n})',
    betsOne: '1 bet',
    betsMany: '{n} bets',
    betsBig: ' · biggest bet: {who} {amount} on {pick}',
    betsPaid: '💰 {upset}{bets} on **{w}**: +{profit}{best}',
    betsUpset: 'Upset! ',
    betsBest: ' – biggest win: {who} +{profit} ({odds})',
    betsNoGame: '↩️ Bets refunded (no game played)',
    betsOneSided: '↩️ Bets refunded (bets on one side only)',
    betsTournament: '📊 Bets: {parts}',
    betsTop: 'biggest winner {who} {net}',
    betsFlop: 'biggest loser {who} {net}',
    betsVersus: 'man vs. machine: players {h} / bots {b}',
  },
} as const;

type Key = keyof (typeof T)['de'];

function fill(lang: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  return T[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/** Escapes Discord markdown in names. */
export const md = (s: string) => s.replace(/([\\*_~`|>])/g, '\\$1');

/** Discord renders this in every reader's own time zone. */
export const when = (iso: string, style: 'F' | 'R' = 'F') =>
  `<t:${Math.floor(Date.parse(iso) / 1000)}:${style}>`;

export function modeText(lang: Lang, s: Pick<TournamentSettings, 'teamSize' | 'game'>): string {
  if (s.game.adapter === 'ut99-mh') return fill(lang, 'modeMh', { k: s.teamSize });
  return s.teamSize > 1 ? fill(lang, 'modeTdm', { k: s.teamSize }) : fill(lang, 'mode1');
}

export interface TournamentInfo {
  name: string;
  link: string;
  settings: TournamentSettings;
  scheduledAt?: string | null;
}

export function announce(lang: Lang, t: TournamentInfo): string {
  const size = `${t.settings.size} ${fill(lang, t.settings.teamSize > 1 ? 'teams' : 'players')}`;
  return fill(lang, 'announce', {
    name: md(t.name),
    mode: modeText(lang, t.settings),
    size,
    format: fill(lang, t.settings.format),
    start: t.scheduledAt ? fill(lang, 'start', { when: when(t.scheduledAt) }) : '',
    link: t.link,
  });
}

export function checkInOpened(lang: Lang, t: TournamentInfo, deadlineIso: string): string {
  return fill(lang, 'checkIn', { name: md(t.name), link: t.link, when: when(deadlineIso, 'R') });
}

/** "4:07.3" */
export function raceTime(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}

/** One line per match result for the channel. */
export function matchResult(lang: Lang, p: TournamentProjection, r: MatchResult): string {
  const name = (id: string) => md(p.entrants[id]?.displayName ?? id);
  const loser = r.entrants.find((e) => e !== r.winnerId) ?? '';
  const w = `**${name(r.winnerId)}**`;
  const l = name(loser);
  const race = p.settings.game.adapter === 'ut99-mh';
  const games = r.games ?? [];
  const pair = (g: { scores: Record<string, number> }, a: string, b: string) =>
    race
      ? `${raceTime(g.scores[a] ?? 0)} / ${raceTime(g.scores[b] ?? 0)}`
      : `${g.scores[a] ?? 0}:${g.scores[b] ?? 0}`;
  let score = '';
  if (games.length === 1) score = ` – ${pair(games[0]!, r.winnerId, loser)}`;
  else if (games.length > 1) {
    const wins = games.filter((g) => g.winnerId === r.winnerId).length;
    const each = games.map((g) => `${g.map ?? '?'} ${pair(g, r.winnerId, loser)}`).join(', ');
    score = ` – ${wins}:${games.length - wins} (${each})`;
  }
  const key = r.outcome === 'played' ? 'played' : r.outcome;
  return `\`${r.matchId}\` ${fill(lang, key, { w, l, score })}`;
}

export function champion(lang: Lang, p: TournamentProjection, link: string): string {
  const name = (id: string) => md(p.entrants[id]?.displayName ?? id);
  const placed = (p.bracket?.standings ?? [])
    .filter((s) => s.placement && s.placement <= 4)
    .sort((a, b) => (a.placement ?? 0) - (b.placement ?? 0))
    .map((s) => `${s.placement}. ${name(s.entrantId)}`);
  return fill(lang, 'champion', {
    w: name(p.championId ?? ''),
    name: md(p.name),
    places: placed.length ? `\n${placed.join('\n')}\n` : '',
    link,
  });
}

const connectLine = (address: string | null, token: string) =>
  address ? `\n\`open ${address}?tk=${token}\`` : '';

export function dmCheckIn(lang: Lang, t: TournamentInfo, address: string | null, token: string) {
  if (!address) return fill(lang, 'dmCheckInNoAddr', { name: md(t.name), link: t.link });
  return fill(lang, 'dmCheckIn', {
    name: md(t.name),
    link: t.link,
    connect: connectLine(address, token),
  });
}

export function dmMatchCalled(
  lang: Lang,
  t: TournamentInfo,
  matchId: string,
  opponent: string,
  address: string | null,
  token: string,
) {
  return fill(lang, 'dmMatch', {
    match: matchId,
    opp: md(opponent),
    name: md(t.name),
    connect: connectLine(address, token),
  });
}

export const dmReminder = (lang: Lang, t: TournamentInfo) =>
  fill(lang, 'dmReminder', {
    name: md(t.name),
    when: when(t.scheduledAt ?? '', 'R'),
    link: t.link,
  });

export const dmJoinedTeam = (lang: Lang, t: TournamentInfo, team: string) =>
  fill(lang, 'dmJoinedTeam', { team: md(team), name: md(t.name), link: t.link });

export const dmTeamJoin = (lang: Lang, t: TournamentInfo, team: string, who: string) =>
  fill(lang, 'dmTeamJoin', { team: md(team), who: md(who), name: md(t.name) });

/** `team`: the team's name in team tournaments, else the player ("You"). */
export function dmPlacement(lang: Lang, t: TournamentInfo, place: number, team?: string): string {
  const name = md(t.name);
  // German and English conjugate differently for "you": own sentences instead of a placeholder.
  if (!team)
    return place === 1 ? fill(lang, 'dmWonYou', { name }) : fill(lang, 'dmOutYou', { name, place });
  const who = `**${md(team)}**`;
  return place === 1
    ? fill(lang, 'dmWon', { who, name })
    : fill(lang, 'dmOut', { who, name, place });
}

// --- Bets with Neuro (€) ----------------------------------------------------------------------

const locale = (lang: Lang) => (lang === 'de' ? 'de-DE' : 'en-US');

/** "1.240 €" (Neuro). */
export const neuro = (lang: Lang, n: number) => `${n.toLocaleString(locale(lang))} €`;

/** "+320 €", "−400 €". */
const signed = (lang: Lang, n: number) =>
  (n > 0 ? '+' : n < 0 ? '−' : '') + neuro(lang, Math.abs(n));

/** "2,1x"; "–" when a side has no bets. */
const oddsText = (lang: Lang, o: number | null) =>
  o === null ? '–' : `${o.toLocaleString(locale(lang), { maximumFractionDigits: 2 })}x`;

const betCount = (lang: Lang, n: number) =>
  n === 1 ? fill(lang, 'betsOne') : fill(lang, 'betsMany', { n });

/** Entrant and bettor names for the bet texts. */
export interface BetNames {
  entrant: (id: string) => string;
  bettor: (key: string) => string;
}

export function betsOpen(lang: Lang, a: string, b: string, sec: number, link: string): string {
  return fill(lang, 'betsOpen', { a: md(a), b: md(b), sec, link });
}

export function betsClosed(lang: Lang, s: MatchBetSummary, n: BetNames): string {
  const [a, b] = s.entrants;
  const sides = s.entrants
    .map((e) =>
      fill(lang, 'betsSide', {
        name: md(n.entrant(e)),
        odds: oddsText(lang, s.sides[e]?.odds ?? null),
        n: betCount(lang, s.sides[e]?.bettors ?? 0),
      }),
    )
    .join(' / ');
  const big = s.biggest
    ? fill(lang, 'betsBig', {
        who: md(n.bettor(s.biggest.userId)),
        amount: neuro(lang, s.biggest.amount),
        pick: md(n.entrant(s.biggest.pick)),
      })
    : '';
  return fill(lang, 'betsClosed', {
    a: md(n.entrant(a)),
    b: md(n.entrant(b)),
    pool: neuro(lang, s.total),
    sides,
    big,
  });
}

/** Payout line under a match result (null: the match is not decided yet). */
export function betsPayout(lang: Lang, s: MatchBetSummary, n: BetNames): string | null {
  const o = s.outcome;
  if (!o) return null;
  if (o.kind === 'refunded')
    return fill(lang, o.reason === 'noGame' ? 'betsNoGame' : 'betsOneSided');
  const best = o.best
    ? fill(lang, 'betsBest', {
        who: md(n.bettor(o.best.userId)),
        profit: neuro(lang, o.best.profit),
        odds: oddsText(lang, o.odds),
      })
    : '';
  return fill(lang, 'betsPaid', {
    upset: o.upset ? fill(lang, 'betsUpset') : '',
    bets: betCount(lang, o.winners),
    w: md(n.entrant(o.winnerId)),
    profit: neuro(lang, o.profit),
    best,
  });
}

/** Summary line under the champion message (null: nothing to say). */
export function betsTournament(lang: Lang, s: TournamentBetSummary, n: BetNames): string | null {
  const parts: string[] = [];
  if (s.top)
    parts.push(
      fill(lang, 'betsTop', { who: md(n.bettor(s.top.userId)), net: signed(lang, s.top.net) }),
    );
  if (s.flop)
    parts.push(
      fill(lang, 'betsFlop', { who: md(n.bettor(s.flop.userId)), net: signed(lang, s.flop.net) }),
    );
  if (s.versus)
    parts.push(
      fill(lang, 'betsVersus', {
        h: signed(lang, s.versus.humans),
        b: signed(lang, s.versus.bots),
      }),
    );
  return parts.length ? fill(lang, 'betsTournament', { parts: parts.join(' · ') }) : null;
}

// --- Channel posts as embeds ------------------------------------------------------------------

/** Embed colours: cyan (actions), green (live, wins), gold (Neuro, champion), magenta, grey. */
export const COLOR = {
  cyan: 0x22d3ee,
  green: 0x4ade80,
  gold: 0xf5b83d,
  magenta: 0xf0468c,
  grey: 0x5d6679,
} as const;

const post = (...embeds: Embed[]): DiscordPost => ({ embeds });
const plain = (s: string) => s.replace(/\*\*/g, '');

export function announceEmbed(lang: Lang, t: TournamentInfo): DiscordPost {
  const fields = [
    { name: fill(lang, 'eMode'), value: modeText(lang, t.settings), inline: true },
    { name: fill(lang, 'eFormat'), value: fill(lang, t.settings.format), inline: true },
    {
      name: fill(lang, t.settings.teamSize > 1 ? 'teams' : 'eSize'),
      value: String(t.settings.size),
      inline: true,
    },
  ];
  if (t.scheduledAt)
    fields.push({
      name: fill(lang, 'eStart'),
      value: `${when(t.scheduledAt)} (${when(t.scheduledAt, 'R')})`,
      inline: false,
    });
  return post({
    title: `📣 ${t.name}`,
    url: t.link,
    description: `${fill(lang, 'eSignUp')}\n${t.link}`,
    color: COLOR.cyan,
    fields,
  });
}

export function checkInEmbed(lang: Lang, t: TournamentInfo, deadlineIso: string): DiscordPost {
  return post({
    title: fill(lang, 'eCheckInTitle', { name: t.name }),
    url: t.link,
    description: fill(lang, 'eCheckIn'),
    color: COLOR.green,
    fields: [{ name: fill(lang, 'eStartLatest'), value: when(deadlineIso, 'R') }],
  });
}

/** A match result; `payout`: the bets line, if any. */
export function resultEmbed(
  lang: Lang,
  p: TournamentProjection,
  r: MatchResult,
  link: string,
  payout?: string | null,
): DiscordPost {
  const nm = (id: string) => p.entrants[id]?.displayName ?? id;
  const loser = r.entrants.find((e) => e !== r.winnerId) ?? '';
  const race = p.settings.game.adapter === 'ut99-mh';
  const games = r.games ?? [];
  const pair = (g: { scores: Record<string, number> }) =>
    race
      ? `${raceTime(g.scores[r.winnerId] ?? 0)} / ${raceTime(g.scores[loser] ?? 0)}`
      : `${g.scores[r.winnerId] ?? 0} : ${g.scores[loser] ?? 0}`;
  const key = r.outcome === 'played' ? 'played' : r.outcome;
  const title = plain(fill(lang, key, { w: nm(r.winnerId), l: nm(loser), score: '' }));
  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (games.length > 1) {
    const wins = games.filter((g) => g.winnerId === r.winnerId).length;
    fields.push({ name: fill(lang, 'eSeries'), value: `**${wins} : ${games.length - wins}**` });
    games.forEach((g, i) =>
      fields.push({
        name: `${fill(lang, 'eGame', { n: i + 1 })} · ${g.map ?? '?'}`,
        value: pair(g),
        inline: true,
      }),
    );
  }
  if (payout) fields.push({ name: fill(lang, 'eBets'), value: payout.replace(/^💰 /, '') });
  return post({
    author: { name: `${p.name} · ${r.matchId}`, url: link },
    title: `${r.outcome === 'played' ? '⚔️' : '⏭️'} ${title}`,
    url: link,
    ...(games.length === 1
      ? { description: `**${pair(games[0]!)}** · ${games[0]!.map ?? ''}` }
      : {}),
    color: r.outcome === 'played' ? COLOR.green : COLOR.grey,
    ...(fields.length ? { fields } : {}),
  });
}

export function championEmbed(
  lang: Lang,
  p: TournamentProjection,
  link: string,
  bets?: string | null,
  fanfare?: { title?: string; color?: string } | null,
): DiscordPost {
  const name = (id: string) => md(p.entrants[id]?.displayName ?? id);
  const medal = ['🥇', '🥈', '🥉', '4.'];
  const placed = (p.bracket?.standings ?? [])
    .filter((s) => s.placement && s.placement <= 4)
    .sort((a, b) => (a.placement ?? 0) - (b.placement ?? 0))
    .map((s) => `${medal[(s.placement ?? 4) - 1] ?? `${s.placement}.`} ${name(s.entrantId)}`);
  const fields = placed.length ? [{ name: fill(lang, 'ePlaces'), value: placed.join('\n') }] : [];
  if (bets)
    fields.push({ name: fill(lang, 'eBetsSummary'), value: bets.replace(/^📊 [^:]+: /, '') });
  return post({
    title: fill(lang, 'eChampion', {
      w: p.entrants[p.championId ?? '']?.displayName ?? '',
      name: p.name,
    }),
    url: link,
    description:
      (fanfare ? `🎉🎊 ${fanfare.title ? `*${md(fanfare.title)}* ` : ''}🎊🎉\n` : '') +
      `[${fill(lang, 'eBracket')}](${link})`,
    color: fanfare ? fanfareColor(fanfare.color) : COLOR.gold,
    fields,
  });
}

/** Embed colour of a victory fanfare: the winner's name colour (first colour of a gradient). */
export function fanfareColor(color?: string): number {
  if (color === 'aurora') return COLOR.magenta;
  const hex = /#([0-9a-f]{6})/i.exec(color ?? '');
  return hex ? parseInt(hex[1]!, 16) : COLOR.gold;
}

export function betsOpenEmbed(
  lang: Lang,
  a: string,
  b: string,
  sec: number,
  link: string,
): DiscordPost {
  return post({
    title: fill(lang, 'eBetsOpenTitle', { a, b }),
    url: link,
    description: fill(lang, 'eBetsOpen', { sec, link }),
    color: COLOR.gold,
  });
}

export function betsClosedEmbed(
  lang: Lang,
  s: MatchBetSummary,
  n: BetNames,
  link: string,
): DiscordPost {
  const [a, b] = s.entrants;
  const side = (e: string) => {
    const x = s.sides[e];
    return `**${oddsText(lang, x?.odds ?? null)}**\n${neuro(lang, x?.amount ?? 0)} · ${betCount(lang, x?.bettors ?? 0)}`;
  };
  const fields = [
    { name: n.entrant(a), value: side(a), inline: true },
    { name: n.entrant(b), value: side(b), inline: true },
    { name: fill(lang, 'ePool'), value: `**${neuro(lang, s.total)}**`, inline: true },
  ];
  if (s.biggest)
    fields.push({
      name: fill(lang, 'eBiggest'),
      value: `${md(n.bettor(s.biggest.userId))}: ${neuro(lang, s.biggest.amount)} → ${md(n.entrant(s.biggest.pick))}`,
      inline: false,
    });
  return post({
    title: fill(lang, 'eBetsClosedTitle', { a: n.entrant(a), b: n.entrant(b) }),
    url: link,
    color: COLOR.magenta,
    fields,
  });
}
