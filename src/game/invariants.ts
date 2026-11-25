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
  MIN_ANSWERS_FOR_NO_VOTES_LIST,
  MIN_ANSWERS_FOR_RANKING,
  MIN_PLAYERS,
  SUBJECT_MIN_RANKABLE,
} from '../shared/constants';
import { DRINK_RULES, inRange } from '../shared/drinkRules';
import type { PlayerId, RoundResults, Snapshot } from '../shared/protocol';
import { hasSubject } from '../shared/questionSubject';
import { gameCategories, type CategoryId } from '../shared/questionCategories';
import { revealEndsAt } from '../shared/reveal';
import { isPartialRanking, spotsFor } from '../shared/spots';
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
    // One socket waits on a request, like one socket per player (G-18).
    const waiting = Object.values(state.connections).filter(
      (c) => c.reclaimRequestId === requestId,
    ).length;
    if (waiting > 1) fail(`reclaim ${requestId}: ${String(waiting)} sockets wait on it`);
  }

  // ── Host, limits, names ──────────────────────────────────────────────────
  if (state.hostId !== null && players[state.hostId]?.status !== 'active')
    fail(`hostId ${state.hostId} is not an active player`);
  const active = entriesOf(players).filter(([, p]) => p.status === 'active');
  if (active.length > MAX_PLAYERS) fail(`${active.length} active players > MAX_PLAYERS`);
  const nameKeys = active.map(([, p]) => p.nameKey);
  if (new Set(nameKeys).size !== nameKeys.length) fail('two active players share a nameKey (G-14)');
  // A handover is pending only while there is a host who is offline, in a game still running.
  if (state.deadlines.hostHandover !== undefined) {
    const host = state.hostId === null ? undefined : players[state.hostId];
    if (state.phase === 'ENDED' || host === undefined || host.connId !== null)
      fail('deadlines.hostHandover is set without an offline host in a running game');
  }

  // ── Phase ↔ round ↔ results ↔ deadlines ──────────────────────────────────
  const { phase, round } = state;
  // G-42: paused exactly while a started game has too few active players (late joiners count).
  const shouldPause = (phase === 'QUESTION' || phase === 'RESULTS') && active.length < MIN_PLAYERS;
  if (state.paused !== shouldPause)
    fail(
      `paused is ${String(state.paused)} with ${String(active.length)} active players in ${phase}`,
    );
  if ((phase === 'ENDED') !== (state.endReason !== null))
    fail(`endReason ${String(state.endReason)} does not fit phase ${phase}`);
  if (phase === 'LOBBY' && round !== null) fail('LOBBY with a round');
  // A finished game keeps no round: the answers are private and have no use any more (3B).
  if (phase === 'ENDED' && round !== null) fail('ENDED with a round (answers must be dropped)');
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
    const categories: readonly CategoryId[] = gameCategories(state.settings.categories);
    for (const question of state.questions)
      if (!categories.includes(question.category))
        fail(`question ${question.id} is from a category that wasn't chosen (G-22)`);
  }
  // "Play again" (G-52): every asked question is remembered, once.
  if (new Set(state.playedQuestionIds).size !== state.playedQuestionIds.length)
    fail('playedQuestionIds lists a question twice');
  if (round !== null) {
    const asked = state.questions[round.index];
    if (asked !== undefined && !state.playedQuestionIds.includes(asked.id))
      fail(`question ${asked.id} is being asked but isn't in playedQuestionIds`);
  }

  // ── Tokens (G-44) ────────────────────────────────────────────────────────
  // A superseded token must never also be someone's current token (it would both resume a player
  // and be told RECLAIMED).
  const currentTokens = new Set(Object.values(players).map((p) => p.tokenHash));
  for (const [id, player] of entriesOf(players))
    for (const old of player.previousTokenHashes)
      if (currentTokens.has(old)) fail(`player ${id}: a previous token is someone's current token`);

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
  // One round per question, in order: round N shows question N (index N − 1).
  if (round.roundId !== round.index + 1) fail('round.roundId must be round.index + 1');
  // "[player]" questions (G-51): a subject exactly when the question has the token; the subject
  // takes part and is ranked only in the few-players fallback.
  const question = state.questions[round.index];
  if (question !== undefined && hasSubject(question.text) !== (round.subjectId !== null))
    fail('round.subjectId must be set exactly for a "[player]" question (G-51)');
  if (round.subjectId !== null) {
    if (!round.participants.includes(round.subjectId)) fail('the subject is not a participant');
    if (
      round.candidates.includes(round.subjectId) &&
      round.participants.length >= SUBJECT_MIN_RANKABLE
    )
      fail('the subject is ranked although enough players could be (G-51)');
  }
  // Candidates stay rankable for their round even if they leave meanwhile (G-41) → they must
  // exist, but needn't be active.
  // Spotlight shows at most MAX_CANDIDATES; Podium shows every participant (G-34, G-24).
  const maxCandidates = state.settings.mode === 'podium' ? MAX_PLAYERS : MAX_CANDIDATES;
  if (round.candidates.length < 1 || round.candidates.length > maxCandidates)
    fail(`${round.candidates.length} candidates (allowed 1…${maxCandidates})`);
  if (round.spots !== spotsFor(state.settings.mode, round.candidates.length))
    fail(`round.spots ${round.spots} does not match the mode (G-24)`);
  if (new Set(round.candidates).size !== round.candidates.length) fail('duplicate candidate');
  // Everyone ranked is also someone who answers (candidates are chosen from the participants, G-34).
  for (const id of round.candidates)
    if (!round.participants.includes(id)) fail(`candidate ${id} is not a participant`);
  for (const id of [...round.candidates, ...round.participants])
    if (!isPlayer(id)) fail(`round refers to unknown player ${id}`);
  if (!(round.startedAt <= round.answerStartsAt && round.answerStartsAt < round.endsAt))
    fail('round timeline out of order');

  for (const [playerId, ranking] of entriesOf(round.answers)) {
    if (!round.participants.includes(playerId))
      fail(`answer from ${playerId}, who is not a participant`);
    if (
      ranking.length !== round.spots ||
      new Set(ranking).size !== ranking.length ||
      !ranking.every((id) => round.candidates.includes(id))
    )
      fail(`answer from ${playerId} does not fill exactly the round's spots (G-36)`);
  }

  if (round.results !== null) {
    if (round.results.roundId !== round.roundId) fail('results belong to another round');
    if (round.results.answerCount !== Object.keys(round.answers).length)
      fail('results.answerCount differs from the number of answers');
    problems.push(...checkResults(round.results, round.candidates, round.spots));
  }
  return problems;
}

