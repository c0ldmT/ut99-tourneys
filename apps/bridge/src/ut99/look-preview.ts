import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { MeshPreview } from '@tourney/protocol';
import { findDir } from './inventory.js';
import { PackageFile, type PackageObject, type PropertyValue } from './package-file.js';
import type { Reader } from './unreal-package.js';

/**
 * 3D previews of bot looks for the website (decision 176): the mesh of a bot class (one idle
 * animation) and its skin textures, read straight from the game's packages – nothing of the
 * game is shipped with the project.
 */

/** Idle animations the preview plays, in order of preference (UT's player meshes have them). */
const IDLE_SEQUENCES = ['breath2', 'breath1', 'breath', 'breath3', 'look', 'stand', 'idle'];
/** At most this many frames of the idle animation are sent. */
const MAX_FRAMES = 48;
const MAX_MODEL_VERTS = 4000;
const MAX_FACES = 8000;
/** Larger textures are sent as a smaller mip map. */
const MAX_TEXTURE = 512;

/** UT's texture formats (Engine.Texture ETextureFormat). */
const TEXF_P8 = 0;
const TEXF_DXT1 = 3;
const TEXF_RGBA8 = 5;

/** The asked part is not there or not usable (the website may remember that). */
export class MissingAsset extends Error {}

// --- mesh -------------------------------------------------------------------------------------

function lazyArray<T>(r: Reader, version: number, item: (r: Reader) => T, max = 2_000_000): T[] {
  if (version > 61) r.i32(); // skip position
  return array(r, item, max);
}

function array<T>(r: Reader, item: (r: Reader) => T, max = 2_000_000): T[] {
  const n = r.index();
  if (n < 0 || n > max) throw new Error(`bad array length ${n}`);
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(item(r));
  return out;
}

const vec = (r: Reader): [number, number, number] => [r.f32(), r.f32(), r.f32()];
const box = (r: Reader) => {
  vec(r);
  vec(r);
  r.u8();
};
const sphere = (r: Reader) => {
  vec(r);
  r.f32();
};

interface Sequence {
  name: string;
  group: string;
  start: number;
  frames: number;
  rate: number;
}

/**
 * Reads a LodMesh (UT's player models): the idle animation's frames as packed vertices (UE1:
 * X 11 bits, Y 11 bits, Z 10 bits), the wedges (vertex + texture coordinates), the faces with
 * their material, the materials (skin slot + poly flags) and the mesh's own textures.
 */
