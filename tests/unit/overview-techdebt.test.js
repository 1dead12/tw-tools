/**
 * Pure seams for the three tech-debt fixes (M6 / T34-T35):
 *  - classifyNukeFlag(units, settings)        -> boolean (own offensive nuke)
 *  - collectOverviewCacheKeys(prefix, gids)   -> the REAL cache keys Clear-Cache clears
 *  - recomputeBucketsNuke(allTroopData, opts) -> re-flags isNuke on ALL 5 buckets
 *
 * These are node-tested so the entry-file fixes (VERSION/Clear-Cache/recalc) can
 * delegate to a single covered implementation. The DOM wiring around them is
 * verified by build, not by these tests.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const core = require('../../lib/tw-overview-core.js');

// ------------------------------------------------------------------
// classifyNukeFlag — offCount = axe + light (+ marcher when includeArchers).
// ------------------------------------------------------------------
test('classifyNukeFlag: axe+light at/above threshold => true', () => {
  assert.strictEqual(
    core.classifyNukeFlag({ axe: 3000, light: 2000 }, { nukeThreshold: 5000, includeArchers: false }),
    true
  );
});

test('classifyNukeFlag: below threshold => false', () => {
  assert.strictEqual(
    core.classifyNukeFlag({ axe: 1000, light: 1000 }, { nukeThreshold: 5000, includeArchers: false }),
    false
  );
});

test('classifyNukeFlag: marcher counts only when includeArchers', () => {
  const units = { axe: 3000, marcher: 2500, light: 0 };
  assert.strictEqual(
    core.classifyNukeFlag(units, { nukeThreshold: 5000, includeArchers: true }),
    true,
    'axe 3000 + marcher 2500 = 5500 >= 5000 when archers counted'
  );
  assert.strictEqual(
    core.classifyNukeFlag(units, { nukeThreshold: 5000, includeArchers: false }),
    false,
    'axe 3000 alone (3000 < 5000) when archers ignored'
  );
});

test('classifyNukeFlag: fail-safe on bad input (never throws)', () => {
  assert.strictEqual(core.classifyNukeFlag(null, { nukeThreshold: 5000 }), false);
  assert.strictEqual(core.classifyNukeFlag({}, {}), false, 'threshold 0/undefined => not a nuke');
  assert.strictEqual(core.classifyNukeFlag(undefined, undefined), false);
});

// ------------------------------------------------------------------
// collectOverviewCacheKeys — the REAL keys, NEVER a troop_data_* key.
// ------------------------------------------------------------------
test('collectOverviewCacheKeys: returns exactly the real per-group + per-domain keys', () => {
  const keys = core.collectOverviewCacheKeys('two_', ['0', '1']);
  const expected = [
    'two_troop_all_g0', 'two_troop_all_g1',
    'two_command_data',
    'two_econ_g0', 'two_econ_g1',
    'two_buildings_g0', 'two_buildings_g1',
    'two_incomings_g0', 'two_incomings_g1',
    'two_map_villages', 'two_map_players'
  ];
  assert.deepStrictEqual(keys.slice().sort(), expected.slice().sort());
});

test('collectOverviewCacheKeys: NEVER emits a legacy troop_data_* key', () => {
  const keys = core.collectOverviewCacheKeys('two_', ['0', '5', '12']);
  keys.forEach(function (k) {
    assert.ok(!/two_troop_data_/.test(k), 'no never-written troop_data_ key: ' + k);
  });
});

test('collectOverviewCacheKeys: fail-safe on bad input', () => {
  assert.deepStrictEqual(core.collectOverviewCacheKeys('two_', null).slice().sort(),
    ['two_command_data', 'two_map_players', 'two_map_villages'].sort());
  assert.deepStrictEqual(core.collectOverviewCacheKeys(undefined, []).slice().sort(),
    ['command_data', 'map_players', 'map_villages'].sort());
});

// ------------------------------------------------------------------
// recomputeBucketsNuke — re-flag isNuke on EVERY one of the 5 buckets.
// ------------------------------------------------------------------
test('recomputeBucketsNuke: flags isNuke across ALL 5 buckets', () => {
  const settings = { nukeThreshold: 5000, includeArchers: false };
  const mkBuckets = function () {
    return {
      own_home:   [{ units: { axe: 4000, light: 2000 } }, { units: { axe: 100, light: 50 } }],
      in_village: [{ units: { axe: 6000, light: 0 } },    { units: { axe: 10, light: 0 } }],
      outside:    [{ units: { axe: 3000, light: 3000 } }, { units: { axe: 0, light: 0 } }],
      in_transit: [{ units: { axe: 5000, light: 1 } },    { units: { axe: 1, light: 1 } }],
      own_all:    [{ units: { axe: 8000, light: 1000 } }, { units: { axe: 2, light: 2 } }]
    };
  };
  const data = mkBuckets();
  core.recomputeBucketsNuke(data, settings);

  ['own_home', 'in_village', 'outside', 'in_transit', 'own_all'].forEach(function (cat) {
    assert.strictEqual(data[cat][0].isNuke, true, cat + ' over-threshold row => nuke');
    assert.strictEqual(data[cat][1].isNuke, false, cat + ' under-threshold row => not nuke');
  });
});

test('recomputeBucketsNuke: tolerates missing buckets, never throws', () => {
  const data = { own_home: [{ units: { axe: 6000, light: 0 } }] }; // only one bucket present
  assert.doesNotThrow(function () { core.recomputeBucketsNuke(data, { nukeThreshold: 5000 }); });
  assert.strictEqual(data.own_home[0].isNuke, true);
  assert.doesNotThrow(function () { core.recomputeBucketsNuke(null, { nukeThreshold: 5000 }); });
  assert.doesNotThrow(function () { core.recomputeBucketsNuke({}, null); });
});

test('recomputeBucketsNuke: accepts flat unit keys directly on the row', () => {
  const data = { own_home: [{ axe: 6000, light: 0, isNuke: false }] };
  core.recomputeBucketsNuke(data, { nukeThreshold: 5000, includeArchers: false });
  assert.strictEqual(data.own_home[0].isNuke, true, 'flat row.axe read when no row.units');
});
