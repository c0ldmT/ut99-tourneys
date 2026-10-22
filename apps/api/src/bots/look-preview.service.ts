import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { GameAssets, MeshPreview } from '@tourney/protocol';
import { AgentsService } from '../agents/agents.service.js';
import { AgentConnections } from '../agents/connections.js';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { notFound } from '../common/http.js';
import { CONFIG, type ApiConfig } from '../config.js';
import { BotsService } from './bots.service.js';
import { lookSlots, profilesWith, STOCK_TEXTURES, type LookSlots } from './models.js';

/** The class UT spawns when none is set (TourneyCore.SpawnSideBot). */
const DEFAULT_CLASS = 'Botpack.TMale1Bot';
/** Parts kept in memory (meshes and textures together), the rest on disk. */
const MEMORY_BYTES = 24 * 1024 * 1024;

interface Source {
  agentId: string;
  profileId: string;
  stamp: string;
  assets?: GameAssets;
}

type Part = { kind: 'mesh'; mesh: MeshPreview } | { kind: 'texture'; png: Buffer } | null;

/**
 * 3D look previews (decision 176): the bridge reads a bot model's mesh and its skin textures
 * from the game's packages; the website keeps them per installation stamp (memory and the data
 * folder), so a server that is offline still shows what was looked at before.
 */
@Injectable()
export class LookPreviewService {
  private memory = new Map<string, { part: Part; bytes: number }>();
  private memoryBytes = 0;
  private inflight = new Map<string, Promise<Part>>();
  private readonly dir?: string;

  constructor(
    @Inject(CONFIG) config: ApiConfig,
    @Inject(AgentsService) private readonly agents: AgentsService,
    @Inject(AgentConnections) private readonly connections: AgentConnections,
    @Inject(BotsService) private readonly bots: BotsService,
    @Inject(LOGGER) private readonly log: ApiLogger,
  ) {
    if (config.dataDir !== ':memory:') this.dir = path.join(config.dataDir, 'look-previews');
  }

  /** The textures a look puts on the model (and the stamp the parts are asked with). */
  async look(
    cls: string,
    skin: string,
    face: string,
    team: number | null,
  ): Promise<LookSlots & { stamp: string }> {
    const { source, profile, name } = this.model(cls);
    const mesh = await this.part(source, 'mesh', name);
    if (mesh?.kind !== 'mesh') throw notFound('3D preview of {name}', { name });
    const { known, listed } = this.knownTextures(source);
    return {
      stamp: source.stamp,
      ...lookSlots({
        multi: profile.multi,
        defaultSkin: profile.skin,
        meshTextures: mesh.mesh.textures,
        skin,
        face,
        team,
        known,
        listed,
      }),
    };
  }

  async mesh(cls: string): Promise<{ stamp: string; mesh: MeshPreview }> {
    const { source, name } = this.model(cls);
    const p = await this.part(source, 'mesh', name);
    if (p?.kind !== 'mesh') throw notFound('3D preview of {name}', { name });
    return { stamp: source.stamp, mesh: p.mesh };
  }

  /** A texture; `stamp`: of the server the look came from (the same server answers). */
  async texture(name: string, stamp?: string): Promise<{ stamp: string; png: Buffer }> {
    const source = this.source(undefined, stamp);
    if (!source || !/^\w+\.[\w.]+$/.test(name) || name.length > 128)
      throw notFound('3D preview of {name}', { name });
    const p = await this.part(source, 'texture', name);
    if (p?.kind !== 'texture') throw notFound('3D preview of {name}', { name });
    return { stamp: source.stamp, png: p.png };
  }

  /** The class's profile (mesh, skins) and the server to ask. */
  private model(cls: string) {
    const name = cls || DEFAULT_CLASS;
    const assets = this.bots.assets();
    const profile = profilesWith(assets.classDefaults)[name.toLowerCase()];
    const source = this.source(name);
    if (!profile?.mesh || !source) throw notFound('3D preview of {name}', { name });
    return { source, profile, name };
  }

  /**
   * The server whose installation the parts come from: one that reports an asset stamp (bridges
   * since decision 176) for a profile it still has; the one with `stamp` if given, else online
   * first, one that has the class first.
   */
  private source(cls?: string, stamp?: string): Source | undefined {
    const rows = this.agents.inventoryRows().flatMap((r) => {
      const inv = r.data as { assetStamp?: string; assets?: GameAssets };
      if (!inv?.assetStamp || !this.agents.profile(r.agentId, r.profileId)) return [];
      const hasClass =
        !cls ||
        cls.toLowerCase().startsWith('botpack.') ||
        (inv.assets?.botClasses ?? []).some((c) => c.name.toLowerCase() === cls.toLowerCase());
      const online = this.connections.isOnline(r.agentId);
      const same = !!stamp && inv.assetStamp === stamp;
      return [
        {
          agentId: r.agentId,
          profileId: r.profileId,
          stamp: inv.assetStamp,
          ...(inv.assets ? { assets: inv.assets } : {}),
          hasClass,
          online,
          same,
        },
      ];
    });
    rows.sort(
      (a, b) =>
        Number(b.same) - Number(a.same) ||
        Number(b.online) - Number(a.online) ||
        Number(b.hasClass) - Number(a.hasClass),
    );
    const r = rows[0];
    return r
      ? {
          agentId: r.agentId,
          profileId: r.profileId,
          stamp: r.stamp,
          ...(r.assets ? { assets: r.assets } : {}),
        }
      : undefined;
  }

