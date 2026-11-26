/**
 * Patch notes for the website's users (decision 243): newest first. The id is the decision
 * number of the patch's last change and only grows; a user sees every note above the id they
 * last saw once in a modal after the update (new users start at the latest). A patch that
 * changes something users notice adds a note at the top, in English and German.
 */

export interface PatchNoteText {
  title: string;
  items: string[];
}

export interface PatchNote {
  id: number;
  /** Day of the patch (YYYY-MM-DD). */
  date: string;
  /** Mod version the patch needs on the game servers (when it brings one). */
  mod?: string;
  en: PatchNoteText;
  de: PatchNoteText;
}

export const PATCH_NOTES: readonly PatchNote[] = [
  {
    id: 310,
    date: '2026-11-26',
    en: {
      title: 'Your account in one place',
      items: [
        'The profile is now "Account": your name as others see it, in-game name, join token (with Copy), language and Discord messages on one page.',
        'A new join token is only created after you confirm - the old one stops working at once.',
      ],
    },
    de: {
      title: 'Dein Konto an einem Ort',
      items: [
        'Aus dem Profil wird „Konto“: dein Name, wie andere ihn sehen, Ingame-Name, Beitritts-Token (mit Kopieren), Sprache und Discord-Nachrichten auf einer Seite.',
        'Ein neuer Beitritts-Token entsteht erst nach einer Rückfrage - der alte funktioniert sofort nicht mehr.',
      ],
    },
  },
  {
    id: 309,
    date: '2026-11-26',
    en: {
      title: 'League games at a glance',
      items: [
        'Matches: your league game sits in its league evening row ("your game …") instead of a second row.',
        "A league game's page shows a result card - home, score, away - instead of a bracket of two.",
        'Packs: the stage stays slim until you open a box; the calendar shows league evenings as "League MD 8" in full.',
      ],
    },
    de: {
      title: 'Ligaspiele auf einen Blick',
      items: [
        'Matches: Dein Ligaspiel steht in der Zeile seines Liga-Abends („dein Spiel …“) statt in einer zweiten Zeile.',
        'Die Seite eines Ligaspiels zeigt eine Ergebnis-Karte - Heim, Ergebnis, Gast - statt eines Turnierbaums mit zwei Teams.',
        'Packs: Die Bühne bleibt schmal, bis du eine Box öffnest; der Kalender zeigt Liga-Abende vollständig als „Liga ST 8“.',
      ],
    },
  },
  {
    id: 306,
    date: '2026-11-26',
    en: {
      title: 'Small navigation helps',
      items: [
        'On wide screens the shop shows its name in the header.',
        "A bot's page marks the Team tab, so you see where you are.",
      ],
    },
    de: {
      title: 'Kleine Navigationshilfen',
      items: [
        'Auf breiten Bildschirmen steht der Shop mit Namen in der Kopfleiste.',
        'Die Seite eines Bots markiert den Reiter „Team“ - du siehst, wo du bist.',
      ],
    },
  },
  {
    id: 305,
    date: '2026-11-26',
    en: {
      title: 'Dream Team pages tidied up',
      items: [
        'Every Dream Team page starts the same way: a small violet line with the area, the title, one sentence and the key figures - without the big card, so the content starts higher (on phones too).',
        'Long rules (trading, market chart, scouting, mentors) are behind "How it works" - open them once and they stay open.',
        'The club house shows its buildings directly, the next market day reads "tomorrow 04:00".',
      ],
    },
    de: {
      title: 'Dream-Team-Seiten aufgeräumt',
      items: [
        'Jede Dream-Team-Seite beginnt gleich: eine kleine violette Zeile mit dem Bereich, der Titel, ein Satz und die wichtigsten Zahlen - ohne die große Karte, der Inhalt beginnt weiter oben (auch am Handy).',
        'Lange Regeln (Handel, Markt-Kurve, Scouting, Mentoren) stehen hinter „So funktioniert’s“ - einmal geöffnet, bleiben sie offen.',
        'Das Vereinshaus zeigt seine Gebäude direkt, der nächste Markttag liest sich „morgen 04:00“.',
      ],
    },
  },
  {
    id: 302,
    date: '2026-11-26',
    en: {
      title: 'Clearer when something is locked or empty',
      items: [
        'A purchase you cannot afford yet says how much Neuro is missing (shop, club house, packs).',
        'Empty lists point to the next step, e.g. the calendar when no tournament is coming up.',
        'On phones, tab rows fade out where more tabs are - swipe to see them.',
        "Pausing, aborting and renaming ask in the website's own dialog.",
      ],
    },
    de: {
      title: 'Klarer, wenn etwas gesperrt oder leer ist',
      items: [
        'Ein Kauf, den du dir noch nicht leisten kannst, zeigt, wie viel Neuro fehlt (Shop, Vereinshaus, Packs).',
        'Leere Listen zeigen den nächsten Schritt, z. B. den Kalender, wenn kein Turnier ansteht.',
        'Am Handy blenden Reiterleisten aus, wo weitere Reiter kommen - zum Sehen wischen.',
        'Pausieren, Abbrechen und Umbenennen fragen im Dialog der Website.',
      ],
    },
  },
  {
    id: 299,
    date: '2026-11-26',
    en: {
      title: 'Easier to read, clearer to confirm',
      items: [
        'Small labels are a little bigger and the pale grey text has more contrast.',
        'Dates read the same everywhere ("today 18:00", "Sat 05/12", "5 Dec 2026"); the ledger shows when in your local time.',
        'Buying, selling and deleting ask in a dialog of the website instead of the browser; deleting and other steps that cannot be undone have a red button and start on Cancel.',
      ],
    },
    de: {
      title: 'Besser lesbar, klarer bestätigen',
      items: [
        'Kleine Beschriftungen sind etwas größer, der blasse graue Text hat mehr Kontrast.',
        'Daten lesen sich überall gleich („heute 18:00“, „Sa., 05.12.“, „05.12.2026“); das Kontobuch zeigt die Zeit in deiner Ortszeit, die Statistik deutsche Daten.',
        'Kaufen, Verkaufen und Löschen fragen in einem Dialog der Website statt des Browsers; Löschen und andere endgültige Schritte haben einen roten Knopf und starten auf „Abbrechen“.',
      ],
    },
  },
  {
    id: 296,
    date: '2026-11-26',
    en: {
      title: 'Neuro gets its own sign',
      items: [
        'Neuro now has its own coin with an N, and amounts read "1,250 N" - no more € sign that looked like real money.',
        'Clearer words: "Teams" under Transfers lists every team of the season ("Roster" stays your own bots), and texts say "1 day" or "3 days" instead of "day(s)".',
        "Finished cups show your team's place, Dream Team tournaments drop the BOT marks.",
        "Shop titles and colours show their rarity in the Dream Team's colours.",
      ],
    },
    de: {
      title: 'Neuro bekommt ein eigenes Zeichen',
      items: [
        'Neuro hat jetzt eine eigene Münze mit N, Beträge stehen als „1.250 N“ da - kein €-Zeichen mehr, das nach Echtgeld aussah.',
        'Klarere Begriffe: „Teams“ unter Transfers zeigt alle Teams der Season („Kader“ bleiben deine eigenen Bots), und Texte sagen „1 Tag“ oder „3 Tage“ statt „Tag(e)“.',
        'Seltenheiten heißen auf Deutsch Gewöhnlich, Ungewöhnlich, Selten, Episch und Legendär; Shop-Titel und Namensfarben tragen die Farben der Dream-Team-Seltenheiten.',
        'Beendete Cups zeigen den Platz deines Teams, Dream-Team-Turniere ohne BOT-Marken.',
      ],
    },
  },
  {
    id: 294,
    date: '2026-11-26',
    en: {
      title: 'League evenings like parallel matches',
      items: [
        "A league game's page lists the other games of the evening - one click opens them.",
        'The league page and the overview show the games on the server in the same list: server, score, your game marked.',
        '"Matches ● n" in the header now counts the matches being played.',
      ],
    },
    de: {
      title: 'Liga-Abende wie parallele Matches',
      items: [
        'Die Seite eines Ligaspiels listet die anderen Spiele des Abends - ein Klick öffnet sie.',
        'Liga-Seite und Übersicht zeigen die Spiele auf dem Server in derselben Liste: Server, Stand, dein Spiel markiert.',
        '„Matches ● n“ in der Kopfleiste zählt jetzt die laufenden Matches.',
      ],
    },
  },
  {
    id: 293,
    date: '2026-11-26',
    en: {
      title: 'Tournament page tidied up',
      items: [
        'While a tournament runs, everything about the matches being played is at the top: with several at once a list on the left, the chosen match with its bets on the right.',
        'Joining the server, open bets and next matches are in the side column next to the bracket.',
      ],
    },
    de: {
      title: 'Turnierseite aufgeräumt',
      items: [
        'Während ein Turnier läuft, steht alles zu den laufenden Matches oben: bei mehreren gleichzeitig links eine Liste, rechts das gewählte Match mit seinen Wetten.',
        'Auf den Server, offene Wetten und nächste Matches stehen in der Seitenspalte neben dem Turnierbaum.',
      ],
    },
  },
  {
    id: 291,
    date: '2026-11-26',
    en: {
      title: 'Several matches at once',
      items: [
        'Tournaments can play bot matches on several servers at the same time - matches with players stay on the main server.',
        'The tournament page shows one tab per running match; the bracket marks all of them.',
        'Want to watch a bot match? "More servers" in the join box has the connect command of each server.',
      ],
    },
    de: {
      title: 'Mehrere Matches gleichzeitig',
      items: [
        'Turniere können Bot-Matches auf mehreren Servern gleichzeitig spielen - Matches mit Spielern bleiben auf dem Hauptserver.',
        'Die Turnierseite zeigt einen Reiter je laufendem Match; der Turnierbaum markiert alle.',
        'Ein Bot-Match ansehen? Unter „Weitere Server“ im Beitreten-Kasten steht der Befehl für jeden Server.',
      ],
    },
  },
  {
    id: 289,
    date: '2026-11-26',
    en: {
      title: 'Elite packs a little cheaper',
      items: [
        'Elite packs rise a little less with the economy index: 19,820 at index 2.7 and 24,590 at index 5 (before 20,830 and 26,650).',
      ],
    },
    de: {
      title: 'Elite-Packs etwas günstiger',
      items: [
        'Elite-Packs steigen mit dem Wirtschaftsindex noch etwas weniger: 19.820 bei Index 2,7 und 24.590 bei Index 5 (vorher 20.830 und 26.650).',
      ],
    },
  },
  {
    id: 286,
    date: '2026-11-26',
    en: {
      title: 'Cheaper elite packs late in the season, a tidier menu',
      items: [
        'Premium and elite packs rise much less with the economy index: elite costs 14,000 at index 1, 20,830 at 2.7 and 26,650 at 5 (before 10,000 / 27,000 / 50,000). In exchange the base price is a bit higher early in the season.',
        'The menu bar is tidier: profile, language and logout are behind your avatar.',
      ],
    },
    de: {
      title: 'Günstigere Elite-Packs spät in der Season, aufgeräumtes Menü',
      items: [
        'Premium- und Elite-Packs steigen mit dem Wirtschaftsindex viel weniger: Elite kostet bei Index 1 14.000, bei 2,7 20.830 und bei 5 26.650 (vorher 10.000 / 27.000 / 50.000). Dafür ist der Grundpreis früh in der Season etwas höher.',
        'Die Menüleiste ist aufgeräumt: Profil, Sprache und Abmelden liegen hinter deinem Avatar.',
      ],
    },
  },
  {
    id: 283,
    date: '2026-11-25',
    en: {
      title: 'Fair play for names and chat lines',
      items: [
        'Names, team names, bot names and chat lines go through a word filter: insults, hate and sexual words are not allowed.',
        'See something that does not belong here? The small flag next to a player name, a bot or a team reports it to the moderators.',
        'Moderators can reset names and lines and warn or block players who break the rules.',
      ],
    },
    de: {
      title: 'Fair Play für Namen und Chatzeilen',
      items: [
        'Namen, Teamnamen, Botnamen und Chatzeilen laufen durch einen Wortfilter: Beleidigungen, Hetze und sexuelle Begriffe sind nicht erlaubt.',
        'Etwas gesehen, das hier nicht hingehört? Die kleine Fahne neben einem Spielernamen, einem Bot oder einem Team meldet es den Moderatoren.',
        'Moderatoren können Namen und Zeilen zurücksetzen und Spieler verwarnen oder sperren, die gegen die Regeln verstoßen.',
      ],
    },
  },
  {
    id: 282,
    date: '2026-11-25',
    en: {
      title: 'More game servers',
      items: [
        'Several tournaments can run at the same time now: the overview shows a tile per running tournament with its server, the header how many run right now.',
        'League evenings are shorter: the games run side by side on all free servers (your club still plays its games one after another).',
        'You cannot sign up for two tournaments that take place at the same time.',
      ],
    },
    de: {
      title: 'Mehr Gameserver',
      items: [
        'Mehrere Turniere können jetzt gleichzeitig laufen: die Übersicht zeigt eine Kachel je laufendem Turnier mit seinem Server, der Kopf, wie viele gerade laufen.',
        'Liga-Abende werden kürzer: die Spiele laufen gleichzeitig auf allen freien Servern (dein Club spielt seine Spiele weiter nacheinander).',
        'Du kannst dich nicht mehr für zwei Turniere anmelden, die zur selben Zeit stattfinden.',
      ],
    },
  },
  {
    id: 280,
    date: '2026-11-25',
    en: {
      title: 'Small fix',
      items: [
        'Cards show prestige stars as ★3 instead of a row of stars, so the prestige chip no longer breaks on small cards.',
      ],
    },
    de: {
      title: 'Kleine Korrektur',
      items: [
        'Karten zeigen Prestige-Sterne als ★3 statt als Sternreihe, damit die Prestige-Leiste auf kleinen Karten nicht mehr umbricht.',
      ],
    },
  },
  {
    id: 279,
    date: '2026-11-22',
    en: {
      title: 'Prestige in the yearbook',
      items: [
        'The yearbook shows the prestige stage a bot reached in its season (Mature, Godlike, Godlike+ with stars), the hall of fame the highest one of its seasons.',
      ],
    },
    de: {
      title: 'Prestige im Jahrbuch',
      items: [
        'Das Jahrbuch zeigt die Prestige-Endstufe, die ein Bot in seiner Season erreicht hat (Ausgereift, Godlike, Godlike+ mit Sternen), die Ruhmeshalle die höchste seiner Seasons.',
      ],
    },
  },
  {
    id: 278,
    date: '2026-11-22',
    mod: '0.23.0',
    en: {
      title: 'Seven more traits',
      items: [
        'Uncommon: belt runner (knows when shield belts, armour and the keg come back, faster on the way), escape artist (faster and dodges more on the retreat when hurt), close quarters (more damage up close).',
        'Rare: Hitscan Sniper (better aim with shock beam, sniper rifle, enforcer and minigun), power surge (more damage for 10 s after a power item).',
        'Epic: focus fire (team games: the whole team goes for the enemy a team mate is hitting). Legendary: last stand (once per life below 30 health: 4 s of much better aim and less damage taken).',
        'The match page shows what the new traits did in the trait log.',
      ],
    },
    de: {
      title: 'Sieben weitere Traits',
      items: [
        'Uncommon: Belt runner (kennt die Respawn-Zeiten von Gürteln, Rüstung und Keg, auf dem Weg schneller), Escape artist (schneller und mehr Ausweichen auf dem Rückzug, wenn angeschlagen), Close quarters (mehr Schaden aus der Nähe).',
        'Rare: Hitscan Sniper (besser zielen mit Shock-Strahl, Sniper Rifle, Enforcer und Minigun), Power surge (mehr Schaden für 10 s nach einem Power-Item).',
        'Epic: Focus fire (Teamspiele: das ganze Team nimmt den Gegner, den ein Teamkollege gerade trifft). Legendary: Last stand (einmal pro Leben unter 30 Leben: 4 s viel besser zielen und weniger Schaden nehmen).',
        'Die Match-Seite zeigt im Trait-Log, was die neuen Traits getan haben.',
      ],
    },
  },
  {
    id: 276,
    date: '2026-11-21',
    mod: '0.22.0',
    en: {
      title: 'Nine new traits',
      items: [
        'Common: cool head (better aim for 6 s after a spawn), quick draw (better aim against a new enemy), spawn guard (half the damage for 2 s after a spawn).',
        'Uncommon: fast hands (another weapon before the last shots). Rare: clutch (more damage and better aim while its side is behind), quartermaster (fetches ammo when it runs low, more ammo from pickups).',
        'Epic: momentum (better aim with every kill of a life), trigger discipline (keeps its weapon in a fight and never fires splash up close). Legendary: arsenal (a full flak cannon or rocket launcher at every spawn, a refill once per life).',
        'The match page shows what the new traits did in the trait log.',
      ],
    },
    de: {
      title: 'Neun neue Traits',
      items: [
        'Common: Cool head (besser zielen für 6 s nach dem Spawn), Quick draw (besser zielen gegen einen neuen Gegner), Spawn guard (halber Schaden für 2 s nach dem Spawn).',
        'Uncommon: Fast hands (wechselt vor den letzten Schüssen). Rare: Clutch (mehr Schaden und besser zielen, solange seine Seite hinten liegt), Quartermaster (holt Munition, wenn sie knapp wird, mehr Munition aus Pickups).',
        'Epic: Momentum (besser zielen mit jedem Kill eines Lebens), Trigger discipline (bleibt im Kampf bei seiner Waffe und schießt nie Flächenschaden aus der Nähe). Legendary: Arsenal (volle Flak oder Rocket Launcher bei jedem Spawn, einmal pro Leben nachgefüllt).',
        'Die Match-Seite zeigt im Trait-Log, was die neuen Traits getan haben.',
      ],
    },
  },
  {
    id: 274,
    date: '2026-11-21',
    mod: '0.21.0',
    en: {
      title: 'Market: signatures, loans, settling in',
      items: [
        'Library bots with a career (2 seasons, career level 10) earn a signature: an effect of their own from their statistics - signature weapon, marksman, streak killer, clean-up, comeback kid, early starter or home map. It stays with the bot, needs no trait slot and gets stronger (★) from career level 20. A mentor passes it on to its apprentice with 25 % for the season.',
        "Loan a bot of the day's offers for 7 market days for 15 % of its value, without salary (one at a time). Buying it meanwhile costs the price less the fee.",
        'Bought bots settle in after 10 Dream Team games for your team and get 2 prestige points.',
        "Prestige points count 4 % each against a cup's team value cap.",
      ],
    },
    de: {
      title: 'Markt: Signaturen, Leihe, Eingewöhnung',
      items: [
        'Bibliotheks-Bots mit Karriere (2 Seasons, Karriere-Level 10) bekommen eine Signatur: einen eigenen Effekt aus ihrer Statistik – Leibwaffe, Präzisionsschütze, Serienkiller, Abräumer, Stehaufmann, Frühstarter oder Lieblings-Map. Sie bleibt beim Bot, braucht keinen Trait-Slot und wird ab Karriere-Level 20 stärker (★). Ein Mentor gibt sie mit 25 % für die Season an seinen Lehrling weiter.',
        'Leihe einen Bot aus dem Tagesangebot für 7 Markttage für 15 % seines Werts, ohne Gehalt (eine Leihe gleichzeitig). Kaufen während der Leihe kostet den Preis minus Leihgebühr.',
        'Gekaufte Bots sind nach 10 Dream-Team-Spielen für dein Team eingewöhnt und bekommen 2 Prestige-Punkte.',
        'Prestige-Punkte zählen mit je 4 % zur Teamwert-Grenze eines Cups.',
      ],
    },
  },
  {
    id: 268,
    date: '2026-11-21',
    en: {
      title: 'Club house and scouting',
      items: [
        'New page Club house (My team): ten buildings for the season, some in three levels - training ground, physio, scouting office, analysis room, boarding school, workshop, fan shop, mentor wing, sports psychologist and trophy room.',
        "Analysis room: before a league game My team shows the opponent's lineup with values, traits and prestige, both sides' strength and your record per map with a recommended home map.",
        "Trophy room: pick a crest - it shows next to your team name in the league, the hub and My team - and see your trophy wall with titles, cup wins and your bots' final stages.",
        'Scouting reworked: talents are rough diamonds (skill 2-3, high potential) that learn 30 % faster until they reach it, their licence costs half, and some carry a hidden trait that comes free at level 10. As keepers they lose no skill.',
        'Development points: the buttons are tiles now, with the value before and after and a bar.',
      ],
    },
    de: {
      title: 'Vereinshaus und Scouting',
      items: [
        'Neue Seite Vereinshaus (Mein Team): zehn Gebäude für die Season, einige in drei Stufen – Trainingsplatz, Physio, Scouting-Büro, Analyse-Raum, Jugendinternat, Werkstatt, Fanshop, Mentoren-Flügel, Sportpsychologe und Trophäenraum.',
        'Analyse-Raum: Vor einem Ligaspiel zeigt „Mein Team“ die Aufstellung des Gegners mit Werten, Traits und Prestige, die Stärke beider Seiten und deine Bilanz je Map mit einer empfohlenen Heim-Map.',
        'Trophäenraum: Wähle ein Wappen – es steht neben deinem Teamnamen in der Liga, im Hub und bei „Mein Team“ – und sieh deine Trophäenwand mit Titeln, Cup-Siegen und den Endstufen deiner Bots.',
        'Scouting überarbeitet: Talente sind Rohdiamanten (Skill 2–3, hohes Potenzial), lernen bis dahin 30 % schneller, ihre Lizenz kostet die Hälfte, und manche tragen eine verborgene Anlage, die mit Level 10 frei wird. Als Keeper verlieren sie keinen Skill.',
        'Entwicklungspunkte: Die Knöpfe sind jetzt Kacheln mit dem Wert vorher und nachher und einem Balken.',
      ],
    },
  },
  {
    id: 265,
    date: '2026-11-21',
    mod: '0.20.0',
    en: {
      title: 'Prestige',
      items: [
        'Own bots at the end of their development get prestige points: mature bots up to 4, Godlike up to 6, Godlike+ after the ascension up to 11 with stars.',
        'Points come from left-over level points (2 = 1) or for Neuro; place them on nine stats (precision, reflex, evasion, overview, toughness, firepower, plating, sprint, supply), at most 3 each. Resetting costs a little.',
        'Prestige lasts the season like traits; the stage stays as a mark. AI managers and AI clubs use it too.',
      ],
    },
    de: {
      title: 'Prestige',
      items: [
        'Eigene Bots am Ende ihrer Entwicklung bekommen Prestige-Punkte: ausgereifte bis 4, Godlike bis 6, Godlike+ nach dem Aufstieg mit Sternen bis 11.',
        'Punkte kommen aus übrigen Level-Punkten (je 2 = 1) oder gegen Neuro; verteile sie auf neun Werte (Präzision, Reflex, Ausweichen, Übersicht, Zähigkeit, Feuerkraft, Panzerung, Sprint, Vorrat), je höchstens 3. Umverteilen kostet etwas.',
        'Prestige gilt die Season wie Traits; die Endstufe bleibt als Marke. KI-Manager und KI-Clubs nutzen es auch.',
      ],
    },
  },
  {
    id: 263,
    date: '2026-11-21',
    en: {
      title: 'AI clubs play with their traits',
      items: [
        'League AI clubs now play real games with their own values and traits (before, the game left them out). The self-regulating band adjusts their strength to the results.',
        'AI managers will use prestige like you once it is there.',
      ],
    },
    de: {
      title: 'KI-Clubs spielen mit ihren Traits',
      items: [
        'KI-Clubs der Liga spielen echte Spiele jetzt mit ihren eigenen Werten und Traits (bisher ließ das Spiel sie weg). Das selbstregelnde Gummiband passt ihre Stärke an die Ergebnisse an.',
        'KI-Manager nutzen Prestige wie du, sobald es da ist.',
      ],
    },
  },
  {
    id: 262,
    date: '2026-11-21',
    en: {
      title: 'Breakthrough from level 15',
      items: [
        'A breakthrough now needs level 15 (was 10): development lasts a little longer. Next comes prestige - bots at the end of their development get small strength boosts.',
      ],
    },
    de: {
      title: 'Durchbruch ab Level 15',
      items: [
        'Ein Durchbruch braucht jetzt Level 15 (statt 10): Die Entwicklung dauert etwas länger. Als Nächstes kommt Prestige – Bots am Ende ihrer Entwicklung bekommen kleine Stärke-Boni.',
      ],
    },
  },
  {
    id: 259,
    date: '2026-11-21',
    mod: '0.19.2',
    en: {
      title: 'Smarter bots and reworked traits (mod 0.19.2)',
      items: [
        'Base AI by level: higher levels now and then keep safe distances with splash weapons, switch weapons less in fights, change weapon before their last shot, are pushed into pits less often and head for power items shortly before they are back.',
        'Light feet: +12 % speed only on the way to items and on the retreat, normal speed in a fight.',
        "Sniper's nest: only with the sniper rifle and a hitscan weapon in hand, shorter stays, a hit ends it. Assassin: only +25 % damage from behind, no more hunting of hurt enemies.",
        'Stronger: thick skin −15 %, regeneration after 3 s, counter-attacker 5 s, health hound below 85 health, team player joins fights from further away.',
        'A little weaker: overload every 6th kill, vampire 11 %, weapon master aim error −20 %.',
      ],
    },
    de: {
      title: 'Klügere Bots und überarbeitete Traits (Mod 0.19.2)',
      items: [
        'Grund-KI nach Stufe: Höhere Stufen halten mit Splash-Waffen öfter Abstand, wechseln im Kampf seltener die Waffe, wechseln vor dem letzten Schuss, werden seltener in Abgründe gestoßen und laufen kurz vor dem Respawn zu Power-Items.',
        'Light feet: +12 % Tempo nur auf dem Weg zu Items und auf dem Rückzug, im Kampf normales Tempo.',
        "Sniper's nest: nur mit Scharfschützengewehr und Hitscan-Waffe in der Hand, kürzer, ein Treffer beendet es. Assassin: nur noch +25 % Schaden von hinten, keine Jagd auf angeschlagene Gegner mehr.",
        'Stärker: Thick skin −15 %, Regeneration nach 3 s, Counter-attacker 5 s, Health hound unter 85 Leben, Team player hilft aus größerer Entfernung.',
        'Etwas schwächer: Overload jeder 6. Kill, Vampire 11 %, Weapon master Zielfehler −20 %.',
      ],
    },
  },
  {
    id: 256,
    date: '2026-11-21',
    en: {
      title: 'Fully developed bots',
      items: [
        'A bot that is fully developed (skill at its potential, every value at 100, breakthrough done) no longer counts as having development points to give - the hub and My team stop asking. Its further level points are kept for prestige later.',
      ],
    },
    de: {
      title: 'Voll entwickelte Bots',
      items: [
        'Ein voll entwickelter Bot (Skill am Potenzial, alle Werte bei 100, Durchbruch erledigt) hat keine Entwicklungspunkte mehr zu vergeben – Hub und Mein Team melden sich dafür nicht mehr. Seine weiteren Level-Punkte werden für das spätere Prestige aufbewahrt.',
      ],
    },
  },
  {
    id: 255,
    date: '2026-11-20',
    en: {
      title: 'Cheaper basics, new ways to spend Neuro',
      items: [
        'Salaries, standard packs and creation licences now follow the economy index only with its square root (at index 5 about ×2.2 instead of ×5). Premium and elite packs and the market stay as they are.',
        'Training camp: in the bot details a bot gains +60 XP once a day for a little Neuro - good for bots that play little.',
        'Trait workshop on the packs page: reroll a trait card into another trait of its rarity, or upgrade it into a random trait one rarity higher - for Neuro and scrap.',
      ],
    },
    de: {
      title: 'Günstigere Grundkosten, neue Wege, Neuro auszugeben',
      items: [
        'Gehälter, Standard-Packs und Lizenzen folgen dem Wirtschaftsindex jetzt nur noch mit seiner Wurzel (bei Index 5 etwa ×2,2 statt ×5). Premium- und Elite-Packs und der Markt bleiben, wie sie sind.',
        'Trainingslager: In den Bot-Details bekommt ein Bot einmal am Tag +60 XP für ein paar Neuro – gut für Bots, die wenig spielen.',
        'Trait-Werkstatt auf der Packs-Seite: Würfle eine Trait-Karte zu einem anderen Trait ihrer Seltenheit neu oder werte sie zu einem zufälligen Trait eine Seltenheit höher auf – gegen Neuro und Schrott.',
      ],
    },
  },
  {
    id: 252,
    date: '2026-11-20',
    en: {
      title: 'League: stronger AI clubs that keep pace',
      items: [
        'AI clubs now play with traits - as many per bot as a typical human manager of their tier has (at most 4 in the Pro Series down to 1 in the lowest tier).',
        "Your bots' traits now count when the league works out how strong the AI clubs should be. Last season the AI clubs ignored them and lost almost every game.",
        "The AI clubs' strength regulates itself: after every league evening it rises a little when the humans win more than 70 % of their games against AI clubs and falls when they win less than 55 %. Good teams should win about two of three games against AI clubs.",
      ],
    },
    de: {
      title: 'Liga: stärkere KI-Clubs, die mithalten',
      items: [
        'KI-Clubs spielen jetzt mit Traits – so vielen pro Bot, wie ein typischer menschlicher Manager ihrer Liga hat (höchstens 4 in der Pro Series bis 1 in der untersten Liga).',
        'Die Traits deiner Bots zählen jetzt mit, wenn die Liga berechnet, wie stark die KI-Clubs sein sollen. In der letzten Season haben die KI-Clubs sie ignoriert und fast jedes Spiel verloren.',
        'Die Stärke der KI-Clubs regelt sich selbst: Nach jedem Ligaabend steigt sie etwas, wenn die Menschen mehr als 70 % ihrer Spiele gegen KI-Clubs gewinnen, und sinkt, wenn sie weniger als 55 % gewinnen. Gute Teams sollen etwa zwei von drei Spielen gegen KI-Clubs gewinnen.',
      ],
    },
  },
  {
    id: 250,
    date: '2026-11-20',
    en: {
      title: 'AI managers in the league, smarter AI managers',
      items: [
        'AI managers now have their own club in the Dream Team league from the next league start. Your games against them are played on the server, their games against AI clubs are simulated. They get table money like you; the cup bonus stays with the human managers. An AI manager can become champion.',
        'AI managers develop their bots up to the potential first, swap weak bought bots for clearly better ones, open more packs from their savings and build their blueprints.',
      ],
    },
    de: {
      title: 'KI-Manager in der Liga, klügere KI-Manager',
      items: [
        'KI-Manager haben ab dem nächsten Ligastart einen eigenen Club in der Dream Team Liga. Deine Spiele gegen sie laufen auf dem Server, ihre Spiele gegen KI-Clubs werden simuliert. Sie bekommen Tabellengeld wie du; der Cup-Bonus bleibt bei den menschlichen Managern. Auch ein KI-Manager kann Meister werden.',
        'KI-Manager entwickeln ihre Bots zuerst bis zum Potenzial, tauschen schwache gekaufte Bots gegen deutlich bessere, öffnen von ihren Ersparnissen mehr Packs und bauen ihre Baupläne.',
      ],
    },
  },
  {
    id: 245,
    date: '2026-11-20',
    en: {
      title: 'Feedback and the season survey',
      items: [
        'New in the footer: "Feedback" - tell the admins what you like, what bugs you or what you wish for, any time.',
        'At the end of a season every Dream Team manager gets a short survey (fun, money, prices, salaries, bot development, league). It takes two minutes and you can change your answers while it is open.',
      ],
    },
    de: {
      title: 'Feedback und Season-Umfrage',
      items: [
        'Neu im Footer: „Feedback“ – sag den Admins jederzeit, was dir gefällt, was dich stört oder was du dir wünschst.',
        'Am Ende einer Season bekommt jeder Dream-Team-Manager eine kurze Umfrage (Spaß, Geld, Preise, Gehälter, Bot-Entwicklung, Liga). Sie dauert zwei Minuten, und solange sie offen ist, kannst du deine Antworten ändern.',
      ],
    },
  },
  {
    id: 243,
    date: '2026-10-31',
    en: {
      title: 'Patch notes',
      items: [
        'After an update the website now shows what changed - once per update.',
        'All patch notes can be opened again any time from the footer ("Patch notes").',
      ],
    },
    de: {
      title: 'Patchnotes',
      items: [
        'Nach einem Update zeigt die Website jetzt, was sich geändert hat – einmal pro Update.',
        'Alle Patchnotes lassen sich jederzeit über den Footer („Patchnotes“) wieder öffnen.',
      ],
    },
  },
  {
    id: 242,
    date: '2026-10-31',
    mod: '0.18.0',
    en: {
      title: 'Dream Team: 29 new traits',
      items: [
        'Every rarity gets new traits (62 in all): body traits like light feet, second wind, regeneration, juggernaut and overload, behaviour traits like scavenger, health hound, counter-attacker and assassin.',
        'Weapon master (epic): pick a favourite weapon like the gun nut - it aims better with it. One favourite weapon trait per bot.',
        'Legendary: deemer dream (a redeemer once per game), rewind (once per game back where it died), hivemind (the whole team helps out in fights), monster whisperer and dynasty (a keeper without the skill loss).',
        'Monster Hunt traits: monster bane, titan slayer, pathfinder, warden (draws the monsters to itself) and monster whisperer.',
        'Manager traits: thrifty (resting 25 % cheaper), talent scout (cheaper scout reports with four talents), loyal, captain, showman, fan mail and franchise player.',
        'Bouncer: no more hopping around all the time - it now reacts faster and dodges more often.',
        'The match page shows what the new traits did in every game (trait log).',
      ],
    },
    de: {
      title: 'Dream Team: 29 neue Traits',
      items: [
        'Jede Seltenheit bekommt neue Traits (insgesamt 62): Körper-Traits wie Light feet, Second wind, Regeneration, Juggernaut und Overload, Verhaltens-Traits wie Scavenger, Health hound, Counter-attacker und Assassin.',
        'Weapon master (Epic): Lieblingswaffe wählen wie beim Gun nut – damit zielt der Bot besser. Pro Bot ein Lieblingswaffen-Trait.',
        'Legendär: Deemer dream (einmal pro Spiel ein Redeemer), Rewind (einmal pro Spiel zurück am Todesort), Hivemind (das ganze Team hilft in Kämpfen aus), Monster whisperer und Dynasty (Keeper ohne Skill-Verlust).',
        'Monster-Hunt-Traits: Monster bane, Titan slayer, Pathfinder, Warden (zieht die Monster auf sich) und Monster whisperer.',
        'Manager-Traits: Thrifty (Erholen 25 % günstiger), Talent scout (günstigere Scout-Berichte mit vier Talenten), Loyal, Captain, Showman, Fan mail und Franchise player.',
        'Bouncer: hüpft nicht mehr ständig herum – reagiert jetzt schneller und weicht öfter aus.',
        'Die Matchseite zeigt, was die neuen Traits in jedem Spiel getan haben (Trait-Log).',
      ],
    },
  },
  {
    id: 241,
    date: '2026-10-31',
    en: {
      title: 'Crafting in order, Monster Hunt focus per bot',
      items: [
        'Packs page: the crafting list and your trait inventory are sorted by category and rarity.',
        'Monster Hunt focus per bot (bot details on My team) instead of one for the whole lineup - e.g. a hunter that clears the way and a sprinter.',
        "Trait report for admins with the bot's skill and its trait combination.",
      ],
    },
    de: {
      title: 'Crafting sortiert, Monster-Hunt-Fokus pro Bot',
      items: [
        'Packs-Seite: Crafting-Liste und Trait-Inventar sind nach Kategorie und Seltenheit sortiert.',
        'Monster-Hunt-Fokus pro Bot (Bot-Details auf Mein Team) statt für die ganze Aufstellung – z. B. ein Jäger, der den Weg freiräumt, und ein Sprinter.',
        'Trait-Report für Admins mit dem Skill des Bots und seiner Trait-Kombination.',
      ],
    },
  },
  {
    id: 238,
    date: '2026-10-31',
    mod: '0.17.0',
    en: {
      title: 'Blueprints, Monster Hunt, league and bets',
      items: [
        'Blueprints are never scrapped automatically any more: with a full inventory packs wait until you scrap or build one. Every manager got a legendary blueprint as an apology.',
        "Monster Hunt: the board counts monster kills, the running time includes penalty time, the run panel shows the map's objectives; map records count all season games including Dream Team.",
        'League games have their own page (home vs away, matchday, lineups) without sign-up.',
        'Betting bots bet in different styles - some tipsy, some chasing odds, some loyal to the underdog.',
        'Traits: new rarities for watchdog, starter armour, daredevil, berserker and revenant; the match page shows what every trait did (trait log).',
      ],
    },
    de: {
      title: 'Blueprints, Monster Hunt, Liga und Wetten',
      items: [
        'Blueprints werden nicht mehr automatisch verschrottet: Bei vollem Inventar warten Packs, bis du einen verschrottest oder baust. Jeder Manager hat als Entschuldigung einen legendären Blueprint bekommen.',
        'Monster Hunt: Die Tabelle zählt Monster-Kills, die Laufzeit enthält die Strafzeit, das Run-Panel zeigt die Ziele der Map; Map-Rekorde zählen alle Season-Spiele inklusive Dream Team.',
        'Ligaspiele haben eine eigene Seite (Heim gegen Gast, Spieltag, Aufstellungen) ohne Anmeldung.',
        'Wett-Bots wetten in verschiedenen Stilen – manche angeheitert, manche jagen Quoten, manche halten zum Außenseiter.',
        'Traits: neue Seltenheiten für Watchdog, Starter armour, Daredevil, Berserker und Revenant; die Matchseite zeigt, was jeder Trait getan hat (Trait-Log).',
      ],
    },
  },
];

/** The newest patch note's id (0: none). */
export const LATEST_PATCH = PATCH_NOTES[0]?.id ?? 0;
