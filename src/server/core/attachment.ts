// What each socket remembers about itself (`ws.serializeAttachment`) — it survives hibernation, so
// after a wake the DO can rebuild who every open socket belongs to (CLAUDE.md §4).
import * as v from 'valibot';
import { ConnIdSchema, PlayerIdSchema, RequestIdSchema } from '../../shared/protocol';
import type { ConnId, PlayerId, RequestId } from '../../shared/protocol';

export const AttachmentSchema = v.object({
  connId: ConnIdSchema,
  /** From the WebSocket URL (`?v=N`) at accept time — the one source of a socket's version. */
  protocolVersion: v.pipe(v.number(), v.integer(), v.minValue(0)),
  /** Server time the socket was accepted: its last sign of life until its first ping. */
  openedAt: v.number(),
  playerId: v.exactOptional(PlayerIdSchema),
  reclaimRequestId: v.exactOptional(RequestIdSchema),
});

export type Attachment = v.InferOutput<typeof AttachmentSchema>;

/** The socket's attachment, or null if it has none we can trust (never written by us). */
export function readAttachment(ws: WebSocket): Attachment | null {
  const parsed = v.safeParse(AttachmentSchema, ws.deserializeAttachment());
  return parsed.success ? parsed.output : null;
}

/**
 * Record who the socket belongs to now (`bindConnection` effect). Both ids absent = anonymous
 * again. The socket's own facts (connId, version, openedAt) are kept.
 */
export function bindAttachment(
  ws: WebSocket,
  identity: { readonly playerId?: PlayerId; readonly reclaimRequestId?: RequestId },
): void {
  const current = readAttachment(ws);
  if (current === null) return;
  const next: Attachment = {
    connId: current.connId,
    protocolVersion: current.protocolVersion,
    openedAt: current.openedAt,
    ...(identity.playerId !== undefined && { playerId: identity.playerId }),
    ...(identity.reclaimRequestId !== undefined && { reclaimRequestId: identity.reclaimRequestId }),
  };
  ws.serializeAttachment(next);
}

export function newAttachment(
  connId: ConnId,
  protocolVersion: number,
  openedAt: number,
): Attachment {
  return { connId, protocolVersion, openedAt };
}
