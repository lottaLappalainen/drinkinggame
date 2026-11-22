// Runs Vitest with normalized Windows paths.
//
// Why: on Windows with Node 26, if the working directory and Vitest's own file path disagree on
// the drive letter's case (VS Code's terminal often opens in `c:\...`, Node elsewhere reports
// `C:\...`), Node loads two copies of Vitest's runner and every test file fails with
// "TypeError: Cannot read properties of undefined (reading 'config')".
// Verified 2026-11-22 with Vitest 4.1.12, 5.0.5 and 5.1.1 — not a Vitest regression.
// Fix: start Vitest with an upper-case drive letter for both. Use `npm test`, not `npx vitest`.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Upper-cases a leading Windows drive letter: `c:\x` → `C:\x`. No-op elsewhere. */
function normalizeDrive(path) {
  return process.platform === 'win32' && /^[a-z]:/.test(path)
    ? path.charAt(0).toUpperCase() + path.slice(1)
    : path;
}

const cwd = normalizeDrive(process.cwd());
const vitestBin = normalizeDrive(
  fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
);

const child = spawn(process.execPath, [vitestBin, ...process.argv.slice(2)], {
  cwd,
  stdio: 'inherit',
});
child.on('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
