import { describe, expect, it } from 'vitest';
import {
  BridgeToModSchema,
  decodeBridgeToMod,
  decodeModToBridge,
  encodeModLine,
  LineSplitter,
  MAX_LINE_BYTES,
  ModLineError,
  splitText,
  wireName,
  type BridgeToMod,
} from '../src/index.js';

describe('mod line protocol', () => {
  it('round-trips a message', () => {
    const msg: BridgeToMod = { t: 'phase', p: 'ready', mid: 'W1-1', sec: 180 };
    const line = encodeModLine(msg);
    expect(line.endsWith('\n')).toBe(true);
    expect(decodeBridgeToMod(line)).toEqual(msg);
  });

  it('escapes non-ASCII so the wire is pure ASCII', () => {
    const line = encodeModLine({ t: 'say', pid: -1, msg: 'Grüße an Jörg' });
    expect(/^[\x20-\x7e]*\n$/.test(line)).toBe(true);
    expect(decodeBridgeToMod(line)).toMatchObject({ msg: 'Grüße an Jörg' });
  });

  it('rejects nested values and floats', () => {
    expect(() => encodeModLine({ t: 'cd', sec: 1.5 } as never)).toThrow(ModLineError);
    expect(() => decodeModToBridge('{"t":"hb","up":{"x":1}}')).toThrow(ModLineError);
    expect(() => decodeModToBridge('[1,2]')).toThrow(ModLineError);
    expect(() => decodeModToBridge('nope')).toThrow(ModLineError);
  });

  it('rejects lines over the limit', () => {
    expect(() => encodeModLine({ t: 'err', msg: 'x'.repeat(250) } as never)).toThrow(/max is/);
  });

  it('validates message shapes', () => {
    expect(() => decodeModToBridge('{"t":"ready"}')).toThrow(/invalid message/);
    expect(decodeModToBridge('{"t":"ready","pid":3}\r\n')).toEqual({ t: 'ready', pid: 3 });
  });

  it('a bracket line with two worst-case names still fits', () => {
    const name = wireName('Ünïcödé'.repeat(10));
    const line = encodeModLine({
      t: 'brm',
      id: 'GF2',
      s: 'GF',
      r: 2,
      i: 1,
      na: name,
      nb: name,
      sa: 999,
      sb: 999,
      st: 'c',
      w: 'a',
    });
    expect(line.length).toBeLessThanOrEqual(MAX_LINE_BYTES);
  });

  it('wireName respects char and byte budgets and drops emoji', () => {
    expect(wireName('a'.repeat(50))).toHaveLength(32);
    expect(wireName('ä'.repeat(20))).toHaveLength(8); // 8 * 6 bytes = 48
    expect(wireName('Pro🎮Gamer')).toBe('ProGamer');
  });

  it('every bridge message type has a schema entry', () => {
    const types = BridgeToModSchema.options.map((o) => o.shape.t.value);
    expect(new Set(types).size).toBe(types.length);
  });

  it('splits text into say-sized chunks', () => {
    const chunks = splitText('word '.repeat(100), 40);
    expect(chunks.every((c) => c.length <= 40)).toBe(true);
    expect(chunks.join(' ')).toBe('word '.repeat(100).trim());
    expect(splitText('x'.repeat(90), 40)).toEqual(['x'.repeat(40), 'x'.repeat(40), 'x'.repeat(10)]);
  });

  it('line splitter buffers partial lines', () => {
    const s = new LineSplitter();
    expect(s.push('{"t":"hb"')).toEqual([]);
    expect(s.push(',"up":1}\r\n{"t":"hb","up":2}\n{"t"')).toEqual([
      '{"t":"hb","up":1}',
      '{"t":"hb","up":2}',
    ]);
    expect(() => s.push('x'.repeat(MAX_LINE_BYTES * 5))).toThrow(ModLineError);
  });
});
