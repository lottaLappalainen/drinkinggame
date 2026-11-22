// Proves the client test project runs and compiles JSX with Preact (not React). Real client tests
// (store, connection manager with a fake socket — 5C) live next to this file.
import { describe, expect, it } from 'vitest';

describe('client toolchain', () => {
  it('compiles JSX to Preact vnodes', () => {
    const vnode = <p class="x">hi</p>;
    expect(vnode.type).toBe('p');
    expect(vnode.props).toMatchObject({ class: 'x', children: 'hi' });
  });
});
