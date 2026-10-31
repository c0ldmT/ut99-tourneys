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
