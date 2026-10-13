import { describe, expect, it } from 'vitest';
import { isLocalAddress, joinUrl, linuxStartCommand, shellQuote } from '../src/app/core/connect';

describe('connect helpers', () => {
  it('builds the join URL', () => {
    expect(joinUrl('192.168.0.105:7777', 'k7m2qx9p3a')).toBe('192.168.0.105:7777?tk=k7m2qx9p3a');
  });

  it('recognises addresses only the server PC can reach', () => {
    for (const a of [
      '127.0.0.1',
      '127.0.0.1:7777',
      'localhost:7777',
      'LOCALHOST',
      '0.0.0.0:7777',
      '[::1]:7777',
      ':7777',
    ])
      expect(isLocalAddress(a)).toBe(true);
    for (const a of ['192.168.0.105:7777', 'ut.example.com:7777', '10.0.0.2', null, undefined, ''])
      expect(isLocalAddress(a)).toBe(false);
  });

  it('quotes for the shell', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  it('builds the Linux start command', () => {
    expect(
      linuxStartCommand(
        '/home/ramamara/Games/UT99-native/System/',
        '192.168.0.105:7777',
        'k7m2qx9p3a',
      ),
    ).toBe(
      "cd '/home/ramamara/Games/UT99-native/System' && ./ut-bin '192.168.0.105:7777?tk=k7m2qx9p3a'",
    );
    expect(linuxStartCommand('~/Games/UT 99/System', 'a:7777', 't')).toBe(
      "cd ~/'Games/UT 99/System' && ./ut-bin 'a:7777?tk=t'",
    );
    expect(linuxStartCommand('  ', 'a:7777', 't')).toBe("./ut-bin 'a:7777?tk=t'");
  });
});
