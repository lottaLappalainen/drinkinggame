// 5A logic that needs no DOM: routes, the in-app browser check, the interim ranking board's
// placement rules, and the strings module.
import { describe, expect, it } from 'vitest';
import { isInAppBrowser } from '../../src/client/device';
import { isComplete, place, unplace } from '../../src/client/ranking/RankingBoard';
import { parseRoute } from '../../src/client/router';
import { noticeText, STRINGS } from '../../src/client/strings';
import { ErrorCodeSchema } from '../../src/shared/protocol';
import { P } from '../fixtures/common';

describe('routes (G-17)', () => {
  it('/, /g/<KEY> (any case), the dev pages; anything else is Home', () => {
    expect(parseRoute('/')).toEqual({ name: 'home' });
    expect(parseRoute('/g/ABCDE')).toEqual({ name: 'game', key: 'ABCDE' });
    expect(parseRoute('/g/abcde/')).toEqual({ name: 'game', key: 'ABCDE' });
    expect(parseRoute('/g/ABCD0')).toEqual({ name: 'home' }); // 0 is not in the key alphabet
    expect(parseRoute('/dev/ui')).toEqual({ name: 'devUi' });
    expect(parseRoute('/dev/screens')).toEqual({ name: 'devScreens' });
    expect(parseRoute('/nope')).toEqual({ name: 'home' });
  });
});

describe('in-app browsers (G-12b)', () => {
  it('spots chat-app browsers, not real ones', () => {
    const iphoneSafari =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const androidChrome =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
    expect(isInAppBrowser(iphoneSafari)).toBe(false);
    expect(isInAppBrowser(androidChrome)).toBe(false);
    expect(isInAppBrowser(`${iphoneSafari} Instagram 300.0`)).toBe(true);
    expect(isInAppBrowser(`${androidChrome} WhatsApp/2.24`)).toBe(true);
    expect(isInAppBrowser(`${iphoneSafari} [FBAN/FBIOS;FBAV/400.0]`)).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 14; Pixel; wv) AppleWebKit/537.36')).toBe(
      true,
    );
  });
});

describe('interim ranking board placement (G-36)', () => {
  const empty = [null, null, null] as const;
  it('places, swaps between spots, and takes a player back out', () => {
    let p = place(empty, P.aino, 0);
    p = place(p, P.ville, 1);
    expect(p).toEqual([P.aino, P.ville, null]);
    p = place(p, P.aino, 1); // onto an occupied spot → swap
    expect(p).toEqual([P.ville, P.aino, null]);
    p = place(p, P.sanna, 0); // from the list onto an occupied spot → the occupant goes back
    expect(p).toEqual([P.sanna, P.aino, null]);
    expect(isComplete(p)).toBe(false);
    p = place(p, P.mikko, 2);
    expect(isComplete(p)).toBe(true);
    expect(unplace(p, P.aino)).toEqual([P.sanna, null, P.mikko]);
  });
});

describe('strings (Q-5)', () => {
  it('every error code has a sensible notice text', () => {
    for (const code of ErrorCodeSchema.options) expect(noticeText(code).length).toBeGreaterThan(5);
    expect(STRINGS.round.readyCount(6, 8)).toBe('6 / 8 ready');
  });
});
