// The way Phase 3 tests apply events: `apply` wraps engine.applyEvent and FAILS the test if
// - the resulting state breaks an invariant (game/invariants.ts), or no longer matches
//   GameStateSchema (what the DO would fail to load later), or
// - any emitted message doesn't parse with ServerMessageSchema. The schemas are strict objects,
//   so a handler that slips a token, a token hash or someone's answers into a message — even into
//   a field that exists elsewhere — is caught here, not only by the schema-walking secrets test.
import * as v from 'valibot';
import { expect } from 'vitest';
import { applyEvent } from '../../src/game/engine';
import { checkInvariants, checkSnapshotInvariants } from '../../src/game/invariants';
import { GameStateSchema, type GameState } from '../../src/game/stateSchema';
import type { Ctx, Effect, EngineEvent, EngineResult } from '../../src/game/types';
import {
  ServerMessageSchema,
  type ConnId,
  type PlayerId,
  type ServerMessage,
} from '../../src/shared/protocol';

/** Every message an effect would put on the wire. */
export function outgoingMessages(effects: readonly Effect[]): ServerMessage[] {
  const messages: ServerMessage[] = [];
  for (const effect of effects) {
    if (effect.kind === 'send' || effect.kind === 'broadcast' || effect.kind === 'sendToHost')
      messages.push(effect.message);
  }
  return messages;
}

/** Fails the test if the state breaks an invariant or the saved-state schema. */
export function expectValidState(state: GameState): void {
  expect(checkInvariants(state), 'state invariants').toEqual([]);
  const parsed = v.safeParse(GameStateSchema, state);
  expect(parsed.success, parsed.success ? '' : JSON.stringify(v.flatten(parsed.issues))).toBe(true);
}

/** Fails the test if a message isn't exactly what the protocol allows. */
export function expectValidMessage(message: ServerMessage): void {
  const parsed = v.safeParse(ServerMessageSchema, message);
  expect(parsed.success, parsed.success ? '' : JSON.stringify(v.flatten(parsed.issues))).toBe(true);
  if (message.type === 'welcome')
    expect(checkSnapshotInvariants(message.snapshot), 'snapshot invariants').toEqual([]);
}

/**
 * "Welcome first" (CLAUDE.md §5): a socket that gets a `welcome` in this event must not receive a
 * broadcast or a host message BEFORE it — a phone can't apply a delta to a snapshot it doesn't
 * have yet. Direct sends (reclaimResult before the welcome, …) are deliberate and allowed.
 * Recipients are worked out from the resulting state, as the DO would deliver them.
 */
export function welcomeFirstViolations(state: GameState, effects: readonly Effect[]): string[] {
  const welcomeAt = new Map<ConnId, number>();
  effects.forEach((effect, i) => {
    if (
      effect.kind === 'send' &&
      effect.message.type === 'welcome' &&
      !welcomeAt.has(effect.connId)
    )
      welcomeAt.set(effect.connId, i);
  });
  const reaches = (effect: Effect, connId: ConnId): boolean => {
    if (effect.kind === 'broadcast')
      return Object.entries(state.players).some(
        ([id, p]) =>
          p.status === 'active' &&
          p.connId === connId &&
          !(effect.except ?? []).includes(id as PlayerId),
      );
    if (effect.kind === 'sendToHost')
      return state.hostId !== null && state.players[state.hostId]?.connId === connId;
    return false;
  };
  const problems: string[] = [];
  effects.forEach((effect, i) => {
    for (const [connId, at] of welcomeAt)
      if (i < at && reaches(effect, connId))
        problems.push(`${connId} receives ${effect.kind} #${i} before its welcome #${at}`);
  });
  return problems;
}

/** applyEvent + every check above. Use this instead of applyEvent in game tests. */
export function apply(state: GameState, event: EngineEvent, ctx: Ctx): EngineResult {
  const result = applyEvent(state, event, ctx);
  expectValidState(result.state);
  for (const message of outgoingMessages(result.effects)) expectValidMessage(message);
  expect(welcomeFirstViolations(result.state, result.effects), 'welcome first').toEqual([]);
  return result;
}
