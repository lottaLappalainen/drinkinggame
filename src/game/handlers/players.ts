// Player-side game logic: the own profile, the host's lobby settings, leaving and removal, photos
// and the player deadlines. The rest of the player side: handlers/session.ts (claim, hello, join),
// handlers/reclaim.ts ("That's me"), handlers/sockets.ts (open, close, rebuild).
//
// Conventions for every handler in handlers/:
// - MUTATE `draft` (a private deep copy owned by the engine); return the effects.
// - The engine has already checked: sender identity, host-only, phase, stale roundId — a player
//   message gets a resolved `PlayerSender` (its player is in the draft, active, on this socket).
// - Never decide round end / ready counter / pause here — that is rounds.onPlayersChanged,
//   which the engine calls automatically after any change to who is online or active.
import { PODIUM_MIN_PLAYERS, REMOVE_OFFLINE_MIN_MS } from '../../shared/constants';
import { validateNickname, nameKey } from '../../shared/nickname';
import type { PlayerId, Settings } from '../../shared/protocol';
import { normalizeCategories } from '../../shared/questionCategories';
import { idleCleanupAt } from '../deadlines';
import { broadcast, errorTo, send, unbind } from '../effects';
import { changeHost, pickNewHost, runHandover } from '../players/host';
import { nextPhotoVersion } from '../players/photos';
import { activePlayers, refreshIdle, setOffline } from '../players/presence';
import { denyReclaimsFor, expireReclaims } from '../players/reclaims';
import type { GameState } from '../stateSchema';
import type { Ctx, Effect, EngineEvent, EngineMessageOf, PlayerSender } from '../types';

// ── Profile & settings (lobby only — the engine checks the phase) ────────────

/** Own nickname / preset, LOBBY only (G-1, G-5, G-6). photoVersion is never set here. */
export function handleUpdateProfile(
  draft: GameState,
  msg: EngineMessageOf<'updateProfile'>,
  sender: PlayerSender,
  _ctx: Ctx,
): Effect[] {
  const { playerId, player } = sender;
  const before = JSON.stringify(player);

  if (msg.nickname !== undefined) {
    const name = validateNickname(msg.nickname);
    if (!name.ok) return [errorTo(sender.connId, 'INVALID_NICKNAME', 'updateProfile')];
    const key = nameKey(name.nickname);
    const taken = activePlayers(draft).some(([id, p]) => id !== playerId && p.nameKey === key);
    if (taken)
      return [send(sender.connId, { type: 'error', code: 'NAME_TAKEN', for: 'updateProfile' })];
    player.nickname = name.nickname;
    player.nameKey = key;
  }
  if (msg.presetId !== undefined) player.avatar.presetId = msg.presetId;

  if (JSON.stringify(player) === before) return [];
  return [
    broadcast({
      type: 'playerUpdated',
      playerId,
      nickname: player.nickname,
      avatar: { ...player.avatar },
    }),
  ];
}

/**
 * Host, LOBBY only: game length, add-on categories and game mode (G-20, G-22, G-24). Takes the
 * whole settings object. Switching TO Podium needs PODIUM_MIN_PLAYERS active players; a Podium
 * choice that is already set stays when players leave (never changed silently — `start` refuses
 * it instead, and the host may still change other settings meanwhile).
 */
export function handleSetSettings(
  draft: GameState,
  msg: EngineMessageOf<'setSettings'>,
  sender: PlayerSender,
  _ctx: Ctx,
): Effect[] {
  const next: Settings = {
    gameLength: msg.settings.gameLength,
    categories: normalizeCategories(msg.settings.categories),
    mode: msg.settings.mode,
  };
  if (JSON.stringify(next) === JSON.stringify(draft.settings)) return [];
  const switchingToPodium = next.mode === 'podium' && draft.settings.mode !== 'podium';
  if (switchingToPodium && activePlayers(draft).length < PODIUM_MIN_PLAYERS)
    return [errorTo(sender.connId, 'NOT_ENOUGH_PLAYERS', 'setSettings')];
  draft.settings = next;
  return [
    broadcast({ type: 'settingsChanged', settings: { ...next, categories: [...next.categories] } }),
  ];
}

