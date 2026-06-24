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
const { readFixture, readReal } = require('./fixtures/load.js');
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
// RowMatrix capture: header.order (from order= link) + cell.res (span.res.*),
// proven against the REAL prod DOM. Existing fields stay intact.
// ------------------------------------------------------------------
test('rowMatrix captures header.order tokens and cell.res from the real prod DOM', () => {
  const m = rowMatrix(readReal('overview-prod.html'));
  // header.order tokens (language-proof) from the &amp;order=… sort links.
  const orders = m.headers.map((h) => h.order);
  assert.ok(orders.indexOf('name') !== -1, 'order=name captured');
  assert.ok(orders.indexOf('points') !== -1, 'order=points captured');
  assert.ok(orders.indexOf('storage_max') !== -1, 'order=storage_max captured');
  assert.ok(orders.indexOf('trader_available') !== -1, 'order=trader_available captured');
  assert.ok(orders.indexOf('pop') !== -1, 'order=pop captured');
  // The Suroviny cell carries res = {wood, clay, iron} (stone -> clay).
  const resCell = m.rows[0].cells.find((c) => c.res);
  assert.ok(resCell, 'a cell carries res');
  assert.deepStrictEqual(resCell.res, { wood: 501, clay: 501, iron: 401 });
  // Existing fields intact (text/links/colIndex still present on cells).
  assert.ok(m.rows[0].cells.every((c) => typeof c.text === 'string'));
  assert.ok(m.rows[0].cells.every((c) => typeof c.colIndex === 'number'));
});

