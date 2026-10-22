import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addFakeLodMesh,
  addFakeTexture,
  FakePackageBuilder,
  packVertex,
} from '../src/sim/fake-packages.js';
import { encodePng, LookAssets } from '../src/ut99/look-preview.js';
import { PackageFile } from '../src/ut99/package-file.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function install(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'look-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, 'System'));
  fs.mkdirSync(path.join(root, 'Textures'));
  return root;
}

/** A 4-vertex model with 2 faces on 2 skin slots, a 3-frame idle and a 1-frame pose. */
function modelPackage(meshName = 'Robo'): Buffer {
  const b = new FakePackageBuilder();
  const frame = (dz: number): [number, number, number][] => [
    [0, 0, 0 + dz],
    [10, 0, 0 + dz],
    [0, 10, 0 + dz],
    [-5, -7, 100 + dz],
  ];
  addFakeLodMesh(b, meshName, {
    frames: [frame(0), frame(1), frame(2), frame(3)],
    wedges: [
      [0, 0, 0],
      [1, 255, 0],
      [2, 0, 255],
      [3, 128, 128],
    ],
    faces: [
      [0, 1, 2, 0],
      [1, 2, 3, 1],
    ],
    materials: [
      { slot: 0, flags: 0 },
      { slot: 3, flags: 0x100 },
    ],
    sequences: [
      ['All', 0, 4, 30],
      ['Fighter', 0, 1, 1],
      ['Breath1', 1, 3, 6],
    ],
    specialVerts: 1,
  });
  return b.build();
}

function skinPackage(): Buffer {
  const b = new FakePackageBuilder();
  addFakeTexture(
    b,
    'robo1',
    2,
    2,
    [0, 1, 2, 3],
    [
      [10, 20, 30],
      [40, 50, 60],
      [70, 80, 90],
      [255, 0, 0],
    ],
  );
  addFakeTexture(
    b,
    'robo2Zed',
    2,
    2,
    [0, 0, 1, 1],
    [
      [0, 0, 0],
      [1, 2, 3],
    ],
    true,
  );
  return b.build();
}

/** Decodes the palette PNG the bridge writes (IHDR, PLTE, tRNS, IDAT). */
function readPng(png: Buffer) {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const chunks = new Map<string, Buffer>();
  for (let p = 8; p < png.length;) {
    const len = png.readUInt32BE(p);
    const type = png.toString('latin1', p + 4, p + 8);
    const data = png.subarray(p + 8, p + 8 + len);
    expect(png.readUInt32BE(p + 8 + len)).toBe(zlib.crc32(png.subarray(p + 4, p + 8 + len)) >>> 0);
    chunks.set(type, data);
    p += 12 + len;
  }
  const ihdr = chunks.get('IHDR')!;
  return {
    w: ihdr.readUInt32BE(0),
    h: ihdr.readUInt32BE(4),
    colorType: ihdr[9],
    plte: chunks.get('PLTE'),
    trns: chunks.get('tRNS'),
    raw: zlib.inflateSync(chunks.get('IDAT')!),
  };
}

