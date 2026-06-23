'use strict';

/**
 * Parse specs for lib/tw-overview-core.js:
 *  - parseLocaleNumber / extractCoords / parseCoordsObj
 *  - shared unit constant tables (parity with tw-overview.js:47-82)
 *  - buildColumnMap + parseOverviewTable across units|prod|buildings|incomings
 *  - dedupById, splitByCategory, the "column mapped by header icon NOT index" contract
 */

const test = require('node:test');
const assert = require('node:assert');
const core = require('./helpers/load-overview-core.js');
const { readFixture } = require('./fixtures/load.js');
const { rowMatrix } = require('./helpers/html-to-rowmatrix.js');

// ------------------------------------------------------------------
// parseLocaleNumber
// ------------------------------------------------------------------
test('parseLocaleNumber strips separators / spaces / NBSP, never NaN', () => {
  assert.strictEqual(core.parseLocaleNumber('1.234'), 1234);
  assert.strictEqual(core.parseLocaleNumber('12 345'), 12345);
  assert.strictEqual(core.parseLocaleNumber('1 234'), 1234); // NBSP
  assert.strictEqual(core.parseLocaleNumber('1,234'), 1234);
  assert.strictEqual(core.parseLocaleNumber(''), 0);
  assert.strictEqual(core.parseLocaleNumber('abc'), 0);
  assert.strictEqual(core.parseLocaleNumber(null), 0);
  assert.strictEqual(core.parseLocaleNumber('-3'), -3);
});

// ------------------------------------------------------------------
// coords
// ------------------------------------------------------------------
test('extractCoords / parseCoordsObj', () => {
  assert.strictEqual(core.extractCoords('Foo (123|456)'), '123|456');
  assert.strictEqual(core.extractCoords('none'), '');
  assert.deepStrictEqual(core.parseCoordsObj('x (12|34)'), { x: 12, y: 34 });
  assert.strictEqual(core.parseCoordsObj('none'), null);
});

// ------------------------------------------------------------------
// constant tables
// ------------------------------------------------------------------
test('unit constant tables match tw-overview.js values', () => {
  assert.strictEqual(core.UNIT_HEADER_ALIASES.stone, 'clay');
  assert.strictEqual(core.UNIT_HEADER_ALIASES.wood, 'wood');
  assert.strictEqual(core.ATTACK_VALUES.light, 130);
  assert.strictEqual(core.DEF_VALUES.heavy, 200);
  assert.strictEqual(core.ALL_UNITS.length, 12);
});

// ------------------------------------------------------------------
// units parse + dedup + shuffled-header (proves column mapped by icon, not index)
// ------------------------------------------------------------------
test('parseOverviewTable(units) maps spear by header icon and dedups 5-row villages', () => {
  const matrix = rowMatrix(readFixture('overview-units-complete.html'));
  const out = core.parseOverviewTable(matrix, core.DOMAIN_CONFIGS.units);
  assert.ok(Array.isArray(out.rows));
  // 2 distinct villages despite 5 rows each.
  assert.strictEqual(out.rows.length, 2);
  const v1 = out.rows.find((r) => r.id === 1001);
  assert.ok(v1, 'village 1001 present');
  assert.strictEqual(v1.coords, '500|500');
  assert.strictEqual(v1.spear, 200);
  assert.strictEqual(v1.axe, 6000);
  assert.strictEqual(v1.snob, 1);
});

test('parseOverviewTable(units) reads the SAME spear value from a shuffled header (not by index)', () => {
  // Build a units fixture with columns reordered: axe header moved before spear.
  const shuffled =
    '<table class="vis"><thead><tr>' +
    '<th>Dedina</th>' +
    '<th><img src="/graphic/unit/unit_axe.png" class="unit-type-axe"></th>' +
    '<th><img src="/graphic/unit/unit_spear.png" class="unit-type-spear"></th>' +
    '<th><img src="/graphic/unit/unit_snob.png" class="unit-type-snob"></th>' +
    '</tr></thead><tbody>' +
    '<tr><td><a href="/game.php?village=1001&amp;screen=overview">V1 (500|500) K55</a></td>' +
    '<td>6000</td><td>200</td><td>1</td></tr>' +
    '</tbody></table>';
  const out = core.parseOverviewTable(rowMatrix(shuffled), core.DOMAIN_CONFIGS.units);
  const v = out.rows[0];
  // Despite axe being in the FIRST data column, spear/axe map correctly by icon.
  assert.strictEqual(v.spear, 200);
  assert.strictEqual(v.axe, 6000);
  assert.strictEqual(v.snob, 1);
});

