import fs from 'node:fs';
import { Reader } from './unreal-package.js';

const PACKAGE_TAG = 0x9e2a83c1;
const RF_HAS_STACK = 0x02000000;

export interface PackageObject {
  /** Index in the export table (0-based). */
  index: number;
  name: string;
  /** Class name ("Texture", "LodMesh", ...); "Class" for class objects. */
  className: string;
  /** Outer object: 0 = the package itself, > 0 export, < 0 import (as in the file). */
  outer: number;
  flags: number;
  size: number;
  offset: number;
}

/** A property of an object, decoded where the type is simple. */
export type PropertyValue = number | boolean | string | null | Buffer;

/**
 * An Unreal Engine 1 package (.u, .utx) on disk: the name, import and export tables are read
 * once; objects are read on demand (packages like Botpack.u have 40 MB, so never read whole).
 * Package versions from 64 on (UT99 writes 68 and 69; older ones store names differently).
 */
export class PackageFile {
  readonly version: number;
  readonly names: string[] = [];
  readonly imports: { className: string; outer: number; name: string }[] = [];
  readonly objects: PackageObject[] = [];
  private readonly size: number;

  private constructor(
    /** Open while the tables are read; objects open the file again (it stays replaceable). */
    private fd: number,
    readonly path: string,
  ) {
    this.size = fs.fstatSync(fd).size;
    const head = new Reader(this.range(0, 36));
    if (head.u32() !== PACKAGE_TAG) throw new Error('not an Unreal package');
    this.version = head.u16();
    head.u16(); // licensee
    head.u32(); // package flags
    const nameCount = head.i32();
    const nameOffset = head.i32();
    const exportCount = head.i32();
    const exportOffset = head.i32();
    const importCount = head.i32();
    const importOffset = head.i32();
    if (this.version < 64 || nameCount <= 0 || nameCount > 500_000 || exportCount > 500_000)
      throw new Error(`unsupported package (version ${this.version})`);
    this.table(nameOffset, (r) => {
      this.names.length = 0;
      for (let i = 0; i < nameCount; i++) {
        this.names.push(r.fstring());
        r.u32(); // flags
      }
    });
    this.table(importOffset, (r) => {
      this.imports.length = 0;
      for (let i = 0; i < importCount; i++) {
        r.index(); // class package
        const className = this.name(r.index());
        const outer = r.i32();
        this.imports.push({ className, outer, name: this.name(r.index()) });
      }
    });
    this.table(exportOffset, (r) => {
      this.objects.length = 0;
      for (let i = 0; i < exportCount; i++) {
        const cls = r.index();
        r.index(); // super
        const outer = r.i32();
        const name = this.name(r.index());
        const flags = r.u32();
        const size = r.index();
        const offset = size > 0 ? r.index() : 0;
        const className = cls === 0 ? 'Class' : (this.refName(cls) ?? '');
        this.objects.push({ index: i, name, className, outer, flags, size, offset });
      }
    });
  }

  /** Reads a package's tables; throws if it is none. No file stays open. */
  static open(file: string): PackageFile {
    const fd = fs.openSync(file, 'r');
    try {
      const pkg = new PackageFile(fd, file);
      pkg.fd = -1;
      return pkg;
    } finally {
      fs.closeSync(fd);
    }
  }

  name(i: number): string {
    return this.names[i] ?? '';
  }

  /** Name of an object reference (> 0 export, < 0 import, 0 none). */
  refName(ref: number): string | undefined {
    if (ref > 0) return this.objects[ref - 1]?.name;
    if (ref < 0) return this.imports[-ref - 1]?.name;
    return undefined;
  }

  /**
   * "Package.Name" of an object reference as UT names it (groups left out): the outermost
   * package of an import, this package's name for an export.
   */
  refPath(ref: number, ownPackage: string): string | undefined {
    if (ref > 0) {
      const o = this.objects[ref - 1];
      return o ? `${ownPackage}.${o.name}` : undefined;
    }
    if (ref < 0) {
      let imp = this.imports[-ref - 1];
      if (!imp) return undefined;
      const name = imp.name;
      for (let guard = 0; imp && imp.outer < 0 && guard < 16; guard++)
        imp = this.imports[-imp.outer - 1];
      return imp && imp !== this.imports[-ref - 1] ? `${imp.name}.${name}` : name;
    }
    return undefined;
  }

