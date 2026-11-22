// Rules that must hold for EVERY game state and EVERY snapshot, whatever happened before.
// Phase 3 tests run checkInvariants after every applyEvent (test/game/helpers.ts), and the
// snapshot builder's output is checked with checkSnapshotInvariants — so a handler that leaves the
// state half-updated fails a test at once instead of misbehaving at a party.
//
// Each function returns a list of human-readable violations ([] = all good). Not run in
// production: they are a test tool (cheap enough, but a violation there has no good recovery).
import {
  MAX_CANDIDATES,
  MAX_PLAYERS,
  MIN_ANSWERS_FOR_RANKING,
  MIN_ANSWERS_FOR_STATS,
} from '../shared/constants';
import type { PlayerId, RoundResults, Snapshot } from '../shared/protocol';
import { revealEndsAt } from '../shared/reveal';
import { entriesOf } from './ids';
import type { GameState, RoundState } from './stateSchema';

export function checkInvariants(state: GameState): string[] {
  const problems: string[] = [];
  const fail = (message: string) => problems.push(message);
  const players = state.players;
  const isPlayer = (id: PlayerId) => players[id] !== undefined;

  // ── Players ↔ connections ────────────────────────────────────────────────
  // players[p].connId and connections[c].playerId describe the same link from both ends. It is
  // NOT a perfect mirror: a replaced older socket that hasn't closed yet still points at its
  // player (G-18), while the player points at the newest socket only.
  for (const [id, player] of entriesOf(players)) {
    if (player.connId !== null && state.connections[player.connId]?.playerId !== id)
      fail(`player ${id}: connId ${player.connId} is not a connection bound to them`);
    if ((player.connId === null) !== (player.connectedSince === null))
      fail(`player ${id}: connId and connectedSince disagree about being online`);
    if ((player.connId === null) !== (player.offlineSince !== null))
      fail(`player ${id}: connId and offlineSince disagree about being offline`);
    if (player.status !== 'active' && player.connId !== null && state.phase !== 'ENDED')
      fail(`player ${id}: ${player.status} but still holds a current connection`);
  }
  for (const [connId, connection] of entriesOf(state.connections)) {
    if (connection.playerId !== undefined && !isPlayer(connection.playerId))
      fail(`connection ${connId}: bound to unknown player ${connection.playerId}`);
    if (connection.playerId !== undefined && connection.reclaimRequestId !== undefined)
      fail(`connection ${connId}: both a player and a reclaim requester`);
    if (connection.reclaimRequestId !== undefined && !state.reclaims[connection.reclaimRequestId])
      fail(`connection ${connId}: bound to unknown reclaim ${connection.reclaimRequestId}`);
  }

  // ── Reclaims (G-44) ──────────────────────────────────────────────────────
  const pendingTargets = new Set<PlayerId>();
  for (const [requestId, request] of entriesOf(state.reclaims)) {
    const target = players[request.targetPlayerId];
    if (!target) fail(`reclaim ${requestId}: unknown target ${request.targetPlayerId}`);
    if (request.status === 'pending') {
      if (target && target.status !== 'active') fail(`reclaim ${requestId}: target not active`);
      if (pendingTargets.has(request.targetPlayerId))
        fail(`reclaim ${requestId}: second pending request for ${request.targetPlayerId}`);
      pendingTargets.add(request.targetPlayerId);
    }
    if (request.expiresAt <= request.createdAt)
      fail(`reclaim ${requestId}: expires before created`);
  }

  // ── Host, limits, names ──────────────────────────────────────────────────
  if (state.hostId !== null && players[state.hostId]?.status !== 'active')
    fail(`hostId ${state.hostId} is not an active player`);
  const active = entriesOf(players).filter(([, p]) => p.status === 'active');
  if (active.length > MAX_PLAYERS) fail(`${active.length} active players > MAX_PLAYERS`);
  const nameKeys = active.map(([, p]) => p.nameKey);
  if (new Set(nameKeys).size !== nameKeys.length) fail('two active players share a nameKey (G-14)');

  // ── Phase ↔ round ↔ results ↔ deadlines ──────────────────────────────────
  const { phase, round } = state;
  if ((phase === 'ENDED') !== (state.endReason !== null))
    fail(`endReason ${String(state.endReason)} does not fit phase ${phase}`);
  if (phase === 'LOBBY' && round !== null) fail('LOBBY with a round');
  if (phase === 'LOBBY' && state.questions.length > 0) fail('LOBBY with drawn questions');
  if (phase === 'QUESTION' && (round === null || round.results !== null))
    fail('QUESTION needs a round without results');
  if (phase === 'RESULTS' && (round === null || round.results === null))
    fail('RESULTS needs a round with results');
  if ((state.deadlines.roundEnd !== undefined) !== (phase === 'QUESTION'))
    fail('deadlines.roundEnd must be set exactly while a question is running');
  if ((state.deadlines.retention !== undefined) !== (phase === 'ENDED'))
    fail('deadlines.retention must be set exactly when the game has ended');

  // ── Questions (G-31) ─────────────────────────────────────────────────────
  if (state.questions.length > 0) {
    if (state.questions.length !== state.settings.gameLength)
      fail(
        `${state.questions.length} questions drawn for a ${state.settings.gameLength}-question game`,
      );
    const ids = state.questions.map((q) => q.id);
    if (new Set(ids).size !== ids.length) fail('a question was drawn twice (G-31)');
  }

  if (round !== null) problems.push(...checkRound(state, round));

  // ── Idle tracking (cleanup) ──────────────────────────────────────────────
  if (phase !== 'ENDED') {
    const anyOnline = active.some(([, p]) => p.connId !== null);
    if (anyOnline !== (state.idleSince === null))
      fail('idleSince must be null exactly while an active player is online');
  }

  return problems;
}

