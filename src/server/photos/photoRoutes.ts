// The photo routes (CLAUDE.md §5 HTTP). The Worker checks what it can without the game — the token's
// shape, the size (counted while streaming), the image type (magic bytes) — and the game's object
// decides the rest (whose photo, which phase) and stores it.
import * as v from 'valibot';
import { MAX_PHOTO_BYTES } from '../../shared/constants';
import {
  TokenSchema,
  type GameId,
  type GameKey,
  type PlayerId,
  type UploadPhotoResponse,
} from '../../shared/protocol';
import { readLimited } from '../core/body';
import { httpError } from '../core/http';
import { detectPhotoType } from './photoStore';

/** PUT /api/games/<KEY>/photos/<playerId> — body: JPEG/WebP ≤ 64 KB, `Authorization: Bearer <token>`. */
export async function uploadPhoto(
  request: Request,
  env: Env,
  key: GameKey,
  playerId: PlayerId,
): Promise<Response> {
  const token = bearerToken(request);
  if (token === null) return httpError(401, 'NOT_ALLOWED');
  const bytes = await readLimited(request, MAX_PHOTO_BYTES);
  if (bytes === null) return httpError(413, 'INVALID');
  const contentType = detectPhotoType(bytes);
  if (contentType === null) return httpError(415, 'INVALID');

  const outcome = await env.GAME.getByName(key).storePhoto({ playerId, token, contentType, bytes });
  switch (outcome.result) {
    case 'ok': {
      const body: UploadPhotoResponse = { photoVersion: outcome.photoVersion };
      return Response.json(body);
    }
    case 'noGame':
    case 'unknownPlayer':
      return httpError(404, 'NOT_FOUND');
    case 'wrongToken':
      return httpError(401, 'NOT_ALLOWED');
    case 'notActive':
      return httpError(403, 'NOT_ALLOWED');
    case 'locked':
      return httpError(409, 'NOT_ALLOWED'); // changing a photo is lobby-only (G-5)
    case 'failed':
      // A server bug (logged): the phone keeps its preset avatar, as for any failed upload.
      return httpError(500, 'INVALID');
  }
}

/**
 * GET /api/games/<KEY>/<gameId>/photos/<playerId>?v=<version>. The URL names one exact image — a
 * different game (reused key) or version is a 404 — so it can be cached forever, privately: faces
 * must never enter shared caches.
 */
export async function servePhoto(
  env: Env,
  key: GameKey,
  gameId: GameId,
  playerId: PlayerId,
  versionParam: string | null,
): Promise<Response> {
  const version =
    versionParam !== null && /^\d{1,9}$/.test(versionParam) ? Number(versionParam) : 0;
  if (version < 1) return httpError(404, 'NOT_FOUND');
  const photo = await env.GAME.getByName(key).getPhoto({ gameId, playerId, version });
  if (photo === null) return httpError(404, 'NOT_FOUND');
  return new Response(photo.bytes, {
    headers: {
      'Content-Type': photo.contentType,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function bearerToken(request: Request): string | null {
  const match = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '');
  const parsed = v.safeParse(TokenSchema, match?.[1]);
  return parsed.success ? parsed.output : null;
}
