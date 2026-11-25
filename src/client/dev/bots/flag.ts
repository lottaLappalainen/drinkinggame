// TEST BOTS (dev / staging only — production builds never contain them).
//
// To HIDE the 🤖 button but keep the code: set this to false.
// To REMOVE the bots completely: delete this folder (src/client/dev/bots/), the block marked
// "TEST BOTS" in src/client/app.tsx, test/client/bots.test.ts and e2e/bots.spec.ts.
// (Typed as boolean, so flipping it is a one-word change that type-checks either way.)
export const SHOW_TEST_BOTS = true as boolean;
