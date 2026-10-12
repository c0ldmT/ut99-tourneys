import type { MatchResult } from '@tourney/bracket';
import type { TournamentProjection, TournamentSettings } from '@tourney/protocol';

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
