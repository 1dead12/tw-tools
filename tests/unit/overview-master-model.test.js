'use strict';

/**
 * Specs for the unified master model + caching + premium detect in
 * lib/tw-overview-core.js (M3 / T19):
 *  - buildMasterModel: JOIN all domains by village id into ONE per-village row
 *  - cacheKeyFor: UNPREFIXED per-domain cache key (Store adds two_, Storage adds twt_)
 *  - CACHE_TTL_MS: per-domain TTLs with the required ordering
 *  - detectPremium: jQuery-free probe of an overview page
 *  - aggregateIncomingsByTarget: M3 placeholder (real impl is M6 / T37)
 */

const test = require('node:test');
const assert = require('node:assert');
const core = require('./helpers/load-overview-core.js');

// ------------------------------------------------------------------
// buildMasterModel — JOIN by id
// ------------------------------------------------------------------
test('buildMasterModel JOINs domains by id into one per-village row', () => {
  const domainData = {
    troops: { 1: { id: 1, units: { axe: 100 }, axe: 100, total: 100 } },
    econ: { 1: { id: 1, wood: 5000 } }
  };
  const villageIndex = { byId: { 1: { id: 1, name: 'V1', x: 500, y: 500, points: 9000, rank: 12 } } };

  const rows = core.buildMasterModel(domainData, villageIndex);
  assert.ok(Array.isArray(rows));
  assert.strictEqual(rows.length, 1, 'one merged row');

  const row = rows[0];
  assert.strictEqual(row.id, 1);
  assert.strictEqual(row.continent, 'K55');
  assert.strictEqual(row.coords, '500|500');
  assert.strictEqual(row.points, 9000);
  assert.strictEqual(row.rank, 12);
  assert.strictEqual(row.wood, 5000, 'econ wood merged');
  assert.strictEqual(row.axe, 100, 'troop axe merged');
});

test('buildMasterModel tolerates a missing domain (econ omitted)', () => {
  const domainData = { troops: { 1: { id: 1, units: { axe: 100 }, axe: 100 } } };
  const villageIndex = { byId: { 1: { id: 1, x: 500, y: 500 } } };
  const rows = core.buildMasterModel(domainData, villageIndex);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].wood, undefined, 'no wood without econ');
  assert.strictEqual(rows[0].axe, 100);
});

test('buildMasterModel still yields a row for a village absent from byId', () => {
  const domainData = { troops: { 7: { id: 7, units: {}, total: 0 } } };
  const villageIndex = { byId: {} };
  const rows = core.buildMasterModel(domainData, villageIndex);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].id, 7);
});

test('buildMasterModel dedups to one row per id and never throws', () => {
  const domainData = {
    troops: { 1: { id: 1, total: 1 } },
    econ: { 1: { id: 1, wood: 2 } },
    buildings: { 1: { id: 1, main: 20 } }
  };
  const villageIndex = { byId: { 1: { id: 1, x: 1, y: 1 } } };
  const rows = core.buildMasterModel(domainData, villageIndex);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].main, 20);

  // non-object input -> []
  assert.deepStrictEqual(core.buildMasterModel(null, null), []);
  assert.deepStrictEqual(core.buildMasterModel('x', 'y'), []);
});

// ------------------------------------------------------------------
// cacheKeyFor — UNPREFIXED
// ------------------------------------------------------------------
test('cacheKeyFor returns an UNPREFIXED domain_worldKey_gGID key', () => {
  // Signature: cacheKeyFor(domain, gid, worldKey) -> `${domain}_${worldKey}_g${gid}`.
  assert.strictEqual(core.cacheKeyFor('incomings', 0, 'en123'), 'incomings_en123_g0');
  assert.strictEqual(core.cacheKeyFor('econ', 5, 'sk88'), 'econ_sk88_g5');
  // No twt_ / two_ prefix here (the Store/Storage adapters add those).
  assert.strictEqual(/^(twt_|two_)/.test(core.cacheKeyFor('troops', 0, 'en123')), false);
  // Different domains differ.
  assert.notStrictEqual(
    core.cacheKeyFor('troops', 0, 'en123'),
    core.cacheKeyFor('incomings', 0, 'en123')
  );
});

// ------------------------------------------------------------------
// CACHE_TTL_MS — per-domain ordering
// ------------------------------------------------------------------
test('CACHE_TTL_MS exposes the per-domain TTL ladder', () => {
  const t = core.CACHE_TTL_MS;
  assert.strictEqual(t.incomings, 120000);
  assert.strictEqual(t.troops, 300000);
  assert.strictEqual(t.econ, 900000);
  assert.strictEqual(t.buildings, 900000);
  assert.strictEqual(t.map, 3600000);
  // ordering: incomings < troops < econ === buildings < map
  assert.ok(t.incomings < t.troops);
  assert.ok(t.troops < t.econ);
  assert.strictEqual(t.econ, t.buildings);
  assert.ok(t.buildings < t.map);
});

// ------------------------------------------------------------------
// detectPremium — jQuery-free probe
// ------------------------------------------------------------------
test('detectPremium returns available:true for an overview page with the prod nav', () => {
  const html = '<table class="vis overview_table"><tr><th>Production</th></tr></table>';
  const res = core.detectPremium(html, 'prod');
  assert.strictEqual(res.available, true);
});

test('detectPremium returns available:false (with reason) when premium is required', () => {
  const html = '<div class="error">premium_account_required</div>';
  const res = core.detectPremium(html, 'prod');
  assert.strictEqual(res.available, false);
  assert.ok(res.reason, 'a reason is present');
});

