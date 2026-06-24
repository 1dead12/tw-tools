/**
 * tw-config-core — versioned config + migration + saved-view presets.
 *
 * node:test over the bundled-source lib (node-compat envelope). The lib must NOT
 * reference jQuery/localStorage/document at load — require() must not throw.
 *
 * Persistence is tested through a fakeStore (the lib takes a store ADAPTER so it
 * is node-testable). CONFIG_KEY is the BARE 'config' — the adapter (and only the
 * adapter) adds the two_/twt_ prefixes; the lib NEVER double-prefixes.
 */
'use strict';

var test = require('node:test');
var assert = require('node:assert');

// The lib attaches its surface to window.TWTools. Provide a bare window before
// require so the browser-attach path runs and we can read TWTools.Config.
global.window = {};
require('../../lib/tw-config-core.js');
var TWConfig = global.window.TWTools.Config;

// cfgVersion 3 ships 10 seeded views (5 original + 5 curated tier presets).
var CFG_VER = 3;
var SEED_COUNT = TWConfig.SEED_VIEWS.length;

function makeFakeStore(seed) {
  return {
    map: seed ? Object.assign({}, seed) : {},
    get: function (k) { return this.map[k] !== undefined ? this.map[k] : null; },
    set: function (k, v) { this.map[k] = v; },
    remove: function (k) { delete this.map[k]; }
  };
}

// ============================================================
// surface
// ============================================================

test('lib requires cleanly under node and exposes TWConfig', function () {
  assert.strictEqual(typeof TWConfig, 'object');
  assert.strictEqual(TWConfig.CONFIG_VERSION, 3);
  assert.strictEqual(TWConfig.CONFIG_KEY, 'config'); // BARE — adapter adds prefixes
  ['mergeDefaults', 'deepMerge', 'migrateConfig', 'migrate_v1_to_v2',
    'seedViews', 'saveView', 'deleteView', 'renameView', 'applyView',
    'exportViews', 'importViews', 'intOr', 'clampInt', 'swapIfInverted',
    'load', 'save', 'patch'].forEach(function (fn) {
    assert.strictEqual(typeof TWConfig[fn], 'function', 'missing fn: ' + fn);
  });
});

// ============================================================
// coercion helpers
// ============================================================

test('intOr: parses ints, NaN-safe fallback', function () {
  assert.strictEqual(TWConfig.intOr('42', 0), 42);
  assert.strictEqual(TWConfig.intOr(7, 0), 7);
  assert.strictEqual(TWConfig.intOr('abc', 99), 99);
  assert.strictEqual(TWConfig.intOr('', 99), 99);
  assert.strictEqual(TWConfig.intOr(null, 5), 5);
  assert.strictEqual(TWConfig.intOr(undefined, 5), 5);
  assert.strictEqual(TWConfig.intOr(NaN, 3), 3);
  assert.strictEqual(TWConfig.intOr('12px', 0), 12); // leading-number tolerant
});

test('clampInt: clamps to [min,max], NaN-safe, never below 0 by default', function () {
  assert.strictEqual(TWConfig.clampInt(50, 0, 100), 50);
  assert.strictEqual(TWConfig.clampInt(-5, 0, 100), 0);
  assert.strictEqual(TWConfig.clampInt(150, 0, 100), 100);
  assert.strictEqual(TWConfig.clampInt('abc', 0, 100), 0); // NaN -> min
  assert.strictEqual(TWConfig.clampInt(-99), 0); // default min 0
});

test('swapIfInverted: auto-swaps an inverted min/max pair', function () {
  assert.deepStrictEqual(TWConfig.swapIfInverted(10, 5), [5, 10]);
  assert.deepStrictEqual(TWConfig.swapIfInverted(5, 10), [5, 10]);
  assert.deepStrictEqual(TWConfig.swapIfInverted(5, 5), [5, 5]);
});

// ============================================================
// deepMerge
// ============================================================

