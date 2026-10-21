import fs from 'node:fs';
import path from 'node:path';
import type { BridgeToMod, ClassDefaults, ModToBridge } from '@tourney/protocol';
import type { Logger } from '../log.js';
import { findDir } from './inventory.js';

type ModelLine = Extract<ModToBridge, { t: 'model' }>;

/** A class the mod answered for; `info` missing: it does not load or is no bot. */
interface Entry {
  name: string;
  /** Size and time of the class's package file when the mod answered (a new version asks again). */
  stamp: string;
  info?: ClassDefaults;
}

/** The first mod version that answers `describe`. */
const DESCRIBE_SINCE = [0, 14, 1];

/** Whether a mod version (hello `mv`, e.g. "0.14.1") answers `describe`. */
export function modDescribes(version: string): boolean {
  const v = version.split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const a = v[i] ?? 0;
    const b = DESCRIBE_SINCE[i]!;
    if (a !== b) return a > b;
  }
  return true;
}

export interface ModelCatalogOptions {
  installDir: string;
  /** Where the answers are kept between runs (none: memory only). */
  file?: string;
  log: Logger;
  /** Requests per mod connection (the rest follow on the next one; each loads a package). */
  maxRequests?: number;
}

/**
 * The defaults of the bot classes (mesh, multi-skin flag, voice meta class, own voice and skin)
 * that only the game knows: the mod loads each class once and reports them (decision 173). The
 * answers are kept, so the mod is only asked about new classes or changed packages.
 */
export class ModelCatalog {
  private entries = new Map<string, Entry>();
  private pending = new Map<number, { name: string; stamp: string }>();
  private nextId = 1;

  constructor(private readonly o: ModelCatalogOptions) {
    this.load();
  }

  /** What the mod reported (classes that load), sorted by name. */
  models(): ClassDefaults[] {
    return [...this.entries.values()]
      .flatMap((e) => (e.info ? [e.info] : []))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * `describe` lines for the classes without a current answer. `classes` is the server's full
   * list: answers for classes that are gone are dropped.
   */
  requests(classes: readonly string[]): BridgeToMod[] {
    this.pending.clear();
    const present = new Set(classes.map((c) => c.toLowerCase()));
    let pruned = false;
    for (const key of [...this.entries.keys()])
      if (!present.has(key)) pruned = this.entries.delete(key);
    if (pruned) this.save();
    const stamps = this.packageStamps();
    const out: BridgeToMod[] = [];
    for (const name of classes) {
      if (out.length >= (this.o.maxRequests ?? 16)) break;
      if (!/^\w+\.\w+$/.test(name) || name.length > 64) continue;
      const stamp = stamps.get(name.slice(0, name.indexOf('.')).toLowerCase()) ?? '';
      if (this.entries.get(name.toLowerCase())?.stamp === stamp) continue;
      const i = this.nextId++;
      this.pending.set(i, { name, stamp });
      out.push({ t: 'describe', i, c: name });
    }
    return out;
  }

  /** Takes the mod's answer; true if the reported models changed. */
  answer(m: ModelLine): boolean {
    const req = this.pending.get(m.i);
    if (!req) return false;
    this.pending.delete(m.i);
    const info: ClassDefaults | undefined =
      m.ok && m.m
        ? {
            name: req.name,
            mesh: m.m,
            multi: m.ms ?? false,
            voiceMeta: m.vm ?? '',
            voice: m.v ?? '',
            skin: m.s ?? '',
          }
        : undefined;
    const key = req.name.toLowerCase();
    const before = JSON.stringify(this.entries.get(key)?.info ?? null);
    this.entries.set(key, { name: req.name, stamp: req.stamp, ...(info ? { info } : {}) });
    this.save();
    if (!info) this.o.log.info(`mod: bot class ${req.name} does not load`);
    return JSON.stringify(info ?? null) !== before;
  }

  /** Package name (lower case) → size and time of its file in System. */
  private packageStamps(): Map<string, string> {
    const out = new Map<string, string>();
    const dir = findDir(this.o.installDir, 'System');
    if (!dir) return out;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.toLowerCase().endsWith('.u')) continue;
        const st = fs.statSync(path.join(dir, f));
        out.set(f.slice(0, -2).toLowerCase(), `${st.size}:${Math.round(st.mtimeMs)}`);
      }
    } catch {
      // no stamps: every class counts as unchanged once answered
    }
    return out;
  }

  private load(): void {
    if (!this.o.file || !fs.existsSync(this.o.file)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.o.file, 'utf8')) as { entries?: Entry[] };
      for (const e of data.entries ?? [])
        if (typeof e?.name === 'string' && typeof e.stamp === 'string')
          this.entries.set(e.name.toLowerCase(), e);
    } catch (e) {
      this.o.log.warn(`cannot read ${this.o.file}: ${(e as Error).message}`);
    }
  }

  private save(): void {
    if (!this.o.file) return;
    try {
      fs.mkdirSync(path.dirname(this.o.file), { recursive: true });
      fs.writeFileSync(
        this.o.file,
        JSON.stringify({ entries: [...this.entries.values()] }, null, 2) + '\n',
      );
    } catch (e) {
      this.o.log.warn(`cannot write ${this.o.file}: ${(e as Error).message}`);
    }
  }
}
