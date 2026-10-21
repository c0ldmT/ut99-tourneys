import { describe, expect, it } from 'vitest';
import {
  changedLookProblems,
  lookProblem,
  modelChoices,
  STOCK_TEXTURES,
  STOCK_VOICE_ENTRIES,
  type TextureEntry,
  type VoiceEntry,
} from '../src/bots/models.js';

/** Entries of the bonus pack's .int files as a 469 server has them (SystemLocalized/int). */
const BONUS: TextureEntry[] = [
  ['tskmskins.Warr1', 'Arena Warrior'],
  ['tskmskins.Warr2', ''],
  ['tskmskins.Warr2Berserker', 'Berserker'],
  ['tskmskins.Warr2Dominator', 'Dominator'],
  ['tskmskins.Warr2Guardian', 'Guardian'],
  ['tskmskins.Warr3T_0', ''],
  ['tskmskins.Warr5Berserker', ''],
  ['tskmskins.PitF1', 'Pit Fighter'],
  ['tskmskins.PitF2Baetal', 'Baetal'],
  ['tskmskins.PitF2Pharoh', 'Pharoh'],
  ['tskmskins.PitF2Skrilax', 'Skrilax'],
  ['tskmskins.MekS', 'Cyborg Trooper'],
  ['tskmskins.MekS2', ''],
  ['tskmskins.MekS2Firewall', 'Firewall'],
  ['tskmskins.MekS2Disconnect', 'Disconnect'],
  ['tskmskins.MekS5Firewall', ''],
  ['TNaliMeshSkins.Priest', 'Priest'],
  ['TNaliMeshSkins.Ouboudah', 'Ouboudah'],
  ['TNaliMeshSkins.T_Nali_0', ''],
  ['TCowMeshSkins.WarCow', 'War Cow'],
  ['TCowMeshSkins.AtomicCow', 'Atomic Cow'],
  ['TCowMeshSkins.T_Cow_0', ''],
].map(([name, label]) => ({ name: name!, label: label! }));

const VOICES: VoiceEntry[] = [
  ...STOCK_VOICE_ENTRIES,
  { name: 'MultiMesh.SkaarjVoice', label: 'Skaarj Hybrid', meta: 'BotPack.VoiceMale' },
  { name: 'MultiMesh.NaliVoice', label: 'Nali', meta: 'BotPack.VoiceMale' },
  { name: 'MultiMesh.CowVoice', label: 'Nali WarCow', meta: 'BotPack.VoiceMale' },
];

const CLASSES = [
  { name: 'BotPack.TMale1Bot', label: 'Male Commando' },
  { name: 'BotPack.TFemale1Bot', label: 'Female Commando' },
  { name: 'BotPack.TBossBot', label: 'Boss' },
  { name: 'MultiMesh.TSkaarjBot', label: 'Skaarj Hybrid' },
  { name: 'MultiMesh.TNaliBot', label: 'Nali' },
  { name: 'MultiMesh.TCowBot', label: 'Nali WarCow' },
  { name: 'Custom.ZombieBot', label: '' },
];

const models = modelChoices(CLASSES, [...STOCK_TEXTURES, ...BONUS], VOICES);
const model = (name: string) => models.find((m) => m.name === name)!;
const labels = (l: { label: string }[]) => l.map((x) => x.label);