export function readLodMesh(pkg: PackageFile, o: PackageObject, ownPackage: string): MeshPreview {
  const v = pkg.version;
  const { r } = pkg.readObject(o);
  // UPrimitive
  box(r);
  sphere(r);
  // UMesh
  const verts = lazyArray(r, v, (x) => x.u32(), 8_000_000);
  lazyArray(r, v, (x) => x.skip(20)); // Tris (vertex meshes only)
  const seqs = array<Sequence>(r, (x) => {
    const name = pkg.name(x.index());
    const group = pkg.name(x.index());
    const start = x.i32();
    const frames = x.i32();
    array(x, (y) => {
      y.f32();
      y.index();
    });
    return { name, group, start, frames, rate: x.f32() };
  });
  lazyArray(r, v, (x) => x.skip(8)); // Connects
  box(r);
  sphere(r);
  lazyArray(r, v, (x) => x.i32()); // VertLinks
  const textures = array(r, (x) => x.index());
  array(r, box); // BoundingBoxes
  array(r, sphere); // BoundingSpheres
  const frameVerts = r.i32();
  const animFrames = r.i32();
  r.u32(); // AND flags
  r.u32(); // OR flags
  const scale = vec(r);
  const origin = vec(r);
  const rotOrigin: [number, number, number] = [r.i32(), r.i32(), r.i32()];
  r.i32(); // CurPoly
  r.i32(); // CurVertex
  if (v === 65) r.f32();
  else if (v >= 66) array(r, (x) => x.f32()); // TextureLOD
  // ULodMesh
  array(r, (x) => x.u16()); // CollapsePointThus
  array(r, (x) => x.u16()); // FaceLevel
  const faces = array(r, (x) => [x.u16(), x.u16(), x.u16(), x.u16()] as const);
  array(r, (x) => x.u16()); // CollapseWedgeThus
  const wedges = array(r, (x) => [x.u16(), x.u8(), x.u8()] as const);
  const materials = array(r, (x) => ({ flags: x.u32(), slot: x.i32() }));
  array(r, (x) => x.skip(8)); // SpecialFaces
  const modelVerts = r.i32();
  const specialVerts = r.i32();

  if (
    frameVerts <= 0 ||
    animFrames <= 0 ||
    modelVerts <= 0 ||
    modelVerts > MAX_MODEL_VERTS ||
    modelVerts + specialVerts !== frameVerts ||
    verts.length !== frameVerts * animFrames ||
    !faces.length ||
    faces.length > MAX_FACES ||
    wedges.some((w) => w[0] >= modelVerts) ||
    faces.some((f) => f[0] >= wedges.length || f[1] >= wedges.length || f[2] >= wedges.length) ||
    faces.some((f) => f[3] >= materials.length) ||
    materials.length > 64 ||
    materials.some((m) => m.slot < 0 || m.slot > 7) ||
    ![...scale, ...origin].every(Number.isFinite)
  )
    throw new MissingAsset(`mesh ${o.name} is not a model mesh`);

  const seq = pickIdle(seqs, animFrames);
  const frames = Math.min(seq.frames, MAX_FRAMES);
  const packed = Buffer.alloc(frames * modelVerts * 4);
  for (let f = 0; f < frames; f++) {
    const base = (seq.start + f) * frameVerts + specialVerts;
    for (let i = 0; i < modelVerts; i++)
      packed.writeUInt32LE(verts[base + i]!, (f * modelVerts + i) * 4);
  }
  const wedgeBuf = Buffer.alloc(wedges.length * 4);
  wedges.forEach(([vi, s, t], i) => {
    wedgeBuf.writeUInt16LE(vi, i * 4);
    wedgeBuf.writeUInt8(s, i * 4 + 2);
    wedgeBuf.writeUInt8(t, i * 4 + 3);
  });
  const faceBuf = Buffer.alloc(faces.length * 8);
  faces.forEach(([a, b, c, m], i) => {
    faceBuf.writeUInt16LE(a, i * 8);
    faceBuf.writeUInt16LE(b, i * 8 + 2);
    faceBuf.writeUInt16LE(c, i * 8 + 4);
    faceBuf.writeUInt16LE(m, i * 8 + 6);
  });
  return {
    name: o.name.slice(0, 64),
    seq: seq.name.slice(0, 64),
    frames,
    rate: seq.rate > 0 && seq.rate < 120 ? seq.rate : 10,
    modelVerts,
    verts: packed.toString('base64'),
    wedges: wedgeBuf.toString('base64'),
    faces: faceBuf.toString('base64'),
    materials,
    textures: textures.slice(0, 8).map((t) => {
      const n = pkg.refPath(t, ownPackage) ?? '';
      return n.length <= 128 ? n : '';
    }),
    scale,
    origin,
    rotOrigin,
  };
}

/** The idle animation (a known name, else the first waiting animation, else the first frame). */
function pickIdle(seqs: Sequence[], animFrames: number): Sequence {
  const ok = (s: Sequence) => s.start >= 0 && s.frames > 0 && s.start + s.frames <= animFrames;
  for (const name of IDLE_SEQUENCES) {
    const s = seqs.find((x) => x.name.toLowerCase() === name && ok(x));
    if (s) return s;
  }
  const waiting = seqs.find((x) => x.group.toLowerCase() === 'waiting' && x.frames > 1 && ok(x));
  return waiting ?? { name: 'None', group: 'None', start: 0, frames: 1, rate: 1 };
}

// --- textures ---------------------------------------------------------------------------------

/** A texture as PNG (palette textures stay palette images; masked: colour 0 transparent). */
export function readTexture(pkg: PackageFile, o: PackageObject): Buffer {
  const { r, props } = pkg.readObject(o);
  const format = num(props.get('Format'));
  const masked = props.get('bMasked') === true;
  const mips = array(
    r,
    (x) => {
      if (pkg.version >= 63) x.i32(); // skip position
      const n = x.index();
      if (n < 0 || n > 64 * 1024 * 1024) throw new Error('bad mip size');
      const start = x.pos;
      x.skip(n);
      const w = x.i32();
      const h = x.i32();
      x.u8();
      x.u8();
      return { start, n, w, h };
    },
    16,
  );
  // The largest mip map up to 512 × 512 (bigger ones would be too much for the link).
  const mip = mips.find((m) => m.w > 0 && m.h > 0 && m.w <= MAX_TEXTURE && m.h <= MAX_TEXTURE);
  if (!mip) throw new MissingAsset(`texture ${o.name} has no image up to ${MAX_TEXTURE} px`);
  const data = r.buf.subarray(mip.start, mip.start + mip.n);
  const { w, h } = mip;
  if (format === TEXF_P8) {
    if (data.length < w * h) throw new Error(`texture ${o.name} is cut off`);
    const palRef = num(props.get('Palette'));
    const pal = palRef > 0 ? pkg.objects[palRef - 1] : undefined;
    if (!pal) throw new Error(`texture ${o.name} has no palette`);
    const colors = readPalette(pkg, pal);
    return encodePng(w, h, { palette: colors, masked }, data.subarray(0, w * h));
  }
  if (format === TEXF_RGBA8) {
    if (data.length < w * h * 4) throw new Error(`texture ${o.name} is cut off`);
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      // stored as BGRA
      rgba[i * 4] = data[i * 4 + 2]!;
      rgba[i * 4 + 1] = data[i * 4 + 1]!;
      rgba[i * 4 + 2] = data[i * 4]!;
      rgba[i * 4 + 3] = masked || data[i * 4 + 3] ? data[i * 4 + 3]! : 255;
    }
    return encodePng(w, h, undefined, rgba);
  }
  if (format === TEXF_DXT1) return encodePng(w, h, undefined, decodeDxt1(data, w, h, masked));
  throw new MissingAsset(`texture ${o.name}: format ${format} is not supported`);
}

