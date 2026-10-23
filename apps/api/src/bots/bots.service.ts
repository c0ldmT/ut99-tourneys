import { Inject, Injectable } from '@nestjs/common';
import { createRng } from '@tourney/bracket';
import {
  BotLineKindSchema,
  BotTraitsSchema,
  BOT_MAX_LINES,
  BOT_MAX_RIVALS,
  type BotPersonality,
  type BotSpec,
  type BotTraits,
  type GameAssets,
} from '@tourney/protocol';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { UsersService } from '../auth/users.service.js';
import { AgentsService } from '../agents/agents.service.js';
import { badRequest, conflict, notFound } from '../common/http.js';
import { randomId } from '../common/ids.js';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { botClans, bots } from '../db/schema.js';
import { randomBot } from './bot-random.js';
import {
  allSkins,
  changedLookProblems,
  lookProblem,
  modelChoices,
  profilesWith,
  STOCK_TEXTURES,
  STOCK_VOICE_ENTRIES,
  type Look,
  type ModelChoice,
  type VoiceEntry,
} from './models.js';
import { NORMAL_TRAITS, STOCK_CLASSES, STOCK_WEAPONS } from './bot-stock.js';

/** UT cuts player names to 24 characters: clan tag plus name must fit. */
export const GAME_NAME_CHARS = 24;
const REF = z.string().trim().max(48);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const RivalSchema = z.object({
  kind: z.enum(['user', 'bot']),
  id: z.string().min(1).max(64),
  level: z.enum(['rival', 'nemesis']),
});
export const PersonalitySchema = z.object({
  /** Chance to say something on an occasion, 0..100. */
  talk: z.number().int().min(0).max(100).default(30),
  lines: z
    .array(z.object({ kind: BotLineKindSchema, text: z.string().trim().min(1).max(120) }))
    .max(64)
    .default([]),
  rivals: z.array(RivalSchema).max(16).default([]),
});
export type Personality = z.infer<typeof PersonalitySchema>;

export const BotBody = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[\x20-\x7e]+$/, 'ASCII letters, digits and signs only (UT99 names)'),
  clanId: z.string().max(40).nullable().optional(),
  skill: z.number().min(0).max(7).optional(),
  botClass: REF.optional(),
  skin: REF.optional(),
  face: REF.optional(),
  traits: BotTraitsSchema.extend({
    favoriteWeapon: REF.optional(),
    voice: REF.optional(),
  }).optional(),
  personality: PersonalitySchema.partial().optional(),
  bio: z.string().trim().max(1000).nullable().optional(),
  color: Color.nullable().optional(),
  active: z.boolean().optional(),
});
export type BotInput = z.infer<typeof BotBody>;

export const ClanBody = z.object({
  name: z.string().trim().min(1).max(40),
  tag: z
    .string()
    .trim()
    .min(1)
    .max(8)
    .regex(/^[\x21-\x7e]+$/, 'ASCII without spaces'),
  color: Color.nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
});
export type ClanInput = z.infer<typeof ClanBody>;

export interface Clan {
  id: string;
  name: string;
  tag: string;
  color: string | null;
  description: string | null;
}

export interface LibraryBot {
  id: string;
  name: string;
  /** Name in the game: clan tag + name. */
  gameName: string;
  clanId: string | null;
  skill: number;
  botClass: string | null;
  skin: string | null;
  face: string | null;
  traits: BotTraits;
  personality: Personality;
  bio: string | null;
  color: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  /** Unreal Dream Team: made by this manager (hidden in the control center). */
  udtOwner: string | null;
}

const key = (s: string) => s.trim().toLowerCase();

/**
 * Bot control center: the website's bots (no limit; statistics and ratings follow the id),
 * clans, team names for bot teams, import from a server's bot configuration and a randomizer.
 */
