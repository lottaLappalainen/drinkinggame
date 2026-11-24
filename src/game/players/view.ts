// What phones may see of the game: public players, the public round and the per-viewer snapshot.
// Never answers, tokens or token hashes (CLAUDE.md §5); results only as computed (S-6).
import type { PlayerId, PublicPlayer, PublicRound, Snapshot } from '../../shared/protocol';
import { keysOf } from '../ids';
import type { GameState, PlayerState, RoundState } from '../stateSchema';
import { pendingReclaims } from './reclaims';

export function toPublicPlayer(
  state: GameState,
  playerId: PlayerId,
  player: PlayerState,
): PublicPlayer {
  return {
    playerId,
    nickname: player.nickname,
    avatar: { ...player.avatar },
    status: player.status,
    online: player.connId !== null,
    offlineSince: player.offlineSince,
  };
}

export function publicPlayers(state: GameState): PublicPlayer[] {
  return keysOf(state.players).flatMap((id) => {
    const player = state.players[id];
    return player ? [toPublicPlayer(state, id, player)] : [];
  });
}

/** The running round as phones see it: who is ready, never what they answered (G-38). */
export function publicRound(state: GameState, round: RoundState): PublicRound {
  const question = state.questions[round.index];
  if (question === undefined) throw new Error(`Round ${round.roundId} has no question`);
  return {
    roundId: round.roundId,
    number: round.index + 1, // "7 / 25" — the question's position in the game
    total: state.settings.gameLength,
    question: { ...question },
    candidates: [...round.candidates],
    spots: round.spots,
    participants: [...round.participants],
    answerStartsAt: round.answerStartsAt,
    endsAt: round.endsAt,
    ready: keysOf(round.answers),
    subjectId: round.subjectId,
  };
}

/**
 * The per-viewer snapshot sent in `welcome` (SnapshotSchema, a variant on phase). Reclaim
 * requests only for the host; `you.submitted` so a phone reconnecting after Ready shows the
 * waiting screen (G-38).
 */
export function buildSnapshot(state: GameState, viewer: PlayerId): Snapshot {
  const common = {
    key: state.key,
    gameId: state.gameId,
    hostId: state.hostId,
    settings: { ...state.settings, categories: [...state.settings.categories] },
    players: publicPlayers(state),
    you: { playerId: viewer },
    reclaims: viewer === state.hostId ? pendingReclaims(state) : [],
  };
  const { round } = state;
  switch (state.phase) {
    case 'LOBBY':
      return { ...common, phase: 'LOBBY' };
    case 'QUESTION':
      if (round === null) throw new Error('QUESTION without a round');
      return {
        ...common,
        phase: 'QUESTION',
        paused: state.paused,
        you: { playerId: viewer, submitted: round.answers[viewer] !== undefined },
        round: publicRound(state, round),
      };
    case 'RESULTS':
      if (round?.results == null) throw new Error('RESULTS without results');
      return {
        ...common,
        phase: 'RESULTS',
        paused: state.paused,
        round: publicRound(state, round),
        results: round.results,
      };
    case 'ENDED':
      // An ENDED game always has a reason (invariant) — a missing one is a bug, not a default.
      if (state.endReason === null) throw new Error('ENDED without an endReason');
      return { ...common, phase: 'ENDED', endReason: state.endReason, summary: null };
  }
}
