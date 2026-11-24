// Guards the version constants (CLAUDE.md §4): the saved state reuses wire schemas (Avatar,
// RoundResults, Question …), so a protocol edit can silently change what is SAVED. Without a
// STATE_VERSION bump that is only caught at runtime — by ending every live game as 'updated'.
//
// This test fingerprints the structure of both schemas. When a fingerprint changes:
// - GameStateSchema changed → bump STATE_VERSION, then record the new fingerprint under it.
// - Client/Server message schemas changed → decide: incompatible for phones already running the
//   old client? Then bump PROTOCOL_VERSION. Record the new fingerprint under the (new) version.
// Old entries stay in the tables as history.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GameStateSchema } from '../../src/game/stateSchema';
import { PROTOCOL_VERSION, STATE_VERSION } from '../../src/shared/constants';
import { ClientMessageSchema, ServerMessageSchema } from '../../src/shared/protocol';

const STATE_FINGERPRINTS: Readonly<Record<number, string>> = {
  1: 'aef42d30d8028781', // contracts before any game ran anywhere (only the echo page was deployed); categories, previousTokenHashes, MAX_CANDIDATES 6 and position-named reveal kinds added without a bump
  2: '12074aa158aefd16', // 2026-11-24: game modes (settings.mode, round.spots), add-on categories default/spicy/luuppi, results places only (noVotes, no stats). The engine had been on staging since 2026-11-23, so every shape change needs a real bump from here on
  3: 'de16f388e08116af', // 2026-11-24: drinking rules (reveal step rule filled), "[player]" questions (round.subjectId, player timesSubject), stats sipsDrunk / sipsGiven
};

const PROTOCOL_FINGERPRINTS: Readonly<Record<number, string>> = {
  1: '1ac544e07e9f68bb', // contracts before any phone ran a game (only the echo page was deployed); setSettings, join object, leftGame, question categories, MAX_CANDIDATES 6, reveal kinds bottom/third/second/top added without a bump
  2: '16049a3c5965545a', // 2026-11-24: settings.mode + add-on categories, round.spots, candidates/ranking up to MAX_PLAYERS, results noVotes instead of stats, no questionCounts; then (same day, version 2 still deployed nowhere) error codes NOT_ENOUGH_PLAYERS / PAUSED / TOO_EARLY, no waitingForNextRound
  3: '4d3bceb1eec2b0f0', // 2026-11-24: reveal steps carry their drinking rule {action, sips}; the public round carries subjectId for "[player]" questions
};

/** A stable description of a Valibot schema's structure (kinds, keys, literals, checks). */
function describeSchema(node: unknown, seen = new Set<unknown>()): unknown {
  if (node === null || typeof node !== 'object') return node;
  if (node instanceof RegExp) return `/${node.source}/${node.flags}`;
  if (seen.has(node)) return '[cycle]';
  seen.add(node);
  if (Array.isArray(node)) return node.map((child) => describeSchema(child, seen));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(node).sort()) {
    // Functions and the Standard Schema adapter are behaviour, not structure; messages are prose.
    if (key.startsWith('~') || key === 'message' || key === 'async') continue;
    const value = (node as Record<string, unknown>)[key];
    if (typeof value === 'function') continue;
    out[key] = describeSchema(value, seen);
  }
  seen.delete(node);
  return out;
}

function fingerprint(...schemas: unknown[]): string {
  const text = JSON.stringify(schemas.map((schema) => describeSchema(schema)));
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

describe('version constants follow schema changes (CLAUDE.md §4)', () => {
  it('the fingerprint sees real changes (sanity check)', () => {
    const before = fingerprint(GameStateSchema);
    const changed = { ...GameStateSchema, entries: { ...GameStateSchema.entries, extra: 1 } };
    expect(fingerprint(changed)).not.toBe(before);
    expect(fingerprint(GameStateSchema)).toBe(before); // stable
  });

  it('GameStateSchema matches the fingerprint recorded for STATE_VERSION', () => {
    const actual = fingerprint(GameStateSchema);
    expect(
      STATE_FINGERPRINTS[STATE_VERSION],
      `The saved-state shape changed (fingerprint ${actual}). Bump STATE_VERSION in ` +
        `shared/constants.ts and record ${actual} under the new version in this test.`,
    ).toBe(actual);
  });

  it('the wire protocol matches the fingerprint recorded for PROTOCOL_VERSION', () => {
    const actual = fingerprint(ClientMessageSchema, ServerMessageSchema);
    expect(
      PROTOCOL_FINGERPRINTS[PROTOCOL_VERSION],
      `The protocol changed (fingerprint ${actual}). If phones running the old client can't ` +
        `handle it, bump PROTOCOL_VERSION. Then record ${actual} under PROTOCOL_VERSION here.`,
    ).toBe(actual);
  });
});