const num = (v: PropertyValue | undefined): number => (typeof v === 'number' ? v : 0);

function readPalette(pkg: PackageFile, o: PackageObject): Buffer {
  const { r } = pkg.readObject(o);
  const n = r.index();
  if (n <= 0 || n > 256) throw new Error('bad palette');
  const out = Buffer.alloc(256 * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = r.u8();
    out[i * 4 + 1] = r.u8();
    out[i * 4 + 2] = r.u8();
    out[i * 4 + 3] = r.u8();
  }
  return out;
}

function rgb565(c: number): [number, number, number] {
  return [((c >> 11) & 31) * (255 / 31), ((c >> 5) & 63) * (255 / 63), (c & 31) * (255 / 31)];
}

function decodeDxt1(data: Buffer, w: number, h: number, masked: boolean): Buffer {
  const out = Buffer.alloc(w * h * 4);
  const bw = Math.max(1, Math.ceil(w / 4));
  const bh = Math.max(1, Math.ceil(h / 4));
  if (data.length < bw * bh * 8) throw new Error('texture is cut off');
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      const o = (by * bw + bx) * 8;
      const c0 = data.readUInt16LE(o);
      const c1 = data.readUInt16LE(o + 2);
      const bits = data.readUInt32LE(o + 4);
      const a = rgb565(c0);
      const b = rgb565(c1);
      const cols: [number, number, number, number][] =
        c0 > c1
          ? [
              [...a, 255],
              [...b, 255],
              [(2 * a[0] + b[0]) / 3, (2 * a[1] + b[1]) / 3, (2 * a[2] + b[2]) / 3, 255],
              [(a[0] + 2 * b[0]) / 3, (a[1] + 2 * b[1]) / 3, (a[2] + 2 * b[2]) / 3, 255],
            ]
          : [
              [...a, 255],
              [...b, 255],
              [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, 255],
              [0, 0, 0, masked ? 0 : 255],
            ];
      for (let py = 0; py < 4; py++)
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= w || y >= h) continue;
          const c = cols[(bits >> (2 * (py * 4 + px))) & 3]!;
          const p = (y * w + x) * 4;
          out[p] = Math.round(c[0]);
          out[p + 1] = Math.round(c[1]);
          out[p + 2] = Math.round(c[2]);
          out[p + 3] = c[3];
        }
    }
  return out;
}

/**
 * A PNG: 8-bit palette (`palette` RGBA × 256; masked: colour 0 transparent) or RGBA pixels.
 */
export function encodePng(
  w: number,
  h: number,
  palette: { palette: Buffer; masked: boolean } | undefined,
  pixels: Buffer,
): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const bpp = palette ? 1 : 4;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = palette ? 3 : 6; // palette / RGBA
  const raw = Buffer.alloc((w * bpp + 1) * h);
  for (let y = 0; y < h; y++)
    pixels.copy(raw, y * (w * bpp + 1) + 1, y * w * bpp, (y + 1) * w * bpp);
  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
  ];
  if (palette) {
    const plte = Buffer.alloc(256 * 3);
    for (let i = 0; i < 256; i++) {
      plte[i * 3] = palette.palette[i * 4]!;
      plte[i * 3 + 1] = palette.palette[i * 4 + 1]!;
      plte[i * 3 + 2] = palette.palette[i * 4 + 2]!;
    }
    parts.push(chunk('PLTE', plte));
    if (palette.masked) parts.push(chunk('tRNS', Buffer.from([0])));
  }
  parts.push(chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// --- finding things in the installation -------------------------------------------------------

/** Lists the files of a folder (case-insensitive lookups on Linux). */
function filesOf(dir: string | undefined, ext: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!dir) return out;
  try {
    for (const f of fs.readdirSync(dir))
      if (f.toLowerCase().endsWith(ext))
        out.set(f.slice(0, -ext.length).toLowerCase(), path.join(dir, f));
  } catch {
    // unreadable: nothing
  }
  return out;
}