@Injectable()
export class BotsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(AgentsService) private readonly agents: AgentsService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  private now() {
    return new Date(this.clock.now()).toISOString();
  }

  // --- clans ----------------------------------------------------------------------------------

  clans(): Clan[] {
    return this.db
      .select()
      .from(botClans)
      .orderBy(asc(botClans.nameKey))
      .all()
      .map((c) => ({
        id: c.id,
        name: c.name,
        tag: c.tag,
        color: c.color,
        description: c.description,
      }));
  }

  createClan(body: ClanInput): Clan {
    if (this.clans().some((c) => key(c.name) === key(body.name)))
      throw conflict('clan {name} exists', { name: body.name });
    const id = `c${randomId(10)}`;
    this.db
      .insert(botClans)
      .values({
        id,
        name: body.name,
        nameKey: key(body.name),
        tag: body.tag,
        color: body.color ?? null,
        description: body.description ?? null,
        createdAt: this.now(),
      })
      .run();
    return this.clan(id);
  }

  updateClan(id: string, body: Partial<ClanInput>): Clan {
    const c = this.clan(id);
    if (body.name && this.clans().some((x) => x.id !== id && key(x.name) === key(body.name!)))
      throw conflict('clan {name} exists', { name: body.name });
    const tag = body.tag ?? c.tag;
    if (tag !== c.tag)
      for (const b of this.list().filter((x) => x.clanId === id))
        this.checkGameName(b.id, b.name, tag);
    this.db
      .update(botClans)
      .set({
        ...(body.name ? { name: body.name, nameKey: key(body.name) } : {}),
        tag,
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
      })
      .where(eq(botClans.id, id))
      .run();
    return this.clan(id);
  }

  /** Deletes a clan; its bots stay, without a clan. */
  deleteClan(id: string): void {
    this.clan(id);
    this.db.update(bots).set({ clanId: null }).where(eq(bots.clanId, id)).run();
    this.db.delete(botClans).where(eq(botClans.id, id)).run();
  }

  clan(id: string): Clan {
    const c = this.clans().find((x) => x.id === id);
    if (!c) throw notFound('clan {id}', { id });
    return c;
  }

  // --- bots -----------------------------------------------------------------------------------

  /** Current names in the game (clan tag + name) by bot id. */
  gameNames(): Map<string, string> {
    return new Map(this.list().map((b) => [b.id, b.gameName]));
  }

  list(): LibraryBot[] {
    const clans = new Map(this.clans().map((c) => [c.id, c]));
    return this.db
      .select()
      .from(bots)
      .orderBy(asc(bots.nameKey))
      .all()
      .map((r) => {
        const traits = BotTraitsSchema.safeParse(JSON.parse(r.traitsJson));
        const pers = PersonalitySchema.safeParse(JSON.parse(r.personalityJson));
        const tag = r.clanId ? (clans.get(r.clanId)?.tag ?? '') : '';
        return {
          id: r.id,
          name: r.name,
          gameName: `${tag}${r.name}`.slice(0, GAME_NAME_CHARS),
          clanId: r.clanId && clans.has(r.clanId) ? r.clanId : null,
          skill: r.skill,
          botClass: r.botClass,
          skin: r.skin,
          face: r.face,
          traits: traits.success ? traits.data : { ...NORMAL_TRAITS },
          personality: pers.success ? pers.data : PersonalitySchema.parse({}),
          bio: r.bio,
          color: r.color,
          active: r.active,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          udtOwner: r.udtOwner ?? null,
        };
      });
  }

  get(id: string): LibraryBot | undefined {
    // Statistics keys carry the id in lower case (`b:<id>`): links from there work too.
    const all = this.list();
    return all.find((b) => b.id === id) ?? all.find((b) => b.id.toLowerCase() === id.toLowerCase());
  }

  /** `get` in bots already read (the same lookup). */
  private find(library: ReadonlyMap<string, LibraryBot>, id: string): LibraryBot | undefined {
    const lower = id.toLowerCase();
    return library.get(id) ?? [...library.values()].find((b) => b.id.toLowerCase() === lower);
  }

  require(id: string): LibraryBot {
    const b = this.get(id);
    if (!b) throw notFound('bot {id}', { id });
    return b;
  }

  /** Clan tag plus name must fit into a UT name and be unique among all bots. */
  private checkGameName(id: string | undefined, name: string, tag: string) {
    const gameName = `${tag}${name}`;
    if (gameName.length > GAME_NAME_CHARS)
      throw badRequest('"{gameName}" is longer than {chars} characters (UT cuts names)', {
        gameName,
        chars: GAME_NAME_CHARS,
      });
    const clash = this.list().find((b) => b.id !== id && key(b.gameName) === key(gameName));
    if (clash) throw conflict('a bot is already called {gameName} in the game', { gameName });
  }

  private checkPersonality(p: Personality, selfId: string | undefined) {
    for (const r of p.rivals) {
      if (r.kind === 'bot' && (r.id === selfId || !this.get(r.id)))
        throw badRequest('unknown rival bot {id}', { id: r.id });
      if (r.kind === 'user' && !this.users.list().some((u) => u.id === r.id))
        throw badRequest('unknown rival player {id}', { id: r.id });
    }
  }

  create(body: BotInput): LibraryBot {
    const tag = body.clanId ? this.clan(body.clanId).tag : '';
    if (this.list().some((b) => key(b.name) === key(body.name)))
      throw conflict('bot {name} exists', { name: body.name });
    this.checkGameName(undefined, body.name, tag);
    const personality = PersonalitySchema.parse(body.personality ?? {});
    this.checkPersonality(personality, undefined);
    const id = `b${randomId(10)}`;
    const now = this.now();
    this.db
      .insert(bots)
      .values({
        id,
        name: body.name,
        nameKey: key(body.name),
        clanId: body.clanId ?? null,
        skill: body.skill ?? 4,
        botClass: body.botClass || null,
        skin: body.skin || null,
        face: body.face || null,
        traitsJson: JSON.stringify({ ...NORMAL_TRAITS, ...cleanTraits(body.traits) }),
        personalityJson: JSON.stringify(personality),
        bio: body.bio ?? null,
        color: body.color ?? null,
        active: body.active ?? true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return this.require(id);
  }

  update(id: string, body: Partial<BotInput>): LibraryBot {
    const b = this.require(id);
    const name = body.name ?? b.name;
    const clanId = body.clanId !== undefined ? body.clanId : b.clanId;
    if (body.name && this.list().some((x) => x.id !== id && key(x.name) === key(name)))
      throw conflict('bot {name} exists', { name });
    this.checkGameName(id, name, clanId ? this.clan(clanId).tag : '');
    const personality = body.personality
      ? PersonalitySchema.parse({ ...b.personality, ...body.personality })
      : b.personality;
    this.checkPersonality(personality, id);
    this.db
      .update(bots)
      .set({
        name,
        nameKey: key(name),
        clanId,
        ...(body.skill !== undefined ? { skill: body.skill } : {}),
        ...(body.botClass !== undefined ? { botClass: body.botClass || null } : {}),
        ...(body.skin !== undefined ? { skin: body.skin || null } : {}),
        ...(body.face !== undefined ? { face: body.face || null } : {}),
        ...(body.traits ? { traitsJson: JSON.stringify(cleanTraits(body.traits)) } : {}),
        personalityJson: JSON.stringify(personality),
        ...(body.bio !== undefined ? { bio: body.bio } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        updatedAt: this.now(),
      })
      .where(eq(bots.id, id))
      .run();
    return this.require(id);
  }

  /** Deletes a bot (its statistics stay under its id; other bots lose it as a rival). */
  remove(id: string): void {
    this.require(id);
    for (const b of this.list())
      if (b.personality.rivals.some((r) => r.kind === 'bot' && r.id === id))
        this.update(b.id, {
          personality: {
            rivals: b.personality.rivals.filter((r) => !(r.kind === 'bot' && r.id === id)),
          },
        });
    this.db.delete(bots).where(eq(bots.id, id)).run();
  }

  /** New bots from the randomizer (stock look, made-up names, random play style). */
  random(count: number, opts: { clanId?: string; skill?: number; seed?: string }): LibraryBot[] {
    const rng = createRng(opts.seed ?? `${this.clock.now()}-${Math.random()}`);
    const taken = new Set(this.list().map((b) => key(b.name)));
    const out: LibraryBot[] = [];
    for (let i = 0; i < count; i++) {
      const r = randomBot(taken, rng);
      taken.add(key(r.name));
      out.push(
        this.create({
          name: r.name,
          ...(opts.clanId ? { clanId: opts.clanId } : {}),
          skill: opts.skill ?? 4,
          botClass: r.botClass,
          skin: r.skin,
          ...(r.face ? { face: r.face } : {}),
          traits: r.traits,
        }),
      );
    }
    return out;
  }

  /** Imports the bots of a server's configuration (inventory); bots with known names are skipped. */
  importFrom(agentId: string, profileId?: string): { created: LibraryBot[]; skipped: string[] } {
    const agent = this.agents.require(agentId);
    const profiles = this.agents.info(agent).profiles ?? [];
    const ids = profileId ? [profileId] : profiles.map((p) => p.id);
    const specs: BotSpec[] = [];
    for (const p of ids) {
      const inv = this.agents.inventory(agentId, p) as { bots?: BotSpec[] } | undefined;
      for (const b of inv?.bots ?? [])
        if (!specs.some((s) => key(s.name) === key(b.name))) specs.push(b);
    }
    if (!specs.length) throw badRequest('the server reported no bots (scan the server first)');
    const created: LibraryBot[] = [];
    const skipped: string[] = [];
    for (const s of specs) {
      const name = s.name.trim().slice(0, 20);
      if (!/^[\x20-\x7e]+$/.test(name) || this.list().some((b) => key(b.name) === key(name))) {
        skipped.push(s.name);
        continue;
      }
      created.push(
        this.create({
          name,
          skill: s.skill,
          ...(s.botClass ? { botClass: s.botClass.slice(0, 48) } : {}),
          ...(s.skin ? { skin: s.skin.slice(0, 48) } : {}),
          ...(s.face ? { face: s.face.slice(0, 48) } : {}),
          ...(s.traits ? { traits: s.traits } : {}),
        }),
      );
    }
    return { created, skipped };
  }

  /**
   * Choices for the editors: stock material plus what the servers report (their .int entries,
   * decision 172). `models` has per bot class the skins, faces and voices UT's own setup menu
   * offers (see models.ts); `skins`/`faces` are all of them (for labels).
   */
  assets(): GameAssets & {
    skins: { name: string; label: string }[];
    faces: { name: string; label: string; pkg: string }[];
    packages: Record<string, string>;
    models: ModelChoice[];
  } {
    const out: GameAssets = {
      botClasses: STOCK_CLASSES.map((c) => ({ name: c.botClass, label: c.label })),
      textures: [],
      voices: STOCK_VOICE_ENTRIES.map((v) => ({ ...v })),
      weapons: STOCK_WEAPONS.map((w) => ({ name: w, label: w.split('.').pop() ?? w })),
      skinPackages: [],
      classDefaults: [],
    };
    const add = <T extends { name: string; label: string }>(list: T[], items: readonly T[]) => {
      for (const i of items) {
        const hit = list.find((x) => x.name.toLowerCase() === i.name.toLowerCase());
        if (!hit) list.push(i);
        // A server's description is better than a name.
        else if (i.label && (!hit.label || hit.label === hit.name.split('.').pop()))
          hit.label = i.label;
      }
    };
    const packs: GameAssets['skinPackages'] = [];
    for (const raw of this.agents.allInventories()) {
      const inv = raw as { assets?: GameAssets } | undefined;
      if (!inv?.assets) continue;
      add(out.botClasses, inv.assets.botClasses ?? []);
      add(out.textures, inv.assets.textures ?? []);
      add(out.voices, inv.assets.voices ?? []);
      add(out.weapons, inv.assets.weapons ?? []);
      packs.push(...(inv.assets.skinPackages ?? []));
      // One entry per class (servers report the same stock classes).
      for (const d of inv.assets.classDefaults ?? [])
        if (!out.classDefaults.some((x) => x.name.toLowerCase() === d.name.toLowerCase()))
          out.classDefaults.push(d);
    }
    const pkg = (n: string) => n.split('.')[0]!.toLowerCase();
    const withInt = new Set(out.textures.map((t) => pkg(t.name)));
    // The stock skins when no server reported their package.
    const textures = [...out.textures, ...STOCK_TEXTURES.filter((t) => !withInt.has(pkg(t.name)))];
    // Skin packages without any .int entry (decision 133): their textures as UT names them.
    for (const sp of packs) {
      if (withInt.has(sp.pkg.toLowerCase())) continue;
      withInt.add(sp.pkg.toLowerCase());
      for (const n of sp.textures) {
        const face = /^[A-Za-z]{4}\d([A-Za-z]\w*)$/.exec(n);
        const label = /^[A-Za-z]{4}1$/.test(n)
          ? n.slice(0, 4)
          : face && !/^t_/i.test(face[1]!)
            ? face[1]!
            : '';
        textures.push({ name: `${sp.pkg}.${n}`, label });
      }
    }
    const models = modelChoices(
      out.botClasses,
      textures,
      out.voices as VoiceEntry[],
      profilesWith(out.classDefaults),
    );
    const skins = new Map<string, { name: string; label: string }>();
    const faces = new Map<string, { name: string; label: string; pkg: string }>();
    for (const sk of allSkins(textures)) {
      skins.set(sk.name.toLowerCase(), { name: sk.name, label: sk.label });
      for (const f of sk.faces)
        faces.set(f.name.toLowerCase(), { ...f, pkg: f.name.split('.')[0]! });
    }
    return {
      ...out,
      textures,
      skins: [...skins.values()],
      faces: [...faces.values()],
      packages: Object.fromEntries(STOCK_CLASSES.map((c) => [c.botClass, c.pkg])),
      models,
    };
  }

  /**
   * A model, skin, face and voice that fit together as in UT's setup menu (decision 172); empty
   * values are the defaults. Models whose profile is unknown are not checked.
   */
  assertLook(look: Look, before?: Look): void {
    const models = this.assets().models;
    const p = before ? changedLookProblems(models, before, look)[0] : lookProblem(models, look);
    if (!p) return;
    if (p.field === 'botClass') throw badRequest('the model {value} is not known', p);
    if (p.field === 'skin') throw badRequest('the skin {value} does not fit the model', p);
    if (p.field === 'face') throw badRequest('the face {value} does not fit the skin', p);
    throw badRequest('the voice {value} does not fit the model', p);
  }

  // --- tournaments ----------------------------------------------------------------------------

  /**
   * A pool entry with a library id gets the bot's current name, look and play style (`library`:
   * the bots by id when the caller has read them already, for many entries at once).
   */
  resolveSpec(spec: BotSpec, library?: ReadonlyMap<string, LibraryBot>): BotSpec {
    if (!spec.id) return spec;
    const b = library ? this.find(library, spec.id) : this.get(spec.id);
    if (!b) return spec;
    return {
      id: b.id,
      name: b.gameName,
      skill: spec.skill,
      ...(b.botClass ? { botClass: b.botClass } : {}),
      ...(b.skin ? { skin: b.skin } : {}),
      ...(b.face ? { face: b.face } : {}),
      traits: b.traits,
    };
  }

  /** `resolveSpec` for a whole pool: the bots are read once (not once per entry). */
  resolveSpecs(specs: readonly BotSpec[]): BotSpec[] {
    const library = specs.some((s) => s.id)
      ? new Map(this.list().map((b) => [b.id, b]))
      : undefined;
    return specs.map((s) => this.resolveSpec(s, library));
  }

  /** Clan of a library bot (for clan teams). */
  clanOf(botId: string | undefined): Clan | undefined {
    const b = botId ? this.get(botId) : undefined;
    return b?.clanId ? this.clans().find((c) => c.id === b.clanId) : undefined;
  }

  /**
   * Personalities for the game: lines (at most BOT_MAX_LINES, spread over the occasions) and
   * rivals by their names in the game (players by display name, bots by game name).
   */
  personalities(
    ids: readonly string[],
    /** Latest bets with Neuro per bot id (betting), to talk about in the next game. */
    news?: ReadonlyMap<string, NonNullable<BotPersonality['bet']>>,
    /** The bot's name in this game when it differs (a Dream Team tag in front). */
    names?: ReadonlyMap<string, string>,
  ): BotPersonality[] {
    const all = this.list();
    const users = new Map(this.users.list().map((u) => [u.id, u.displayName]));
    const out: BotPersonality[] = [];
    for (const id of new Set(ids)) {
      const b = all.find((x) => x.id === id);
      if (!b) continue;
      const rivals = b.personality.rivals
        .map((r) => ({
          // A rival bot under its name in this game (Dream Team: with the manager's tag).
          name:
            r.kind === 'user'
              ? users.get(r.id)
              : (names?.get(r.id) ?? all.find((x) => x.id === r.id)?.gameName),
          level: r.level,
        }))
        .filter((r): r is { name: string; level: 'rival' | 'nemesis' } => !!r.name)
        .map((r) => ({ name: r.name.slice(0, 32), level: r.level }))
        .slice(0, BOT_MAX_RIVALS);
      const bet = news?.get(b.id);
      if (!b.personality.lines.length && !rivals.length) continue;
      out.push({
        name: names?.get(b.id) ?? b.gameName,
        talk: b.personality.talk,
        lines: spreadLines(b.personality.lines, BOT_MAX_LINES),
        rivals,
        ...(bet ? { bet } : {}),
      });
    }
    return out;
  }
}

/** Traits without empty strings (weapon/voice "" = none). */
function cleanTraits(t: BotTraits | undefined): BotTraits {
  const out: BotTraits = { ...(t ?? {}) };
  if (!out.favoriteWeapon) delete out.favoriteWeapon;
  if (!out.voice) delete out.voice;
  return out;
}

/** Up to `max` lines, taking them round-robin from the occasions so every occasion gets some. */
export function spreadLines<T extends { kind: string }>(lines: readonly T[], max: number): T[] {
  const byKind = new Map<string, T[]>();
  for (const l of lines) byKind.set(l.kind, [...(byKind.get(l.kind) ?? []), l]);
  const out: T[] = [];
  for (let round = 0; out.length < max; round++) {
    let added = false;
    for (const list of byKind.values())
      if (list[round] && out.length < max) {
        out.push(list[round]!);
        added = true;
      }
    if (!added) break;
  }
  return out;
}
