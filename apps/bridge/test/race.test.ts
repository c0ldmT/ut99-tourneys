import { finalMs, raceWinner } from '@tourney/adapter-ut99';
import { createRng } from '@tourney/bracket';
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

const MH_MAPS = ['MH-NaliVillage', 'MH-Lavafort', 'MH-Egypt', 'MH-Revenge'];

/** Monster Hunt 2on2, bracket of 4: Red (Mario, Anna), Blue (Jonas, Lea, Tim), two bot teams. */
function raceFile(settings: Record<string, unknown> = {}) {
  return tournamentFile(
    {
      teams: [
        { name: 'Red', members: ['mario', 'anna'] },
        { name: 'Blue', members: ['jonas', 'lea', 'tim'], captain: 'lea' },
      ],
      humanOrder: 'seeded',
    },
    {
      format: 'single',
      size: 4,
      teamSize: 2,
      adapter: 'ut99-mh',
      ...settings,
      rules: {
        mapPool: MH_MAPS,
        timeLimitMin: 20,
        fragLimit: 0,
        penaltySec: 5,
        ...((settings['rules'] as object) ?? {}),
      },
    },
  );
}

describe('Monster Hunt time race against the simulated UT server', () => {
  it('plays every game as two runs on the same map, the lower time plus penalty wins', async () => {
    env = await setup({
      file: raceFile(),
      behaviour: {
        // Match 1: 5:00 + 2 deaths = 5:10 beats 4:50 + 5 deaths = 5:15.
        runs: [
          { ms: 300_000, deaths: 2 },
          { ms: 290_000, deaths: 5 },
        ],
      },
    });
    await env.run(finished(env));
    const p = env.director.projection;
    expect(p.results).toHaveLength(3);
    expect(p.results.every((r) => r.outcome === 'played')).toBe(true);

    const runs = events(env, 'match.runFinished');
    expect(runs).toHaveLength(6);
    const games = events(env, 'match.gameFinished');
    expect(games.every((g) => g.data.endReason === 'race')).toBe(true);
    // Both runs of a game on the same map, in the drawn order; the faster team won.
    const order = events(env, 'match.mapSelected')[0].data.runOrder;
    expect(runs[0].data.entrantId).toBe(order[0]);
    expect(runs[1].data.entrantId).toBe(order[1]);
    expect(runs[0].data).toMatchObject({ timeMs: 300_000, deaths: 2, penaltyMs: 10_000 });
    expect(games[0].data.winnerId).toBe(order[0]);
    expect(games[0].data.scores).toEqual({ [order[0]]: 310_000, [order[1]]: 315_000 });
    expect(p.games[games[0].data.matchId]?.[0]?.runs).toHaveLength(2);
    // Two travels to the same map per game.
    expect(env.sim.travels).toHaveLength(6);
    expect(env.sim.travels[0]).toBe(env.sim.travels[1]);
    // The in-game bracket shows games won, not run times in ms.
    const brm = env.sim.received.filter((m) => m.t === 'brm') as any[];
    expect(brm.some((m) => m.sa === 1 || m.sb === 1)).toBe(true);
    expect(brm.every((m) => m.sa <= 1 && m.sb <= 1)).toBe(true);
    expect(env.log.lines.filter((l) => /^(warn|error):/.test(l))).toEqual([]);
  });

  it('lets only the running team play; the other team watches and sees the time to beat', async () => {
    env = await setup({ file: raceFile() });
    await env.run(() => events(env!, 'match.runFinished').length >= 1);
    await env.run(() => env!.director.stageKind === 'live');
    const started = events(env, 'match.started');
    const [first, second] = started.slice(0, 2).map((e) => e.data);
    expect(first.runner).not.toBe(second.runner);
    expect(Object.keys(first.lineups)).toEqual([first.runner]);
    expect(first.lineups[first.runner]).toHaveLength(2);

    // Before each travel the access list makes the watching team spectators.
    const travels = env.sim.received.flatMap((m, i) => (m.t === 'travel' ? [i] : []));
    const rolesBefore = (end: number) => {
      const out: Record<string, string> = {};
      for (const m of env!.sim.received.slice(0, end)) if (m.t === 'acle') out[m.tk] = m.r;
      return out;
    };
    const cm = env.director.projection.currentMatch!;
    const humanTeam = cm.entrants.find((e) => e === 't1' || e === 't2')!;
    const tokens =
      humanTeam === 't1' ? ['mario-token', 'anna-token'] : ['jonas-token', 'lea-token'];
    const humansRunFirst = first.runner === humanTeam;
    const r1 = rolesBefore(travels[0]!);
    const r2 = rolesBefore(travels[1]!);
    for (const tk of tokens) {
      expect(r1[tk] === 's').toBe(!humansRunFirst);
      expect(r2[tk] === 's').toBe(humansRunFirst);
    }
    // The race line: run 2 knows the result of run 1.
    const raceLines = env.sim.received.filter((m) => m.t === 'race') as any[];
    const run2 = raceLines.find((l) => l.n === 2);
    expect(run2).toMatchObject({ pen: 5, pf: true, lv: 0, mk: 5, ws: true, hc: true });
    expect(run2.pt).toBe(finalMs(events(env, 'match.runFinished')[0].data));
  });

  it('a team at the exit beats a team that ran out of time', async () => {
    env = await setup({
      file: raceFile(),
      behaviour: {
        runs: [
          { ms: 1_200_000, deaths: 0, done: false, pts: 300 },
          { ms: 1_100_000, deaths: 20 },
        ],
      },
    });
    await env.run(() => events(env!, 'match.gameFinished').length >= 1);
    const order = events(env, 'match.mapSelected')[0].data.runOrder;
    expect(events(env, 'match.gameFinished')[0].data.winnerId).toBe(order[1]);
    expect(env.log.lines.some((l) => l.includes('did not reach the exit'))).toBe(true);
  });

  it('alternates who runs first in a best-of-3', async () => {
    env = await setup({
      file: raceFile({ bestOf: { default: 3 } }),
      behaviour: { gameDurationMs: 5_000 },
    });
    await env.run(() => events(env!, 'match.result').length >= 1);
    const selected = events(env, 'match.mapSelected').filter(
      (e) => e.data.matchId === events(env!, 'match.result')[0].data.result.matchId,
    );
    expect(selected.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < selected.length; i++) {
      expect(selected[i].data.runOrder[0]).toBe(selected[i - 1].data.runOrder[1]);
    }
  });

  it('replays only the interrupted run after a bridge restart', async () => {
    env = await setup({ file: raceFile(), behaviour: { gameDurationMs: 60_000 } });
    await env.run(
      () => events(env!, 'match.runFinished').length === 1 && env!.director.stageKind === 'live',
    );
    await env.restartDirector();
    await env.run(() => events(env!, 'match.gameFinished').length >= 1);
    const runs = events(env, 'match.runFinished');
    expect(runs[0].data.entrantId).not.toBe(runs[1].data.entrantId);
    expect(runs.slice(0, 2).every((r) => r.data.game === 1)).toBe(true);
  });

  it('lets the organizer end a stuck run: it counts as not finished, the other team runs', async () => {
    env = await setup({ file: raceFile(), behaviour: { gameDurationMs: 60_000 } });
    await env.run(() => env!.director.stageKind === 'live');
    env.clock.advance(10_000);
    await env.settle();
    const cm = env.director.projection.currentMatch!;
    await env.director.forfeitRun(cm.matchId);
    await env.settle();
    const run = events(env, 'match.runFinished')[0];
    expect(run.data).toMatchObject({ finished: false, forfeit: true, entrantId: cm.runOrder![0] });
    expect(env.sim.received.some((m) => m.t === 'abort' && m.why === 'runforfeit')).toBe(true);
    await env.run(() => events(env!, 'match.gameFinished').length >= 1);
    // The second team reached the exit: a finished run beats an ended one.
    expect(events(env, 'match.gameFinished')[0].data.winnerId).toBe(cm.runOrder![1]);
    await expect(env.director.forfeitRun('nope')).rejects.toThrow('no run');
  });

  it('simulates bot-only races', async () => {
    env = await setup({
      file: raceFile({ botMatchMode: 'simulate', size: 8 }),
      behaviour: { gameDurationMs: 5_000 },
    });
    await env.run(finished(env));
    const sim = env.director.projection.results.filter((r) => r.outcome === 'simulated');
    expect(sim.length).toBeGreaterThan(0);
    for (const r of sim) {
      const [a, b] = r.entrants;
      const g = r.games![0]!;
      expect(g.scores[a!]).toBeGreaterThan(0);
      expect(g.scores[b!]).toBeGreaterThan(0);
    }
  });

  it('decides like raceWinner', () => {
    const run = { timeMs: 1000, deaths: 0, penaltyMs: 0, points: 0, finished: true };
    expect(
      raceWinner(
        { ...run, entrantId: 'a' },
        { ...run, entrantId: 'b', timeMs: 2000 },
        createRng(1),
      ),
    ).toMatchObject({ winnerId: 'a' });
  });
});
