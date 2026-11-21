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
