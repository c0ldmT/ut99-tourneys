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
  wireText,
  BOT_REF_CHARS,
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
    // Mod 0.12.0: a bot's chat line for the kill feed.
    expect(
      decodeModToBridge('{"t":"bs","mid":"W1-1","g":2,"n":"[NX]Mira","sd":1,"x":"Gotcha, Tim!"}'),
    ).toEqual({ t: 'bs', mid: 'W1-1', g: 2, n: '[NX]Mira', sd: 1, x: 'Gotcha, Tim!' });
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

  it('worst-case statistics lines fit the line limit', () => {
    const mid = 'X'.repeat(16);
    const lines = [
      encodeModLine({
        t: 'ps',
        mid,
        g: 99,
        n: 2,
        i: 63,
        tk: 'A'.repeat(24),
        bn: wireName('\u00e4'.repeat(40)),
        s: 'b',
        k: 9999,
        d: 9999,
        su: 9999,
        tm: 9999,
        sec: 99999,
      }),
      encodeModLine({
        t: 'px',
        mid,
        g: 99,
        n: 2,
        i: 63,
        hs: 9999,
        fb: false,
        bs: 9999,
        sp: 9999,
        m2: 9999,
        m3: 9999,
        m4: 9999,
        m5: 9999,
        mk: 99999,
        mp: -999999,
      }),
      encodeModLine({ t: 'pw', mid, g: 99, n: 2, i: 63, w: 'W'.repeat(32), c: 9999 }),
      encodeModLine({ t: 'pse', mid, g: 99, n: 2, c: 64, sec: 99999 }),
    ];
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(MAX_LINE_BYTES);
      expect(decodeModToBridge(line).t).toMatch(/^p/);
    }
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

  it('fits the website bot lines into one wire line each', () => {
    const name = wireName('\u00e4'.repeat(40));
    const ref = 'x'.repeat(BOT_REF_CHARS);
    const lines = [
      { t: 'bcfg', name, skn: ref, fac: ref, vc: ref },
      { t: 'btr', name, fw: ref, acc: -100, alt: -100, cs: -100, cmp: 100, str: -100, jmp: true },
      { t: 'bpers', name, tk: 100 },
      { t: 'bsay', name, k: 'rdeath', x: wireText('\u00e4'.repeat(200), 120) },
      { t: 'brv', name, r: name, lv: 2 },
    ] as const;
    for (const l of lines) {
      const wire = encodeModLine(l as never);
      expect(wire.length).toBeLessThanOrEqual(MAX_LINE_BYTES);
      expect(decodeBridgeToMod(wire)).toEqual(l);
    }
    expect(wireText('abc\u00e4def', 6)).toBe('abc');
  });
});