// ------------------------------------------------------------------
// splitByCategory
// ------------------------------------------------------------------
test('splitByCategory yields 5 buckets with per-bucket id dedup', () => {
  const matrix = rowMatrix(readFixture('overview-units-complete.html'));
  const buckets = core.splitByCategory(matrix, core.DOMAIN_CONFIGS.units);
  assert.deepStrictEqual(
    Object.keys(buckets).sort(),
    ['in_transit', 'in_village', 'outside', 'own_all', 'own_home'].sort()
  );
  // own_home (parent rows) = 2 villages.
  assert.strictEqual(buckets.own_home.length, 2);
  // no duplicate ids in any bucket.
  Object.keys(buckets).forEach((cat) => {
    const ids = buckets[cat].map((v) => v.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'no dup ids in ' + cat);
  });
});

// ------------------------------------------------------------------
// prod: 'stone' header lands on 'clay'; locale numbers parsed
// ------------------------------------------------------------------
test('parseOverviewTable(prod) maps stone->clay and parses locale numbers', () => {
  const matrix = rowMatrix(readFixture('overview-prod.html'));
  const out = core.parseOverviewTable(matrix, core.DOMAIN_CONFIGS.prod);
  const v1 = out.rows.find((r) => r.id === 1001);
  assert.ok(v1);
  assert.strictEqual(v1.wood, 120000);
  assert.strictEqual(v1.clay, 98500); // header class="stone" aliased to clay
  assert.strictEqual(v1.iron, 110250);
});

// ------------------------------------------------------------------
// buildings: levels mapped by buildings/<name>.png
// ------------------------------------------------------------------
test('parseOverviewTable(buildings) maps levels by building icon src', () => {
  const matrix = rowMatrix(readFixture('overview-buildings.html'));
  const out = core.parseOverviewTable(matrix, core.DOMAIN_CONFIGS.buildings);
  const v1 = out.rows.find((r) => r.id === 1001);
  assert.ok(v1);
  assert.strictEqual(v1.main, 20);
  assert.strictEqual(v1.wall, 20);
  assert.strictEqual(v1.storage, 30);
  assert.strictEqual(v1.academy, 1); // snob.png -> academy
});

// ------------------------------------------------------------------
// incomings: TARGET + source + player captured; one record per row
// ------------------------------------------------------------------
test('parseOverviewTable(incomings) emits one record per row with target + source', () => {
  const matrix = rowMatrix(readFixture('overview-incomings.html'));
  const out = core.parseOverviewTable(matrix, core.DOMAIN_CONFIGS.incomings);
  assert.strictEqual(out.rows.length, 3);
  const first = out.rows[0];
  assert.strictEqual(first.id, 1001); // TARGET village id
  assert.strictEqual(first.coords, '500|500');
  assert.strictEqual(first.sourceCoords, '520|495');
  assert.strictEqual(first.player, 'EnemyGuy');
  assert.ok(first.arrivalText.indexOf('12:34:56') !== -1);
});

// ------------------------------------------------------------------
// dedupById
// ------------------------------------------------------------------
test('dedupById(keep:first) collapses duplicated ids stably', () => {
  const out = core.dedupById(
    [{ id: 1, v: 'a' }, { id: 2 }, { id: 1, v: 'b' }],
    'first'
  );
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].v, 'a');
});

// ------------------------------------------------------------------
// empty-group
// ------------------------------------------------------------------
test('parseOverviewTable surfaces emptyGroup from the info box', () => {
  const html =
    '<div class="info_box">Táto dedina nepatrí do tejto skupiny.</div>' +
    '<table class="vis"><thead><tr><th>Dedina</th></tr></thead><tbody></tbody></table>';
  const out = core.parseOverviewTable(rowMatrix(html), core.DOMAIN_CONFIGS.units);
  assert.deepStrictEqual(out.rows, []);
  assert.ok(out.emptyGroup);
});

// ------------------------------------------------------------------
// fail-safe
// ------------------------------------------------------------------
test('parseOverviewTable never throws on bad input', () => {
  assert.deepStrictEqual(core.parseOverviewTable(null, {}).rows, []);
  assert.deepStrictEqual(core.parseOverviewTable(undefined).rows, []);
  assert.deepStrictEqual(core.parseOverviewTable('garbage', {}).rows, []);
});