function checkRound(state: GameState, round: RoundState): string[] {
  const problems: string[] = [];
  const fail = (message: string) => problems.push(message);
  const isPlayer = (id: PlayerId) => state.players[id] !== undefined;

  if (round.index >= state.questions.length) fail(`round.index ${round.index} has no question`);
  // Candidates stay rankable for their round even if they leave meanwhile (G-41) → they must
  // exist, but needn't be active.
  if (round.candidates.length < 1 || round.candidates.length > MAX_CANDIDATES)
    fail(`${round.candidates.length} candidates (allowed 1…MAX_CANDIDATES)`);
  if (new Set(round.candidates).size !== round.candidates.length) fail('duplicate candidate');
  for (const id of [...round.candidates, ...round.participants])
    if (!isPlayer(id)) fail(`round refers to unknown player ${id}`);
  if (!(round.startedAt <= round.answerStartsAt && round.answerStartsAt < round.endsAt))
    fail('round timeline out of order');

  const candidates = [...round.candidates].sort().join();
  for (const [playerId, ranking] of entriesOf(round.answers)) {
    if (!round.participants.includes(playerId))
      fail(`answer from ${playerId}, who is not a participant`);
    if ([...ranking].sort().join() !== candidates)
      fail(`answer from ${playerId} is not a ranking of exactly the candidates (G-36)`);
  }

  if (round.results !== null) {
    if (round.results.roundId !== round.roundId) fail('results belong to another round');
    if (round.results.answerCount !== Object.keys(round.answers).length)
      fail('results.answerCount differs from the number of answers');
    problems.push(...checkResults(round.results, round.candidates));
  }
  return problems;
}

/** Rules for results — shared by the saved state and the snapshot checks. */
function checkResults(results: RoundResults, candidates: readonly PlayerId[]): string[] {
  const problems: string[] = [];
  const fail = (message: string) => problems.push(message);
  switch (results.outcome) {
    case 'ranked': {
      if (results.answerCount < MIN_ANSWERS_FOR_RANKING) fail('ranked with too few answers (S-7)');
      if (results.revealEndsAt !== revealEndsAt(results.revealStartsAt, results.steps.length))
        fail('revealEndsAt does not match the reveal steps (G-45)');
      const ranked = results.ranking.map((e) => e.playerId);
      if ([...ranked].sort().join() !== [...candidates].sort().join())
        fail('ranking must list every candidate exactly once');
      for (const step of results.steps)
        for (const id of step.playerIds)
          if (!candidates.includes(id)) fail(`reveal step names non-candidate ${id}`);
      if (results.stats !== null && results.answerCount < MIN_ANSWERS_FOR_STATS)
        fail('stats shown with fewer than MIN_ANSWERS_FOR_STATS answers (S-6)');
      break;
    }
    case 'notEnoughAnswers':
      if (results.answerCount < 1 || results.answerCount >= MIN_ANSWERS_FOR_RANKING)
        fail('notEnoughAnswers with a wrong answerCount (S-7)');
      if (results.revealEndsAt !== results.revealStartsAt) fail('nothing to reveal, yet it lasts');
      break;
    case 'nobodyAnswered':
      if (results.answerCount !== 0) fail('nobodyAnswered with answers (S-5)');
      if (results.revealEndsAt !== results.revealStartsAt) fail('nothing to reveal, yet it lasts');
      break;
  }
  return problems;
}

/** Rules every snapshot must satisfy (the shape itself is SnapshotSchema). */
export function checkSnapshotInvariants(snapshot: Snapshot): string[] {
  const problems: string[] = [];
  const fail = (message: string) => problems.push(message);
  const ids = new Set(snapshot.players.map((p) => p.playerId));

  if (!ids.has(snapshot.you.playerId)) fail('you are not in the player list');
  if (snapshot.hostId !== null && !ids.has(snapshot.hostId)) fail('host not in the player list');
  // Only the host ever receives reclaim requests.
  if (snapshot.reclaims.length > 0 && snapshot.you.playerId !== snapshot.hostId)
    fail('a non-host received reclaim requests');

  if (snapshot.phase === 'QUESTION' || snapshot.phase === 'RESULTS') {
    const { round } = snapshot;
    for (const id of [...round.candidates, ...round.participants])
      if (!ids.has(id)) fail(`round refers to unknown player ${id}`);
    for (const id of round.ready)
      if (!round.participants.includes(id)) fail(`ready player ${id} is not a participant`);
    if (round.endsAt <= round.answerStartsAt) fail('round ends before answering starts');
    if (round.number !== round.roundId) fail('round.number must equal roundId (1-based)');
  }
  if (snapshot.phase === 'RESULTS') {
    if (snapshot.results.roundId !== snapshot.round.roundId)
      fail('results belong to another round');
    problems.push(...checkResults(snapshot.results, snapshot.round.candidates));
  }
  return problems;
}