test('deepMerge: null/undefined patch -> deep clone of base', function () {
  var base = { a: 1, nested: { x: 1 } };
  var out = TWConfig.deepMerge(base, null);
  assert.deepStrictEqual(out, base);
  out.nested.x = 999;
  assert.strictEqual(base.nested.x, 1); // clone, not a reference
});

test('deepMerge: objects recurse, sibling keys preserved', function () {
  var base = { ui: { a: 1, b: 2 }, t: { z: 9 } };
  var out = TWConfig.deepMerge(base, { ui: { b: 20 } });
  assert.deepStrictEqual(out, { ui: { a: 1, b: 20 }, t: { z: 9 } });
});

test('deepMerge: arrays REPLACED wholesale (never element-merged)', function () {
  var base = { views: [1, 2, 3] };
  var out = TWConfig.deepMerge(base, { views: [9] });
  assert.deepStrictEqual(out.views, [9]);
});

// ============================================================
// mergeDefaults
// ============================================================

test('mergeDefaults(null) deep-equals DEFAULT_CONFIG (cfgVersion=2)', function () {
  var out = TWConfig.mergeDefaults(null);
  assert.strictEqual(out.cfgVersion, CFG_VER);
  assert.ok(Array.isArray(out.views));
  assert.ok(out.thresholds && typeof out.thresholds === 'object');
  assert.ok(out.ui && typeof out.ui === 'object');
});

test('mergeDefaults: spreads defaults under saved, stamps cfgVersion, keeps new keys', function () {
  var out = TWConfig.mergeDefaults({ thresholds: { nukeThreshold: 7000 } });
  assert.strictEqual(out.thresholds.nukeThreshold, 7000);
  assert.strictEqual(out.thresholds.whNearFullPct, 90); // forward-compatible default
  assert.strictEqual(out.cfgVersion, CFG_VER);
});

// ============================================================
// migration
// ============================================================

test('migrateConfig(null) -> valid v2, 5 seeded views', function () {
  var out = TWConfig.migrateConfig(null);
  assert.strictEqual(out.cfgVersion, CFG_VER);
  assert.strictEqual(out.views.length, SEED_COUNT);
});

test('migrateConfig: garbage / bad cfgVersion never throws, returns valid v2', function () {
  var a = TWConfig.migrateConfig('garbage');
  var b = TWConfig.migrateConfig({ cfgVersion: 'x' });
  assert.strictEqual(a.cfgVersion, CFG_VER);
  assert.strictEqual(b.cfgVersion, CFG_VER);
  assert.strictEqual(a.views.length, SEED_COUNT);
});

test('migrateConfig: v2 config preserves user view and re-seeds to >=5', function () {
  var userView = { name: 'Mine', visibleColumns: ['name'], filters: [], sort: { key: 'name', dir: 'asc' }, group: '0' };
  var out = TWConfig.migrateConfig({ cfgVersion: 2, views: [userView] });
  assert.strictEqual(out.cfgVersion, CFG_VER);
  assert.ok(out.views.length >= 5);
  assert.ok(out.views.some(function (v) { return v.name === 'Mine'; }));
});

test('migrate_v1_to_v2: imports legacy flat keys into v2 blob', function () {
  var partial = TWConfig.migrate_v1_to_v2({
    settings: { includeArchers: true, nukeThreshold: 7000, exportFormat: 'csv' },
    viewType: 'outside',
    groupId: '42'
  });
  assert.strictEqual(partial.ui.includeArchers, true);
  assert.strictEqual(partial.ui.exportFormat, 'csv');
  assert.strictEqual(partial.ui.viewType, 'outside');
  assert.strictEqual(partial.ui.groupId, '42');
  assert.strictEqual(partial.thresholds.nukeThreshold, 7000);
});

