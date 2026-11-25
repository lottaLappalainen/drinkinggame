// The client's one store (CLAUDE.md §7 Client): signals fed by the connection, intents the screens
// call. Components read signals and call intents — they never touch the socket.
//
// Server state: `snapshot` is replaced by every `welcome` and patched by deltas (reduce.ts); the
// screens render it exactly like the Phase 2 fixtures, so 5A can swap fixtures for the store with
// no other change. Local state: whether we're connected / updating, why the game is over for this
// phone (`exit`), join and reclaim progress, and which requests are in flight (to disable buttons).
//
// Login rules (CLAUDE.md §3, §5, §6): the token is generated and SAVED before it is ever sent; the
// `join` profile rides along only after an explicit Join tap; a terminal answer (NOT_FOUND, LEFT,
// REMOVED, RECLAIMED) drops the token; REPLACED stops everything until "Use here".
import { batch, computed, signal } from '@preact/signals';
import type { PresetId } from '../../shared/avatars';
import { WS_CLOSE } from '../../shared/constants';
import type {
  ClientMessage,
  ErrorMessage,
  GameKey,
  PlayerId,
  RequestId,
  ServerMessage,
  Settings,
  Snapshot,
} from '../../shared/protocol';
import { createGame, type FetchLike } from '../net/api';
import type { Clock } from '../net/clock';
import type { Connection, ConnectionStatus, Timers } from '../net/connection';
import { createPhotoUploader } from '../media/upload';
import { reloadOnce } from '../net/reload';
import type { GameEntry, Profile, Storage } from '../storage';
import { errorOutcome } from './errors';
import { applyDelta } from './reduce';
import {
  isPendingRequest,
  type Exit,
  type JoinError,
  type Notice,
  type PendingRequest,
  type ReclaimState,
} from './types';

export type { Exit, JoinError, Notice, PendingRequest, ReclaimState } from './types';

export type StoreDeps = {
  readonly connection: Connection;
  readonly clock: Clock;
  readonly storage: Storage;
  readonly fetch: FetchLike;
  /** For photo-upload retries. */
  readonly timers: Timers;
  readonly newToken: () => string;
  readonly reload: () => void;
  /** The phone's clock (epoch ms) — for the reload cap. */
  readonly now: () => number;
};

export type Store = ReturnType<typeof createStore>;