/** Rules for results — shared by the saved state and the snapshot checks. */
function checkResults(
  results: RoundResults,
  candidates: readonly PlayerId[],
  spots: number,
): string[] {
  const problems: string[] = [];
  const fail = (message: string) => problems.push(message);
  switch (results.outcome) {
    case 'ranked': {
      if (results.answerCount < MIN_ANSWERS_FOR_RANKING) fail('ranked with too few answers (S-7)');
      if (results.revealEndsAt !== revealEndsAt(results.revealStartsAt, results.steps.length))
        fail('revealEndsAt does not match the reveal steps (G-45)');
      const partial = isPartialRanking(spots, candidates.length);
      const ranked = results.ranking.map((e) => e.playerId);
      const listed = [...ranked, ...(results.noVotes ?? [])];
      if (new Set(listed).size !== listed.length) fail('a player is listed twice in the results');
      for (const id of listed)
        if (!candidates.includes(id)) fail(`results name non-candidate ${id}`);
      if (results.noVotes === null) {
        // S-8: withheld only for a partial ranking with few answers; then only revealed places.
        if (!partial || results.answerCount >= MIN_ANSWERS_FOR_NO_VOTES_LIST)
          fail('noVotes withheld without reason (S-8)');
        const revealed = new Set(results.steps.flatMap((step) => step.playerIds));
        if (!ranked.every((id) => revealed.has(id)))
          fail('withheld results list a place that was not revealed (S-8)');
      } else if (listed.length !== candidates.length) {
        fail('ranking + noVotes must list every candidate exactly once');
      }
      if (!partial && (results.noVotes ?? []).length > 0)
        fail('a full ranking has a "No votes" group');
      if (partial && results.steps.some((step) => step.kind === 'bottom'))
        fail('a partial ranking reveals a bottom step (G-50)');
      for (const step of results.steps) {
        for (const id of step.playerIds)
          if (!ranked.includes(id)) fail(`reveal step names unranked player ${id}`);
        // D-1: the rule is the one of the step's kind, with a number from its range.
        const range = DRINK_RULES[step.kind];
        if (step.rule === null) fail(`reveal step ${step.kind} has no drinking rule (D-1)`);
        else if (step.rule.action !== range.action || !inRange(range, step.rule.sips))
          fail(`reveal step ${step.kind} has a rule outside its range (D-1)`);
      }
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
    if (round.number < 1 || round.number > round.total)
      fail(`question number ${round.number} outside 1…${round.total}`);
    const categories: readonly CategoryId[] = gameCategories(snapshot.settings.categories);
    if (!categories.includes(round.question.category))
      fail(`question from a category that wasn't chosen (G-22)`);
    if (round.spots !== spotsFor(snapshot.settings.mode, round.candidates.length))
      fail('round.spots does not match the mode (G-24)');
    if (hasSubject(round.question.text) !== (round.subjectId !== null))
      fail('subjectId must be set exactly for a "[player]" question (G-51)');
    if (round.subjectId !== null && !ids.has(round.subjectId))
      fail('the subject is not in the player list');
  }
  if (snapshot.phase === 'RESULTS') {
    if (snapshot.results.roundId !== snapshot.round.roundId)
      fail('results belong to another round');
    problems.push(
      ...checkResults(snapshot.results, snapshot.round.candidates, snapshot.round.spots),
    );
  }
  return problems;
}
