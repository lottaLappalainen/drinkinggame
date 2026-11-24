// HTTP calls (CLAUDE.md §5 HTTP). Responses are checked loosely — the server answers with
// schema-valid bodies; anything else is treated as a failure, never trusted.
import type { PresetId } from '../../shared/avatars';
import type { CreateGameRequest, ErrorCode, GameId, GameKey } from '../../shared/protocol';
import { isGameKey } from '../storage';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type CreateGameResult =
  | { readonly ok: true; readonly key: GameKey; readonly gameId: GameId }
  /** `code` from the server's `{error}` body; NETWORK = no answer at all (offline, timeout). */
  | { readonly ok: false; readonly code: ErrorCode | 'NETWORK' };

/** POST /api/games — the token must already be saved in the pending-create slot. */
export async function createGame(
  fetchFn: FetchLike,
  request: { nickname: string; presetId: PresetId; token: string },
): Promise<CreateGameResult> {
  const body: CreateGameRequest = request;
  let response: Response;
  try {
    response = await fetchFn('/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: 'NETWORK' };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  if (typeof json !== 'object' || json === null) return { ok: false, code: 'NETWORK' };
  const { key, gameId, error } = json as Record<string, unknown>;
  if (response.ok && typeof key === 'string' && isGameKey(key) && typeof gameId === 'string')
    return { ok: true, key, gameId: gameId as GameId };
  return { ok: false, code: typeof error === 'string' ? (error as ErrorCode) : 'NETWORK' };
}
