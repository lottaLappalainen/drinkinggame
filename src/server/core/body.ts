// Reading an HTTP body with a hard size cap, counted while streaming — a `Content-Length` header is
// a claim, not a fact (CLAUDE.md §6). Shared by create-game and (4B) photo uploads.

/** The body's bytes, or null if it is larger than `limit`. */
export async function readLimited(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (request.body === null) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    const chunk: unknown = result.value;
    if (!(chunk instanceof Uint8Array)) {
      await reader.cancel();
      return null; // request bodies are always bytes; anything else is not ours to read
    }
    size += chunk.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
