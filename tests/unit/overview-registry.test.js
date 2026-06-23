'use strict';

/**
 * Specs for the declarative COLUMN_REGISTRY and its helpers in
 * lib/tw-overview-core.js (M3 / T18):
 *  - COLUMN_REGISTRY shape + per-domain coverage + unique keys
 *  - getColumn / columnsForDomain
 *  - gateColumnsByWorld (feature gating by world config — never hardcoded)
 *  - resolveVisibleColumns (saved order honored, unknown dropped, default fallback)
 */

const test = require('node:test');
const assert = require('node:assert');
const core = require('./helpers/load-overview-core.js');

const DOMAINS = ['troops', 'economy', 'buildings', 'incomings', 'map'];

// ------------------------------------------------------------------
// registry shape
// ------------------------------------------------------------------
test('COLUMN_REGISTRY is a non-empty array of well-formed descriptors', () => {
  assert.ok(Array.isArray(core.COLUMN_REGISTRY), 'COLUMN_REGISTRY is an array');
  assert.ok(core.COLUMN_REGISTRY.length > 0, 'COLUMN_REGISTRY is non-empty');
  core.COLUMN_REGISTRY.forEach((d) => {
    assert.strictEqual(typeof d.key, 'string', 'descriptor has a string key: ' + JSON.stringify(d));
    assert.ok(d.key.length > 0, 'descriptor key is non-empty');
    assert.strictEqual(typeof d.label, 'string', 'descriptor ' + d.key + ' has a string label');
    assert.strictEqual(typeof d.domain, 'string', 'descriptor ' + d.key + ' has a string domain');
    assert.strictEqual(typeof d.format, 'function', 'descriptor ' + d.key + ' has a format() fn');
  });
});

test('COLUMN_REGISTRY keys are unique', () => {
  const keys = core.COLUMN_REGISTRY.map((d) => d.key);
  assert.strictEqual(new Set(keys).size, keys.length, 'no duplicate column keys');
});

test('every domain (troops/economy/buildings/incomings/map) has columns', () => {
  DOMAINS.forEach((dom) => {
    const cols = core.COLUMN_REGISTRY.filter((d) => d.domain === dom);
    assert.ok(cols.length > 0, 'domain ' + dom + ' has at least one column');
  });
});

test('COLUMN_REGISTRY carries the camelCase design keys the seed presets reference', () => {
  const keys = core.COLUMN_REGISTRY.map((d) => d.key);
  // Identity + a representative sample from each domain (must match preset keys exactly).
  [
    'name', 'coords', 'continent', 'points', 'rank',
    'off', 'defPower', 'snob', 'isNuke', 'total',
    'whFillPct', 'wood', 'clay', 'iron', 'prodPerH', 'merchants',
    'main', 'wall', 'smithy', 'farm', 'warehouse', 'academy', 'academyReady',
    'incCount', 'soonest', 'nukesEst', 'fakesEst', 'underDefended',
    'distFront', 'nearestEnemy'
  ].forEach((k) => {
    assert.ok(keys.indexOf(k) !== -1, 'registry has key ' + k);
  });
});

// ------------------------------------------------------------------
// getColumn / columnsForDomain
// ------------------------------------------------------------------
test('getColumn returns the descriptor for a known key, null otherwise', () => {
  const col = core.getColumn('whFillPct');
  assert.ok(col, 'whFillPct descriptor found');
  assert.strictEqual(col.key, 'whFillPct');
  assert.strictEqual(col.domain, 'economy');
  assert.strictEqual(core.getColumn('does_not_exist'), null);
  assert.strictEqual(core.getColumn(), null);
});

test('columnsForDomain returns only that domain (buildings)', () => {
  const cols = core.columnsForDomain('buildings');
  assert.ok(cols.length > 0);
  cols.forEach((c) => assert.strictEqual(c.domain, 'buildings'));
  const keys = cols.map((c) => c.key);
  assert.ok(keys.indexOf('main') !== -1);
  assert.ok(keys.indexOf('wall') !== -1);
  // Not an economy column.
  assert.strictEqual(keys.indexOf('whFillPct'), -1);
});

test('columnsForDomain on an unknown domain returns []', () => {
  assert.deepStrictEqual(core.columnsForDomain('nope'), []);
  assert.deepStrictEqual(core.columnsForDomain(), []);
});

// ------------------------------------------------------------------
// gateColumnsByWorld — feature gating by world config (never hardcoded)
// ------------------------------------------------------------------
test('gateColumnsByWorld drops feature columns when the world lacks them', () => {
  const all = core.COLUMN_REGISTRY;

  // World WITHOUT church and WITHOUT archer.
  const gatedNoChurch = core.gateColumnsByWorld(all, { church: 0, archer: false });
  const keysNoChurch = gatedNoChurch.map((c) => c.key);
  assert.strictEqual(keysNoChurch.indexOf('church'), -1, 'church dropped when world.church===0');
  assert.strictEqual(keysNoChurch.indexOf('archer'), -1, 'archer dropped when world.archer===false');
  // A no-flag column always passes.
  assert.ok(keysNoChurch.indexOf('name') !== -1, 'non-feature column kept');

  // World WITH church present keeps the church column.
  const gatedWithChurch = core.gateColumnsByWorld(all, { church: 1, archer: true });
  const keysWithChurch = gatedWithChurch.map((c) => c.key);
  assert.ok(keysWithChurch.indexOf('church') !== -1, 'church kept when world.church===1');
  assert.ok(keysWithChurch.indexOf('archer') !== -1, 'archer kept when world.archer===true');
});

test('gateColumnsByWorld keeps feature columns when the world value is undefined', () => {
  const gated = core.gateColumnsByWorld(core.COLUMN_REGISTRY, {});
  const keys = gated.map((c) => c.key);
  // Unknown world feature state -> keep the column (do not over-hide).
  assert.ok(keys.indexOf('church') !== -1, 'church kept when world.church undefined');
  assert.ok(keys.indexOf('watchtower') !== -1, 'watchtower kept when world value undefined');
});

test('gateColumnsByWorld is fail-safe on a null world / null columns', () => {
  const gated = core.gateColumnsByWorld(core.COLUMN_REGISTRY, null);
  assert.ok(Array.isArray(gated) && gated.length === core.COLUMN_REGISTRY.length);
  assert.deepStrictEqual(core.gateColumnsByWorld(null, {}), []);
});

// ------------------------------------------------------------------
// resolveVisibleColumns
// ------------------------------------------------------------------
test('resolveVisibleColumns honors saved order and drops unknown keys', () => {
  const defaults = ['name', 'coords', 'points'];
  const saved = ['points', 'name', 'ghost_key'];
  const out = core.resolveVisibleColumns(saved, defaults);
  assert.deepStrictEqual(out, ['points', 'name'], 'saved order kept, unknown dropped');
});

test('resolveVisibleColumns falls back to defaults when saved is empty/invalid', () => {
  const defaults = ['name', 'coords'];
  assert.deepStrictEqual(core.resolveVisibleColumns(null, defaults), defaults);
  assert.deepStrictEqual(core.resolveVisibleColumns([], defaults), defaults);
  assert.deepStrictEqual(core.resolveVisibleColumns(['only_unknown'], defaults), defaults);
});
