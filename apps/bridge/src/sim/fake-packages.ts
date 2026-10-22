/**
 * Tiny Unreal packages for tests (the game's own files cannot be part of the project): a model
 * package with a LodMesh and a skin package with palette textures, laid out as UT99 stores them.
 */

function compactIndex(v: number): Buffer {
  const out: number[] = [];
  const neg = v < 0;
  let a = Math.abs(v);
  let b0 = (neg ? 0x80 : 0) | (a & 0x3f);
  a >>>= 6;
  if (a) b0 |= 0x40;
  out.push(b0);
  while (a) {
    let b = a & 0x7f;
    a >>>= 7;
    if (a) b |= 0x80;
    out.push(b);
  }
  return Buffer.from(out);
}

class Bytes {
  private parts: Buffer[] = [];
  u8(v: number) {
    this.parts.push(Buffer.from([v & 0xff]));
    return this;
  }
  u16(v: number) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v);
    this.parts.push(b);
    return this;
  }
  i32(v: number) {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v);
    this.parts.push(b);
    return this;
  }
  u32(v: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0);
    this.parts.push(b);
    return this;
  }
  f32(v: number) {
    const b = Buffer.alloc(4);
    b.writeFloatLE(v);
    this.parts.push(b);
    return this;
  }
  ci(v: number) {
    this.parts.push(compactIndex(v));
    return this;
  }
  raw(b: Buffer) {
    this.parts.push(b);
    return this;
  }
  get length() {
    return this.parts.reduce((n, p) => n + p.length, 0);
  }
  done(): Buffer {
    return Buffer.concat(this.parts);
  }
}

/** A property tag of the simple kinds the readers use. */
export type FakeProp =
  | { name: string; byte: number }
  | { name: string; int: number }
  | { name: string; bool: boolean }
  | { name: string; object: number };

interface FakeObject {
  name: string;
  className: string;
  body: (n: (s: string) => number) => Buffer;
}

/** Builds a package (version 69) from objects whose classes are imported from Engine. */
export class FakePackageBuilder {
  private names: string[] = ['None', 'Core', 'Engine', 'Class', 'Package'];
  private objects: FakeObject[] = [];

  name(s: string): number {
    let i = this.names.indexOf(s);
    if (i < 0) i = this.names.push(s) - 1;
    return i;
  }

  /** Adds an object; returns its reference (export index + 1). */
  add(name: string, className: string, body: (n: (s: string) => number) => Buffer): number {
    this.objects.push({ name, className, body });
    return this.objects.length;
  }

  /** Property list followed by the native data. */
  static props(n: (s: string) => number, props: FakeProp[], native: Buffer = Buffer.alloc(0)) {
    const b = new Bytes();
    for (const p of props) {
      b.ci(n(p.name));
      if ('bool' in p) b.u8(3 | (p.bool ? 0x80 : 0));
      else if ('byte' in p) b.u8(1).u8(p.byte);
      else if ('int' in p) b.u8(2 | (2 << 4)).i32(p.int);
      else {
        const ref = compactIndex(p.object);
        b.u8(5 | (5 << 4))
          .u8(ref.length)
          .raw(ref);
      }
    }
    b.ci(n('None'));
    return Buffer.concat([b.done(), native]);
  }

  build(): Buffer {
    const classes = [...new Set(this.objects.map((o) => o.className))];
    for (const c of classes) this.name(c);
    const bodies = this.objects.map((o) => o.body((s) => this.name(s)));
    for (const o of this.objects) this.name(o.name);
    const headerSize = 64;
    let offset = headerSize;
    const data = Buffer.concat(bodies);
    const dataOffset = offset;
    offset += data.length;
    const nameTable = new Bytes();
    for (const s of this.names)
      nameTable
        .ci(s.length + 1)
        .raw(Buffer.from(`${s}\0`, 'latin1'))
        .u32(0);
    const nameOffset = offset;
    offset += nameTable.length;
    // Imports: the Engine package, then one class per used class name.
    const imports = new Bytes();
    imports.ci(this.name('Core')).ci(this.name('Package')).i32(0).ci(this.name('Engine'));
    for (const c of classes)
      imports.ci(this.name('Core')).ci(this.name('Class')).i32(-1).ci(this.name(c));
    const importOffset = offset;
    offset += imports.length;
    const exports = new Bytes();
    let at = dataOffset;
    this.objects.forEach((o, i) => {
      const size = bodies[i]!.length;
      exports
        .ci(-(classes.indexOf(o.className) + 2))
        .ci(0)
        .i32(0)
        .ci(this.name(o.name))
        .u32(0x00070004)
        .ci(size)
        .ci(at);
      at += size;
    });
    const exportOffset = offset;
    const header = new Bytes()
      .u32(0x9e2a83c1)
      .u16(69)
      .u16(0)
      .u32(1)
      .i32(this.names.length)
      .i32(nameOffset)
      .i32(this.objects.length)
      .i32(exportOffset)
      .i32(classes.length + 1)
      .i32(importOffset)
      .done();
    const head = Buffer.alloc(headerSize);
    header.copy(head);
    return Buffer.concat([head, data, nameTable.done(), imports.done(), exports.done()]);
  }
}

