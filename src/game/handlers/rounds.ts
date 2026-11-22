// Round-side game logic — filled by Phase 3B (.claude/phases/phase-3-game-logic.md).
// Still stubs (Phase 3B): start, submit, advance, end and closeRound. Already implemented (needed by
// 3A, whose events reach them): onPlayersChanged (pause flag + early-end check) and the round-end
// deadline routing — both end in closeRound, the 3B stub.
//
// Conventions: MUTATE `draft`, return effects. The engine has already checked sender identity,
// host-only, phase and stale roundId.
import { MIN_PLAYERS } from '../../shared/constants';
import { canEndEarly, readyCounter } from '../../shared/ready';
import { broadcast } from '../effects';
import { keysOf } from '../ids';
import { NotImplementedError } from '../notImplemented';
import { activePlayers } from '../players/presence';
import type { GameState } from '../stateSchema';
import type { Ctx, Effect, EngineMessageOf, Sender } from '../types';

const OWNER = 'Phase 3B';

/**
 * Host starts the game from the LOBBY (G-21: ≥ MIN_PLAYERS active): draw gameLength distinct
 * questions (Fisher–Yates with ctx.random, G-31), store them WITH their text in state.questions
 * (the game never reads the bank again), and start round 1.
 */
export function handleStart(
  _draft: GameState,
  _msg: EngineMessageOf<'start'>,
  _sender: Sender,
  _ctx: Ctx,
): Effect[] {
  throw new NotImplementedError(OWNER, 'start (G-21, G-31)');
}

/**
 * Ranking submitted (G-36, G-37): only in the answer window (shared/timeline acceptsAnswers),
 * only participants, exactly the round's candidates once each, once per player. Broadcast
 * playerReady (G-38). An answer after endsAt + grace that arrives before the alarm has closed the
 * round is IGNORED silently (no error) — like the engine does for submits arriving in RESULTS.
 */
export function handleSubmit(
  _draft: GameState,
  _msg: EngineMessageOf<'submit'>,
  _sender: Sender,
  _ctx: Ctx,
): Effect[] {
  throw new NotImplementedError(OWNER, 'submit (G-36…G-38)');
}

/**
 * Host's Next / Finish (G-45): accepted from revealEndsAt − ADVANCE_EARLY_MS (shared/reveal
 * serverAcceptsAdvance — server only); next round, or ENDED after the last question; blocked
 * while paused except Finish.
 */
export function handleAdvance(
  _draft: GameState,
  _msg: EngineMessageOf<'advance'>,
  _sender: Sender,
  _ctx: Ctx,
): Effect[] {
  throw new NotImplementedError(OWNER, 'advance (G-45)');
}

/** Host ends the game from any phase (G-46): ENDED 'hostEnded', retention deadline (G-48). */
export function handleEnd(
  _draft: GameState,
  _msg: EngineMessageOf<'end'>,
  _sender: Sender,
  _ctx: Ctx,
): Effect[] {
  throw new NotImplementedError(OWNER, 'end (G-46)');
}

/** Round-end deadline (endsAt + ANSWER_GRACE_MS): close the round, compute results once (S-1…S-7). */
export function onRoundDeadlines(draft: GameState, ctx: Ctx): Effect[] {
  const due = draft.deadlines.roundEnd;
  if (draft.phase !== 'QUESTION' || due === undefined || due > ctx.now) return [];
  return closeRound(draft, ctx);
}

/**
 * Called by the engine after ANY change to who is online or active (including after a rebuild —
 * its effects are sent like any others). The ONLY place for: setting/clearing the pause flag
 * (G-42, counting late joiners waiting for their first round) and ending the round early
 * (shared/ready canEndEarly, G-39).
 */
export function onPlayersChanged(draft: GameState, ctx: Ctx): Effect[] {
  if (draft.phase !== 'QUESTION' && draft.phase !== 'RESULTS') return [];
  const effects = updatePause(draft);
  const round = draft.round;
  if (draft.phase === 'QUESTION' && round !== null) {
    const counter = readyCounter(
      round.participants,
      new Set(keysOf(round.answers)),
      (id) => draft.players[id]?.connId != null,
    );
    if (canEndEarly(ctx.now, round.answerStartsAt, counter))
      effects.push(...closeRound(draft, ctx));
  }
  return effects;
}

/**
 * G-42: paused while fewer than MIN_PLAYERS are active (late joiners count — otherwise 2 players +
 * 1 late joiner could never continue). The flag only blocks the host's Next; clearing it never
 * starts anything by itself.
 */
function updatePause(draft: GameState): Effect[] {
  const shouldPause = activePlayers(draft).length < MIN_PLAYERS;
  if (shouldPause === draft.paused) return [];
  draft.paused = shouldPause;
  return [broadcast(shouldPause ? { type: 'paused', needed: MIN_PLAYERS } : { type: 'resumed' })];
}

/**
 * QUESTION → RESULTS, exactly once: Borda scores, places, reveal steps, stats (S-1…S-7, G-50);
 * sends roundResults. Phase 3B.
 */
function closeRound(_draft: GameState, _ctx: Ctx): Effect[] {
  throw new NotImplementedError(OWNER, 'closeRound (S-1…S-7, G-50)');
}
