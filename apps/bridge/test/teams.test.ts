import { afterEach, describe, expect, it } from 'vitest';
import { setup, tournamentFile } from './harness.js';

type Env = Awaited<ReturnType<typeof setup>>;
let env: Env | undefined;
afterEach(async () => {
  await env?.close();
  env = undefined;
});

const finished = (e: Env) => () => e.director.projection.phase === 'finished';
const events = (e: Env, type: string) =>
  (e.director as any).events.filter((x: { type: string }) => x.type === type) as any[];

/** 2on2, bracket of 4: Red (Mario, Anna), Blue (Jonas, Lea, Tim as substitute), two bot teams. */
function teamFile(settings: Record<string, unknown> = {}, over: Record<string, unknown> = {}) {
  return tournamentFile(
    {
      teams: [
        { name: 'Red', members: ['mario', 'anna'] },
        { name: 'Blue', members: ['jonas', 'lea', 'tim'], captain: 'lea' },
      ],
      humanOrder: 'seeded',
      ...over,
    },
    { format: 'single', size: 4, teamSize: 2, ...settings },
  );
}

describe('team tournaments against the simulated UT server', () => {
  it('plays a 2on2 tournament: check-in per member, team votes, line-ups with bots', async () => {
    env = await setup({ file: teamFile() });
    await env.run(finished(env));
    const p = env.director.projection;
    expect(p.results).toHaveLength(3);
    expect(p.results.every((r) => r.outcome === 'played')).toBe(true);
    // Check-in ends as soon as both teams have two players here (Tim may arrive later).
    expect(p.checkedInUsers).toEqual(expect.arrayContaining(['anna', 'jonas', 'lea', 'mario']));

    // Line-ups: Blue's substitute Tim stays on the bench, bot teams play with two bots.
    const started = events(env, 'match.started');
    expect(started).toHaveLength(3);
    for (const e of started) {
      for (const [id, lineup] of Object.entries(e.data.lineups) as [string, any[]][]) {
        expect(lineup, id).toHaveLength(2);
        if (id === 't1') expect(lineup.map((x) => x.name)).toEqual(['Mario', 'Anna']);
        if (id === 't2') expect(lineup.map((x) => x.name)).toEqual(['Jonas', 'Lea']);
        if (id.startsWith('botteam')) expect(lineup.every((x) => x.bot)).toBe(true);
      }
    }
    // Every player of a team voted; the vote counted one ballot per team.
    const firstVote = events(env, 'match.mapSelected')[0];
    expect(firstVote.data.details.ballots).toHaveLength(2);
    expect(firstVote.data.details.players.length).toBeGreaterThanOrEqual(2);
    // Tim was a spectator once the line-up was fixed (acl right before a travel).
    const travelAt = env.sim.received.findIndex((m) => m.t === 'travel');
    const aclBefore = env.sim.received
      .slice(0, travelAt)
      .filter((m) => m.t === 'acle' && m.tk === 'tim-token')
      .at(-1);
    expect(aclBefore).toMatchObject({ r: 's' });
    // The mod knows the team size and gets the bots with the countdown.
    expect(env.sim.received.find((m) => m.t === 'match')).toMatchObject({ ts: 2, ff: 0 });
    expect(env.sim.received.filter((m) => m.t === 'bot').length).toBeGreaterThanOrEqual(4);
    expect(env.log.lines.filter((l) => /^(warn|error):/.test(l))).toEqual([]);
  });

  it('replaces a team nobody checked in for with bots', async () => {
    env = await setup({
      file: teamFile(),
      behaviour: { absent: ['jonas-token', 'lea-token', 'tim-token'] },
    });
    await env.run(() => env!.director.projection.phase === 'running');
    const replaced = events(env, 'entrant.replaced');
    expect(replaced).toHaveLength(1);
    expect(replaced[0].data.entrantId).toBe('t2');
    expect(replaced[0].data.replacement).toMatchObject({
      kind: 'team',
      displayName: 'Blue',
      members: [],
    });
    expect(replaced[0].data.replacement.bots).toHaveLength(2);
  });

  it('lets the captain start with a bot for a missing player', async () => {
    env = await setup({
      file: teamFile({ noShowSec: 600 }),
      behaviour: { absent: ['anna-token'], captains: ['mario-token'], captainStartAfterMs: 61_000 },
    });
    await env.run(() => events(env!, 'match.started').some((e) => 't1' in e.data.lineups));
    const red = events(env, 'match.started').find((e) => 't1' in e.data.lineups);
    expect(red.data.lineups.t1.map((x: any) => [x.name, !!x.bot])).toEqual([
      ['Mario', false],
      [expect.any(String), true],
    ]);
    expect(env.log.lines.some((l) => l.includes('Mario starts for Red'))).toBe(true);
  });

  it('sends a stand-in bot for a dropped player and removes it when they return', async () => {
    env = await setup({
      file: teamFile(),
      behaviour: {
        gameDurationMs: 120_000,
        dropDuringLive: { token: 'mario-token', returnAfterMs: 40_000 },
      },
    });
    await env.run(() => env!.sim.botsRemoved.length > 0);
    expect(env.sim.botsAdded).toHaveLength(1);
    expect(env.sim.botsRemoved).toEqual(env.sim.botsAdded);
    // The game was never paused and never replayed.
    expect(env.sim.received.some((m) => m.t === 'pause' && m.on)).toBe(false);
    await env.run(finished(env));
    expect(env.sim.travels).toHaveLength(3);
  });

  it('takes a player out of the match after too many disconnects', async () => {
    env = await setup({
      file: teamFile({ maxReconnects: 0 }),
      behaviour: {
        gameDurationMs: 120_000,
        dropDuringLive: { token: 'mario-token', returnAfterMs: 5_000 },
      },
    });
    await env.run(() => env!.sim.botsAdded.length > 0);
    const out = env.sim.received.filter((m) => m.t === 'acladd' && m.tk === 'mario-token');
    expect(out.at(-1)).toMatchObject({ r: 's' });
    await env.run(finished(env));
    expect(env.sim.botsRemoved).toEqual([]);
  });

  it('applies a line-up change from the website without disturbing the running game', async () => {
    env = await setup({ file: teamFile(), behaviour: { gameDurationMs: 60_000 } });
    await env.run(() => env!.director.stageKind === 'live');
    // The website appends the change; the bridge's next own event has to go on top of it.
    const head = env.director.projection.headSeq;
    const res = await env.store.append('test-cup', head, [
      {
        type: 'team.lineupSet',
        actor: { kind: 'player', id: 'lea' },
        data: { entrantId: 't2', starters: ['tim', 'lea'] },
      },
    ]);
    expect(res.accepted).toBe(true);
    await env.run(finished(env));
    expect(env.sim.travels).toHaveLength(3);
    expect(env.log.lines.some((l) => l.includes('re-planning'))).toBe(false);
    // Blue's next game (if it had one) uses the new line-up.
    const t2 = env.director.projection.entrants['t2'] as any;
    expect(t2.members.filter((m: any) => !m.sub).map((m: any) => m.userId)).toEqual(['tim', 'lea']);
  });
});