/**
 * Finds meshes and textures in a UT installation: textures in Textures/*.utx (or a .u of
 * System), meshes in the .u packages of System (the class's own package first).
 */
export class LookAssets {
  /** Mesh name (lower case) → package file, once every package was searched. */
  private meshIndex?: Map<string, string>;
  private indexStamp = '';
  /** Tables of recently used packages (file → size and time, package). */
  private open = new Map<string, { stamp: string; pkg: PackageFile }>();

  constructor(private readonly installDir: string) {}

  /** A package with its tables, kept for the next requests (4 at most). */
  private pkg(file: string): PackageFile {
    const st = fs.statSync(file);
    const stamp = `${st.size}:${st.mtimeMs}`;
    const hit = this.open.get(file);
    this.open.delete(file);
    if (hit && hit.stamp === stamp) {
      this.open.set(file, hit);
      return hit.pkg;
    }
    const pkg = PackageFile.open(file);
    this.open.set(file, { stamp, pkg });
    for (const k of [...this.open.keys()]) {
      if (this.open.size <= 4) break;
      this.open.delete(k);
    }
    return pkg;
  }

  /**
   * Size and time of the packages a preview can come from (System/*.u, Textures/*.utx), hashed:
   * it changes when a model or skin package is added, replaced or removed.
   */
  stamp(): string {
    const h = crypto.createHash('sha1');
    for (const [dir, ext] of [
      [findDir(this.installDir, 'System'), '.u'],
      [findDir(this.installDir, 'Textures'), '.utx'],
    ] as const) {
      for (const [k, file] of [...filesOf(dir, ext)].sort((a, b) => a[0].localeCompare(b[0]))) {
        try {
          const st = fs.statSync(file);
          h.update(`${k}${ext}:${st.size}:${Math.round(st.mtimeMs)};`);
        } catch {
          // vanished meanwhile
        }
      }
    }
    return h.digest('hex').slice(0, 16);
  }

  /** The mesh `name` (e.g. "Commando"), looked for in package `hint` first ("Botpack"). */
  mesh(name: string, hint?: string): MeshPreview {
    const system = filesOf(findDir(this.installDir, 'System'), '.u');
    const tryFile = (file: string | undefined): MeshPreview | undefined => {
      if (!file) return undefined;
      const pkg = this.pkg(file);
      const o = pkg.find(name, 'LodMesh');
      if (!o) return undefined;
      return readLodMesh(pkg, o, path.basename(file).replace(/\.u$/i, ''));
    };
    const first = hint ? system.get(hint.toLowerCase()) : undefined;
    const hit = safe(() => tryFile(first));
    if (hit) return hit;
    const indexed = this.indexMeshes(system).get(name.toLowerCase());
    const found = indexed && indexed !== first ? tryFile(indexed) : undefined;
    if (found) return found;
    throw new MissingAsset(`no model mesh ${name}`);
  }

  /** A texture by its full name ("CommandoSkins.cmdo2Blake") as PNG. */
  texture(fullName: string): Buffer {
    const dot = fullName.indexOf('.');
    const pkgName = fullName.slice(0, dot).toLowerCase();
    const item = fullName.slice(fullName.lastIndexOf('.') + 1);
    if (dot <= 0 || !item || !/^[\w.-]+$/.test(fullName))
      throw new MissingAsset('bad texture name');
    const file =
      filesOf(findDir(this.installDir, 'Textures'), '.utx').get(pkgName) ??
      filesOf(findDir(this.installDir, 'System'), '.u').get(pkgName);
    if (!file) throw new MissingAsset(`no package ${fullName.slice(0, dot)}`);
    const pkg = this.pkg(file);
    const o = pkg.find(item, 'Texture');
    if (!o) throw new MissingAsset(`no texture ${fullName}`);
    return readTexture(pkg, o);
  }

  /** Every LodMesh of the System packages (built once per change of the installation). */
  private indexMeshes(system: Map<string, string>): Map<string, string> {
    const stamp = this.stamp();
    if (this.meshIndex && this.indexStamp === stamp) return this.meshIndex;
    const index = new Map<string, string>();
    for (const file of system.values()) {
      safe(() => {
        for (const o of PackageFile.open(file).ofClass('LodMesh'))
          if (!index.has(o.name.toLowerCase())) index.set(o.name.toLowerCase(), file);
      });
    }
    this.meshIndex = index;
    this.indexStamp = stamp;
    return index;
  }
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
