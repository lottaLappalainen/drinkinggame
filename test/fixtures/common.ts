// Building blocks shared by the fixtures. Ids are created through the protocol schemas, so they
// carry their brand (PlayerId, ConnId, …) AND are checked against the real format.
import * as v from 'valibot';
import type { PresetId } from '../../src/shared/avatars';
import { REVEAL_BUFFER_MS } from '../../src/shared/constants';
import {
  ConnIdSchema,
  GameIdSchema,
  GameKeySchema,
  PlayerIdSchema,
  RequestIdSchema,
  type Avatar,
  type ConnId,
  type GameId,
  type GameKey,
  type PlayerId,
  type PublicPlayer,
  type RequestId,
} from '../../src/shared/protocol';

export const playerId = (id: string): PlayerId => v.parse(PlayerIdSchema, id);
export const connId = (id: string): ConnId => v.parse(ConnIdSchema, id);
export const gameId = (id: string): GameId => v.parse(GameIdSchema, id);
export const requestId = (id: string): RequestId => v.parse(RequestIdSchema, id);
export const gameKey = (key: string): GameKey => v.parse(GameKeySchema, key);

/** A fixed point in time so fixtures are deterministic. */
export const T0 = 1_800_000_000_000;

export const GAME_KEY = gameKey('ABCDE');
export const GAME_ID = gameId('Game00000001');

export const P = {
  mikko: playerId('Mikko0000001'),
  aino: playerId('Aino00000002'),
  ville: playerId('Ville0000003'),
  sanna: playerId('Sanna0000004'),
  juho: playerId('Juho00000005'),
  emma: playerId('Emma00000006'),
  late: playerId('Late00000007'),
} as const;

/** The sockets of the four lobby players in the state fixtures (states.ts). */
export const C = {
  mikko: connId('conn-mikko'),
  aino: connId('conn-aino'),
  ville: connId('conn-ville'),
  sanna: connId('conn-sanna'),
  requester: connId('conn-requester'),
} as const;

export const REQUEST_ID = requestId('Req000000001');

export function preset(presetId: PresetId): Avatar {
  return { presetId, photoVersion: null };
}

export function player(
  id: PlayerId,
  nickname: string,
  overrides: Partial<Omit<PublicPlayer, 'playerId' | 'nickname'>> = {},
): PublicPlayer {
  return {
    playerId: id,
    nickname,
    avatar: preset('fox'),
    status: 'active',
    online: true,
    offlineSince: null,
    waitingForNextRound: false,
    ...overrides,
  };
}

/** Six players: Mikko hosts; Juho has a photo; Emma has been offline for 3 minutes. */
export function sixPlayers(): PublicPlayer[] {
  return [
    player(P.mikko, 'Mikko', { avatar: preset('fox') }),
    player(P.aino, 'Aino', { avatar: preset('cat') }),
    player(P.ville, 'Ville', { avatar: preset('panda') }),
    player(P.sanna, 'Sanna', { avatar: preset('owl') }),
    player(P.juho, 'Juho 🍕', { avatar: { presetId: 'frog', photoVersion: 1 } }),
    player(P.emma, 'Emma', {
      avatar: preset('unicorn'),
      online: false,
      offlineSince: T0 - 180_000,
    }),
  ];
}

/**
 * A big game (Podium, G-24): the six players above plus generated guests, `count` in total
 * (7 … MAX_PLAYERS). Guest ids are "Guest0000007", "Guest0000008", …
 */
export function manyPlayers(count: number): PublicPlayer[] {
  const guests = Array.from({ length: Math.max(0, count - 6) }, (_, i) =>
    player(guestId(i + 7), `Guest ${String(i + 7)}`, { avatar: preset('owl') }),
  );
  return [...sixPlayers(), ...guests];
}

export function guestId(n: number): PlayerId {
  return playerId(`Guest${String(n).padStart(7, '0')}`);
}

/** Results are sent this long before the reveal starts (shared constant). */
export const RESULTS_SENT_AT = T0 + 60_000;
export const REVEAL_STARTS_AT = RESULTS_SENT_AT + REVEAL_BUFFER_MS;
