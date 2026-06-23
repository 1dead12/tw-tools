'use strict';

/**
 * Smoke spec for lib/tw-overview-core.js (the pure heart, built in M2).
 *
 * SKIP-GUARDED: until the lib exists this test is skipped, so `npm test` is GREEN
 * from M1 onward. Once M2 lands the lib, the SAME spec auto-exercises its node export
 * envelope. Exact parser-output shapes are pinned by the dedicated M2 specs, not here.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// tests/unit/<spec> -> repo/lib is ../../lib (NOT ../lib, which would be tests/lib).
const LIB = path.join(__dirname, '..', '..', 'lib', 'tw-overview-core.js');
const skip = !fs.existsSync(LIB) ? 'lib/tw-overview-core.js not built yet (M2)' : false;

test('tw-overview-core exposes a CommonJS (node) surface', { skip }, () => {
  const core = require(LIB);
  assert.strictEqual(typeof core.parseLocaleNumber, 'function');
  assert.strictEqual(typeof core.parseOverviewTable, 'function');
});

test('parseOverviewTable on an empty matrix yields no villages and no next page', { skip }, () => {
  const core = require(LIB);
  const out = core.parseOverviewTable({ headers: [], rows: [], hasNextPage: false, infoBoxText: '' }, {});
  // Tolerant container check; the precise shape is asserted by the M2 parser specs.
  const list = Array.isArray(out) ? out : (out && out.villages);
  assert.ok(Array.isArray(list), 'expected an array of villages');
  assert.strictEqual(list.length, 0);
});
