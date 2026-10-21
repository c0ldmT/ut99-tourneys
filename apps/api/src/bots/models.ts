/**
 * Models, skins, faces and voices as UT99's own player and bot setup offers them
 * (UMenuPlayerSetupClient.IterateSkins/IterateFaces, UTPlayerSetupClient.IterateVoices):
 *
 * - skins: the `.int` texture entries whose name starts with the class's mesh name
 *   (mesh `Commando` → `CommandoSkins.*`). Multi-skin classes: an entry with a description and
 *   an item name of at most 5 letters is a skin, its value the package plus the first 4 letters
 *   (`tskmskins.MekS` "Cyborg Trooper"); other classes: every texture but `T_*`;
 * - faces (multi-skin only): entries with a description whose item name is longer and starts
 *   with the skin's 4 letters; the value is the package plus the item name from letter 6
 *   (`tskmskins.MekS2Firewall` → `tskmskins.Firewall` "Firewall");
 * - voices: the voice packs of the class's voice meta class (`BotPack.VoiceMale`, ...).
 *
 * The mesh name, the multi-skin flag and the voice meta class are class defaults (in the .u):
 * known classes are listed here (decision 172), others come from the game server later.
 */

/** A texture entry of a `.int` file; label '' = no description. */
export interface TextureEntry {
  name: string;
  label: string;
}

/** A voice pack and its meta class (`BotPack.VoiceMale`; undefined: unknown). */
export interface VoiceEntry {
  name: string;
  label: string;
  meta?: string;
}

/** What UT reads from a bot class's defaults to fill its setup menu. */
export interface ClassProfile {
  /** Mesh name: the skins are the textures whose name starts with it. Null: no skins. */
  mesh: string | null;
  /** New skin format (skins with faces). */
  multi: boolean;
  /** Voices of this meta class are offered; null: all. */
  voiceMeta: string | null;
  /** The class's own voice (preselected). */
  voice: string | null;
  /** The class's own skin (preselected). */
  skin: string | null;
}

export interface Choice {
  name: string;
  label: string;
}

export interface SkinChoice extends Choice {
  faces: Choice[];
}

/** One model for the editors: its skins (with faces) and voices, and what UT preselects. */
export interface ModelChoice extends Choice {
  /** Its profile is known (else no skins can be told apart yet). */
  known: boolean;
  multi: boolean;
  skins: SkinChoice[];
  voices: Choice[];
  defaults: { skin: string; face: string; voice: string };
}

/** The bot class UT takes when none is set (TourneyCore.SpawnSideBot). */
export const DEFAULT_CLASS = 'Botpack.TMale1Bot';

const MALE = 'BotPack.VoiceMale';
const FEMALE = 'BotPack.VoiceFemale';

/** Class defaults of the classes that come with UT (Botpack) and its bonus packs. */
export const KNOWN_PROFILES: Record<string, ClassProfile> = {
  'botpack.tmale1bot': {
    mesh: 'Commando',
    multi: true,
    voiceMeta: MALE,
    voice: 'BotPack.VoiceMaleOne',
    skin: 'CommandoSkins.cmdo',
  },
  'botpack.tmale2bot': {
    mesh: 'Soldier',
    multi: true,
    voiceMeta: MALE,
    voice: 'BotPack.VoiceMaleTwo',
    skin: 'SoldierSkins.blkt',
  },
  'botpack.tfemale1bot': {
    mesh: 'FCommando',
    multi: true,
    voiceMeta: FEMALE,
    voice: 'BotPack.VoiceFemaleOne',
    skin: 'FCommandoSkins.cmdo',
  },
  'botpack.tfemale2bot': {
    mesh: 'SGirl',
    multi: true,
    voiceMeta: FEMALE,
    voice: 'BotPack.VoiceFemaleTwo',
    skin: 'SGirlSkins.army',
  },
  'botpack.tbossbot': {
    mesh: 'Boss',
    multi: true,
    voiceMeta: 'BotPack.VoiceBoss',
    voice: 'BotPack.VoiceBotBoss',
    skin: 'BossSkins.Boss',
  },
  // Bonus pack 1 (MultiMesh): Skaarj Hybrid, Nali, Nali WarCow.
  'multimesh.tskaarjbot': {
    mesh: 'TSkM',
    multi: true,
    voiceMeta: MALE,
    voice: 'MultiMesh.SkaarjVoice',
    skin: 'tskmskins.Warr',
  },
  'multimesh.tnalibot': {
    mesh: 'TNaliMesh',
    multi: false,
    voiceMeta: MALE,
    voice: 'MultiMesh.NaliVoice',
    skin: null,
  },
  'multimesh.tcowbot': {
    mesh: 'TCowMesh',
    multi: false,
    voiceMeta: MALE,
    voice: 'MultiMesh.CowVoice',
    skin: null,
  },
};

