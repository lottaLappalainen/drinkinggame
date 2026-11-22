// Round-side game logic — filled by Phase 3B (.claude/phases/phase-3-game-logic.md).
// Stubs only in Phase 2: the signatures are the contract; the JSDoc names the rules to implement.
//
// Conventions: MUTATE `draft`, return effects. The engine has already checked sender identity,
// host-only, phase and stale roundId.
import { NotImplementedError } from '../notImplemented';
import type { GameState } from '../stateSchema';
import type { Ctx, Effect, EngineMessageOf, Sender } from '../types';

const OWNER = 'Phase 3B';

/**
 * Host starts the game from the LOBBY (G-21: ≥ MIN_PLAYERS active): draw gameLength distinct
 * question ids (Fisher–Yates with ctx.random, G-31) and start round 1.
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
 * playerReady (G-38).
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
 * canAdvance); next round, or ENDED after the last question; blocked while paused except Finish.
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
export function onRoundDeadlines(_draft: GameState, _ctx: Ctx): Effect[] {
  throw new NotImplementedError(OWNER, 'round deadlines');
}

/**
 * Called by the engine after ANY change to who is online or active (also after rebuild, with
 * effects dropped). The ONLY place for: ending the round early (shared/ready canEndEarly, G-39),
 * and setting/clearing the pause flag (G-42, counting late joiners waiting for their first round).
 */
export function onPlayersChanged(_draft: GameState, _ctx: Ctx): Effect[] {
  throw new NotImplementedError(OWNER, 'onPlayersChanged (G-39, G-42)');
}
