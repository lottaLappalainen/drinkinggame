// Phase 4A "done when": scripted phones play a whole game against the real Worker + Durable Object
// (inside workerd) — create, join, 15 rounds, a phone reconnecting after Ready, Finish. The game
// clock is moved forward instead of waiting for intros and reveals.
import { describe, expect, it } from 'vitest';
import { Phone, createGame, setClock, storedState, tokenFor } from './phone';

describe('a whole game over real sockets', () => {
  it('three phones play 15 questions from the lobby to Game Over', async () => {
    const game = await createGame();
    const host = await Phone.hello(game.key, game.token);
    await host.next('welcome');
    const ainoToken = tokenFor(`aino-${game.key}`);
    let aino = await Phone.hello(game.key, ainoToken, 'Aino');
    await aino.next('welcome');
    const ville = await Phone.hello(game.key, tokenFor(`ville-${game.key}`), 'Ville');
    await ville.next('welcome');

    host.send({
      type: 'setSettings',
      settings: { gameLength: 15, categories: ['spicy'], mode: 'spotlight' },
    });
    await aino.next('settingsChanged');
    host.send({ type: 'start' });

    for (let n = 1; n <= 15; n++) {
      for (const phone of [host, aino, ville]) {
        const { round } = await phone.next('roundStarted');
        expect(round.number).toBe(n);
      }
      const round = (await storedState(game.key))?.round;
      if (!round) throw new Error(`no round ${String(n)}`);
      await setClock(game.key, round.answerStartsAt);
      const submit = (phone: Phone) => {
        phone.send({ type: 'submit', roundId: round.roundId, ranking: round.candidates });
      };

      if (n === 2) {
        // Aino taps Ready, then her phone reconnects: she lands on the waiting screen (G-38).
        submit(aino);
        await host.next('playerReady');
        aino = await Phone.hello(game.key, ainoToken);
        const welcome = await aino.next('welcome');
        expect(welcome.snapshot).toMatchObject({ phase: 'QUESTION', you: { submitted: true } });
        submit(host);
        submit(ville);
      } else {
        for (const phone of [host, aino, ville]) submit(phone);
      }
      for (const phone of [host, aino, ville]) {
        const { results } = await phone.next('roundResults');
        expect(results).toMatchObject({ roundId: n, outcome: 'ranked', answerCount: 3 });
      }

      const results = (await storedState(game.key))?.round?.results;
      if (!results) throw new Error('no results');
      await setClock(game.key, results.revealEndsAt);
      host.send({ type: 'advance', roundId: round.roundId });
    }

    for (const phone of [host, aino, ville]) {
      expect(await phone.next('gameEnded')).toEqual({
        type: 'gameEnded',
        reason: 'finished',
        summary: null,
      });
    }
    const final = await storedState(game.key);
    expect(final?.phase).toBe('ENDED');
    expect(new Set(final?.questions.map((q) => q.id)).size).toBe(15);
  });
});
