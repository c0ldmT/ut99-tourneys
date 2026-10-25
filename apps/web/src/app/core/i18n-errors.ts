import { DICT, translate, type Lang } from './i18n-dict';

/** What the API sends with an error (see `apps/api/src/common/http.ts`). */
export interface ErrorBody {
  statusCode?: number;
  message?: string | string[];
  /** The English template with `{name}` placeholders. */
  key?: string;
  params?: Record<string, string | number>;
}

/**
 * German texts of the API's error templates (the key is the English template, which is also
 * the English text). Every template of the API needs one (tested).
 */
export const ERRORS_DE: Record<string, string> = {
  // --- general
  'login required': 'Bitte melde dich an.',
  'admins only': 'Nur für Admins.',
  forbidden: 'Das darfst du nicht.',
  'missing {header} header': 'Anfrage abgelehnt (Header {header} fehlt). Lade die Seite neu.',
  'server shutting down': 'Der Server fährt gerade herunter.',
  'no season is running': 'Es läuft keine Season.',
  'not enough Neuro: {spendable} can be spent (rescue floor {floor})':
    'Nicht genug Neuro: Du kannst {spendable} ausgeben (Rettungsgrenze {floor}).',
  'user not found': 'Nutzer nicht gefunden.',
  'player {key} not found': 'Spieler {key} nicht gefunden.',

  // --- login and users
  'Discord login is not configured': 'Der Discord-Login ist nicht eingerichtet.',
  'dev login is disabled': 'Der Entwickler-Login ist ausgeschaltet.',
  'you cannot remove your own admin rights':
    'Deine eigenen Admin-Rechte kannst du nicht entfernen.',
  'name must have at least 2 printable ASCII characters':
    'Der Name braucht mindestens 2 druckbare ASCII-Zeichen.',
  'the name {name} is already taken': 'Der Name {name} ist schon vergeben.',

  // --- servers (agents)
  'agent id: letters, digits, - and _ only': 'Server-ID: nur Buchstaben, Ziffern, - und _.',
  'agent {id} exists': 'Server {id} gibt es schon.',
  'agent {id} not found': 'Server {id} nicht gefunden.',
  'agent {id} is offline': 'Server {id} ist offline.',
  'agent {id} is not connected': 'Server {id} ist nicht verbunden.',
  'agent {id} did not answer {command}': 'Server {id} hat auf {command} nicht geantwortet.',
  '3D preview of {name} not found': '3D-Vorschau für {name} nicht gefunden.',
  'agent {agentId} is offline': 'Server {agentId} ist offline.',
  'agent {agentId} is busy with {name}': 'Server {agentId} ist mit {name} beschäftigt.',
  'agent {agentId} has no server profile {profileId}':
    'Server {agentId} hat kein Serverprofil {profileId}.',

  // --- bets
  'bets on this match are closed': 'Die Wetten auf dieses Match sind geschlossen.',
  'match {matchId} not found': 'Match {matchId} nicht gefunden.',
  'no bets in this tournament now ({reason})': 'In diesem Turnier gibt es gerade keine Wetten.',
  'only {free} Neuro free': 'Nur {free} Neuro frei.',
  'pick one of the two entrants': 'Wähle eine der beiden Seiten.',
  'you play in this match': 'Du spielst in diesem Match mit.',

  // --- bots and clans
  'bot {botId} not found': 'Bot {botId} nicht gefunden.',
  'bot {id} not found': 'Bot {id} nicht gefunden.',
  'bot not found': 'Bot nicht gefunden.',
  '"{gameName}" is longer than {chars} characters (UT cuts names)':
    '„{gameName}“ ist länger als {chars} Zeichen (UT kürzt Namen).',
  'ASCII letters, digits and signs only (UT99 names)':
    'Nur ASCII-Buchstaben, Ziffern und Zeichen (UT99-Namen).',
  'ASCII letters, digits and signs only': 'Nur ASCII-Buchstaben, Ziffern und Zeichen.',
  'ASCII without spaces': 'ASCII ohne Leerzeichen.',
  'a bot is already called {gameName} in the game': 'Im Spiel heißt schon ein Bot {gameName}.',
  'bot {name} exists': 'Den Bot {name} gibt es schon.',
  'clan {id} not found': 'Clan {id} nicht gefunden.',
  'clan {name} exists': 'Den Clan {name} gibt es schon.',
  'the server reported no bots (scan the server first)':
    'Der Server hat keine Bots gemeldet (scanne den Server zuerst).',
  'unknown rival bot {id}': 'Unbekannter Rivalen-Bot {id}.',
  'unknown rival player {id}': 'Unbekannter Rivalen-Spieler {id}.',
  'names must differ': 'Die Namen müssen sich unterscheiden.',

  // --- seasons
  'a season cannot start in the past': 'Eine Season kann nicht in der Vergangenheit beginnen.',
  'dates: YYYY-MM-DD': 'Datum im Format JJJJ-MM-TT.',
  'only the newest season can be deleted': 'Nur die neueste Season kann gelöscht werden.',
  'season {number} has ended': 'Season {number} ist beendet.',
  'season {number} is not running': 'Season {number} läuft nicht.',
  'season {number} not found': 'Season {number} nicht gefunden.',
  'season {number} runs until {day}': 'Season {number} läuft bis {day}.',
  'season {number} starts on {startDate}': 'Season {number} beginnt am {startDate}.',
  'the last day cannot be in the past (end the season now)':
    'Der letzte Tag kann nicht in der Vergangenheit liegen (beende die Season jetzt).',
  'the last day is before the first day': 'Der letzte Tag liegt vor dem ersten.',
  'the season has started: its first day cannot change':
    'Die Season hat begonnen: Ihr erster Tag kann sich nicht mehr ändern.',

  // --- series
  'either fromTournament or template': 'Entweder ein Turnier als Vorlage oder eine Vorlage.',
  'a series needs a start time or an hour interval':
    'Eine Serie braucht eine Startzeit oder einen Stundenabstand.',
  'a series needs at least one weekday': 'Eine Serie braucht mindestens einen Wochentag.',
  'at most {max} tournaments a day': 'Höchstens {max} Turniere pro Tag.',
  'no admin to create the tournament': 'Kein Admin, der das Turnier anlegen kann.',
  'series {id} not found': 'Serie {id} nicht gefunden.',
  'the series has no next start': 'Die Serie hat keinen nächsten Start.',

  // --- shop
  'buy a dedication first': 'Kauf zuerst eine Widmung.',
  'dedication {id} not found': 'Widmung {id} nicht gefunden.',
  'item {item} not found': 'Artikel {item} nicht gefunden.',
  'the shop is closed': 'Der Shop ist geschlossen.',
  'this item does not go there': 'Dieser Artikel passt nicht dorthin.',
  'write at least one line': 'Schreib mindestens eine Zeile.',
  'you do not own it': 'Das gehört dir nicht.',
  'you have a dedication already: change its lines instead':
    'Du hast schon eine Widmung: Ändere stattdessen ihre Zeilen.',
  'you own it already': 'Das hast du schon.',

  // --- tournaments and teams
  'a team called {name} already exists': 'Ein Team namens {name} gibt es schon.',
  'team for this invite link not found': 'Kein Team zu diesem Einladungslink gefunden.',
  'team {teamId} not found': 'Team {teamId} nicht gefunden.',
  'the new captain must be a member of the team': 'Der neue Captain muss im Team sein.',
  'the team name needs letters or digits (ASCII)':
    'Der Teamname braucht Buchstaben oder Ziffern (ASCII).',
  'not a Discord webhook URL': 'Das ist keine Discord-Webhook-URL.',
  'abort the running tournaments first: {list}': 'Brich zuerst die laufenden Turniere ab: {list}',
  'abort the tournament before deleting it': 'Brich das Turnier ab, bevor du es löschst.',
  'at most {teamSize} starters': 'Höchstens {teamSize} Starter.',
  'cannot abort in phase {phase}': 'In der Phase „{phase}“ kann nicht abgebrochen werden.',
  'cannot cancel in phase {phase}': 'In der Phase „{phase}“ kann nicht abgesagt werden.',
  'cannot reset in phase {phase}': 'In der Phase „{phase}“ kann nicht zurückgesetzt werden.',
  'cannot run a tournament in phase {phase}':
    'In der Phase „{phase}“ kann das Turnier nicht gestartet werden.',
  'cannot seed in phase {phase}': 'In der Phase „{phase}“ kann nicht gesetzt werden.',
  'form the teams first: some players have no team':
    'Bilde zuerst die Teams: Manche Spieler haben noch kein Team.',
  'leave your team first': 'Verlass zuerst dein Team.',
  'member {userId} not found': 'Mitglied {userId} nicht gefunden.',
  'no Monster Hunt run is being played right now': 'Gerade läuft kein Monster-Hunt-Lauf.',
  'no match is being played right now': 'Gerade läuft kein Match.',
  'not in the team: {list}': 'Nicht im Team: {list}',
  'only the captain can do this': 'Das kann nur der Captain.',
  'registration is closed': 'Die Anmeldung ist geschlossen.',
  'registration is closed: the bracket is already seeded':
    'Die Anmeldung ist geschlossen: Das Bracket ist schon gesetzt.',
  'registration of {userId} not found': 'Anmeldung von {userId} nicht gefunden.',
  'reset the seeding to change the teams': 'Setz die Auslosung zurück, um die Teams zu ändern.',
  'results can only be set while the tournament runs ({phase})':
    'Ergebnisse können nur gesetzt werden, solange das Turnier läuft ({phase}).',
  'settings, agent and profile can only be changed in draft (reset the seeding first)':
    'Einstellungen, Server und Profil lassen sich nur in der Anmeldung ändern (setz zuerst die Auslosung zurück).',
  'team tournaments of {teamSize} need at least {teamSize2} different bots in the pool':
    'Teamturniere mit {teamSize} brauchen mindestens {teamSize2} verschiedene Bots im Pool.',
  'teams are fixed: the bracket is already seeded':
    'Die Teams stehen fest: Das Bracket ist schon gesetzt.',
  'teams sign up on their own page here (Dream Team: the manager enters)':
    'Teams melden sich hier auf ihrer eigenen Seite an (Dream Team: der Manager meldet an).',
  'the bot pool cannot change while the tournament runs':
    'Der Bot-Pool kann sich nicht ändern, solange das Turnier läuft.',
  'the bracket is already seeded': 'Das Bracket ist schon gesetzt.',
  'the kind of a tournament changes in draft only':
    'Die Art eines Turniers lässt sich nur in der Anmeldung ändern.',
  'the team has all its starters': 'Das Team hat schon alle Starter.',
  'the team is full': 'Das Team ist voll.',
  'the tournament is full': 'Das Turnier ist voll.',
  'the tournament is not running ({phase})': 'Das Turnier läuft nicht ({phase}).',
  'the tournament is over': 'Das Turnier ist vorbei.',
  'the tournament is {phase}': 'Das Turnier ist in der Phase „{phase}“.',
  'this is not a team tournament': 'Das ist kein Teamturnier.',
  'tournament {id} exists': 'Das Turnier {id} gibt es schon.',
  'tournament {id} not found': 'Turnier {id} nicht gefunden.',
  'tournaments of kind {kind} cannot be seeded now':
    'Turniere der Art {kind} können gerade nicht gesetzt werden.',
  '{matchId} cannot be decided yet (entrants not known)':
    '{matchId} kann noch nicht entschieden werden (Teilnehmer noch offen).',
  '{matchId} has no map yet (map vote)': '{matchId} hat noch keine Map (Map-Abstimmung).',
  '{n} teams do not fit into a bracket of {size}':
    '{n} Teams passen nicht in ein Bracket mit {size} Plätzen.',
  '{n} players do not fit into a bracket of {size}':
    '{n} Spieler passen nicht in ein Bracket mit {size} Plätzen.',
  '{winnerId} does not play in {matchId}': '{winnerId} spielt nicht in {matchId}.',

  // --- Dream Team: team, lineup, own bots
  'the Dream Team is switched off': 'Das Dream Team ist ausgeschaltet.',
  'found your team first': 'Gründe zuerst dein Team.',
  'team not found': 'Team nicht gefunden.',
  'you have a team this season': 'Du hast in dieser Season schon ein Team.',
  'the team name {name} is taken': 'Der Teamname {name} ist vergeben.',
  'the tag {tag} is taken': 'Das Tag {tag} ist vergeben.',
  'tag and bot name are too long for the game: {tag}{name} (at most {chars})':
    'Tag und Botname sind zu lang fürs Spiel: {tag}{name} (höchstens {chars} Zeichen).',
  'the starter bot costs {cost} of {budget} points: lower the values':
    'Der Starter-Bot kostet {cost} von {budget} Punkten: Senk die Werte.',
  'the starter bot has skill {skill}': 'Der Starter-Bot hat Skill {skill}.',
  'Dream Team matches are played, not simulated (bot matches: watch)':
    'Dream-Team-Matches werden gespielt, nicht simuliert (Bot-Matches: zuschauen).',
  'a graduation is approved when season {season} is over':
    'Ein Abschluss wird freigegeben, wenn Season {season} vorbei ist.',
  '{name} is on strike: its salary is not paid': '{name} streikt: Das Gehalt ist nicht bezahlt.',
  'teams have entered: the kind, the ticket and the finale change only without entries':
    'Es sind schon Teams angemeldet: Art, Ticket und Finale lassen sich nur ohne Anmeldungen ändern.',
  'high stakes needs {minTeams} teams, the bracket has {size} places':
    'High Stakes braucht {minTeams} Teams, der Turnierbaum hat {size} Plätze.',
  'Dream Team tournaments need the Dream Team on and a start in the running season':
    'Dream-Team-Turniere brauchen ein eingeschaltetes Dream Team und einen Start in der laufenden Season.',
  'this Dream Team tournament belongs to season {season}, which is not running':
    'Dieses Dream-Team-Turnier gehört zu Season {season}, die nicht läuft.',
  'this Dream Team tournament belongs to season {season}, which is not running: the tickets went back':
    'Dieses Dream-Team-Turnier gehört zu Season {season}, die nicht läuft: Die Tickets gingen zurück.',
  'a bot twice in the deathmatch lineup': 'Ein Bot steht doppelt in der Deathmatch-Aufstellung.',
  'a bot twice in the Monster Hunt lineup':
    'Ein Bot steht doppelt in der Monster-Hunt-Aufstellung.',
  'a bot twice on the bench': 'Ein Bot sitzt doppelt auf der Bank.',
  'bot {id} is not yours': 'Bot {id} gehört dir nicht.',
  'only your own bots (starter, academy, blueprint) can be changed':
    'Nur deine eigenen Bots (Starter, Akademie, Bauplan) kannst du ändern.',
  'the bot is fully rested': 'Der Bot ist voll erholt.',
  'the model {value} is not known': 'Das Modell {value} kennt der Server nicht',
  'the skin {value} does not fit the model': 'Der Skin {value} passt nicht zum Modell',
  'the face {value} does not fit the skin': 'Das Gesicht {value} passt nicht zum Skin',
  'the voice {value} does not fit the model': 'Die Stimme {value} passt nicht zum Modell',
  'the bot was renamed already (once per bot)': 'Der Bot wurde schon umbenannt (einmal pro Bot).',
  'that is its name already': 'So heißt er schon.',
  'bot in your roster not found': 'Der Bot ist nicht in deinem Kader.',
  'the starter bot stays with your team': 'Der Starter-Bot bleibt in deinem Team.',
  'a bot made by a team cannot be sold to the market, only traded':
    'Ein selbst gemachter Bot kann nicht an den Markt verkauft, nur getauscht werden.',

  // --- Dream Team: academy
  'a bot is called {name} already': 'Ein Bot heißt schon {name}.',
  'a mentor needs level {level}': 'Ein Mentor braucht Level {level}.',
  'a mentor needs skill {skill}': 'Ein Mentor braucht Skill {skill}.',
  'at most {max} bots: make room first': 'Höchstens {max} Bots: Mach zuerst Platz im Kader.',
  'blueprint not found': 'Bauplan nicht gefunden.',
  'mentor in your roster not found': 'Der Mentor ist nicht in deinem Kader.',
  'apprentice in your roster not found': 'Der Lehrling ist nicht in deinem Kader.',
  'mentor and apprentice are two bots': 'Mentor und Lehrling müssen zwei verschiedene Bots sein.',
  'an apprentice is a bot your team made': 'Ein Lehrling ist ein Bot, den dein Team gemacht hat.',
  '{name} had a mentor already': '{name} hatte schon einen Mentor.',
  'the apprentice needs a lower skill than its mentor':
    'Der Lehrling braucht einen niedrigeren Skill als sein Mentor.',
  'not enough development points (one per level)':
    'Nicht genug Entwicklungspunkte (einer pro Level).',
  'own bot in your roster not found': 'Der eigene Bot ist nicht in deinem Kader.',
  'scout first': 'Scoute zuerst.',
  'talent not found': 'Talent nicht gefunden.',
  'blueprints build skill {skill}': 'Baupläne bauen Skill {skill}.',
  'the build costs {cost} of {budget} points: lower the values':
    'Der Bau kostet {cost} von {budget} Punkten: Senk die Werte.',
  'the potential is reached': 'Das Potenzial ist erreicht.',
  'a bot has one breakthrough': 'Ein Bot hat nur einen Durchbruch – den hatte er schon.',
  'the bot is Godlike already': 'Der Bot ist schon Godlike.',
  'a breakthrough needs level {level}': 'Ein Durchbruch geht ab Level {level}.',
  'a breakthrough needs the potential reached':
    'Für einen Durchbruch muss das Potenzial erreicht sein.',
  'a breakthrough needs every value at {value} or more':
    'Für einen Durchbruch müssen alle drei Werte mindestens {value} sein.',
  'the breakthrough costs {cost} points': 'Der Durchbruch kostet {cost} Punkte.',
  'the potential is skill {potential}': 'Das Potenzial ist Skill {potential}.',
  'the value is at its maximum': 'Der Wert ist schon am Maximum.',
  '{name} has an apprentice this season': '{name} hat diese Season schon einen Lehrling.',
  '{tag}{name} is too long for the game': '{tag}{name} ist zu lang fürs Spiel.',

  // --- Dream Team: careers, graduation, hall of fame
  'a bot a manager owns cannot retire': 'Ein Bot, der einem Manager gehört, kann nicht abtreten.',
  'a graduation needs {games} Dream Team games and level {level}':
    'Ein Abschluss braucht {games} Dream-Team-Spiele und Level {level}.',
  'at most {n} graduations per season': 'Höchstens {n} Abschlüsse pro Season.',
  'not nominated': 'Nicht angemeldet.',
  'own bot of this season not found': 'Eigener Bot dieser Season nicht gefunden.',
  'retired already': 'Schon abgetreten.',
  'the bot is {status}': 'Der Bot ist schon weiter ({status}).',
  'the server is reserved for {label} from {from} to {to}':
    'Der Server ist von {from} bis {to} für {label} reserviert.',
  'the league does not fit into season {season}: {hint}':
    'Die Liga passt nicht in Season {season}: {hint}.',
  'the league of season {season} runs already': 'Die Liga von Season {season} läuft schon.',
  'league game {id} not found': 'Ligaspiel {id} nicht gefunden.',
  'league club {id} not found': 'Ligaclub {id} nicht gefunden.',
  'league of season {season} not found': 'Keine Liga in Season {season}.',
  'the league is not running': 'Die Liga läuft nicht.',
  '{n} managers do not fit into {places} league places':
    '{n} Manager passen nicht auf {places} Ligaplätze.',
  'clubs per tier: 8, 10, 12, 14 or 16': 'Teams pro Liga: 8, 10, 12, 14 oder 16.',
  'only the home club picks the map': 'Nur der Heimclub wählt die Map.',
  'the game is not open any more': 'Das Spiel ist nicht mehr offen.',
  'map {map} is not in the league pool': 'Die Map {map} ist nicht im Liga-Pool.',
  'the test league cannot start in the past':
    'Die Testliga kann nicht in der Vergangenheit starten.',
  'only a test league can be called off': 'Nur eine Testliga kann abgebrochen werden.',
  'no admin to make the league games': 'Kein Admin, der die Ligaspiele anlegt.',
  'a keeper graduates in a later season':
    'Ein Keeper kann erst in einer späteren Season abschließen, nicht in seiner ersten als Keeper.',
  '{name} is a keeper for next season: take it out first':
    '{name} ist als Keeper für die nächste Season gewählt: Nimm ihn dort zuerst heraus.',
  'keepers are chosen at the end of the season': 'Keeper wählst du am Ende der Season.',
  'at most {n} keepers': 'Höchstens {n} Keeper.',
  '{name} was bought: only bots your team made can be kept':
    '{name} wurde gekauft: Behalten kannst du nur Bots, die dein Team gemacht hat.',
  'the bot plays in a Dream Team roster this season':
    'Der Bot spielt diese Season in einem Dream-Team-Kader.',

  // --- Dream Team: events
  'Dream Team tournament {id} not found': 'Dream-Team-Turnier {id} nicht gefunden.',
  'high stakes needs {minTeams} human teams, {humans} can play: the tickets went back':
    'High Stakes braucht {minTeams} Teams von Menschen, {humans} können spielen: Die Tickets gingen zurück.',
  'not enough teams and free library bots for a bracket':
    'Nicht genug Teams und freie Bibliotheks-Bots für ein Bracket.',
  'the bracket is full': 'Das Bracket ist voll.',
  'the bracket is seeded: ask an organizer': 'Das Bracket ist gesetzt: Frag einen Organisator.',
  'the finale has no sign-up: the top of the season table plays':
    'Das Finale hat keine Anmeldung: Die Spitze der Season-Tabelle spielt.',
  'the sign-up is closed': 'Die Anmeldung ist geschlossen.',
  'your team cannot play: {list}': 'Dein Team kann nicht spielen: {list}',

  // --- Dream Team: market
  'offer not found': 'Angebot nicht gefunden.',
  'the bot is sold': 'Der Bot ist schon verkauft.',
  'at most {max} bots: your roster is full': 'Höchstens {max} Bots: Dein Kader ist voll.',

  // --- Dream Team: packs and traits
  'at most one body trait per bot': 'Höchstens ein Körper-Trait pro Bot.',
  'at most one legendary trait per bot': 'Höchstens ein legendärer Trait pro Bot.',
  'choose the favourite weapon': 'Wähle die Lieblingswaffe.',
  'crafting costs {cost} scrap': 'Herstellen kostet {cost} Schrott.',
  'no free trait slot (more from level 5 and 10)':
    'Kein freier Trait-Platz (mehr ab Level 5 und 10).',
  'take the trait off the bot first': 'Nimm den Trait zuerst vom Bot.',
  'the bot has this trait': 'Der Bot hat diesen Trait schon.',
  'the trait is not on a bot': 'Der Trait ist auf keinem Bot.',
  'the trait is on a bot already': 'Der Trait ist schon auf einem Bot.',
  'trait card not found': 'Trait-Karte nicht gefunden.',
  'unknown trait': 'Unbekannter Trait.',
  'you have this trait in your inventory': 'Diesen Trait hast du schon im Inventar.',

  // --- Dream Team: test mode
  'cannot simulate in phase {phase}': 'In der Phase „{phase}“ kann nicht simuliert werden.',
  'test mode not found': 'Testmodus nicht gefunden.',
  'this clock cannot be moved': 'Diese Uhr lässt sich nicht verstellen.',

  // --- Dream Team: trades
  'Neuro goes one way only': 'Neuro geht nur in eine Richtung.',
  'a trade needs at least one bot': 'Ein Tausch braucht mindestens einen Bot.',
  'a bot twice in the trade': 'Ein Bot steht doppelt im Tausch.',
  'a trade needs two managers': 'Ein Tausch braucht zwei Manager.',
  'every manager keeps at least one bot': 'Jeder Manager behält mindestens einen Bot.',
  'at most {max} bots per roster': 'Höchstens {max} Bots pro Kader.',
  'at most {tradePairPerWeek} trades between two managers per week':
    'Höchstens {tradePairPerWeek} Tausche zwischen zwei Managern pro Woche.',
  'bot {id} is not in that roster (any more)': 'Bot {id} ist nicht (mehr) in diesem Kader.',
  'only the partner can accept': 'Nur der Partner kann annehmen.',
  'only the partner can decline': 'Nur der Partner kann ablehnen.',
  'only the proposer can withdraw': 'Nur wer das Angebot gemacht hat, kann es zurückziehen.',
  'team of that manager not found': 'Team dieses Managers nicht gefunden.',
  'the AI managers are switched off': 'Die KI-Manager sind ausgeschaltet.',
  'the offer is {status}': 'Das Angebot ist nicht mehr offen ({status}).',
  'trade not found': 'Tausch nicht gefunden.',
  'trading is switched off': 'Der Handel ist ausgeschaltet.',
  'unbalanced: one side is worth {giveValue}, the other {takeValue} Neuro (the smaller must be at least {tradeBalancePct} %)':
    'Unausgeglichen: Eine Seite ist {giveValue}, die andere {takeValue} Neuro wert (die kleinere muss mindestens {tradeBalancePct} % erreichen).',
  '{name} plays in a running Dream Team tournament':
    '{name} spielt gerade in einem laufenden Dream-Team-Turnier.',
  '{name} was bought or traded less than {tradeLockDays} days ago':
    '{name} wurde vor weniger als {tradeLockDays} Tagen gekauft oder getauscht.',
  '{name} is nominated for the graduation: withdraw the nomination first':
    '{name} ist für den Abschluss nominiert: Zieh die Nominierung zuerst zurück.',
};

