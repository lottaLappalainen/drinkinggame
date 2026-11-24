// What an `error` from the server means for this phone — a pure decision table, so every code is
// handled (the switch is exhaustive) and testable without a socket. The store carries it out.
import type { ErrorMessage } from '../../shared/protocol';
import type { Exit, JoinError, Notice } from './types';

export type ErrorOutcome =
  /** Out of the game; `forgetToken` = the login will never work again (CLAUDE.md §6). */
  | { readonly kind: 'exit'; readonly exit: Exit['kind']; readonly forgetToken: boolean }
  /** OUTDATED_CLIENT: reload (capped once per minute). */
  | { readonly kind: 'reload' }
  /** SERVER_UPDATING: show "Updating…"; the connection keeps retrying, no reload. */
  | { readonly kind: 'updating' }
  /** The Leave this page asked for is done (LEFT after a lost leftGame): forget, go Home. */
  | { readonly kind: 'leftDone' }
  /** The join was refused; the socket stays open for another name. */
  | { readonly kind: 'joinError'; readonly joinError: JoinError }
  /** The "That's me" target is gone: back to joining, with an explanation. */
  | { readonly kind: 'reclaimUnavailable'; readonly notice: Notice }
  /** TOO_EARLY: this phone's clock is off — re-measure it (the button is enabled again). */
  | { readonly kind: 'resyncClock' }
  /** A refused request to explain. */
  | { readonly kind: 'notice'; readonly notice: Notice };

export function errorOutcome(message: ErrorMessage, leaving: boolean): ErrorOutcome {
  const request = message.for;
  const notice: Notice = { code: message.code, ...(request !== undefined && { for: request }) };
  switch (message.code) {
    case 'OUTDATED_CLIENT':
      return { kind: 'reload' };
    case 'SERVER_UPDATING':
      return { kind: 'updating' };
    case 'NOT_FOUND':
      // For the socket or the hello: the game (or this login) doesn't exist (G-12).
      return request === undefined || request === 'hello'
        ? { kind: 'exit', exit: 'notFound', forgetToken: true }
        : { kind: 'notice', notice };
    case 'LEFT':
      return leaving ? { kind: 'leftDone' } : { kind: 'exit', exit: 'left', forgetToken: true };
    case 'REMOVED':
      return { kind: 'exit', exit: 'removed', forgetToken: true };
    case 'RECLAIMED':
      return { kind: 'exit', exit: 'reclaimed', forgetToken: true };
    case 'REPLACED':
      // Keep the token: "Use here" takes the game back with it (G-18).
      return { kind: 'exit', exit: 'replaced', forgetToken: false };
    case 'NAME_TAKEN':
      return {
        kind: 'joinError',
        joinError: {
          code: 'NAME_TAKEN',
          ...(message.reclaimPlayerId !== undefined && {
            reclaimPlayerId: message.reclaimPlayerId,
          }),
        },
      };
    case 'GAME_FULL':
      return { kind: 'joinError', joinError: { code: 'GAME_FULL' } };
    case 'INVALID_NICKNAME':
      return request === 'hello'
        ? { kind: 'joinError', joinError: { code: 'INVALID_NICKNAME' } }
        : { kind: 'notice', notice }; // a profile edit in the lobby
    case 'RECLAIM_UNAVAILABLE':
      return { kind: 'reclaimUnavailable', notice };
    case 'TOO_EARLY':
      return { kind: 'resyncClock' };
    case 'NOT_ALLOWED':
    case 'NOT_ENOUGH_PLAYERS':
    case 'PAUSED':
    case 'INVALID':
    case 'NOT_ENOUGH_QUESTIONS':
    case 'CREATE_FAILED':
      return { kind: 'notice', notice };
    default: {
      const unknown: never = message;
      return unknown;
    }
  }
}
