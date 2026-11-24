// Worker entry point (stateless): routes API and WebSocket requests to the game's Durable Object.
// Everything else is served from the static assets (see `assets` in wrangler.jsonc), so this only
// runs for /api/* and /ws/*.
import * as v from 'valibot';
import {
  CREATE_GAME_ATTEMPTS,
  GAME_KEY_ALPHABET,
  GAME_KEY_LENGTH,
  MAX_MESSAGE_BYTES,
} from '../shared/constants';
import {
  CreateGameRequestSchema,
  type CreateGameResponse,
  GameIdSchema,
  GameKeySchema,
  PlayerIdSchema,
  type GameKey,
  type PlayerId,
} from '../shared/protocol';
import { GameObject } from './GameObject';
import { readLimited } from './core/body';
import { httpError } from './core/http';
import { newGameKey } from './core/random';
import { servePhoto, uploadPhoto } from './photos/photoRoutes';

export { GameObject };

const KEY = `[${GAME_KEY_ALPHABET}]{${String(GAME_KEY_LENGTH)}}`;
const ID = '[0-9A-Za-z]{12}';
const WS_PATH = new RegExp(`^/ws/(${KEY})$`);
const PHOTO_UPLOAD = new RegExp(`^/api/games/(${KEY})/photos/(${ID})$`);
const PHOTO_DOWNLOAD = new RegExp(`^/api/games/(${KEY})/(${ID})/photos/(${ID})$`);

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/games') {
      if (request.method !== 'POST') return httpError(405, 'NOT_ALLOWED');
      return createGame(request, env);
    }

    const upload = PHOTO_UPLOAD.exec(url.pathname);
    if (upload) {
      if (request.method !== 'PUT') return httpError(405, 'NOT_ALLOWED');
      return uploadPhoto(request, env, gameKey(upload[1]), playerIdOf(upload[2]));
    }
    const download = PHOTO_DOWNLOAD.exec(url.pathname);
    if (download) {
      if (request.method !== 'GET') return httpError(405, 'NOT_ALLOWED');
      return servePhoto(
        env,
        gameKey(download[1]),
        v.parse(GameIdSchema, download[2]),
        playerIdOf(download[3]),
        url.searchParams.get('v'),
      );
    }

    const key = WS_PATH.exec(url.pathname)?.[1];
    if (key !== undefined) {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected a WebSocket upgrade', { status: 426 });
      }
      // Any well-formed key reaches its object; an unknown game is answered over the socket
      // (NOT_FOUND + close), because browsers hide the HTTP status of a failed upgrade.
      return env.GAME.getByName(key).fetch(request);
    }

    // Malformed keys (no real phone builds one) and unknown API routes.
    return httpError(404, 'NOT_FOUND');
  },
} satisfies ExportedHandler<Env>;

/**
 * POST /api/games {nickname, presetId, token} → {key, gameId}. Picks a random key and asks that
 * key's object to claim it — atomically inside the object; a taken key is retried with a new one.
 * `nextKey` is injectable so a test can force every attempt to collide (→ CREATE_FAILED).
 */
export async function createGame(
  request: Request,
  env: Env,
  nextKey: () => GameKey = newGameKey,
): Promise<Response> {
  const body = await readLimited(request, MAX_MESSAGE_BYTES);
  if (body === null) return httpError(413, 'INVALID');
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return httpError(400, 'INVALID');
  }
  const parsed = v.safeParse(CreateGameRequestSchema, data);
  if (!parsed.success) return httpError(400, 'INVALID');

  for (let attempt = 0; attempt < CREATE_GAME_ATTEMPTS; attempt++) {
    const key = nextKey();
    const outcome = await env.GAME.getByName(key).claim({ key, ...parsed.output });
    if (outcome.ok) {
      const response: CreateGameResponse = { key, gameId: outcome.gameId };
      return Response.json(response, { status: 201 });
    }
    if (outcome.error !== 'TAKEN') return httpError(400, outcome.error);
  }
  return httpError(503, 'CREATE_FAILED');
}

// The regexes above already guarantee the formats; parsing gives the values their brand.
function gameKey(value: string | undefined): GameKey {
  return v.parse(GameKeySchema, value);
}

function playerIdOf(value: string | undefined): PlayerId {
  return v.parse(PlayerIdSchema, value);
}