/** A palette texture: `pixels` palette indices (w × h), `colors` RGB per index. */
export function addFakeTexture(
  b: FakePackageBuilder,
  name: string,
  w: number,
  h: number,
  pixels: number[],
  colors: [number, number, number][],
  masked = false,
): number {
  const pal = b.add(`${name}Pal`, 'Palette', (n) => {
    const native = new Bytes().ci(256);
    for (let i = 0; i < 256; i++) {
      const c = colors[i] ?? [0, 0, 0];
      native.u8(c[0]).u8(c[1]).u8(c[2]).u8(0);
    }
    return FakePackageBuilder.props(n, [], native.done());
  });
  return b.add(name, 'Texture', (n) => {
    const native = new Bytes()
      .ci(1)
      .i32(0)
      .ci(w * h)
      .raw(Buffer.from(pixels))
      .i32(w)
      .i32(h)
      .u8(Math.log2(w))
      .u8(Math.log2(h));
    return FakePackageBuilder.props(
      n,
      [
        { name: 'Palette', object: pal },
        { name: 'USize', int: w },
        { name: 'VSize', int: h },
        ...(masked ? [{ name: 'bMasked', bool: true }] : []),
      ],
      native.done(),
    );
  });
}

/** Packs a vertex as UE1 does (X 11 bits, Y 11 bits, Z 10 bits). */
export function packVertex(x: number, y: number, z: number): number {
  return ((x & 0x7ff) | ((y & 0x7ff) << 11) | ((z & 0x3ff) << 22)) >>> 0;
}

export interface FakeMesh {
  /** Per frame the model vertices [x, y, z]. */
  frames: [number, number, number][][];
  /** Vertex index, S, T. */
  wedges: [number, number, number][];
  /** Wedge indices and material. */
  faces: [number, number, number, number][];
  /** Skin slot and poly flags per material. */
  materials: { slot: number; flags: number }[];
  /** Animations: name, first frame, frames, rate. */
  sequences: [string, number, number, number][];
  /** Special vertices per frame (before the model vertices). */
  specialVerts?: number;
}

/** A LodMesh as UT99's packages store it. */
export function addFakeLodMesh(b: FakePackageBuilder, name: string, mesh: FakeMesh): number {
  return b.add(name, 'LodMesh', (n) => {
    const special = mesh.specialVerts ?? 0;
    const modelVerts = mesh.frames[0]!.length;
    const frameVerts = modelVerts + special;
    const x = new Bytes();
    const box = () => x.f32(0).f32(0).f32(0).f32(1).f32(1).f32(1).u8(1);
    const sphere = () => x.f32(0).f32(0).f32(0).f32(1);
    box();
    sphere();
    // Verts (lazy)
    x.i32(0).ci(frameVerts * mesh.frames.length);
    for (const f of mesh.frames) {
      for (let i = 0; i < special; i++) x.u32(packVertex(0, 0, 0));
      for (const v of f) x.u32(packVertex(v[0], v[1], v[2]));
    }
    x.i32(0).ci(0); // Tris
    x.ci(mesh.sequences.length);
    for (const [seq, start, num, rate] of mesh.sequences)
      x.ci(n(seq)).ci(n('None')).i32(start).i32(num).ci(0).f32(rate);
    x.i32(0).ci(0); // Connects
    box();
    sphere();
    x.i32(0).ci(0); // VertLinks
    x.ci(mesh.materials.length);
    for (let i = 0; i < mesh.materials.length; i++) x.ci(0); // Textures
    x.ci(0).ci(0); // BoundingBoxes, BoundingSpheres
    x.i32(frameVerts).i32(mesh.frames.length).u32(0xffffffff).u32(0);
    x.f32(0.0625).f32(0.0625).f32(0.125); // scale
    x.f32(0).f32(0).f32(0); // origin
    x.i32(0).i32(16384).i32(-16384); // rot origin
    x.i32(0).i32(0); // CurPoly, CurVertex
    x.ci(1).f32(1); // TextureLOD
    x.ci(0); // CollapsePointThus
    x.ci(0); // FaceLevel
    x.ci(mesh.faces.length);
    for (const f of mesh.faces) x.u16(f[0]).u16(f[1]).u16(f[2]).u16(f[3]);
    x.ci(0); // CollapseWedgeThus
    x.ci(mesh.wedges.length);
    for (const w of mesh.wedges) x.u16(w[0]).u8(w[1]).u8(w[2]);
    x.ci(mesh.materials.length);
    for (const m of mesh.materials) x.u32(m.flags).i32(m.slot);
    x.ci(0); // SpecialFaces
    x.i32(modelVerts).i32(special);
    x.f32(1).f32(0).f32(1).i32(10).f32(0).f32(0).f32(0); // LOD settings
    return FakePackageBuilder.props(n, [], x.done());
  });
}
