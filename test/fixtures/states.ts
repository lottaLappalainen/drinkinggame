// Example saved GameStates (the server-side shape). Validated against GameStateSchema by a test;
// Phase 3 tests start from these.
import {
  ANSWER_GRACE_MS,
  ENDED_RETENTION_MS,
  QUESTION_INTRO_MS,
  ROUND_MS,
} from '../../src/shared/constants';
import {
  createGame,
  createPlayer,
  createUpdatedEndState,
  type GameState,
} from '../../src/game/stateSchema';
import { GAME_ID, GAME_KEY, P, REQUEST_ID, T0 } from './common';

/** Deterministic fake token hashes (64 hex chars). */
export function fakeTokenHash(n: number): string {
  return n.toString(16).padStart(64, '0');
}

const NAMES: ReadonlyArray<readonly [string, string, string]> = [
  [P.mikko, 'Mikko', 'fox'],
  [P.aino, 'Aino', 'cat'],
  [P.ville, 'Ville', 'panda'],
  [P.sanna, 'Sanna', 'owl'],
];

/** A lobby with 4 players, all online, Mikko hosting. */
export function lobbyState(): GameState {
  const state = createGame({
    key: GAME_KEY,
    gameId: GAME_ID,
    hostId: P.mikko,
    host: {
      nickname: 'Mikko',
      nameKey: 'mikko',
      presetId: 'fox',
      tokenHash: fakeTokenHash(1),
      now: T0,
    },
  });
  NAMES.forEach(([id, nickname, presetId], i) => {
    const player =
      state.players[id] ??
      createPlayer({
        nickname,
        nameKey: nickname.toLowerCase(),
        presetId,
        tokenHash: fakeTokenHash(i + 1),
        now: T0 + i * 1_000,
        activeFromRound: 1,
      });
    const connId = `conn-${nickname.toLowerCase()}`;
    state.players[id] = { ...player, connId, connectedSince: T0 + i * 1_000, offlineSince: null };
    state.connections[connId] = { playerId: id, protocolVersion: 1 };
  });
  state.idleSince = null;
  return state;
}

/** Round 1 is running, Aino has answered; question ids drawn. */
export function questionState(): GameState {
  const state = lobbyState();
  const startedAt = T0 + 10_000;
  const answerStartsAt = startedAt + QUESTION_INTRO_MS;
  const endsAt = answerStartsAt + ROUND_MS;
  const ids = [P.mikko, P.aino, P.ville, P.sanna];
  state.phase = 'QUESTION';
  state.questionIds = Array.from({ length: 25 }, (_, i) => `q${String(i + 1).padStart(4, '0')}`);
  state.round = {
    roundId: 1,
    index: 0,
    candidates: ids,
    participants: ids,
    startedAt,
    answerStartsAt,
    endsAt,
    answers: { [P.aino]: [P.ville, P.mikko, P.sanna, P.aino] },
    results: null,
  };
  state.deadlines.roundEnd = endsAt + ANSWER_GRACE_MS;
  for (const id of ids) {
    const player = state.players[id];
    if (player) player.timesShown = 1;
  }
  return state;
}

/** A lobby where Sanna is offline and a "That's me" request for her is pending (G-44). */
export function lobbyWithReclaimState(): GameState {
  const state = lobbyState();
  const sanna = state.players[P.sanna];
  if (sanna) {
    delete state.connections[sanna.connId ?? ''];
    state.players[P.sanna] = {
      ...sanna,
      connId: null,
      connectedSince: null,
      offlineSince: T0 + 5_000,
    };
  }
  state.connections['conn-requester'] = { reclaimRequestId: REQUEST_ID, protocolVersion: 1 };
  state.reclaims[REQUEST_ID] = {
    targetPlayerId: P.sanna,
    requesterTokenHash: fakeTokenHash(99),
    nickname: 'Sanna',
    presetId: 'owl',
    createdAt: T0 + 60_000,
    expiresAt: T0 + 360_000,
    status: 'pending',
  };
  return state;
}

/** A finished game in its retention window. */
export function endedState(): GameState {
  const state = lobbyState();
  state.phase = 'ENDED';
  state.endReason = 'finished';
  state.deadlines = { retention: T0 + ENDED_RETENTION_MS };
  return state;
}

/** What the server substitutes for a saved state that failed the version/schema check. */
export function updatedEndState(): GameState {
  return createUpdatedEndState({ key: GAME_KEY, gameId: GAME_ID, now: T0 });
}

export const STATE_FIXTURES: ReadonlyArray<readonly [string, () => GameState]> = [
  ['lobby', lobbyState],
  ['question', questionState],
  ['lobby-with-reclaim', lobbyWithReclaimState],
  ['ended', endedState],
  ['updated-end', updatedEndState],
];