// ── Leaving & removal (G-41, G-43) ──────────────────────────────────────────

/** Leave for good (G-41). */
export function handleLeave(
  draft: GameState,
  _msg: EngineMessageOf<'leave'>,
  sender: PlayerSender,
  ctx: Ctx,
): Effect[] {
  return retirePlayer(draft, sender.playerId, 'left', ctx.now);
}

/** Host removes a player offline ≥ REMOVE_OFFLINE_MIN_MS (G-43); same effects as leaving. */
export function handleRemovePlayer(
  draft: GameState,
  msg: EngineMessageOf<'removePlayer'>,
  sender: PlayerSender,
  ctx: Ctx,
): Effect[] {
  const target = draft.players[msg.playerId];
  const offlineLongEnough =
    target?.status === 'active' &&
    target.connId === null &&
    target.offlineSince !== null &&
    ctx.now - target.offlineSince >= REMOVE_OFFLINE_MIN_MS;
  if (!offlineLongEnough) return [errorTo(sender.connId, 'NOT_ALLOWED', 'removePlayer')];
  return retirePlayer(draft, msg.playerId, 'removed', ctx.now);
}

/**
 * Leave / remove: the player stays on record (their token then gets LEFT / REMOVED), no longer
 * counts toward MAX_PLAYERS, frees their name, can't be ranked in later rounds, and any pending
 * "That's me" for them is closed. A leaving host hands over at once (G-41).
 */
function retirePlayer(
  draft: GameState,
  playerId: PlayerId,
  reason: 'left' | 'removed',
  now: number,
): Effect[] {
  const player = draft.players[playerId];
  if (player === undefined) return [];
  const socket = player.connId;
  player.status = reason;
  const effects: Effect[] = [...setOffline(draft, playerId, now)];
  if (socket !== null) {
    // Confirm to the leaving phone (it keeps its token until this arrives — if the leave or this
    // reply is lost, its reconnect gets LEFT). The socket becomes anonymous; the phone goes Home.
    effects.push(send(socket, { type: 'leftGame' }));
    const connection = draft.connections[socket];
    if (connection) delete connection.playerId;
    effects.push(unbind(socket));
  }
  effects.push(broadcast({ type: 'playerLeft', playerId, reason }));
  effects.push(...denyReclaimsFor(draft, playerId));
  if (draft.hostId === playerId) effects.push(...changeHost(draft, pickNewHost(draft)));
  refreshIdle(draft, now);
  return effects;
}

/** Photo bytes stored: bump avatar.photoVersion, broadcast playerUpdated. */
export function onPhotoStored(
  draft: GameState,
  event: Extract<EngineEvent, { kind: 'photoStored' }>,
  _ctx: Ctx,
): Effect[] {
  const player = draft.players[event.playerId];
  if (player?.status !== 'active') return [];
  player.avatar.photoVersion = nextPhotoVersion(player);
  return [
    broadcast({
      type: 'playerUpdated',
      playerId: event.playerId,
      nickname: player.nickname,
      avatar: { ...player.avatar },
    }),
  ];
}

/**
 * Player-side deadlines due at ctx.now: retention after ENDED and idle cleanup (→ deleteGame),
 * host handover (60 s), reclaim expiry (5 min) — see game/deadlines.ts.
 */
export function onPlayerDeadlines(draft: GameState, ctx: Ctx): Effect[] {
  const { retention, hostHandover } = draft.deadlines;
  if (draft.phase === 'ENDED' && retention !== undefined && retention <= ctx.now)
    return [{ kind: 'deleteGame' }]; // G-48
  const idleUntil = idleCleanupAt(draft);
  if (idleUntil !== null && idleUntil <= ctx.now) return [{ kind: 'deleteGame' }];

  const effects: Effect[] = [];
  if (hostHandover !== undefined && hostHandover <= ctx.now) effects.push(...runHandover(draft));
  effects.push(...expireReclaims(draft, ctx.now));
  return effects;
}
