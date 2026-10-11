/**
 * Best-effort reader for Unreal Engine 1 package files (.unr): finds the LevelInfo object and
 * reads its Title, Author and IdealPlayerCount properties. Returns {} on anything unexpected;
 * callers fall back to the file name.
 *
 * Format (UT99, package version 6x): header, name table, import table, export table; objects are
 * serialized as an optional state frame followed by tagged properties.
 */

const PACKAGE_TAG = 0x9e2a83c1;
const RF_HAS_STACK = 0x02000000;

export interface LevelMeta {
  title?: string;
  author?: string;
  idealPlayerCount?: string;
}

class Reader {
  constructor(
    private readonly buf: Buffer,
    public pos = 0,
  ) {}

  u8(): number {
    if (this.pos >= this.buf.length) throw new RangeError('eof');
    return this.buf[this.pos++] as number;
  }
  u16(): number {
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  i32(): number {
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  u32(): number {
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  skip(n: number): void {
    this.pos += n;
    if (this.pos > this.buf.length) throw new RangeError('eof');
  }
  /** FCompactIndex: sign + 6 bits, then 7 bits per byte. */
  index(): number {
    const b0 = this.u8();
    let value = b0 & 0x3f;
    if (b0 & 0x40) {
      let shift = 6;
      for (let i = 0; i < 4; i++) {
        const b = this.u8();
        value |= (b & 0x7f) << shift;
        shift += 7;
        if (!(b & 0x80)) break;
      }
    }
    return b0 & 0x80 ? -value : value;
  }
  latin1(n: number): string {
    const s = this.buf.toString('latin1', this.pos, this.pos + n);
    this.skip(n);
    return s;
  }
  /** Length-prefixed, zero-terminated latin1 string. */
  fstring(): string {
    const len = this.index();
    if (len <= 0) return '';
    const s = this.buf.toString('latin1', this.pos, this.pos + len);
    this.skip(len);
    return s.replace(/\0+$/, '');
  }
}

export function readLevelMeta(buf: Buffer): LevelMeta {
  try {
    return parse(buf);
  } catch {
    return {};
  }
}

function parse(buf: Buffer): LevelMeta {
  const r = new Reader(buf);
  if (r.u32() !== PACKAGE_TAG) return {};
  const version = r.u16();
  r.u16(); // licensee
  r.u32(); // package flags
  const nameCount = r.i32();
  const nameOffset = r.i32();
  const exportCount = r.i32();
  const exportOffset = r.i32();
  const importCount = r.i32();
  const importOffset = r.i32();
  if (version < 60 || nameCount <= 0 || nameCount > 100_000) return {};

  r.pos = nameOffset;
  const names: string[] = [];
  for (let i = 0; i < nameCount; i++) {
    names.push(r.fstring());
    r.u32(); // flags
  }

  r.pos = importOffset;
  const importNames: string[] = [];
  for (let i = 0; i < importCount; i++) {
    r.index(); // class package
    r.index(); // class name
    r.i32(); // package
    importNames.push(names[r.index()] ?? '');
  }

  r.pos = exportOffset;
  for (let i = 0; i < exportCount; i++) {
    const classIdx = r.index();
    r.index(); // super
    r.i32(); // package
    r.index(); // object name
    const flags = r.u32();
    const size = r.index();
    const offset = size > 0 ? r.index() : 0;
    const className = classIdx < 0 ? importNames[-classIdx - 1] : undefined;
    if (className === 'LevelInfo' && size > 0) {
      return readProperties(
        new Reader(buf, offset),
        names,
        (flags & RF_HAS_STACK) !== 0,
        offset + size,
      );
    }
  }
  return {};
}

const WANTED: Record<string, keyof LevelMeta> = {
  title: 'title',
  author: 'author',
  idealplayercount: 'idealPlayerCount',
};

function readFixedString(r: Reader, size: number): string {
  return r.latin1(size).replace(/\0.*$/s, '');
}

function readProperties(r: Reader, names: string[], hasStack: boolean, end: number): LevelMeta {
  if (hasStack) {
    const node = r.index();
    r.index(); // state node
    r.skip(8); // probe mask
    r.i32(); // latent action
    if (node !== 0) r.index(); // offset
  }
  const meta: LevelMeta = {};
  while (r.pos < end) {
    const name = names[r.index()] ?? '';
    if (name === 'None') break;
    const info = r.u8();
    const type = info & 0x0f;
    const sizeCode = (info >> 4) & 0x07;
    const isArray = (info & 0x80) !== 0;
    if (type === 10) r.index(); // struct name
    let size: number;
    switch (sizeCode) {
      case 0:
        size = 1;
        break;
      case 1:
        size = 2;
        break;
      case 2:
        size = 4;
        break;
      case 3:
        size = 12;
        break;
      case 4:
        size = 16;
        break;
      case 5:
        size = r.u8();
        break;
      case 6:
        size = r.u16();
        break;
      default:
        size = r.i32();
    }
    if (isArray && type !== 3) {
      const b = r.u8();
      if (b & 0x80) r.skip(b & 0x40 ? 3 : 1);
    }
    if (type === 3) continue; // bool: value lives in the array bit, no payload
    const start = r.pos;
    const key = WANTED[name.toLowerCase()];
    if (key && (type === 13 || type === 7)) {
      // 13 = StrProperty (length-prefixed); 7 = old fixed StringProperty (zero-terminated)
      const value = (type === 13 ? r.fstring() : readFixedString(r, size)).trim();
      if (value) meta[key] = value;
    }
    r.pos = start + size;
  }
  return meta;
}
