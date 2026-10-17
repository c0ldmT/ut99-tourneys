import type { BotTraits } from '@tourney/protocol';

/**
 * Stock UT99 bot material (from Botpack's classes and ChallengeBotInfo): bot classes with their
 * skin package, default skin and voice, the faces per skin package, voices and weapons. The
 * control center offers these plus whatever the servers' inventories report.
 */

export interface StockClass {
  botClass: string;
  label: string;
  /** Skin package (DefaultPackage without the dot). */
  pkg: string;
  defaultSkin: string;
  voice: string;
}

export const STOCK_CLASSES: StockClass[] = [
  {
    botClass: 'Botpack.TMale1Bot',
    label: 'Male Commando',
    pkg: 'CommandoSkins',
    defaultSkin: 'CommandoSkins.cmdo',
    voice: 'BotPack.VoiceMaleOne',
  },
  {
    botClass: 'Botpack.TMale2Bot',
    label: 'Male Soldier',
    pkg: 'SoldierSkins',
    defaultSkin: 'SoldierSkins.blkt',
    voice: 'BotPack.VoiceMaleTwo',
  },
  {
    botClass: 'Botpack.TFemale1Bot',
    label: 'Female Commando',
    pkg: 'FCommandoSkins',
    defaultSkin: 'FCommandoSkins.cmdo',
    voice: 'BotPack.VoiceFemaleOne',
  },
  {
    botClass: 'Botpack.TFemale2Bot',
    label: 'Female Soldier',
    pkg: 'SGirlSkins',
    defaultSkin: 'SGirlSkins.army',
    voice: 'BotPack.VoiceFemaleTwo',
  },
  {
    botClass: 'Botpack.TBossBot',
    label: 'Boss',
    pkg: 'BossSkins',
    defaultSkin: 'BossSkins.Boss',
    voice: 'BotPack.VoiceBotBoss',
  },
];

/** Faces of the stock bots per skin package (ChallengeBotInfo defaults). */
export const STOCK_FACES: Record<string, string[]> = {
  CommandoSkins: ['Blake', 'Luthor', 'Kragoth', 'Boris', 'Gorn', 'Ramirez', 'Grail', 'Graves'],
  SoldierSkins: ['Malcom', 'Kregore', 'Johnson', 'Othello', 'Riker', 'Arkon', 'Rankin'],
  FCommandoSkins: ['Cryss', 'Visse', 'Tanya', 'Kyla', 'Malise', 'Freylis', 'Mariana', 'Jayce'],
  SGirlSkins: ['Aryss', 'Cilia', 'Vixen', 'Sara', 'Annaka', 'Sarena', 'Isis', 'Lauren'],
  BossSkins: [],
};

export const STOCK_VOICES = [
  'BotPack.VoiceMaleOne',
  'BotPack.VoiceMaleTwo',
  'BotPack.VoiceFemaleOne',
  'BotPack.VoiceFemaleTwo',
  'BotPack.VoiceBotBoss',
];

export const STOCK_WEAPONS = [
  'Botpack.ImpactHammer',
  'Botpack.ChainSaw',
  'Botpack.enforcer',
  'Botpack.ut_biorifle',
  'Botpack.ShockRifle',
  'Botpack.PulseGun',
  'Botpack.ripper',
  'Botpack.minigun2',
  'Botpack.UT_FlakCannon',
  'Botpack.UT_Eightball',
  'Botpack.SniperRifle',
];

/** Skin package of a bot class (stock classes; else the package before the first dot). */
export function skinPackageOf(botClass: string | undefined): string | undefined {
  if (!botClass) return undefined;
  return STOCK_CLASSES.find((c) => c.botClass.toLowerCase() === botClass.toLowerCase())?.pkg;
}

/** Default traits: a normal bot, as UT's bot setup starts. */
export const NORMAL_TRAITS: BotTraits = {
  accuracy: 0,
  alertness: 0,
  combatStyle: 0,
  camping: 0,
  strafing: 0,
  jumpy: false,
};
