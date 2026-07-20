#!/usr/bin/env node
/*
 * Preflight check for the Electron packaging scripts (`pack`, `dist:electron`).
 *
 * electron-builder 26.x's app-builder-lib does `require("@noble/hashes/blake2.js")`,
 * and @noble/hashes >= 2.2.0 ships as ESM-only. Requiring an ES module from
 * CommonJS only works once Node gained stable `require(ESM)` support:
 *   - Node 22.12.0+  (unflagged), or
 *   - Node 20.19.0+  (backport).
 * On older Node (e.g. 20.15) electron-builder crashes with a cryptic
 * `ERR_REQUIRE_ESM` deep inside blockmap generation. This guard turns that
 * into a clear, actionable message before any slow build work runs.
 *
 * The Angular web build and unit tests are unaffected and still run on Node 20.
 */
const [major, minor] = process.versions.node.split('.').map(Number);

const ok =
  major > 22 ||
  (major === 22 && minor >= 12) ||
  (major === 20 && minor >= 19);

if (!ok) {
  console.error('\n\x1b[31m✖ Electron packaging requires Node >= 22 (or >= 20.19).\x1b[0m');
  console.error(`  You are on Node ${process.versions.node}.`);
  console.error('  electron-builder cannot require the ESM-only @noble/hashes on this version');
  console.error('  and would crash with ERR_REQUIRE_ESM during blockmap generation.\n');
  console.error('  Fix: switch Node for the build, e.g.  \x1b[36mnvm use 22 && npm run pack\x1b[0m');
  console.error('  (The web build and tests are fine on Node 20.)\n');
  process.exit(1);
}
