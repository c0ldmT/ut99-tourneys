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

/** Appends an organizer's result like the website does, then lets the bridge pick it up. */
async function override(e: Env, matchId: string, entrants: [string, string], winnerId: string) {
  const res = await e.store.append('test-cup', e.director.projection.headSeq, [
    {
      type: 'match.result',
      actor: { kind: 'admin', id: 'boss' },
      data: { result: { matchId, entrants, winnerId, outcome: 'override' } },
    },
  ]);
  expect(res.accepted).toBe(true);
  await e.director.refresh();
  await e.settle();
}

const single = () => tournamentFile({}, { format: 'single', size: 8 });

describe('organizer tools', () => {
  it('restarts the current game on the same map without counting it', async () => {
    env = await setup({ file: single(), behaviour: { gameDurationMs: 60_000 } });
    await env.run(() => env!.director.stageKind === 'live');
    const cm = env.director.projection.currentMatch!;
    const travels = env.sim.travels.length;
    await env.director.restartGame(cm.matchId);
    await env.settle();
    expect(env.sim.received.at(-1)?.t).toBe('travel');
    expect(env.sim.received.some((m) => m.t === 'abort' && m.why === 'restart')).toBe(true);
    expect(env.sim.travels.slice(travels)).toEqual([cm.map]);
    await env.run(() => events(env!, 'match.result').length >= 1);
    expect(env.director.projection.games[cm.matchId]).toHaveLength(1);
    await expect(env.director.restartGame('nope')).rejects.toThrow('not running');
    await expect(env.director.forfeitRun(cm.matchId)).rejects.toThrow('not a Monster Hunt');
    await env.run(finished(env));
  });

  it('ends the current match on the server when the organizer sets its winner', async () => {
    env = await setup({ file: single(), behaviour: { gameDurationMs: 60_000 } });
    await env.run(() => env!.director.stageKind === 'live');
    const cm = env.director.projection.currentMatch!;
    await override(env, cm.matchId, cm.entrants, cm.entrants[1]);
    expect(env.sim.received.find((m) => m.t === 'abort')).toMatchObject({ why: 'admin', w: 'b' });
    expect(env.log.lines.some((l) => l.includes(`The organizer decided ${cm.matchId}`))).toBe(true);
    await env.run(finished(env));
    const p = env.director.projection;
    expect(p.bracket?.byId[cm.matchId]?.winnerId).toBe(cm.entrants[1]);
    expect(events(env, 'match.called').filter((e) => e.data.matchId === cm.matchId)).toHaveLength(
      1,
    );
  });

  it('calls off and replays a match whose pairing an earlier correction changed', async () => {
    env = await setup({ file: single(), behaviour: { gameDurationMs: 30_000 } });
    const inRound2 = () => env!.director.projection.currentMatch?.matchId.startsWith('W2-');
    await env.run(() => !!inRound2() && env!.director.stageKind === 'live');
    const cm = env.director.projection.currentMatch!;
    const p = env.director.projection;
    // The round 1 match that sent the first entrant of this match: give it to the other player.
    const feeder = p.bracket!.matches.find(
      (m) => m.round === 1 && m.status === 'completed' && m.winnerId === cm.entrants[0],
    )!;
    const loser = feeder.entrants.find((x) => x !== feeder.winnerId)!;
    await override(env, feeder.id, feeder.entrants as [string, string], loser);
    expect(env.sim.received.find((m) => m.t === 'abort')).toMatchObject({ why: 'void' });
    await env.run(finished(env));
    const calls = events(env, 'match.called').filter((e) => e.data.matchId === cm.matchId);
    expect(calls).toHaveLength(2);
    expect(calls[1].data.entrants).toContain(loser);
    expect(env.director.projection.bracket?.status).toBe('finished');
  });
});