/**
 * Error parameters that are themselves translated: param name → i18n key prefix (phases of a
 * tournament everywhere; statuses per template).
 */
const PARAM_KEYS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  '*': { phase: 'phase.' },
  'the offer is {status}': { status: 'udt.trades.st.' },
  'the bot is {status}': { status: 'udt.academy.st.' },
  'the server is reserved for {label} from {from} to {to}': { label: 'cal.label.' },
  'the league does not fit into season {season}: {hint}': { hint: 'league.fitHint.' },
};

/** Templates whose whole text comes from an i18n key built from a parameter. */
const WHOLE: Readonly<Record<string, (p: Record<string, string | number>) => string>> = {
  'no bets in this tournament now ({reason})': (p) => `bets.closed.${p['reason']}`,
};

function fill(tpl: string, params: Record<string, string | number> = {}): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) =>
    params[k] !== undefined ? String(params[k]) : m,
  );
}

const capital = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/**
 * The text of an API error in a language: the template's translation with its values, the
 * generic "invalid input" for validation problems without a known text, the server's own
 * message otherwise (texts of the bridge or the game).
 */
export function errorMessage(
  lang: Lang,
  e: {
    status: number;
    message: string;
    key?: string | undefined;
    params?: Record<string, string | number> | undefined;
  },
): string {
  if (e.status === 0) return translate(lang, 'err.network');
  if (e.status === 401) return translate(lang, 'err.login');
  const key = e.key;
  const params = { ...(e.params ?? {}) };
  if (key && WHOLE[key]) {
    const k = WHOLE[key](params);
    if (k in DICT.en) return translate(lang, k);
  }
  if (key && key in ERRORS_DE) {
    const names = { ...PARAM_KEYS['*'], ...(PARAM_KEYS[key] ?? {}) };
    for (const [name, prefix] of Object.entries(names)) {
      const v = params[name];
      if (v !== undefined && `${prefix}${v}` in DICT.en)
        params[name] = translate(lang, `${prefix}${v}`);
    }
    const tpl = lang === 'de' ? ERRORS_DE[key]! : key;
    const text = capital(fill(tpl, params));
    return lang === 'en' && !/[.!?:)]$/.test(text) ? `${text}.` : text;
  }
  if (e.status === 400 && (key === 'invalid input' || params['field'] !== undefined)) {
    const field = params['field'];
    return field !== undefined
      ? translate(lang, 'err.invalidField', { field })
      : translate(lang, 'err.invalid');
  }
  if (e.status >= 500) return translate(lang, 'err.server');
  return capital(e.message || translate(lang, 'err.unknown'));
}
