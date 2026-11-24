// The store's public state types — what 5A's screens render besides the snapshot.
import type { ClientMessageType, ErrorMessage, PlayerId } from '../../shared/protocol';
import type { Profile } from '../storage';

/** Why this phone is out of the game — each is its own screen in 5A. */
export type Exit =
  | { readonly kind: 'notFound' } // "Game not found" (G-12)
  | { readonly kind: 'left' } // "You left this game" — LEFT without a Leave tap on this page
  | { readonly kind: 'removed' } // "You were removed from this game" (G-43)
  | { readonly kind: 'reclaimed' } // "Your spot was continued on another phone" (G-44)
  | { readonly kind: 'replaced' } // "Opened somewhere else" + Use here (G-18)
  | { readonly kind: 'refresh' }; // reload cap reached: "Please refresh the page"

/** A refused join — shown on the join screen; the socket stays open for another try. */
export type JoinError = {
  readonly code: 'NAME_TAKEN' | 'GAME_FULL' | 'INVALID_NICKNAME';
  /** NAME_TAKEN by an OFFLINE player → offer "That's me" (G-14, G-44). */
  readonly reclaimPlayerId?: PlayerId;
};

export type ReclaimState =
  | { readonly status: 'sending'; readonly playerId: PlayerId; readonly profile: Profile }
  | { readonly status: 'pending' } // "Waiting for the host…" + Cancel
  | { readonly status: 'denied' };

/** A refused request the screen should explain (a toast). */
export type Notice = Pick<ErrorMessage, 'code' | 'for'>;

/** Requests whose button stays disabled until the server answers. */
export const PENDING_REQUESTS = [
  'start',
  'submit',
  'advance',
  'setSettings',
  'leave',
  'end',
  'removePlayer',
  'answerReclaim',
] as const satisfies readonly ClientMessageType[];
export type PendingRequest = (typeof PENDING_REQUESTS)[number];

export function isPendingRequest(type: string): type is PendingRequest {
  return (PENDING_REQUESTS as readonly string[]).includes(type);
}
