// Building blocks shared by the fixtures. Ids follow the protocol format (12 base62 chars).
import { REVEAL_BUFFER_MS } from '../../src/shared/constants';
import type { Avatar, PublicPlayer } from '../../src/shared/protocol';

/** A fixed point in time so fixtures are deterministic. */
export const T0 = 1_800_000_000_000;

export const GAME_KEY = 'ABCDE';
export const GAME_ID = 'Game00000001';

export const P = {
  mikko: 'Mikko0000001',
  aino: 'Aino00000002',
  ville: 'Ville0000003',
  sanna: 'Sanna0000004',
  juho: 'Juho00000005',
  emma: 'Emma00000006',
  late: 'Late00000007',
} as const;

export const REQUEST_ID = 'Req000000001';

export function preset(presetId: string): Avatar {
  return { presetId, photoVersion: null };
}

export function player(
  playerId: string,
  nickname: string,
  overrides: Partial<Omit<PublicPlayer, 'playerId' | 'nickname'>> = {},
): PublicPlayer {
  return {
    playerId,
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

/** Results are sent this long before the reveal starts (shared constant). */
export const RESULTS_SENT_AT = T0 + 60_000;
export const REVEAL_STARTS_AT = RESULTS_SENT_AT + REVEAL_BUFFER_MS;
