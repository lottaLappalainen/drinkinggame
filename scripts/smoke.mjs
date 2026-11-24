// Smoke test against a RUNNING server — the local dev server or staging:
//
//   npm run smoke                                   (http://localhost:5173, start `npm run dev` first)
//   npm run smoke -- https://drinkinggame-staging.<you>.workers.dev
//
// Three scripted phones create a game, join, play one round in real time (the 4 s intro, answers,
// results) and the host ends the game. Exit code 0 = the whole server path works.
// Uses Node's built-in WebSocket and fetch; no dependencies.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const base = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '');
const wsBase = base.replace(/^http/, 'ws');
// Read from the source, so a version bump can never leave this script behind.
const PROTOCOL_VERSION = Number(
  /PROTOCOL_VERSION = (\d+)/.exec(
    readFileSync(new URL('../src/shared/constants.ts', import.meta.url), 'utf8'),
  )?.[1],
);
if (!Number.isInteger(PROTOCOL_VERSION))
  throw new Error('PROTOCOL_VERSION not found in constants.ts');
const TIMEOUT_MS = 15_000;

const token = () => randomBytes(24).toString('base64url');

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** A scripted phone: a socket that collects messages and can wait for one of a type. */
function phone(name, key) {
  const ws = new WebSocket(`${wsBase}/ws/${key}?v=${PROTOCOL_VERSION}`);
  const inbox = [];
  const waiting = [];
  ws.addEventListener('message', (event) => {
    if (event.data === 'pong') return;
    const message = JSON.parse(String(event.data));
    const i = waiting.findIndex((w) => w.type === message.type);
    if (i >= 0) waiting.splice(i, 1)[0].resolve(message);
    else inbox.push(message);
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error(`${name}: could not connect`)), {
      once: true,
    });
  });
  return {
    name,
    opened,
    send: (message) => ws.send(JSON.stringify(message)),
    next(type) {
      const i = inbox.findIndex((m) => m.type === type);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        waiting.push({ type, resolve });
        setTimeout(
          () => reject(new Error(`${name}: no "${type}" within ${TIMEOUT_MS} ms`)),
          TIMEOUT_MS,
        );
      });
    },
    close: () => ws.close(1000),
  };
}

async function main() {
  console.log(`Smoke test against ${base}`);

  const hostToken = token();
  const created = await fetch(`${base}/api/games`, {
    method: 'POST',
    body: JSON.stringify({ nickname: 'Smoke host', presetId: 'fox', token: hostToken }),
  });
  if (created.status !== 201) fail(`create game: HTTP ${created.status} ${await created.text()}`);
  const { key } = await created.json();
  console.log(`✓ game created: ${key}`);

  const host = phone('host', key);
  const aino = phone('aino', key);
  const ville = phone('ville', key);
  await Promise.all([host.opened, aino.opened, ville.opened]);
  host.send({ type: 'hello', token: hostToken });
  aino.send({ type: 'hello', token: token(), join: { nickname: 'Smoke Aino', presetId: 'cat' } });
  ville.send({ type: 'hello', token: token(), join: { nickname: 'Smoke Ville', presetId: 'owl' } });
  const [hostWelcome] = await Promise.all([
    host.next('welcome'),
    aino.next('welcome'),
    ville.next('welcome'),
  ]);
  if (hostWelcome.snapshot.hostId !== hostWelcome.playerId) fail('the creator is not the host');
  console.log('✓ three phones joined');

  host.send({ type: 'timeSync', t0: 1 });
  const sync = await host.next('timeSync');
  console.log(`✓ clock sync (server time ${new Date(sync.serverTime).toISOString()})`);

  host.send({ type: 'start' });
  const [{ round }] = await Promise.all([
    host.next('roundStarted'),
    aino.next('roundStarted'),
    ville.next('roundStarted'),
  ]);
  console.log(`✓ round 1 started: "${round.question.text}" (${round.candidates.length} to rank)`);

  // Wait for the intro to end on the server's clock (plus a little slack).
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, round.answerStartsAt - sync.serverTime) + 500),
  );
  for (const p of [host, aino, ville])
    p.send({ type: 'submit', roundId: round.roundId, ranking: round.candidates });
  const results = await Promise.all([
    host.next('roundResults'),
    aino.next('roundResults'),
    ville.next('roundResults'),
  ]);
  const outcome = results[0].results;
  if (outcome.outcome !== 'ranked' || outcome.answerCount !== 3)
    fail(`unexpected results: ${JSON.stringify(outcome)}`);
  console.log(`✓ results: ${outcome.steps.length} reveal steps, ${outcome.answerCount} answers`);

  host.send({ type: 'end' });
  await Promise.all([host.next('gameEnded'), aino.next('gameEnded'), ville.next('gameEnded')]);
  console.log('✓ game ended');
  for (const p of [host, aino, ville]) p.close();
  console.log('All good.');
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