/** Skin entries of the stock skin packages (their `.int`), when no server reported them. */
const STOCK_SKIN_INT: Record<string, [string, string][]> = {
  CommandoSkins: [
    ['cmdo1', 'Commando'],
    ['cmdo2Blake', 'Blake'],
    ['cmdo2Gorn', 'Gorn'],
    ['cmdo2Nickolai', 'Nickolai'],
    ['cmdo2Whitman', 'Whitman'],
    ['daco1', 'Mercenary'],
    ['daco2Boris', 'Boris'],
    ['daco2Luthor', 'Luthor'],
    ['daco2Ramirez', 'Ramirez'],
    ['daco2Graves', 'Graves'],
    ['goth1', 'Necris'],
    ['goth2Kragoth', 'Kragoth'],
    ['goth2Malakai', 'Malakai'],
    ['goth2Necrotic', 'Necrotic'],
    ['goth2Grail', 'Grail'],
  ],
  SoldierSkins: [
    ['blkt1', 'Marine'],
    ['blkt4Malcom', 'Malcom'],
    ['blkt4Othello', 'Othello'],
    ['blkt4Riker', 'Riker'],
    ['Gard1', 'Metal Guard'],
    ['Gard4Drake', 'Drake'],
    ['Gard4Radkin', 'Radkin'],
    ['Gard4Wraith', 'Wraith'],
    ['Gard4Von', 'Von'],
    ['RawS1', 'Raw Steel'],
    ['RawS4Arkon', 'Arkon'],
    ['RawS4Bruce', 'Bruce'],
    ['RawS4Kregore', 'Kregore'],
    ['RawS4Manwell', 'Manwell'],
    ['RawS4Slain', 'Slain'],
    ['sldr1', 'Soldier'],
    ['sldr4Brock', 'Brock'],
    ['sldr4Harlin', 'Harlin'],
    ['sldr4Johnson', 'Johnson'],
    ['sldr4Rankin', 'Rankin'],
    ['hkil1', 'War Machine'],
    ['hkil4Vector', 'Vector'],
    ['hkil4Matrix', 'Matrix'],
    ['hkil4Tensor', 'Tensor'],
  ],
  FCommandoSkins: [
    ['cmdo1', 'Commando'],
    ['cmdo4ivana', 'Ivana'],
    ['cmdo4nikita', 'Nikita'],
    ['cmdo4anna', 'Anna'],
    ['cmdo4Gromida', 'Gromida'],
    ['daco1', 'Mercenary'],
    ['daco4kyla', 'Kyla'],
    ['daco4mariana', 'Mariana'],
    ['daco4jayce', 'Jayce'],
    ['daco4Tanya', 'Tanya'],
    ['goth1', 'Necris'],
    ['goth4Cryss', 'Cryss'],
    ['goth4Freylis', 'Freylis'],
    ['goth4Visse', 'Visse'],
    ['goth4Malise', 'Malise'],
    ['aphe1', 'Aphex'],
    ['aphe4Indina', 'Idina'],
    ['aphe4Portia', 'Portia'],
  ],
  SGirlSkins: [
    ['army1', 'Soldier'],
    ['army4Lauren', 'Lauren'],
    ['army4Rylisa', 'Rylisa'],
    ['army4Sara', 'Sara'],
    ['army4Shyann', 'Shyann'],
    ['Garf1', 'Metal Guard'],
    ['Garf4Isis', 'Isis'],
    ['Garf4Risa', 'Risa'],
    ['Garf4Tasha', 'Tasha'],
    ['Garf4Vixen', 'Vixen'],
    ['Venm1', 'Venom'],
    ['Venm4Athena', 'Athena'],
    ['Venm4Cilia', 'Cilia'],
    ['Venm4Sarena', 'Sarena'],
    ['Venm4Tara', 'Tara'],
    ['Venm4Zanna', 'Zanna'],
    ['fbth1', 'Marine'],
    ['fbth4Azure', 'Azure'],
    ['fbth4Aryss', 'Aryss'],
    ['fbth4Annaka', 'Annaka'],
    ['fbth4Olga', 'Olga'],
    ['fbth4Ryanna', 'Ryanna'],
    ['fwar1', 'War Machine'],
    ['fwar4Cathode', 'Cathode'],
    ['fwar4Fury', 'Fury'],
    ['fwar4Lilith', 'Lilith'],
  ],
  BossSkins: [
    ['Boss1', 'Boss'],
    ['Boss4Xan', 'Xan'],
  ],
};