// ------------------------------------------------------------------
// units parse + dedup over the REAL sk104 #units_table (5-row block per village,
// .webp icons, militia/knight present, NO archer). Fresh account -> all 0; we assert
// the KEYS exist and parse to numbers (the column-mapping contract).
// ------------------------------------------------------------------
test('parseOverviewTable(units) maps unit columns by .webp header icon and dedups the 5-row village', () => {
  const matrix = rowMatrix(readReal('overview-units-complete.html'));
  const out = core.parseOverviewTable(matrix, core.DOMAIN_CONFIGS.units);
  assert.ok(Array.isArray(out.rows));
  // 1 distinct village (id 4741) despite the 5-row category block.
  assert.strictEqual(out.rows.length, 1);
  const v1 = out.rows.find((r) => r.id === 4741);
  assert.ok(v1, 'village 4741 present');
  assert.strictEqual(v1.coords, '526|433');
  // Every standard unit column is mapped and numeric (fresh account => 0).
  ['spear', 'sword', 'axe', 'spy', 'light', 'heavy', 'ram', 'catapult', 'knight', 'snob', 'militia']
    .forEach((u) => assert.strictEqual(typeof v1[u], 'number', 'unit key ' + u + ' present & numeric'));
  // archer is NOT a column on this no-archer world.
  assert.strictEqual(v1.archer, undefined, 'archer column absent on no-archer world DOM');
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
test('splitByCategory yields 5 buckets with per-bucket id dedup (REAL units DOM)', () => {
  const matrix = rowMatrix(readReal('overview-units-complete.html'));
  const buckets = core.splitByCategory(matrix, core.DOMAIN_CONFIGS.units);
  assert.deepStrictEqual(
    Object.keys(buckets).sort(),
    ['in_transit', 'in_village', 'outside', 'own_all', 'own_home'].sort()
  );
  // The real fixture has Slovak category labels (vlastné / v dedine / vonku / na ceste /
  // celkovo) so every one of the 5 buckets gets the village.
  assert.strictEqual(buckets.own_home.length, 1);
  assert.strictEqual(buckets.in_village.length, 1);
  assert.strictEqual(buckets.outside.length, 1);
  assert.strictEqual(buckets.in_transit.length, 1);
  assert.strictEqual(buckets.own_all.length, 1);
  // no duplicate ids in any bucket.
  Object.keys(buckets).forEach((cat) => {
    const ids = buckets[cat].map((v) => v.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'no dup ids in ' + cat);
  });
});

// ------------------------------------------------------------------
// prod: REAL #production_table is TEXT/order-headed (not icon-headed). Columns map by
// header order= token; resources come from ONE Suroviny cell (span.res.wood/.stone/.iron,
// stone->clay); whFillPct is computed from whCap.
// ------------------------------------------------------------------
test('parseOverviewTable(prod) maps order-headed columns + reads resources from the res cell', () => {
  const matrix = rowMatrix(readReal('overview-prod.html'));
  const out = core.parseOverviewTable(matrix, core.DOMAIN_CONFIGS.prod);
  const v1 = out.rows.find((r) => r.id === 4741);
  assert.ok(v1, 'village 4741 present');
  assert.strictEqual(v1.coords, '526|433');
  // resources from span.res.wood/.stone/.iron (stone -> clay)
  assert.strictEqual(v1.wood, 501);
  assert.strictEqual(v1.clay, 501); // span class="res stone" aliased to clay
  assert.strictEqual(v1.iron, 401);
  // order=points -> points, order=storage_max -> whCap
  assert.strictEqual(v1.points, 26);
  assert.strictEqual(v1.whCap, 1000);
  // order=trader_available -> merchants "0/0" (available/total)
  assert.strictEqual(v1.merchants, 0);
  assert.strictEqual(v1.merchantsFree, 0);
  // order=pop -> pop "7/240" (used/max)
  assert.strictEqual(v1.popUsed, 7);
  assert.strictEqual(v1.popMax, 240);
});

test('parseOverviewTable(prod) computes whFillPct = round(100*max(res)/whCap)', () => {
  const out = core.parseOverviewTable(
    rowMatrix(readReal('overview-prod.html')), core.DOMAIN_CONFIGS.prod);
  const v1 = out.rows.find((r) => r.id === 4741);
  // max(501,501,401)=501; 100*501/1000 = 50.1 -> round 50.
  assert.strictEqual(v1.whFillPct, 50);
});

test('parseOverviewTable(prod) works on the basic NON-PREMIUM table (fewer columns)', () => {
  const out = core.parseOverviewTable(
    rowMatrix(readReal('overview-nonpremium.html')), core.DOMAIN_CONFIGS.prod);
  const v1 = out.rows.find((r) => r.id === 4741);
  assert.ok(v1, 'village 4741 present in non-premium prod');
  // Same Suroviny / Sklad / Bodov / Sedliacky dvor columns; no Obchodníci.
  assert.strictEqual(v1.wood, 501);
  assert.strictEqual(v1.clay, 501);
  assert.strictEqual(v1.iron, 401);
  assert.strictEqual(v1.points, 26);
  assert.strictEqual(v1.whCap, 1000);
  assert.strictEqual(v1.whFillPct, 50);
  assert.strictEqual(v1.popMax, 240);
  // No merchants column on the basic table.
  assert.strictEqual(v1.merchants, undefined);
});

// ------------------------------------------------------------------
// buildings: levels mapped by buildings/<name>.webp icon src (REAL sk104 DOM).
// snob->academy, place->rally; resource-production buildings (wood/stone/iron) are
// NOT mapped (they would collide with the economy keys).
// ------------------------------------------------------------------
test('parseOverviewTable(buildings) maps levels by .webp building icon, drops resource buildings', () => {
  const matrix = rowMatrix(readReal('overview-buildings.html'));
  const out = core.parseOverviewTable(matrix, core.DOMAIN_CONFIGS.buildings);
  const v1 = out.rows.find((r) => r.id === 4741);
  assert.ok(v1, 'village 4741 present');
  // Real levels on the fresh village.
  assert.strictEqual(v1.main, 1);
  assert.strictEqual(v1.rally, 1);   // place.webp -> rally
  assert.strictEqual(v1.farm, 1);
  assert.strictEqual(v1.storage, 1);
  assert.strictEqual(v1.hide, 1);
  assert.strictEqual(v1.wall, 0);
  assert.strictEqual(v1.academy, 0); // snob.webp -> academy
  assert.strictEqual(v1.watchtower, 0);
  // Resource-production buildings must NOT leak in as economy keys.
  assert.strictEqual(v1.wood, undefined, 'no wood building key (econ collision avoided)');
  assert.strictEqual(v1.clay, undefined, 'no clay building key (econ collision avoided)');
  assert.strictEqual(v1.iron, undefined, 'no iron building key (econ collision avoided)');
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
