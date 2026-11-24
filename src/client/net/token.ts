// The phone's own login token for one game (CLAUDE.md §3 "Phone-generated tokens"): 192 random
// bits, base64url. `crypto.getRandomValues` works without a secure context too (http:// on a LAN).

export function newToken(randomBytes: (n: number) => Uint8Array = browserRandomBytes): string {
  const bytes = randomBytes(24);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function browserRandomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}
