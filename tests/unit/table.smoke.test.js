'use strict';

/**
 * Smoke spec for lib/tw-table.js (generic table engine, built in M4).
 * SKIP-GUARDED until the lib exists, so `npm test` stays GREEN before M4.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const LIB = path.join(__dirname, '..', '..', 'lib', 'tw-table.js');
const skip = !fs.existsSync(LIB) ? 'lib/tw-table.js not built yet (M4)' : false;

test('tw-table exposes pure helpers', { skip }, () => {
  const mod = require(LIB);
  const pure = mod.pure || mod;
  assert.strictEqual(typeof pure.applyFilters, 'function');
  assert.strictEqual(typeof pure.applyMultiSort, 'function');
});

test('tw-table pure helpers no-op on empty input', { skip }, () => {
  const mod = require(LIB);
  const pure = mod.pure || mod;
  assert.deepStrictEqual(pure.applyFilters([], []), []);
  assert.deepStrictEqual(pure.applyMultiSort([], []), []);
});
