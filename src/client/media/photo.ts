// The phone's photo pipeline (CLAUDE.md §6 "Avatars — photos", G-2): decode the picked image (EXIF
// orientation respected) → centre-crop to a square → shrink to PHOTO_SIZE_PX → WebP 0.8, or JPEG
// where the browser can't encode WebP (iOS Safari 16 returns PNG for 'image/webp') → small enough
// for the server's MAX_PHOTO_BYTES. The browser parts are injected (`ImageEnv`) so the decisions —
// crop maths, which encoding to keep — are tested in Node.
import { MAX_PHOTO_BYTES, PHOTO_SIZE_PX } from '../../shared/constants';

export type PhotoType = 'image/webp' | 'image/jpeg';

/** What the server accepts (its magic-byte check), tried in this order. */
const ENCODINGS: readonly { type: PhotoType; quality: number }[] = [
  { type: 'image/webp', quality: 0.8 },
  { type: 'image/jpeg', quality: 0.8 },
  { type: 'image/webp', quality: 0.5 },
  { type: 'image/jpeg', quality: 0.5 },
];

export type PreparedPhoto =
  | { readonly ok: true; readonly dataUrl: string; readonly bytes: number }
  /** unreadable = the phone can't decode it (HEIC on some Androids, odd formats). */
  | { readonly ok: false; readonly reason: 'unreadable' | 'encodeFailed' };

/** The square to cut from a `width × height` image: the largest centred one. */
export function squareCrop(
  width: number,
  height: number,
): { sx: number; sy: number; size: number } {
  const size = Math.max(0, Math.min(width, height));
  return { sx: Math.floor((width - size) / 2), sy: Math.floor((height - size) / 2), size };
}

/**
 * The first encoding the server accepts and that fits. The blob's REAL type is checked: a browser
 * that can't write the requested format silently returns PNG instead.
 */
export async function encodeSmallest(
  encode: (type: PhotoType, quality: number) => Promise<Blob | null>,
): Promise<Blob | null> {
  for (const { type, quality } of ENCODINGS) {
    let blob: Blob | null;
    try {
      blob = await encode(type, quality);
    } catch {
      blob = null;
    }
    if (blob !== null && blob.type === type && blob.size > 0 && blob.size <= MAX_PHOTO_BYTES)
      return blob;
  }
  return null;
}

/** The browser pieces, injectable for tests. */
export type ImageEnv = {
  /** Decode a picked file (null = can't read it). */
  decode(file: Blob): Promise<DecodedImage | null>;
  /** Draw the crop at PHOTO_SIZE_PX square; returns the encoder for that drawing. */
  draw(
    image: DecodedImage,
    crop: ReturnType<typeof squareCrop>,
  ): (type: PhotoType, quality: number) => Promise<Blob | null>;
  toDataUrl(blob: Blob): Promise<string>;
};

export type DecodedImage = { readonly width: number; readonly height: number; close(): void };

export async function preparePhoto(
  file: Blob,
  env: ImageEnv = browserImageEnv(),
): Promise<PreparedPhoto> {
  const image = await env.decode(file);
  if (image === null || image.width < 1 || image.height < 1) {
    image?.close();
    return { ok: false, reason: 'unreadable' };
  }
  try {
    const blob = await encodeSmallest(env.draw(image, squareCrop(image.width, image.height)));
    if (blob === null) return { ok: false, reason: 'encodeFailed' };
    return { ok: true, dataUrl: await env.toDataUrl(blob), bytes: blob.size };
  } catch {
    return { ok: false, reason: 'encodeFailed' };
  } finally {
    image.close();
  }
}

/** A stored photo (data URL) back into upload bytes; null if it isn't a JPEG/WebP data URL. */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:(image\/(?:webp|jpeg));base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  if (match === null) return null;
  const [, type, base64] = match;
  if (type === undefined || base64 === undefined) return null;
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  } catch {
    return null;
  }
}

function browserImageEnv(): ImageEnv {
  return {
    decode: async (file) => {
      try {
        // 'from-image' = apply the EXIF rotation, so phone photos aren't sideways.
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch {
        return null;
      }
    },
    draw: (image, crop) => {
      const canvas = document.createElement('canvas');
      canvas.width = PHOTO_SIZE_PX;
      canvas.height = PHOTO_SIZE_PX;
      const context = canvas.getContext('2d');
      if (context !== null) {
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(
          image, // structurally an ImageBitmap (what `decode` returns in the browser)
          crop.sx,
          crop.sy,
          crop.size,
          crop.size,
          0,
          0,
          PHOTO_SIZE_PX,
          PHOTO_SIZE_PX,
        );
      }
      return (type, quality) =>
        context === null
          ? Promise.resolve(null)
          : new Promise((resolve) => {
              canvas.toBlob(resolve, type, quality);
            });
    },
    toDataUrl: (blob) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') resolve(reader.result);
          else reject(new Error('no data URL'));
        };
        reader.onerror = () => {
          reject(new Error('read failed'));
        };
        reader.readAsDataURL(blob);
      }),
  };
}