export function createStore(deps: StoreDeps) {
  const { connection: conn, storage } = deps;

  // ── Signals (read by screens) ────────────────────────────────────────────
  const gameKey = signal<GameKey | null>(null);
  const snapshot = signal<Snapshot | null>(null);
  const connectionStatus = signal<ConnectionStatus>(conn.status);
  /** SERVER_UPDATING: the server is still on old code — show "Updating…", keep retrying. */
  const updating = signal(false);
  const exit = signal<Exit | null>(null);
  const joinError = signal<JoinError | null>(null);
  const reclaim = signal<ReclaimState | null>(null);
  const notice = signal<Notice | null>(null);
  const pending = signal<ReadonlySet<PendingRequest>>(new Set());
  /** Hosting: POST /api/games in flight, or why it failed. */
  const creating = signal(false);
  const createError = signal<string | null>(null);

  const me = computed(() => {
    const s = snapshot.value;
    return s?.players.find((p) => p.playerId === s.you.playerId) ?? null;
  });
  const isHost = computed(() => {
    const s = snapshot.value;
    return s !== null && s.hostId === s.you.playerId;
  });

  // ── Private state ────────────────────────────────────────────────────────
  /** The login in use — kept in memory too, because storage may be blocked. */
  let entry: GameEntry | null = null;
  /** The profile of an explicit Join tap, until a welcome or a refusal answers it. */
  let pendingJoin: Profile | null = null;
  /** True between the first welcome of a socket and its close: earlier deltas are dropped. */
  let welcomed = false;
  /** The player tapped Leave; LEFT / leftGame then just mean "done". */
  let leaving = false;
  const photos = createPhotoUploader({ fetch: deps.fetch, timers: deps.timers });

  conn.onStatus((status) => {
    connectionStatus.value = status;
  });

  const setPending = (request: PendingRequest, on: boolean) => {
    const next = new Set(pending.value);
    if (on) next.add(request);
    else next.delete(request);
    pending.value = next;
  };
  const send = (message: ClientMessage, request?: PendingRequest): boolean => {
    const sent = conn.send(message);
    if (sent && request) setPending(request, true);
    return sent;
  };

  /** Reset everything about the current game (not the stored login). */
  const clearGame = () => {
    batch(() => {
      snapshot.value = null;
      updating.value = false;
      joinError.value = null;
      reclaim.value = null;
      notice.value = null;
      pending.value = new Set();
    });
    pendingJoin = null;
    leaving = false;
    welcomed = false;
    photos.cancel();
  };

  /**
   * Send this phone's photo to the game (CLAUDE.md §6 "Avatars — photos"): automatically while the
   * game has no photo of ours (any phase — a late joiner or an earlier failed upload), and after
   * the player picked a new one in the lobby (`changed`; changing a photo is lobby-only, G-5).
   */
  const syncPhoto = (photo: string | null, changed: boolean) => {
    const s = snapshot.value;
    const key = gameKey.value;
    if (s === null || key === null || entry === null || photo === null || s.phase === 'ENDED')
      return;
    const mine = s.players.find((p) => p.playerId === s.you.playerId);
    if (mine?.status !== 'active') return;
    const hasPhoto = mine.avatar.photoVersion !== null;
    if (hasPhoto && !(changed && s.phase === 'LOBBY')) return;
    photos.upload({ key, playerId: mine.playerId, token: entry.token }, photo);
  };

  /** A terminal answer: drop the token (it will never work again) and stop. */
  const endWith = (kind: Exit['kind'], forgetToken: boolean) => {
    conn.stop();
    const key = gameKey.value;
    if (forgetToken && key !== null) {
      storage.forgetGame(key);
      entry = null;
    }
    clearGame();
    exit.value = { kind };
  };

  /** Back to Home: nothing open, no exit screen. */
  const home = () => {
    conn.stop();
    clearGame();
    batch(() => {
      gameKey.value = null;
      exit.value = null;
    });
    entry = null;
  };

  const startConnection = (key: GameKey, login: GameEntry, join: Profile | null) => {
    clearGame();
    entry = login;
    pendingJoin = join;
    batch(() => {
      gameKey.value = key;
      exit.value = null;
    });
    conn.connect(key);
  };

  // ── Connection events ────────────────────────────────────────────────────
  const onOpen = () => {
    welcomed = false;
    const state = reclaim.value;
    if (state?.status === 'sending' && entry !== null) {
      // "That's me" must come from an anonymous socket — a fresh one, before any hello.
      conn.send({
        type: 'reclaim',
        playerId: state.playerId,
        token: entry.token,
        nickname: state.profile.nickname,
        presetId: state.profile.presetId,
      });
      return;
    }
    if (entry === null) return;
    conn.send({
      type: 'hello',
      token: entry.token,
      ...(entry.gameId !== undefined && { gameId: entry.gameId }),
      // Only for an explicit Join tap, until it is answered. The server resolves a KNOWN token
      // first (resume / LEFT / REMOVED), so a re-sent join can never turn a removed player into a
      // new one — and a hello lost before the server got it doesn't turn the tap into NOT_FOUND.
      ...(pendingJoin !== null && {
        join: { nickname: pendingJoin.nickname, presetId: pendingJoin.presetId },
      }),
    });
  };

  const onWelcome = (message: Extract<ServerMessage, { type: 'welcome' }>) => {
    const key = gameKey.value;
    if (key === null || entry === null) return;
    welcomed = true;
    conn.resetBackoff();
    entry = { token: entry.token, gameId: message.gameId };
    storage.saveGame(key, entry);
    pendingJoin = null;
    batch(() => {
      snapshot.value = message.snapshot;
      updating.value = false;
      joinError.value = null;
      reclaim.value = null;
      pending.value = new Set();
    });
    // A Leave that never reached the server: the reconnect resumed us, so ask again.
    if (leaving) send({ type: 'leave' }, 'leave');
    else syncPhoto(storage.loadPhoto(), false);
  };

  const onError = (message: ErrorMessage) => {
    if (message.for !== undefined && isPendingRequest(message.for)) setPending(message.for, false);
    const outcome = errorOutcome(message, leaving);
    switch (outcome.kind) {
      case 'exit':
        endWith(outcome.exit, outcome.forgetToken);
        return;
      case 'reload':
        conn.stop();
        if (!reloadOnce(storage, deps.now(), deps.reload)) endWith('refresh', false);
        return;
      case 'updating':
        updating.value = true; // the server closes the socket; the connection retries
        return;
      case 'leftDone':
        // The Leave went through earlier and its leftGame was lost: done all the same.
        if (gameKey.value !== null) storage.forgetGame(gameKey.value);
        home();
        return;
      case 'joinError':
        pendingJoin = null;
        joinError.value = outcome.joinError;
        return;
      case 'reclaimUnavailable':
        batch(() => {
          reclaim.value = null;
          notice.value = outcome.notice;
        });
        return;
      case 'resyncClock':
        conn.resyncClock();
        return;
      case 'notice':
        notice.value = outcome.notice;
        return;
      default: {
        const unknown: never = outcome;
        return unknown;
      }
    }
  };

  const onMessage = (message: ServerMessage) => {
    switch (message.type) {
      case 'welcome':
        onWelcome(message);
        return;
      case 'error':
        onError(message);
        return;
      case 'reclaimPending':
        reclaim.value = { status: 'pending' };
        return;
      case 'reclaimResult':
        // Approved → a welcome as that player follows. Denied → anonymous again: may join anew.
        reclaim.value = message.approved ? null : { status: 'denied' };
        return;
      case 'leftGame':
        if (gameKey.value !== null) storage.forgetGame(gameKey.value);
        home();
        return;
      default:
        break;
    }
    // Safety net: no delta before this socket's welcome (the server sends welcome first anyway).
    const current = snapshot.value;
    if (!welcomed || current === null) return;
    batch(() => {
      snapshot.value = applyDelta(current, message);
      settlePending(message, current.you.playerId);
    });
  };

  /** The answer to a request arrived as a broadcast: enable its button again. */
  const settlePending = (message: ServerMessage, mine: PlayerId) => {
    switch (message.type) {
      case 'roundStarted':
        setPending('start', false);
        setPending('advance', false);
        return;
      case 'playerReady':
        if (message.playerId === mine) setPending('submit', false);
        return;
      case 'settingsChanged':
        setPending('setSettings', false);
        return;
      case 'playerLeft':
        setPending('removePlayer', false);
        return;
      case 'reclaimClosed':
        setPending('answerReclaim', false); // the server closes a request on every answer
        return;
      case 'gameEnded':
      case 'newGame': // a new phase: whatever was in flight belongs to the old one
        pending.value = new Set();
        return;
      default:
        return;
    }
  };

  const onClose = (code: number) => {
    welcomed = false;
    switch (code) {
      case WS_CLOSE.REPLACED:
        if (exit.value === null) endWith('replaced', false);
        return;
      case WS_CLOSE.NOT_FOUND:
        if (exit.value === null) endWith('notFound', true);
        return;
      case WS_CLOSE.GAME_DELETED:
        // Retention or idle cleanup: the game is gone. A Game Over screen may stay as it is.
        if (snapshot.value?.phase === 'ENDED') {
          conn.stop();
          if (gameKey.value !== null) storage.forgetGame(gameKey.value);
        } else endWith('notFound', true);
        return;
      default:
        return; // the connection reconnects by itself
    }
  };

  // ── Intents (called by screens) ──────────────────────────────────────────
  const requireKey = (): GameKey | null => gameKey.value;

  /** Automatic: reopen a game this phone has a login for (refresh, "Return to game"). */
  const resume = (key: GameKey): boolean => {
    const login = storage.loadGame(key);
    if (login === null) return false;
    startConnection(key, login, null);
    return true;
  };

  return {
    // signals
    gameKey,
    snapshot,
    connectionStatus,
    updating,
    exit,
    joinError,
    reclaim,
    notice,
    pending,
    creating,
    createError,
    me,
    isHost,
    /** The server's current time (epoch ms) — every countdown and reveal step uses this. */
    serverNow: (): number => deps.clock.serverNow(),

    /** Wire the connection to the store (once, by whoever created both). */
    handlers: { onOpen, onMessage, onClose },

    /** Host a game: the token is saved in the pending-create slot BEFORE the request. */
    hostGame: async (profile: Profile): Promise<boolean> => {
      const token = deps.newToken();
      storage.savePendingCreate(token);
      batch(() => {
        creating.value = true;
        createError.value = null;
      });
      const result = await createGame(deps.fetch, { ...profile, token });
      // Answered or not, the slot is done: a lost answer means simply creating again.
      storage.clearPendingCreate();
      creating.value = false;
      if (!result.ok) {
        createError.value = result.code;
        return false;
      }
      const login: GameEntry = { token, gameId: result.gameId };
      storage.saveGame(result.key, login);
      startConnection(result.key, login, null);
      return true;
    },

    /** An explicit Join tap (Home, a join link). Reuses this phone's login for the key if any. */
    joinGame: (key: GameKey, profile: Profile): void => {
      const login = storage.loadGame(key) ?? { token: deps.newToken() };
      storage.saveGame(key, login); // saved before it is sent
      startConnection(key, login, profile);
    },

    /** "Join again" after LEFT / REMOVED: a NEW token, so it is a new player. */
    joinAgain: (key: GameKey, profile: Profile): void => {
      storage.forgetGame(key);
      const login = { token: deps.newToken() };
      storage.saveGame(key, login);
      startConnection(key, login, profile);
    },

    resume,

    /** Another name after NAME_TAKEN / INVALID_NICKNAME — same token (it was never used). */
    retryJoin: (profile: Profile): void => {
      const key = requireKey();
      if (key === null || entry === null) return;
      joinError.value = null;
      pendingJoin = profile;
      if (conn.status === 'open') onOpen();
      else conn.connect(key);
    },

    /** "That's me" (G-44): a new token, saved first, sent from this anonymous socket. */
    reclaimPlayer: (playerId: PlayerId, profile: Profile): void => {
      const key = requireKey();
      if (key === null) return;
      entry = { token: deps.newToken() };
      storage.saveGame(key, entry);
      pendingJoin = null;
      batch(() => {
        joinError.value = null;
        reclaim.value = { status: 'sending', playerId, profile };
      });
      // A fresh socket is anonymous for sure (onOpen sends the reclaim instead of a hello).
      conn.connect(key);
    },
    cancelReclaim: (): void => {
      send({ type: 'cancelReclaim' });
      reclaim.value = null;
    },

    /** "Use here" after "Opened somewhere else": take the game back to this page. */
    useHere: (): void => {
      const key = requireKey();
      if (key === null) return;
      if (!resume(key)) home();
    },

    /** Leave for good (G-41): the token is kept until `leftGame` (or LEFT) confirms it. */
    leave: (): void => {
      leaving = true;
      send({ type: 'leave' }, 'leave');
    },

    /** Close the game screen without leaving the game (the login stays for "Return to game"). */
    goHome: home,

    /**
     * A lazy chunk failed to load (`vite:preloadError`): a deploy removed the old hashed files.
     * Reload — sharing the once-per-minute cap with OUTDATED_CLIENT — or ask for a manual refresh.
     */
    lazyChunkFailed: (): void => {
      if (!reloadOnce(storage, deps.now(), deps.reload)) endWith('refresh', false);
    },

    dismissNotice: (): void => {
      notice.value = null;
    },

    // Plain requests
    updateProfile: (patch: { nickname?: string; presetId?: PresetId }): boolean => {
      return send({ type: 'updateProfile', ...patch });
    },
    /**
     * The player picked a new photo (a data URL from media/photo.ts). Uploaded if the game may take
     * it; otherwise it just waits in the saved profile for the next game. A removed photo (null)
     * stays in this game — the protocol has no "delete my photo" (open question in PLAN.md).
     */
    photoChanged: (photo: string | null): void => {
      syncPhoto(photo, true);
    },
    setSettings: (settings: Settings): boolean => {
      return send({ type: 'setSettings', settings }, 'setSettings');
    },
    start: (): boolean => {
      return send({ type: 'start' }, 'start');
    },
    submit: (ranking: readonly PlayerId[]): boolean => {
      const s = snapshot.value;
      if (s?.phase !== 'QUESTION') return false;
      return send({ type: 'submit', roundId: s.round.roundId, ranking: [...ranking] }, 'submit');
    },
    /** Next / Finish (G-45). */
    advance: (): boolean => {
      const s = snapshot.value;
      if (s?.phase !== 'RESULTS') return false;
      return send({ type: 'advance', roundId: s.round.roundId }, 'advance');
    },
    endGame: (): boolean => {
      return send({ type: 'end' }, 'end');
    },
    /** Game Over: the host takes the same group back to a fresh lobby (G-52). */
    playAgain: (): boolean => {
      return send({ type: 'playAgain' }, 'playAgain');
    },
    removePlayer: (playerId: PlayerId): boolean => {
      return send({ type: 'removePlayer', playerId }, 'removePlayer');
    },
    answerReclaim: (requestId: RequestId, approve: boolean): boolean => {
      return send({ type: 'answerReclaim', requestId, approve }, 'answerReclaim');
    },
  };
}
