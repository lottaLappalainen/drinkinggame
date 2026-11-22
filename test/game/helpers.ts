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
import { ServerMessageSchema, type ServerMessage } from '../../src/shared/protocol';

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

/** applyEvent + every check above. Use this instead of applyEvent in game tests. */
export function apply(state: GameState, event: EngineEvent, ctx: Ctx): EngineResult {
  const result = applyEvent(state, event, ctx);
  expectValidState(result.state);
  for (const message of outgoingMessages(result.effects)) expectValidMessage(message);
  return result;
}