describe('look previews (decision 176)', () => {
  it('reads the tables of a package and its objects', () => {
    const root = install();
    const file = path.join(root, 'System', 'RoboPack.u');
    fs.writeFileSync(file, modelPackage());
    const pkg = PackageFile.open(file);
    expect(pkg.version).toBe(69);
    expect(pkg.find('robo', 'lodmesh')?.name).toBe('Robo');
    expect(pkg.ofClass('Texture')).toEqual([]);
    // No file stays open: the package can be replaced (Windows) and is read again.
    fs.rmSync(file);
    expect(() => pkg.readObject(pkg.find('robo', 'lodmesh')!)).toThrow();
    expect(() => PackageFile.open(path.join(root, 'nope.u'))).toThrow();
    fs.writeFileSync(path.join(root, 'bad.u'), 'not a package at all, really not');
    expect(() => PackageFile.open(path.join(root, 'bad.u'))).toThrow(/not an Unreal package/);
  });

  it('sends the idle animation of a model mesh, its wedges, faces and skin slots', () => {
    const root = install();
    fs.writeFileSync(path.join(root, 'System', 'RoboPack.u'), modelPackage());
    const assets = new LookAssets(root);
    const m = assets.mesh('ROBO', 'robopack');
    expect(m).toMatchObject({
      name: 'Robo',
      seq: 'Breath1',
      frames: 3,
      rate: 6,
      modelVerts: 4,
      materials: [
        { slot: 0, flags: 0 },
        { slot: 3, flags: 0x100 },
      ],
      textures: ['', ''],
      scale: [0.0625, 0.0625, 0.125],
      rotOrigin: [0, 16384, -16384],
    });
    const verts = Buffer.from(m.verts, 'base64');
    // frames 1..3 of the mesh, the special vertex left out
    expect(verts.length).toBe(3 * 4 * 4);
    expect(verts.readUInt32LE(0)).toBe(packVertex(0, 0, 1));
    expect(verts.readUInt32LE(3 * 4)).toBe(packVertex(-5, -7, 101));
    expect(verts.readUInt32LE(2 * 16 + 3 * 4)).toBe(packVertex(-5, -7, 103));
    const wedges = Buffer.from(m.wedges, 'base64');
    expect([wedges.readUInt16LE(4), wedges[6], wedges[7]]).toEqual([1, 255, 0]);
    const faces = Buffer.from(m.faces, 'base64');
    expect([0, 2, 4, 6].map((o) => faces.readUInt16LE(8 + o))).toEqual([1, 2, 3, 1]);
  });

  it('finds a mesh in another package, and refuses what is not there', () => {
    const root = install();
    fs.writeFileSync(path.join(root, 'System', 'Other.u'), modelPackage('Ninja'));
    const assets = new LookAssets(root);
    expect(assets.mesh('Ninja', 'Botpack').name).toBe('Ninja');
    expect(() => assets.mesh('Ghost', 'Other')).toThrow(/no model mesh Ghost/);
  });

  it('turns palette textures into PNGs (masked: colour 0 transparent)', () => {
    const root = install();
    fs.writeFileSync(path.join(root, 'Textures', 'roboskins.utx'), skinPackage());
    const assets = new LookAssets(root);
    const a = readPng(assets.texture('RoboSkins.ROBO1'));
    expect([a.w, a.h, a.colorType]).toEqual([2, 2, 3]);
    expect([...a.plte!.subarray(0, 6)]).toEqual([10, 20, 30, 40, 50, 60]);
    expect(a.trns).toBeUndefined();
    // two rows, each: filter byte 0 + 2 indices
    expect([...a.raw]).toEqual([0, 0, 1, 0, 2, 3]);
    const b = readPng(assets.texture('RoboSkins.robo2Zed'));
    expect([...b.trns!]).toEqual([0]);
    expect(() => assets.texture('RoboSkins.robo9')).toThrow(/no texture/);
    expect(() => assets.texture('NoSkins.robo1')).toThrow(/no package/);
    expect(() => assets.texture('../etc/passwd')).toThrow(/bad texture name/);
    // Bigger than 512 px without a smaller mip map: not sent (too much for the link).
    const big = new FakePackageBuilder();
    addFakeTexture(big, 'huge', 1024, 1, new Array<number>(1024).fill(1), [[0, 0, 0]]);
    fs.writeFileSync(path.join(root, 'Textures', 'BigSkins.utx'), big.build());
    expect(() => assets.texture('BigSkins.huge')).toThrow(/no image up to 512/);
  });

  it('writes RGBA PNGs and stamps the installation', () => {
    const rgba = readPng(encodePng(1, 1, undefined, Buffer.from([1, 2, 3, 4])));
    expect([rgba.colorType, ...rgba.raw]).toEqual([6, 0, 1, 2, 3, 4]);
    const root = install();
    const assets = new LookAssets(root);
    const empty = assets.stamp();
    expect(assets.stamp()).toBe(empty);
    fs.writeFileSync(path.join(root, 'Textures', 'roboskins.utx'), skinPackage());
    expect(assets.stamp()).not.toBe(empty);
  });
});