export const STOCK_TEXTURES: TextureEntry[] = Object.entries(STOCK_SKIN_INT).flatMap(
  ([pkg, list]) => list.map(([n, label]) => ({ name: `${pkg}.${n}`, label })),
);

/** The voices of Botpack's `.int` (with their meta class). */
export const STOCK_VOICE_ENTRIES: VoiceEntry[] = [
  { name: 'BotPack.VoiceMaleOne', label: 'Male One', meta: MALE },
  { name: 'BotPack.VoiceMaleTwo', label: 'Male Two', meta: MALE },
  { name: 'BotPack.VoiceFemaleOne', label: 'Female One', meta: FEMALE },
  { name: 'BotPack.VoiceFemaleTwo', label: 'Female Two', meta: FEMALE },
  { name: 'BotPack.VoiceBoss', label: 'Robot', meta: 'BotPack.VoiceBoss' },
];

const lower = (s: string) => s.toLowerCase();
const item = (name: string) => name.slice(name.lastIndexOf('.') + 1);
const pkgOf = (name: string) => name.slice(0, name.length - item(name).length);
const byLabel = (a: Choice, b: Choice) => a.label.localeCompare(b.label);

/** Removes later duplicates (by value, case-insensitive). */
function unique<T extends Choice>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((x) => !seen.has(lower(x.name)) && seen.add(lower(x.name)));
}

/** The skins (with faces) of a mesh, by UT's rules. */
export function skinsFor(textures: readonly TextureEntry[], mesh: string, multi: boolean) {
  const own = textures.filter((t) => lower(t.name).startsWith(lower(mesh)));
  if (!multi)
    return unique(
      own
        .filter((t) => !/^t_/i.test(item(t.name)))
        .map((t) => ({ name: t.name, label: t.label || item(t.name), faces: [] as Choice[] })),
    ).sort(byLabel);
  const skins: SkinChoice[] = [];
  for (const t of own) {
    const it = item(t.name);
    if (!t.label || it.length > 5) continue;
    skins.push({ name: pkgOf(t.name) + it.slice(0, 4), label: t.label, faces: [] });
  }
  for (const s of skins) {
    const base = lower(item(s.name));
    s.faces = unique(
      own
        .filter((t) => {
          const it = item(t.name);
          // As UT: also a face of another package of the mesh (face packs).
          return t.label && it.length > 5 && lower(it.slice(0, 4)) === base;
        })
        .map((t) => ({ name: pkgOf(t.name) + item(t.name).slice(5), label: t.label })),
    ).sort(byLabel);
  }
  return unique(skins).sort(byLabel);
}

/**
 * Every skin of every package (for labels, and for models whose profile is not known yet):
 * per package the new format if it has such skins, else the old one.
 */
export function allSkins(textures: readonly TextureEntry[]): SkinChoice[] {
  const byPkg = new Map<string, TextureEntry[]>();
  for (const t of textures) {
    const k = lower(pkgOf(t.name));
    byPkg.set(k, [...(byPkg.get(k) ?? []), t]);
  }
  const out: SkinChoice[] = [];
  for (const [pkg, list] of byPkg) {
    const multi = skinsFor(list, pkg, true);
    out.push(...(multi.length ? multi : skinsFor(list, pkg, false)));
  }
  return unique(out);
}

