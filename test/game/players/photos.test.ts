// G-5, G-6: who may store a profile photo, and when.
import { describe, expect, it } from 'vitest';
import { photoUploadVerdict } from '../../../src/game/players/photos';
import { P } from '../../fixtures/common';
import { endedState, fakeTokenHash, lobbyState, questionState } from '../../fixtures/states';

describe('photoUploadVerdict', () => {
  it('in the lobby, players may set and change their own photo', () => {
    const state = lobbyState();
    expect(photoUploadVerdict(state, P.aino, fakeTokenHash(2))).toBe('ok');
    const aino = state.players[P.aino];
    if (aino) aino.avatar.photoVersion = 3;
    expect(photoUploadVerdict(state, P.aino, fakeTokenHash(2))).toBe('ok');
  });

  it("only with the player's own token (G-6)", () => {
    expect(photoUploadVerdict(lobbyState(), P.aino, fakeTokenHash(1))).toBe('wrongToken');
    expect(photoUploadVerdict(lobbyState(), P.juho, fakeTokenHash(5))).toBe('unknownPlayer');
  });

  it('once the game has started, only a FIRST photo (late joiner, failed upload) is allowed (G-5)', () => {
    const state = questionState();
    expect(photoUploadVerdict(state, P.aino, fakeTokenHash(2))).toBe('ok');
    const aino = state.players[P.aino];
    if (aino) aino.avatar.photoVersion = 1;
    expect(photoUploadVerdict(state, P.aino, fakeTokenHash(2))).toBe('locked');
  });

  it('not after leaving, and not once the game is over', () => {
    const left = lobbyState();
    const aino = left.players[P.aino];
    if (aino) aino.status = 'left';
    expect(photoUploadVerdict(left, P.aino, fakeTokenHash(2))).toBe('notActive');
    expect(photoUploadVerdict(endedState(), P.aino, fakeTokenHash(2))).toBe('locked');
  });
});