test('migrate_v1_to_v2: defaults / non-object guarded', function () {
  var p = TWConfig.migrate_v1_to_v2({});
  assert.strictEqual(p.ui.includeArchers, false);
  assert.strictEqual(p.ui.exportFormat, 'bbcode');
  assert.strictEqual(p.ui.groupId, '0');
  assert.deepStrictEqual(TWConfig.migrate_v1_to_v2(null), {});
});

test('migrateConfig: full v1 path imports legacy keys end-to-end', function () {
  var out = TWConfig.migrateConfig(null, {
    settings: { includeArchers: true, nukeThreshold: 6500, exportFormat: 'csv' },
    viewType: 'in_village',
    groupId: '7'
  });
  assert.strictEqual(out.cfgVersion, CFG_VER);
  assert.strictEqual(out.ui.includeArchers, true);
  assert.strictEqual(out.ui.exportFormat, 'csv');
  assert.strictEqual(out.ui.viewType, 'in_village');
  assert.strictEqual(out.ui.groupId, '7');
  assert.strictEqual(out.thresholds.nukeThreshold, 6500);
  assert.strictEqual(out.views.length, SEED_COUNT);
});

// ============================================================
// seeded presets
// ============================================================

test('seedViews: idempotent, full seed count from empty', function () {
  var v = TWConfig.seedViews([]);
  assert.strictEqual(v.length, SEED_COUNT);
  var again = TWConfig.seedViews(v);
  assert.strictEqual(again.length, SEED_COUNT);
});

test('seedViews: a user view survives, an edited seed (same name) NOT overwritten', function () {
  var edited = { name: 'Front Nukes', visibleColumns: ['name'], filters: [], sort: { key: 'name', dir: 'asc' }, group: '0' };
  var mine = { name: 'Mine', visibleColumns: ['name'], filters: [], sort: { key: 'name', dir: 'asc' }, group: '0' };
  var out = TWConfig.seedViews([edited, mine]);
  assert.ok(out.some(function (v) { return v.name === 'Mine'; }));
  var fn = out.filter(function (v) { return v.name === 'Front Nukes'; });
  assert.strictEqual(fn.length, 1);
  assert.deepStrictEqual(fn[0].visibleColumns, ['name']); // user edit preserved
});

test('the seeds reference real registry keys (names match design)', function () {
  var names = TWConfig.seedViews([]).map(function (v) { return v.name; }).sort();
  assert.deepStrictEqual(names,
    ['Defense Gaps', 'Defense needed', 'Eco low-WH', 'Economy overflow',
      'Fakes available', 'Front Nukes', 'Frontline', 'Full-offense-ready',
      'Noble-ready', 'Send-out wave']);
});

// The 5 curated v3 tier presets reference REAL COLUMN_REGISTRY keys.
test('v3 curated presets reference real registry keys + tier filter op', function () {
  var core = require('./helpers/load-overview-core.js');
  var keys = {};
  core.COLUMN_REGISTRY.forEach(function (c) { keys[c.key] = true; });
  var seeds = TWConfig.seedViews([]);
  var curated = ['Send-out wave', 'Defense needed', 'Economy overflow', 'Noble-ready', 'Fakes available'];
  curated.forEach(function (name) {
    var v = seeds.filter(function (s) { return s.name === name; })[0];
    assert.ok(v, 'preset present: ' + name);
    v.visibleColumns.forEach(function (k) {
      assert.ok(keys[k], name + ' visibleColumn is a real registry key: ' + k);
    });
    // Filter keys are EITHER a registry column OR a derived flag attached by
    // computeDerivedFlags (e.g. hasIncomings) that has no display column.
    var DERIVED_FLAG_KEYS = { hasIncomings: true };
    v.filters.forEach(function (f) {
      assert.ok(keys[f.key] || DERIVED_FLAG_KEYS[f.key],
        name + ' filter key is a registry key or derived flag: ' + f.key);
    });
  });
  // Send-out wave uses the badge tier filter op.
  var wave = seeds.filter(function (s) { return s.name === 'Send-out wave'; })[0];
  assert.ok(wave.filters.some(function (f) { return f.key === 'attackTier' && f.op === 'tier' && f.value === 'full'; }));
});