/** The voices of a meta class (null: all), the class's own voice included. */
export function voicesFor(voices: readonly VoiceEntry[], meta: string | null, own: string | null) {
  const list: Choice[] = voices
    .filter((v) => !meta || !v.meta || lower(v.meta) === lower(meta))
    // As UT's bot menu (UTIndivBotSetupClient.IterateVoices): bots get the bot boss's voice.
    .map((v) => ({
      name: lower(v.name) === 'botpack.voiceboss' ? 'BotPack.VoiceBotBoss' : v.name,
      label: v.label || item(v.name),
    }));
  if (own && !list.some((v) => lower(v.name) === lower(own))) {
    const known = voices.find((v) => lower(v.name) === lower(own));
    list.push({ name: own, label: known?.label || item(own) });
  }
  return unique(list).sort(byLabel);
}

/** The model choices: every class with its skins, faces and voices (known classes first). */
export function modelChoices(
  classes: readonly Choice[],
  textures: readonly TextureEntry[],
  voices: readonly VoiceEntry[],
  profiles: Record<string, ClassProfile> = KNOWN_PROFILES,
): ModelChoice[] {
  return unique([...classes]).map((c) => {
    const p = profiles[lower(c.name)];
    if (!p)
      return {
        name: c.name,
        label: c.label || item(c.name),
        known: false,
        multi: false,
        skins: [],
        voices: voicesFor(voices, null, null),
        defaults: { skin: '', face: '', voice: '' },
      };
    const skins = p.mesh ? skinsFor(textures, p.mesh, p.multi) : [];
    // The class's own skin (UT's DefaultSkinName); without one the server decides.
    const skin = skins.find((s) => p.skin && lower(s.name) === lower(p.skin))?.name ?? '';
    const face = skins.find((s) => s.name === skin)?.faces[0]?.name ?? '';
    return {
      name: c.name,
      label: c.label || item(c.name),
      known: true,
      multi: p.multi,
      skins,
      voices: voicesFor(voices, p.voiceMeta, p.voice),
      defaults: { skin, face, voice: p.voice ?? '' },
    };
  });
}

export type LookField = 'botClass' | 'skin' | 'face' | 'voice';
export type Look = Partial<Record<LookField, string | null>>;
export type LookProblem = { field: LookField; value: string };

/**
 * What does not fit the model (empty values are the defaults and fit always). Unknown models
 * cannot be checked (their skins are not known yet).
 */
export function lookProblems(models: readonly ModelChoice[], look: Look): LookProblem[] {
  const cls = look.botClass || DEFAULT_CLASS;
  const m = models.find((x) => lower(x.name) === lower(cls));
  if (!m) return look.botClass ? [{ field: 'botClass', value: look.botClass }] : [];
  if (!m.known) return [];
  const out: LookProblem[] = [];
  const skin = look.skin ? m.skins.find((s) => lower(s.name) === lower(look.skin!)) : undefined;
  if (look.skin && !skin) out.push({ field: 'skin', value: look.skin });
  if (look.face) {
    const faces = (skin ?? m.skins.find((s) => s.name === m.defaults.skin))?.faces ?? [];
    if (!faces.some((f) => lower(f.name) === lower(look.face!)))
      out.push({ field: 'face', value: look.face });
  }
  if (look.voice && !m.voices.some((v) => lower(v.name) === lower(look.voice!)))
    out.push({ field: 'voice', value: look.voice });
  return out;
}

/** The first thing that does not fit, if any. */
export function lookProblem(models: readonly ModelChoice[], look: Look): LookProblem | null {
  return lookProblems(models, look)[0] ?? null;
}

/**
 * The problems a change brings: a field counts if it changed or what it depends on changed (the
 * model for skin, face and voice; the skin for the face). An older look that does not fit stays
 * as it is until it is changed.
 */
export function changedLookProblems(
  models: readonly ModelChoice[],
  before: Look,
  after: Look,
): LookProblem[] {
  const same = (k: LookField) => lower(before[k] ?? '') === lower(after[k] ?? '');
  return lookProblems(models, after).filter(
    (p) =>
      !same(p.field) ||
      (p.field !== 'botClass' && !same('botClass')) ||
      (p.field === 'face' && !same('skin')),
  );
}
