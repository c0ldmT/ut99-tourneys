import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { NOTES_PER_DAY, SURVEY_QUESTIONS } from '../src/feedback/survey.js';
import { Client, startApi, startSeason } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

describe('feedback: season survey and notes (decision 245)', () => {
  it('asks the managers of the season once, keeps one answer each and exports without names', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    const tim = await Client.login(api, 'Tim');
    const guest = new Client(api);
    await admin.req('PUT', '/settings/udt', { enabled: true });
    expect((await admin.req('PUT', '/feedback/survey', { open: true })).status).toBe(409);
    await startSeason(admin);
    await mario.post('/udt/team', {
      name: 'Nexus',
      tag: '[NX]',
      starter: { name: 'Mira', skill: 3 },
    });

    // Closed: nothing waits, answering is refused.
    expect((await mario.get('/me')).body.survey).toBeNull();
    expect((await mario.post('/feedback/survey', { answers: { fun: 4 } })).body).toMatchObject({
      key: 'the survey is closed',
    });
    expect((await mario.req('PUT', '/feedback/survey', { open: true })).status).toBe(403);
    expect((await guest.get('/feedback/survey')).status).toBe(401);

    const opened = await admin.req('PUT', '/feedback/survey', { open: true });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    expect(opened.body).toMatchObject({ season: 1, open: true, answers: 0, managers: 1 });
    // Mario (a manager of season 1) gets it, Tim (no team) does not.
    expect((await mario.get('/me')).body.survey).toEqual({ season: 1 });
    expect((await tim.get('/me')).body.survey).toBeNull();
    const view = (await mario.get('/feedback/survey')).body;
    expect(view).toMatchObject({ season: 1, open: true, eligible: true, answer: null });
    expect(view.questions.map((q: { id: string }) => q.id)).toEqual(
      SURVEY_QUESTIONS.map((q) => q.id),
    );
    expect((await tim.post('/feedback/survey', { answers: { fun: 4 } })).body).toMatchObject({
      key: 'only managers of season {season} take part in its survey',
      params: { season: 1 },
    });
    // Out of range, empty.
    expect((await mario.post('/feedback/survey', { answers: { fun: 6 } })).body.key).toBe(
      'an answer is out of range',
    );
    expect((await mario.post('/feedback/survey', { answers: { money: 'lots' } })).status).toBe(400);
    expect(
      (await mario.post('/feedback/survey', { answers: {}, texts: { best: '  ' } })).body.key,
    ).toBe('answer at least one question');

    const ok = await mario.post('/feedback/survey', {
      answers: { fun: 4, money: 'hard', unknown: 3 },
      texts: { best: 'The league evenings', worst: 'Salaries' },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.answer).toMatchObject({
      answers: { fun: 4, money: 'hard' },
      texts: { best: 'The league evenings', worst: 'Salaries' },
    });
    expect((await mario.get('/me')).body.survey).toBeNull();
    // Changed while open: still one answer.
    await mario.post('/feedback/survey', { answers: { fun: 5 }, texts: {} });
    expect((await admin.get('/feedback/admin')).body).toMatchObject({ answers: 1, managers: 1 });

    // Notes from anybody logged in, at most NOTES_PER_DAY a day.
    expect(
      (await tim.post('/feedback/notes', { area: 'website', text: 'Dark mode please' })).status,
    ).toBe(201);
    expect((await tim.post('/feedback/notes', { area: 'nope', text: 'Hello' })).status).toBe(400);
    expect((await guest.post('/feedback/notes', { area: 'other', text: 'Hello' })).status).toBe(
      401,
    );
    for (let i = 1; i < NOTES_PER_DAY; i++)
      expect((await tim.post('/feedback/notes', { area: 'other', text: `Note ${i}` })).status).toBe(
        201,
      );
    expect(
      (await tim.post('/feedback/notes', { area: 'other', text: 'One more' })).body,
    ).toMatchObject({
      key: 'at most {n} feedback notes a day',
    });

    const exp = (await admin.get('/feedback/export')).body;
    expect(exp.season).toBe(1);
    expect(exp.survey).toEqual([
      expect.objectContaining({ manager: 1, answers: { fun: 5 }, texts: {} }),
    ]);
    expect(exp.notes).toHaveLength(NOTES_PER_DAY);
    expect(exp.notes[0]).toMatchObject({
      manager: 2,
      season: 1,
      area: 'website',
      text: 'Dark mode please',
    });
    expect(JSON.stringify(exp)).not.toMatch(/Mario|Tim|userId/);
    expect((await mario.get('/feedback/export')).status).toBe(403);

    // Closed again: nothing waits, answers stay.
    expect((await admin.req('PUT', '/feedback/survey', { open: false })).body).toMatchObject({
      open: false,
      answers: 1,
    });
    expect((await mario.post('/feedback/survey', { answers: { fun: 2 } })).status).toBe(409);
  });
});
