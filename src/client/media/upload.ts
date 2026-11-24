// Uploading this phone's photo (CLAUDE.md §5 HTTP, §6 "Avatars — photos"): PUT over HTTP, never
// through the WebSocket, authorised by the player's own token. Automatic right after joining (any
// phase, as long as the game has no photo of ours yet) and after a photo change in the lobby.
// Network failures and server errors are retried a few times; a refusal (4xx) is final — the
// player keeps the ready-made avatar, which is what everyone sees while a photo is missing anyway.
import type { GameKey, PlayerId } from '../../shared/protocol';
import type { FetchLike } from '../net/api';
import type { Timers } from '../net/connection';
import { dataUrlToBlob } from './photo';

/** Waits before the retries (after the first try fails). */
export const PHOTO_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 15_000];

export type UploadOutcome =
  | { readonly ok: true; readonly photoVersion: number }
  | { readonly ok: false; readonly retry: boolean };

/** PUT /api/games/<KEY>/photos/<playerId>. */
export async function putPhoto(
  fetchFn: FetchLike,
  request: { key: GameKey; playerId: PlayerId; token: string; photo: Blob },
): Promise<UploadOutcome> {
  let response: Response;
  try {
    response = await fetchFn(`/api/games/${request.key}/photos/${request.playerId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${request.token}`, 'Content-Type': request.photo.type },
      body: request.photo,
    });
  } catch {
    return { ok: false, retry: true };
  }
  if (!response.ok) return { ok: false, retry: response.status >= 500 };
  try {
    const { photoVersion } = (await response.json()) as Record<string, unknown>;
    if (typeof photoVersion === 'number') return { ok: true, photoVersion };
  } catch {
    // fall through
  }
  return { ok: false, retry: false };
}

export type UploadTarget = {
  readonly key: GameKey;
  readonly playerId: PlayerId;
  readonly token: string;
};

export type PhotoUploader = ReturnType<typeof createPhotoUploader>;

/**
 * One upload at a time. `upload(target, dataUrl)` replaces whatever is in flight or waiting for a
 * retry; uploading the same photo for the same player again after it succeeded does nothing.
 */
export function createPhotoUploader(deps: { fetch: FetchLike; timers: Timers }) {
  /** Bumped on every new upload / cancel: answers of an older one are ignored. */
  let run = 0;
  let retryTimer: number | null = null;
  let done: { playerId: PlayerId; key: GameKey; dataUrl: string } | null = null;
  let active: { target: UploadTarget; dataUrl: string } | null = null;

  const clearRetry = () => {
    if (retryTimer !== null) deps.timers.clearTimeout(retryTimer);
    retryTimer = null;
  };

  const attempt = (myRun: number, target: UploadTarget, dataUrl: string, tries: number) => {
    const photo = dataUrlToBlob(dataUrl);
    if (photo === null) {
      active = null;
      return;
    }
    void putPhoto(deps.fetch, { ...target, photo }).then((outcome) => {
      if (myRun !== run) return;
      if (outcome.ok) {
        done = { playerId: target.playerId, key: target.key, dataUrl };
        active = null;
        return;
      }
      const delay = outcome.retry ? PHOTO_RETRY_DELAYS_MS[tries] : undefined;
      if (delay === undefined) {
        active = null;
        return;
      }
      retryTimer = deps.timers.setTimeout(() => {
        retryTimer = null;
        if (myRun === run) attempt(myRun, target, dataUrl, tries + 1);
      }, delay);
    });
  };

  return {
    upload(target: UploadTarget, dataUrl: string): void {
      const same = (u: { key: GameKey; playerId: PlayerId; dataUrl: string } | null) =>
        u !== null &&
        u.key === target.key &&
        u.playerId === target.playerId &&
        u.dataUrl === dataUrl;
      if (same(done) || (active !== null && same({ ...active.target, dataUrl: active.dataUrl })))
        return;
      clearRetry();
      run++;
      active = { target, dataUrl };
      attempt(run, target, dataUrl, 0);
    },
    /** Leaving the game: drop any upload in flight or waiting. */
    cancel(): void {
      clearRetry();
      run++;
      active = null;
    },
  };
}