test('detectPremium fail-safe on empty input', () => {
  const res = core.detectPremium('', 'prod');
  assert.strictEqual(res.available, false);
  const res2 = core.detectPremium();
  assert.strictEqual(res2.available, false);
});

// ------------------------------------------------------------------
// aggregateIncomingsByTarget — M3 placeholder (real impl M6 / T37)
// ------------------------------------------------------------------
test('aggregateIncomingsByTarget groups command rows by target id (minimal)', () => {
  // Placeholder must at least return a plain object and tolerate empty input.
  assert.deepStrictEqual(core.aggregateIncomingsByTarget([]), {});
  assert.deepStrictEqual(core.aggregateIncomingsByTarget(), {});
  assert.deepStrictEqual(core.aggregateIncomingsByTarget(null), {});

  // A minimal-but-correct grouping: 2 incomings to village 1001, 1 to 1002.
  const rows = [
    { id: 1001, arrivalMs: 5000 },
    { id: 1001, arrivalMs: 9000 },
    { id: 1002, arrivalMs: 3000 }
  ];
  const agg = core.aggregateIncomingsByTarget(rows);
  assert.strictEqual(agg[1001].count, 2);
  assert.strictEqual(agg[1002].count, 1);
  assert.strictEqual(agg[1001].soonestMs, 5000, 'soonest of the two');
});

// ------------------------------------------------------------------
// aggregateIncomingsByTarget — REAL impl (M6 / T37): per-target nukes/fakes/
// nobles ESTIMATE (via classifyTrainKind over source-grouped trains) +
// nearestSource. The nukesEst>0 result is what lights the purple pill.
// ------------------------------------------------------------------
test('aggregateIncomingsByTarget: nukes/fakes/nobles ESTIMATE per target + nearestSource', () => {
  // Pre-classified units so the train classifier is deterministic (no travel math).
  const rows = [
    // target 2001: a nuke train (axe) from a near source, plus a noble.
    { id: 2001, sourceCoords: '500|500', sourceName: 'OffA', player: 'Enemy1', distanceFloat: 3, unit: 'axe',  arrivalMs: 8000 },
    { id: 2001, sourceCoords: '480|490', sourceName: 'NobleSrc', player: 'Enemy2', distanceFloat: 25, unit: 'snob', arrivalMs: 12000 },
    // target 2001: a fake (lone scout) from a far source.
    { id: 2001, sourceCoords: '900|900', sourceName: 'Spyhole', player: 'Enemy3', distanceFloat: 200, unit: 'spy', arrivalMs: 4000 },
    // target 2002: a single fake.
    { id: 2002, sourceCoords: '100|100', sourceName: 'Lone', player: 'Enemy4', distanceFloat: 50, unit: 'spy', arrivalMs: 7000 }
  ];
  const agg = core.aggregateIncomingsByTarget(rows);

  assert.strictEqual(agg[2001].count, 3, 'three incomings to 2001');
  assert.strictEqual(agg[2001].nukesEst, 1, 'one nuke train (axe)');
  assert.strictEqual(agg[2001].noblesEst, 1, 'one noble train (snob)');
  assert.strictEqual(agg[2001].fakesEst, 1, 'one fake train (lone scout)');
  assert.strictEqual(agg[2001].incomingNuke, true, 'nukesEst>0 lights the purple pill');
  assert.strictEqual(agg[2001].soonestMs, 4000, 'earliest of the three arrivals');
  assert.ok(agg[2001].nearestSource, 'nearestSource present');
  assert.strictEqual(agg[2001].nearestSource.coords, '500|500', 'nearest = smallest dist (3)');

  assert.strictEqual(agg[2002].nukesEst, 0, 'no nuke at 2002');
  assert.strictEqual(agg[2002].fakesEst, 1, 'single scout => fake');
});

// ------------------------------------------------------------------
// INTEGRATION: real parser (FLAT unit keys) -> master model -> flags/power.
// Guards the seam where computeDerivedFlags must read flat unit keys AND
// populate the off/defPower registry columns (isolated specs used nested
// {units:{...}} that the real parser never emits).
// ------------------------------------------------------------------
test('buildMasterModel over REAL parser output computes isNuke/off/defPower from flat unit keys', () => {
  const { rowMatrix } = require('./helpers/html-to-rowmatrix.js');
  const { readFixture } = require('./fixtures/load.js');
  const parsed = core.parseOverviewTable(
    rowMatrix(readFixture('overview-units-complete.html')),
    core.DOMAIN_CONFIGS.units
  );
  const troopRows = (parsed.rows || parsed.villages || []);
  assert.ok(troopRows.length >= 1 && troopRows[0].units === undefined,
    'parser emits FLAT unit keys (no nested .units) — the seam under test');

  // Fixture village 1001: axe 6000 + light 3000 = 9000 off, snob 1.
  const domainData = { troops: troopRows };
  const villageIndex = { byId: { 1001: { id: 1001, x: 500, y: 500, points: 9500, rank: 42 } } };
  const rows2 = core.buildMasterModel(domainData, villageIndex, { nukeThreshold: 5000 });
  const v1 = rows2.find(function (r) { return r.id === 1001; });

  assert.ok(v1, 'village 1001 present');
  assert.strictEqual(v1.isNuke, true, 'axe+light 9000 >= 5000 => nuke (flat keys read)');
  assert.strictEqual(v1.hasNoble, true, 'snob 1 => hasNoble (flat key read)');
  assert.ok(v1.off > 0, 'offensive power populated on the master row');
  assert.ok(v1.defPower > 0, 'defensive power populated on the master row');
});
