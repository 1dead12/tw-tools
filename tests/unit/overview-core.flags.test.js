'use strict';

/**
 * Specs for computeDerivedFlags, calcArmyPower, threshold predicates,
 * composeAnd, countMatching.
 */

const test = require('node:test');
const assert = require('node:assert');
const core = require('./helpers/load-overview-core.js');

// ------------------------------------------------------------------
// calcArmyPower
// ------------------------------------------------------------------
test('calcArmyPower sums off/def power per ATTACK_VALUES/DEF_VALUES', () => {
  const units = { axe: 100, light: 50, spear: 200, sword: 100, marcher: 10, archer: 10 };
  // off = axe*40 + light*130 = 4000 + 6500 = 10500 (no archers)
  // def = spear*15 + sword*50 = 3000 + 5000 = 8000 (no archers)
  const p = core.calcArmyPower(units, false);
  assert.strictEqual(p.offPower, 100 * 40 + 50 * 130);
  assert.strictEqual(p.defPower, 200 * 15 + 100 * 50);
  // with archers: + marcher*120 off, + archer*50 def
  const pa = core.calcArmyPower(units, true);
  assert.strictEqual(pa.offPower, p.offPower + 10 * 120);
  assert.strictEqual(pa.defPower, p.defPower + 10 * 50);
});

// ------------------------------------------------------------------
// computeDerivedFlags
// ------------------------------------------------------------------
test('computeDerivedFlags: isNuke at/above threshold (archers gated)', () => {
  const row = { units: { axe: 3000, light: 4000, marcher: 1000 } };
  const noArchers = core.computeDerivedFlags(row, { nukeThreshold: 7000, includeArchers: false });
  // off = 7000 >= 7000
  assert.strictEqual(noArchers.isNuke, true);
  const lower = core.computeDerivedFlags({ units: { axe: 1000, light: 1000 } }, { nukeThreshold: 7000 });
  assert.strictEqual(lower.isNuke, false);
  const withArchers = core.computeDerivedFlags({ units: { axe: 3000, light: 3000, marcher: 1000 } },
    { nukeThreshold: 7000, includeArchers: true });
  // off = 3000+3000+1000 = 7000 only because marcher counted.
  assert.strictEqual(withArchers.isNuke, true);
});

test('computeDerivedFlags: hasNoble/hasIncomings/underDefended/whNearFull/isFull/academyReady', () => {
  const noble = core.computeDerivedFlags({ units: { snob: 1 } }, {});
  assert.strictEqual(noble.hasNoble, true);

  const inc = core.computeDerivedFlags({ incCount: 2 }, {});
  assert.strictEqual(inc.hasIncomings, true);

  // underDefended: only when defPower < defThreshold AND hasIncomings.
  const ud = core.computeDerivedFlags({ incCount: 1, defPower: 1000 }, { defThreshold: 5000 });
  assert.strictEqual(ud.underDefended, true);
  const notUd = core.computeDerivedFlags({ incCount: 0, defPower: 1000 }, { defThreshold: 5000 });
  assert.strictEqual(notUd.underDefended, false);

  const wh = core.computeDerivedFlags({ whFillPct: 92 }, { warnPct: 90, fullPct: 100 });
  assert.strictEqual(wh.whNearFull, true);
  assert.strictEqual(wh.isFull, false);
  const full = core.computeDerivedFlags({ whFillPct: 100 }, { warnPct: 90, fullPct: 100 });
  assert.strictEqual(full.isFull, true);

  const academy = core.computeDerivedFlags({ main: 20, smith: 20, market: 10 }, {});
  assert.strictEqual(academy.academyReady, true);
  const notAcademy = core.computeDerivedFlags({ main: 19, smith: 20, market: 10 }, {});
  assert.strictEqual(notAcademy.academyReady, false);
});

test('computeDerivedFlags returns a COPY (no input mutation)', () => {
  const row = { units: { snob: 1 }, id: 5 };
  const out = core.computeDerivedFlags(row, {});
  assert.strictEqual(row.hasNoble, undefined, 'input not mutated');
  assert.strictEqual(out.hasNoble, true);
  assert.notStrictEqual(out, row);
});

// ------------------------------------------------------------------
// predicates + composeAnd + countMatching
// ------------------------------------------------------------------
test('predicate builders gte/lte/eq/flag/between', () => {
  const rows = [{ points: 100, ok: true }, { points: 50, ok: false }, { points: 75, ok: true }];
  assert.strictEqual(core.predicate('gte', 'points', 75)(rows[0]), true);
  assert.strictEqual(core.predicate('gte', 'points', 75)(rows[1]), false);
  assert.strictEqual(core.predicate('lte', 'points', 75)(rows[1]), true);
  assert.strictEqual(core.predicate('eq', 'points', 75)(rows[2]), true);
  assert.strictEqual(core.predicate('flag', 'ok')(rows[0]), true);
  assert.strictEqual(core.predicate('flag', 'ok')(rows[1]), false);
  assert.strictEqual(core.predicate('between', 'points', 60, 90)(rows[2]), true);
  assert.strictEqual(core.predicate('between', 'points', 60, 90)(rows[1]), false);
});

test('composeAnd([]) is alwaysTrue; composeAnd ANDs predicates; countMatching counts', () => {
  const rows = [{ p: 100, f: true }, { p: 50, f: true }, { p: 80, f: false }];
  const always = core.composeAnd([]);
  assert.strictEqual(always(rows[1]), true);
  const both = core.composeAnd([core.predicate('gte', 'p', 70), core.predicate('flag', 'f')]);
  assert.strictEqual(both(rows[0]), true);
  assert.strictEqual(both(rows[2]), false); // f is false
  assert.strictEqual(core.countMatching(rows, both), 1);
});
