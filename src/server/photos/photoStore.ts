// Profile photos in the game object's own storage — one KV entry per player, SEPARATE from the game
// state, so saving the state never rewrites photos (CLAUDE.md §4). `deleteAll()` on game deletion
// removes them with everything else (G-48).
import type { PlayerId } from '../../shared/protocol';

export type PhotoContentType = 'image/jpeg' | 'image/webp';

export type StoredPhoto = {
  readonly contentType: PhotoContentType;
  readonly bytes: Uint8Array;
};

const PREFIX = 'photo:';

export function photoKey(playerId: PlayerId): string {
  return `${PREFIX}${playerId}`;
}

export function putPhoto(kv: SyncKvStorage, playerId: PlayerId, photo: StoredPhoto): void {
  kv.put(photoKey(playerId), photo);
}

export function getPhoto(kv: SyncKvStorage, playerId: PlayerId): StoredPhoto | undefined {
  const stored: unknown = kv.get(photoKey(playerId));
  if (typeof stored !== 'object' || stored === null) return undefined;
  const { contentType, bytes } = stored as Partial<Record<keyof StoredPhoto, unknown>>;
  if (
    (contentType !== 'image/jpeg' && contentType !== 'image/webp') ||
    !(bytes instanceof Uint8Array)
  )
    return undefined;
  return { contentType, bytes };
}

/**
 * The image type from the file's first bytes — never from a header the phone sends
 * (CLAUDE.md §7: "verify image magic bytes"). Only JPEG and WebP are photos here.
 */
export function detectPhotoType(bytes: Uint8Array): PhotoContentType | null {
  const at = (i: number) => bytes[i];
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  // WebP: "RIFF" <4-byte size> "WEBP"
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}
