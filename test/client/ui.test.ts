// 5A logic that needs no DOM: routes, the in-app browser check and the strings module. (The
// ranking board's rules are in ranking.test.ts.)
import { describe, expect, it } from 'vitest';
import { isInAppBrowser } from '../../src/client/device';
import { parseRoute } from '../../src/client/router';
import { noticeText, STRINGS } from '../../src/client/strings';
import { ErrorCodeSchema } from '../../src/shared/protocol';

describe('routes (G-17)', () => {
  it('/, /g/<KEY> (any case), the dev pages; anything else is Home', () => {
    expect(parseRoute('/')).toEqual({ name: 'home' });
    expect(parseRoute('/g/ABCDE')).toEqual({ name: 'game', key: 'ABCDE' });
    expect(parseRoute('/g/abcde/')).toEqual({ name: 'game', key: 'ABCDE' });
    expect(parseRoute('/g/ABCD0')).toEqual({ name: 'home' }); // 0 is not in the key alphabet
    expect(parseRoute('/dev/ui')).toEqual({ name: 'devUi' });
    expect(parseRoute('/dev/screens')).toEqual({ name: 'devScreens' });
    expect(parseRoute('/dev/ranking')).toEqual({ name: 'devRanking' });
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

describe('strings (Q-5)', () => {
  it('every error code has a sensible notice text', () => {
    for (const code of ErrorCodeSchema.options) expect(noticeText(code).length).toBeGreaterThan(5);
    expect(STRINGS.round.readyCount(6, 8)).toBe('6 / 8 ready');
  });
});
