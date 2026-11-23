// Untrusted input from a phone → an engine message (CLAUDE.md §7 "Validation & safety").
// Order: binary? → size in BYTES (before parsing anything) → JSON → Valibot schema → hash the token.
// The raw token never goes further than this file: the engine and the saved state only see hashes.
import { createHash } from 'node:crypto';
import * as v from 'valibot';
import { MAX_MESSAGE_BYTES } from '../../shared/constants';
import {
  CLIENT_MESSAGE_TYPES,
  ClientMessageSchema,
  type ClientMessageType,
  type ServerMessage,
} from '../../shared/protocol';
import type { EngineClientMessage } from '../../game/types';

/** SHA-256 hex of a phone-generated token (synchronous: the whole event stays synchronous, §4). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type Incoming =
  | { readonly ok: true; readonly msg: EngineClientMessage }
  | { readonly ok: false; readonly reply: ServerMessage };

const encoder = new TextEncoder();

export function parseIncoming(raw: string | ArrayBuffer): Incoming {
  if (typeof raw !== 'string') return invalid(); // binary frames are never ours
  if (encoder.encode(raw).length > MAX_MESSAGE_BYTES) return invalid();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return invalid();
  }
  const parsed = v.safeParse(ClientMessageSchema, data);
  if (!parsed.success) return invalid(knownType(data));

  const msg = parsed.output;
  if (msg.type === 'hello' || msg.type === 'reclaim') {
    const { token, ...rest } = msg;
    return { ok: true, msg: { ...rest, tokenHash: hashToken(token) } };
  }
  return { ok: true, msg };
}

function invalid(forType?: ClientMessageType): Incoming {
  return {
    ok: false,
    reply:
      forType === undefined
        ? { type: 'error', code: 'INVALID' }
        : { type: 'error', code: 'INVALID', for: forType },
  };
}

/** The message's `type`, if it names a real client message — so the phone knows what failed. */
function knownType(data: unknown): ClientMessageType | undefined {
  if (typeof data !== 'object' || data === null || !('type' in data)) return undefined;
  const type: unknown = data.type;
  return CLIENT_MESSAGE_TYPES.find((known) => known === type);
}