  /** The exported objects of a class (case-insensitive), e.g. "Texture". */
  ofClass(className: string): PackageObject[] {
    const c = className.toLowerCase();
    return this.objects.filter((o) => o.className.toLowerCase() === c && o.size > 0);
  }

  /** An object by name and class (case-insensitive; groups ignored, the first match wins). */
  find(name: string, className: string): PackageObject | undefined {
    const n = name.toLowerCase();
    return this.ofClass(className).find((o) => o.name.toLowerCase() === n);
  }

  /**
   * A reader over an object, positioned after its tagged properties (the native data follows),
   * and the properties themselves.
   */
  readObject(o: PackageObject): { r: Reader; props: Map<string, PropertyValue>; end: number } {
    if (o.size <= 0 || o.offset + o.size > this.size) throw new Error(`bad object ${o.name}`);
    const r = new Reader(this.range(o.offset, o.size));
    if (o.flags & RF_HAS_STACK) {
      const node = r.index();
      r.index(); // state node
      r.skip(8); // probe mask
      r.i32(); // latent action
      if (node !== 0) r.index(); // offset
    }
    const props = this.readProperties(r, o.size);
    return { r, props, end: o.size };
  }

  /** Tagged properties up to "None"; arrays keyed `Name[i]`. Structs and strings stay raw. */
  private readProperties(r: Reader, end: number): Map<string, PropertyValue> {
    const props = new Map<string, PropertyValue>();
    while (r.pos < end) {
      const name = this.name(r.index());
      if (name === 'None') break;
      const info = r.u8();
      const type = info & 0x0f;
      const sizeCode = (info >> 4) & 0x07;
      const isArray = (info & 0x80) !== 0;
      if (type === 10) r.index(); // struct name
      let size: number;
      if (sizeCode < 5) size = [1, 2, 4, 12, 16][sizeCode]!;
      else if (sizeCode === 5) size = r.u8();
      else if (sizeCode === 6) size = r.u16();
      else size = r.i32();
      let idx = 0;
      if (isArray && type !== 3) {
        const b = r.u8();
        if ((b & 0x80) === 0) idx = b;
        else if ((b & 0xc0) === 0x80) idx = ((b & 0x7f) << 8) | r.u8();
        else idx = ((b & 0x3f) << 24) | (r.u8() << 16) | (r.u8() << 8) | r.u8();
      }
      const key = idx ? `${name}[${idx}]` : name;
      if (type === 3) {
        props.set(key, isArray); // bool: the value is the array bit, no payload
        continue;
      }
      const start = r.pos;
      if (size < 0 || start + size > end) throw new Error('bad property size');
      let value: PropertyValue;
      if (type === 1) value = r.u8();
      else if (type === 2) value = r.i32();
      else if (type === 4) value = r.f32();
      else if (type === 5)
        value = r.index(); // object reference
      else if (type === 6) value = this.name(r.index());
      else value = r.buf.subarray(start, start + size);
      r.pos = start + size;
      props.set(key, value);
    }
    return props;
  }

  /** Reads a table that starts at `offset`, with a growing window (its length is not stored). */
  private table(offset: number, parse: (r: Reader) => void): void {
    if (offset < 0 || offset >= this.size) throw new Error('bad table offset');
    for (let len = 256 * 1024; ; len *= 4) {
      const n = Math.min(len, this.size - offset);
      try {
        parse(new Reader(this.range(offset, n)));
        return;
      } catch (e) {
        if (!(e instanceof RangeError) || n >= this.size - offset) throw e;
      }
    }
  }

  private range(offset: number, length: number): Buffer {
    if (this.fd < 0) {
      this.fd = fs.openSync(this.path, 'r');
      try {
        return this.range(offset, length);
      } finally {
        fs.closeSync(this.fd);
        this.fd = -1;
      }
    }
    const buf = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const n = fs.readSync(this.fd, buf, done, length - done, offset + done);
      if (n <= 0) break;
      done += n;
    }
    return done === length ? buf : buf.subarray(0, done);
  }
}