// ============================================================
// preset CRUD
// ============================================================

test('saveView: upsert by name (seed flag forced false)', function () {
  var cfg = TWConfig.mergeDefaults(null);
  var n0 = cfg.views.length;
  var nv = { name: 'Custom', visibleColumns: ['name', 'total'], filters: [], sort: { key: 'total', dir: 'desc' }, group: '0' };
  var out = TWConfig.saveView(cfg, nv);
  assert.strictEqual(out.views.length, n0 + 1);
  // upsert the same name -> count unchanged, content replaced
  var out2 = TWConfig.saveView(out, { name: 'Custom', visibleColumns: ['name'], filters: [], sort: { key: 'name', dir: 'asc' }, group: '0' });
  assert.strictEqual(out2.views.length, n0 + 1);
  var found = out2.views.filter(function (v) { return v.name === 'Custom'; })[0];
  assert.deepStrictEqual(found.visibleColumns, ['name']);
  assert.strictEqual(found.seed, false);
});

test('deleteView: removes by name', function () {
  var cfg = TWConfig.saveView(TWConfig.mergeDefaults(null), { name: 'X', visibleColumns: [], filters: [], sort: { key: 'name', dir: 'asc' }, group: '0' });
  var out = TWConfig.deleteView(cfg, 'X');
  assert.ok(!out.views.some(function (v) { return v.name === 'X'; }));
});

test('renameView: collision -> config UNCHANGED', function () {
  var cfg = TWConfig.saveView(TWConfig.mergeDefaults(null), { name: 'A', visibleColumns: [], filters: [], sort: { key: 'name', dir: 'asc' }, group: '0' });
  // 'Front Nukes' is a seed name already present -> collision
  var out = TWConfig.renameView(cfg, 'A', 'Front Nukes');
  assert.strictEqual(out, cfg); // reference-equality: unchanged
});

test('renameView: happy path remaps', function () {
  var cfg = TWConfig.saveView(TWConfig.mergeDefaults(null), { name: 'A', visibleColumns: [], filters: [], sort: { key: 'name', dir: 'asc' }, group: '0' });
  var out = TWConfig.renameView(cfg, 'A', 'B');
  assert.ok(out.views.some(function (v) { return v.name === 'B'; }));
  assert.ok(!out.views.some(function (v) { return v.name === 'A'; }));
});

test('applyView: returns a patch-shaped object for a known view, null for unknown', function () {
  var cfg = TWConfig.mergeDefaults(null);
  var patch = TWConfig.applyView(cfg, 'Front Nukes');
  assert.ok(patch && patch.columns && Array.isArray(patch.filters) && patch.sort);
  assert.strictEqual(TWConfig.applyView(cfg, 'NoSuchView'), null);
});

// ============================================================
// import / export
// ============================================================

test('exportViews -> importViews round-trips view count', function () {
  var cfg = TWConfig.saveView(TWConfig.mergeDefaults(null), { name: 'RT', visibleColumns: ['name'], filters: [], sort: { key: 'name', dir: 'asc' }, group: '0' });
  var json = TWConfig.exportViews(cfg);
  assert.strictEqual(typeof json, 'string');
  var fresh = TWConfig.mergeDefaults(null);
  var imported = TWConfig.importViews(fresh, json);
  assert.ok(imported.views.some(function (v) { return v.name === 'RT'; }));
});

test('importViews: bad json / non-array returns config UNCHANGED', function () {
  var cfg = TWConfig.mergeDefaults(null);
  assert.strictEqual(TWConfig.importViews(cfg, 'not json'), cfg);
  assert.strictEqual(TWConfig.importViews(cfg, '{"a":1}'), cfg);
});

// ============================================================
// load / save / patch via fakeStore (hydrate-first, no double-prefix)
// ============================================================

