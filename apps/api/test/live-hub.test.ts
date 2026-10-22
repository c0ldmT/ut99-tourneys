import type { KillFeedEntry } from '@tourney/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEED_SIZE, heldBack, LiveHub, type HubMessage } from '../src/tournaments/hub.js';

afterEach(() => vi.useRealTimers());

const entry = (over: Partial<KillFeedEntry> = {}): KillFeedEntry => ({
  tournamentId: 't',
  matchId: 'm1',
  game: 1,
  at: 1,
  killer: 'A',
  killerSide: 'ea',
  victim: 'B',
  victimSide: 'eb',
  weapon: 'Shock Rifle',
  headshot: false,
  firstBlood: false,
  suicide: false,
  teamKill: false,
  monster: false,
  spree: 0,
  multi: 0,
  ...over,
});

describe('LiveHub', () => {
  it('holds back delayed messages and drops them when the live data is cleared', () => {
    vi.useFakeTimers();
    const hub = new LiveHub();
    const got: HubMessage[] = [];
    hub.subscribe('t', (m) => got.push(m));
    const item = entry({ kind: 'item', item: 'amp', humans: true });
    expect(heldBack(item)).toBe(true);
    expect(heldBack(entry({ kind: 'kill', humans: true }))).toBe(false);
    expect(heldBack(entry({ kind: 'item', item: 'amp', humans: false }))).toBe(false);
    hub.publish('t', { type: 'feed', data: item }, 20_000);
    hub.publish('t', { type: 'feed', data: entry() });
    expect(got).toHaveLength(1);
    expect(hub.latestFeed('t')).toHaveLength(1);
    vi.advanceTimersByTime(20_000);
    expect(got).toHaveLength(2);
    hub.publish('t', { type: 'feed', data: item }, 20_000);
    hub.clearLive('t');
    vi.advanceTimersByTime(20_000);
    expect(got).toHaveLength(2);
    expect(hub.latestFeed('t')).toHaveLength(0);
  });

  it('keeps the last entries per run of the game in progress', () => {
    const hub = new LiveHub();
    for (let i = 0; i < FEED_SIZE + 5; i++)
      hub.publish('t', { type: 'feed', data: entry({ at: i, run: 1 }) });
    for (let i = 0; i < 3; i++)
      hub.publish('t', { type: 'feed', data: entry({ at: 100 + i, run: 2 }) });
    const feed = hub.latestFeed('t');
    expect(feed.filter((e) => e.run === 1)).toHaveLength(FEED_SIZE);
    expect(feed.filter((e) => e.run === 1)[0]!.at).toBe(5);
    expect(feed.filter((e) => e.run === 2)).toHaveLength(3);
    // The next game starts over.
    hub.publish('t', { type: 'feed', data: entry({ game: 2 }) });
    expect(hub.latestFeed('t')).toHaveLength(1);
  });
});
