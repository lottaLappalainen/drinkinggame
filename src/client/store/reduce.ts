// How a delta changes the snapshot (CLAUDE.md §5: "broadcast deltas; a full snapshot only on
// connect"). Pure: snapshot + message → the next snapshot (a new object when something changed, the
// same one when the message doesn't apply). The `welcome` snapshot replaces everything; these
// patches keep it current until the next welcome. Messages that don't fit the current phase or round
// (a late `playerReady` for an old round) are ignored — the server is the authority, and the next
// welcome fixes anything a phone missed.
import type { PlayerId, ServerMessage, Snapshot, SnapshotOf } from '../../shared/protocol';

export function applyDelta(snapshot: Snapshot, message: ServerMessage): Snapshot {
  switch (message.type) {
    case 'playerJoined': {
      const others = snapshot.players.filter((p) => p.playerId !== message.player.playerId);
      return { ...snapshot, players: [...others, message.player] };
    }
    case 'playerLeft':
      return patchPlayer(snapshot, message.playerId, { status: message.reason });
    case 'playerConnection':
      return patchPlayer(snapshot, message.playerId, {
        online: message.online,
        offlineSince: message.offlineSince,
      });
    case 'playerUpdated':
      return patchPlayer(snapshot, message.playerId, {
        nickname: message.nickname,
        avatar: message.avatar,
      });
    case 'settingsChanged':
      return { ...snapshot, settings: message.settings };
    case 'hostChanged': {
      const me = snapshot.you.playerId;
      // Reclaim requests are host-only; a new host receives them again as reclaimRequested.
      return {
        ...snapshot,
        hostId: message.hostId,
        reclaims: message.hostId === me ? snapshot.reclaims : [],
      };
    }
    case 'reclaimRequested': {
      const others = snapshot.reclaims.filter((r) => r.requestId !== message.request.requestId);
      return { ...snapshot, reclaims: [...others, message.request] };
    }
    case 'reclaimClosed':
      return {
        ...snapshot,
        reclaims: snapshot.reclaims.filter((r) => r.requestId !== message.requestId),
      };
    case 'roundStarted': {
      if (snapshot.phase === 'ENDED') return snapshot;
      const paused = snapshot.phase === 'LOBBY' ? false : snapshot.paused;
      const next: SnapshotOf<'QUESTION'> = {
        ...common(snapshot),
        phase: 'QUESTION',
        paused,
        you: { playerId: snapshot.you.playerId, submitted: false },
        round: message.round,
      };
      return next;
    }
    case 'playerReady': {
      if (snapshot.phase !== 'QUESTION' || snapshot.round.roundId !== message.roundId)
        return snapshot;
      if (snapshot.round.ready.includes(message.playerId)) return snapshot;
      const mine = message.playerId === snapshot.you.playerId;
      return {
        ...snapshot,
        round: { ...snapshot.round, ready: [...snapshot.round.ready, message.playerId] },
        you: mine ? { ...snapshot.you, submitted: true } : snapshot.you,
      };
    }
    case 'roundResults': {
      if (snapshot.phase !== 'QUESTION' || snapshot.round.roundId !== message.results.roundId)
        return snapshot;
      const next: SnapshotOf<'RESULTS'> = {
        ...common(snapshot),
        phase: 'RESULTS',
        paused: snapshot.paused,
        you: { playerId: snapshot.you.playerId },
        round: snapshot.round,
        results: message.results,
      };
      return next;
    }
    case 'paused':
    case 'resumed': {
      if (snapshot.phase !== 'QUESTION' && snapshot.phase !== 'RESULTS') return snapshot;
      return { ...snapshot, paused: message.type === 'paused' };
    }
    case 'gameEnded': {
      const next: SnapshotOf<'ENDED'> = {
        ...common(snapshot),
        phase: 'ENDED',
        endReason: message.reason,
        you: { playerId: snapshot.you.playerId },
        summary: message.summary,
      };
      return next;
    }
    // "Play again" (G-52): the whole game starts over, so the lobby replaces everything (like a
    // welcome, but on the same connection).
    case 'newGame':
      return message.snapshot;
    // Not snapshot changes: handled by the store (or the connection, for timeSync).
    case 'welcome':
    case 'leftGame':
    case 'reclaimPending':
    case 'reclaimResult':
    case 'timeSync':
    case 'error':
      return snapshot;
    default: {
      const unknown: never = message;
      return unknown;
    }
  }
}

/** The fields every phase has (SnapshotSchema's SNAPSHOT_COMMON), without the phase-specific ones. */
function common(snapshot: Snapshot) {
  return {
    key: snapshot.key,
    gameId: snapshot.gameId,
    hostId: snapshot.hostId,
    settings: snapshot.settings,
    players: snapshot.players,
    reclaims: snapshot.reclaims,
  };
}

function patchPlayer(
  snapshot: Snapshot,
  playerId: PlayerId,
  patch: Partial<Snapshot['players'][number]>,
): Snapshot {
  if (!snapshot.players.some((p) => p.playerId === playerId)) return snapshot;
  return {
    ...snapshot,
    players: snapshot.players.map((p) => (p.playerId === playerId ? { ...p, ...patch } : p)),
  };
}