describe("models as UT's player setup offers them", () => {
  it('Skaarj Hybrid: its skins, the faces per skin, the male voices', () => {
    const m = model('MultiMesh.TSkaarjBot');
    expect(labels(m.skins)).toEqual(['Arena Warrior', 'Cyborg Trooper', 'Pit Fighter']);
    const trooper = m.skins.find((s) => s.label === 'Cyborg Trooper')!;
    expect(trooper.name).toBe('tskmskins.MekS');
    expect(trooper.faces).toEqual([
      { name: 'tskmskins.Disconnect', label: 'Disconnect' },
      { name: 'tskmskins.Firewall', label: 'Firewall' },
    ]);
    expect(labels(m.skins[0]!.faces)).toEqual(['Berserker', 'Dominator', 'Guardian']);
    expect(labels(m.voices)).toEqual([
      'Male One',
      'Male Two',
      'Nali',
      'Nali WarCow',
      'Skaarj Hybrid',
    ]);
    expect(m.defaults).toEqual({
      skin: 'tskmskins.Warr',
      face: 'tskmskins.Berserker',
      voice: 'MultiMesh.SkaarjVoice',
    });
  });

  it('Female Commando: four skins with their faces, the female voices', () => {
    const m = model('BotPack.TFemale1Bot');
    expect(labels(m.skins)).toEqual(['Aphex', 'Commando', 'Mercenary', 'Necris']);
    expect(labels(m.skins.find((s) => s.label === 'Commando')!.faces)).toEqual([
      'Anna',
      'Gromida',
      'Ivana',
      'Nikita',
    ]);
    expect(labels(m.voices)).toEqual(['Female One', 'Female Two']);
    // The male commando's skins are not the female one's (CommandoSkins vs FCommandoSkins).
    expect(model('BotPack.TMale1Bot').skins.every((s) => s.name.startsWith('CommandoSkins.'))).toBe(
      true,
    );
  });

  it('Nali and WarCow: old skin format, no faces; the boss keeps his own voice', () => {
    expect(labels(model('MultiMesh.TNaliBot').skins)).toEqual(['Ouboudah', 'Priest']);
    expect(labels(model('MultiMesh.TCowBot').skins)).toEqual(['Atomic Cow', 'War Cow']);
    expect(model('MultiMesh.TNaliBot').multi).toBe(false);
    const boss = model('BotPack.TBossBot');
    expect(labels(boss.skins)).toEqual(['Boss']);
    expect(labels(boss.skins[0]!.faces)).toEqual(['Xan']);
    expect(boss.voices).toEqual([{ name: 'BotPack.VoiceBotBoss', label: 'Robot' }]);
    expect(boss.defaults.voice).toBe('BotPack.VoiceBotBoss');
  });

  it('an unknown model has no skins yet and every voice', () => {
    const m = model('Custom.ZombieBot');
    expect(m).toMatchObject({ known: false, skins: [], label: 'ZombieBot' });
    expect(m.voices.length).toBe(VOICES.length);
  });

  it('checks a look against the model', () => {
    const ok = {
      botClass: 'MultiMesh.TSkaarjBot',
      skin: 'tskmskins.MekS',
      face: 'tskmskins.Firewall',
    };
    expect(lookProblem(models, ok)).toBeNull();
    expect(lookProblem(models, { ...ok, skin: 'CommandoSkins.cmdo' })).toEqual({
      field: 'skin',
      value: 'CommandoSkins.cmdo',
    });
    expect(lookProblem(models, { ...ok, face: 'tskmskins.Berserker' })).toEqual({
      field: 'face',
      value: 'tskmskins.Berserker',
    });
    expect(lookProblem(models, { ...ok, voice: 'BotPack.VoiceFemaleOne' })).toMatchObject({
      field: 'voice',
    });
    // No class: the default class (male commando); an unknown model is not checked.
    expect(lookProblem(models, { skin: 'CommandoSkins.goth' })).toBeNull();
    expect(lookProblem(models, { skin: 'SGirlSkins.army' })).toMatchObject({ field: 'skin' });
    expect(lookProblem(models, { botClass: 'Custom.ZombieBot', skin: 'Any.thing' })).toBeNull();
    expect(lookProblem(models, { botClass: 'Nope.NopeBot' })).toMatchObject({ field: 'botClass' });
  });

  it('a change is checked where it changes (an older look stays)', () => {
    const old = { botClass: 'MultiMesh.TSkaarjBot', skin: 'tskmskins.MekS', face: 'Old.Face' };
    expect(changedLookProblems(models, old, old)).toEqual([]);
    expect(changedLookProblems(models, old, { ...old, voice: 'BotPack.VoiceMaleOne' })).toEqual([]);
    expect(changedLookProblems(models, old, { ...old, voice: 'BotPack.VoiceFemaleOne' })).toEqual([
      { field: 'voice', value: 'BotPack.VoiceFemaleOne' },
    ]);
    // Another skin: the old face must fit it now.
    expect(changedLookProblems(models, old, { ...old, skin: 'tskmskins.Warr' })).toEqual([
      { field: 'face', value: 'Old.Face' },
    ]);
  });
});