test('load(empty store) returns stamped v2 AND persists it', function () {
  var store = makeFakeStore();
  var cfg = TWConfig.load(store);
  assert.strictEqual(cfg.cfgVersion, CFG_VER);
  assert.strictEqual(cfg.views.length, SEED_COUNT);
  // persisted under the BARE config key (adapter would add prefixes for real)
  assert.ok(store.map.config, 'config not persisted');
  assert.strictEqual(store.map.config.cfgVersion, CFG_VER);
});

test('load: only legacy keys present -> migrates them in', function () {
  var store = makeFakeStore({
    settings: { includeArchers: true, nukeThreshold: 8000, exportFormat: 'csv' },
    view_type: 'outside',
    group_id: '9'
  });
  var cfg = TWConfig.load(store);
  assert.strictEqual(cfg.cfgVersion, CFG_VER);
  assert.strictEqual(cfg.ui.includeArchers, true);
  assert.strictEqual(cfg.ui.exportFormat, 'csv');
  assert.strictEqual(cfg.ui.viewType, 'outside');
  assert.strictEqual(cfg.ui.groupId, '9');
  assert.strictEqual(cfg.thresholds.nukeThreshold, 8000);
});

test('save: writes the config under the bare key, returns it', function () {
  var store = makeFakeStore();
  var cfg = TWConfig.mergeDefaults(null);
  var out = TWConfig.save(store, cfg);
  assert.strictEqual(out, cfg);
  assert.strictEqual(store.map.config.cfgVersion, CFG_VER);
});

test('patch: hydrate-first merge — two sequential patches preserve siblings', function () {
  var store = makeFakeStore();
  TWConfig.load(store); // seed
  TWConfig.patch(store, { ui: { includeArchers: true } });
  var after = TWConfig.patch(store, { thresholds: { nukeThreshold: 7777 } });
  assert.strictEqual(after.ui.includeArchers, true); // sibling preserved
  assert.strictEqual(after.thresholds.nukeThreshold, 7777);
  assert.strictEqual(after.cfgVersion, CFG_VER);
  // and the store reflects it
  assert.strictEqual(store.map.config.ui.includeArchers, true);
  assert.strictEqual(store.map.config.thresholds.nukeThreshold, 7777);
});

test('patch: partial write never clobbers the views array', function () {
  var store = makeFakeStore();
  TWConfig.load(store);
  var after = TWConfig.patch(store, { ui: { groupId: '3' } });
  assert.strictEqual(after.views.length, SEED_COUNT);
});

// sort specs must be canonical multi-key ARRAYS so Table.applyMultiSort/OverviewCore.sortBy
// actually sort (an object {key,dir} is silently ignored by the comparator factory).
test('sort specs (default + every preset) are multi-key arrays', function () {
  var cfg = TWConfig.load(makeFakeStore());
  assert.ok(Array.isArray(cfg.sort), 'top-level sort is an array');
  cfg.views.forEach(function (v) {
    assert.ok(Array.isArray(v.sort), v.name + ' sort must be an array');
    v.sort.forEach(function (s) {
      assert.strictEqual(typeof s.key, 'string');
      assert.ok(s.dir === 'asc' || s.dir === 'desc', 'dir asc|desc');
    });
  });
  var applied = TWConfig.applyView(cfg, 'Front Nukes');
  assert.ok(Array.isArray(applied.sort) && applied.sort.length === 1);
  assert.strictEqual(applied.sort[0].key, 'off');
  assert.strictEqual(applied.sort[0].dir, 'desc');
});

test('applyView coerces a legacy single-object sort into a one-element array', function () {
  var cfg = TWConfig.load(makeFakeStore());
  cfg.views[0].sort = { key: 'points', dir: 'asc' }; // legacy object shape
  var applied = TWConfig.applyView(cfg, cfg.views[0].name);
  assert.deepStrictEqual(applied.sort, [{ key: 'points', dir: 'asc' }]);
});