  /**
   * Texture names the server reports (lower case) and the packages whose textures are all known
   * (read from its files), for the skin slot rules.
   */
  private knownTextures(source: Source): { known: Set<string>; listed: Set<string> } {
    const known = new Set(STOCK_TEXTURES.map((t) => t.name.toLowerCase()));
    const listed = new Set<string>();
    const a = source.assets;
    for (const t of a?.textures ?? []) known.add(t.name.toLowerCase());
    for (const sp of a?.skinPackages ?? []) {
      listed.add(sp.pkg.toLowerCase());
      for (const t of sp.textures) known.add(`${sp.pkg}.${t}`.toLowerCase());
    }
    return { known, listed };
  }

  /** A part from memory, disk or the bridge (null: the bridge has none). */
  private part(source: Source, kind: 'mesh' | 'texture', name: string): Promise<Part> {
    const key = `${source.agentId}|${source.stamp}|${kind}|${name.toLowerCase()}`;
    const mem = this.memory.get(key);
    if (mem) {
      // most recently used last
      this.memory.delete(key);
      this.memory.set(key, mem);
      return Promise.resolve(mem.part);
    }
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.load(source, kind, name, key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async load(source: Source, kind: 'mesh' | 'texture', name: string, key: string) {
    const file = this.file(source, key, kind);
    let part: Part | undefined = file ? this.readDisk(file, kind) : undefined;
    if (part === undefined) {
      part = await this.ask(source, kind, name);
      if (part && file) this.writeDisk(file, part);
    }
    this.remember(key, part);
    return part;
  }

  private async ask(source: Source, kind: 'mesh' | 'texture', name: string): Promise<Part> {
    let mesh = '';
    let pkg: string | undefined;
    if (kind === 'mesh') {
      const profile = profilesWith(this.bots.assets().classDefaults)[name.toLowerCase()];
      if (!profile?.mesh) return null;
      mesh = profile.mesh;
      pkg = name.split('.')[0];
    }
    let msg;
    try {
      msg = await this.connections.request(source.agentId, {
        type: 'asset.request',
        payload:
          kind === 'mesh'
            ? { kind, profileId: source.profileId, mesh, ...(pkg ? { pkg } : {}) }
            : { kind, profileId: source.profileId, name },
      });
    } catch (e) {
      // offline or no answer: not remembered, asked again next time
      this.log.debug(`look preview ${kind} ${name}: ${(e as Error).message}`);
      throw notFound('3D preview of {name}', { name });
    }
    if (msg.type !== 'asset.data') return null;
    const d = msg.payload;
    if (!d.ok) {
      this.log.info(`look preview ${kind} ${name}: ${d.error ?? 'not available'}`);
      // Only what is not there is remembered; "busy" and the like are asked again next time.
      if (d.missing) return null;
      throw notFound('3D preview of {name}', { name });
    }
    if (kind === 'mesh') return d.mesh ? { kind, mesh: d.mesh } : null;
    return d.png ? { kind, png: Buffer.from(d.png, 'base64') } : null;
  }

  private remember(key: string, part: Part): void {
    const bytes = !part
      ? 512
      : part.kind === 'mesh'
        ? JSON.stringify(part.mesh).length
        : part.png.length;
    this.memory.set(key, { part, bytes });
    this.memoryBytes += bytes;
    for (const [k, v] of this.memory) {
      if (this.memoryBytes <= MEMORY_BYTES) break;
      this.memory.delete(k);
      this.memoryBytes -= v.bytes;
    }
  }

  // --- disk -----------------------------------------------------------------------------------

  /** `<DATA_DIR>/look-previews/<server>/<stamp>/<hash>.json|png` */
  private file(source: Source, key: string, kind: 'mesh' | 'texture'): string | undefined {
    if (!this.dir) return undefined;
    const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 24);
    return path.join(
      this.dir,
      safeName(source.agentId),
      safeName(source.stamp),
      `${hash}.${kind === 'mesh' ? 'json' : 'png'}`,
    );
  }

  private readDisk(file: string, kind: 'mesh' | 'texture'): Part | undefined {
    try {
      const buf = fs.readFileSync(file);
      return kind === 'mesh'
        ? { kind, mesh: JSON.parse(buf.toString('utf8')) as MeshPreview }
        : { kind, png: buf };
    } catch {
      return undefined;
    }
  }

  /** Writes a part; the parts of the server's older installation stamps go. */
  private writeDisk(file: string, part: NonNullable<Part>): void {
    try {
      const stampDir = path.dirname(file);
      if (!fs.existsSync(stampDir)) {
        const serverDir = path.dirname(stampDir);
        fs.mkdirSync(stampDir, { recursive: true });
        for (const d of fs.readdirSync(serverDir))
          if (d !== path.basename(stampDir))
            fs.rmSync(path.join(serverDir, d), { recursive: true, force: true });
      }
      fs.writeFileSync(file, part.kind === 'mesh' ? JSON.stringify(part.mesh) : part.png);
    } catch (e) {
      this.log.warn(`cannot keep a look preview: ${(e as Error).message}`);
    }
  }
}

function safeName(s: string): string {
  return s.replace(/[^\w-]/g, '_');
}
