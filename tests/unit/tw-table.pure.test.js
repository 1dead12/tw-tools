'use strict';

/**
 * Pure-helper specs for lib/tw-table.js (the generic table engine's node-testable
 * core). NO DOM / NO jQuery — every helper under Table.pure.* is a pure transform.
 * The bundled lib source IS the tested source (node-compat envelope).
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const Table = require(path.join(__dirname, '..', '..', 'lib', 'tw-table.js'));
const pure = Table.pure;
const { MODEL, COLUMNS } = require('./fixtures/table-model.sample.js');

const col = (key) => COLUMNS.filter((c) => c.key === key)[0];

// ============================================================
// applyFilters
// ============================================================

test('applyFilters: empty spec passes everything through (same length)', () => {
  assert.strictEqual(pure.applyFilters(MODEL, [], COLUMNS).length, MODEL.length);
});

test('applyFilters: gte filters by numeric threshold', () => {
  const out = pure.applyFilters(MODEL, [{ key: 'points', op: 'gte', value: 5000 }], COLUMNS);
  assert.ok(out.every((r) => r.points >= 5000));
  assert.strictEqual(out.length, MODEL.filter((r) => r.points >= 5000).length);
});

test('applyFilters: lte filters by numeric threshold', () => {
  const out = pure.applyFilters(MODEL, [{ key: 'whFillPct', op: 'lte', value: 60 }], COLUMNS);
  assert.ok(out.every((r) => r.whFillPct <= 60));
});

test('applyFilters: eq matches exact value', () => {
  const out = pure.applyFilters(MODEL, [{ key: 'rank', op: 'eq', value: 45 }], COLUMNS);
  assert.ok(out.every((r) => r.rank === 45));
  assert.ok(out.length >= 1);
});

test('applyFilters: flag keeps only truthy rows', () => {
  const out = pure.applyFilters(MODEL, [{ key: 'underDefended', op: 'flag', value: true }], COLUMNS);
  assert.ok(out.every((r) => r.underDefended === true));
  assert.strictEqual(out.length, MODEL.filter((r) => r.underDefended).length);
});

test('applyFilters: search does case-insensitive substring match on the searched key', () => {
  const out = pure.applyFilters(MODEL, [{ key: 'name', op: 'search', value: 'ech' }], COLUMNS);
  assert.deepStrictEqual(out.map((r) => r.name), ['Echo, City']);
});

test('applyFilters: unknown op passes rows through (fail-safe, no throw)', () => {
  const out = pure.applyFilters(MODEL, [{ key: 'points', op: 'bogus', value: 1 }], COLUMNS);
  assert.strictEqual(out.length, MODEL.length);
});

test('applyFilters: composes multiple specs with AND', () => {
  const out = pure.applyFilters(MODEL, [
    { key: 'points', op: 'gte', value: 5000 },
    { key: 'whFillPct', op: 'gte', value: 90 }
  ], COLUMNS);
  assert.ok(out.every((r) => r.points >= 5000 && r.whFillPct >= 90));
});

test('applyFilters: fail-safe on non-array rows -> []', () => {
  assert.deepStrictEqual(pure.applyFilters(null, [{ key: 'points', op: 'gte', value: 0 }]), []);
});

// ============================================================
// computeFilterCounts
// ============================================================

test('computeFilterCounts: count per chip equals applyFilters(rows,[chip]).length', () => {
  const chips = [
    { key: 'points', op: 'gte', value: 5000 },
    { key: 'whFillPct', op: 'gte', value: 90 },
    { key: 'underDefended', op: 'flag', value: true }
  ];
  const counts = pure.computeFilterCounts(MODEL, chips, COLUMNS);
  chips.forEach((chip) => {
    const id = chip.key + '|' + chip.op + '|' + chip.value;
    assert.strictEqual(counts[id], pure.applyFilters(MODEL, [chip], COLUMNS).length, id);
  });
});

test('computeFilterCounts: fail-safe -> {} on bad input', () => {
  assert.deepStrictEqual(pure.computeFilterCounts(null, null), {});
});

// ============================================================
// applyMultiSort
// ============================================================

test('applyMultiSort: numeric desc orders correctly', () => {
  const out = pure.applyMultiSort(MODEL, [{ key: 'points', dir: 'desc', type: 'num' }], COLUMNS);
  const pts = out.map((r) => r.points);
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i - 1] >= pts[i]);
});

test('applyMultiSort: second key breaks ties', () => {
  // points 5000 tie between Charlie(rank45) and Foxtrot(rank45)->same; use rank then id.
  const out = pure.applyMultiSort(MODEL, [
    { key: 'points', dir: 'desc', type: 'num' },
    { key: 'id', dir: 'asc', type: 'num' }
  ], COLUMNS);
  const tied = out.filter((r) => r.points === 5000).map((r) => r.id);
  assert.deepStrictEqual(tied, [3, 6]);
});

test('applyMultiSort: returns a NEW array and does NOT mutate input', () => {
  const before = MODEL.map((r) => r.id);
  const out = pure.applyMultiSort(MODEL, [{ key: 'points', dir: 'asc', type: 'num' }], COLUMNS);
  assert.notStrictEqual(out, MODEL);
  assert.deepStrictEqual(MODEL.map((r) => r.id), before, 'input order preserved');
});

test('applyMultiSort: string asc uses localeCompare', () => {
  const out = pure.applyMultiSort(MODEL, [{ key: 'name', dir: 'asc', type: 'str' }], COLUMNS);
  const names = out.map((r) => r.name);
  const sorted = names.slice().sort((a, b) => a.localeCompare(b));
  assert.deepStrictEqual(names, sorted);
});

test('applyMultiSort: empty spec returns a copy in input order', () => {
  const out = pure.applyMultiSort(MODEL, [], COLUMNS);
  assert.notStrictEqual(out, MODEL);
  assert.deepStrictEqual(out.map((r) => r.id), MODEL.map((r) => r.id));
});

// ============================================================
// toggleSortKey
// ============================================================

test('toggleSortKey: plain click replaces the spec with a single key (asc)', () => {
  const next = pure.toggleSortKey([{ key: 'name', dir: 'asc' }], 'points', false);
  assert.strictEqual(next.length, 1);
  assert.strictEqual(next[0].key, 'points');
  assert.strictEqual(next[0].dir, 'asc');
});

test('toggleSortKey: plain click on the sole sort key cycles asc->desc', () => {
  const next = pure.toggleSortKey([{ key: 'points', dir: 'asc' }], 'points', false);
  assert.strictEqual(next.length, 1);
  assert.strictEqual(next[0].dir, 'desc');
});

test('toggleSortKey: additive (shift) appends a new key', () => {
  const next = pure.toggleSortKey([{ key: 'points', dir: 'desc' }], 'name', true);
  assert.deepStrictEqual(next.map((s) => s.key), ['points', 'name']);
});

test('toggleSortKey: additive on an existing key cycles its direction in place', () => {
  const next = pure.toggleSortKey(
    [{ key: 'points', dir: 'asc' }, { key: 'name', dir: 'asc' }], 'points', true);
  assert.strictEqual(next.length, 2);
  assert.strictEqual(next[0].key, 'points');
  assert.strictEqual(next[0].dir, 'desc');
});

test('toggleSortKey: does NOT mutate the input spec', () => {
  const spec = [{ key: 'points', dir: 'asc' }];
  pure.toggleSortKey(spec, 'points', false);
  assert.deepStrictEqual(spec, [{ key: 'points', dir: 'asc' }]);
});

// ============================================================
// projectVisible
// ============================================================

test('projectVisible: picks visible columns in REGISTRY order, formatting cells', () => {
  const cells = pure.projectVisible(MODEL[0], ['name', 'points'], COLUMNS);
  assert.deepStrictEqual(cells.map((c) => c.key), ['name', 'points']);
  assert.strictEqual(cells[0].text, 'Alpha');
  assert.strictEqual(cells[1].text, '9000'); // points col format -> String(v)
});

test('projectVisible: ignores unknown keys', () => {
  const cells = pure.projectVisible(MODEL[0], ['name', 'nope'], COLUMNS);
  assert.deepStrictEqual(cells.map((c) => c.key), ['name']);
});

test('projectVisible: default (no visible list) falls back to defaultVisible !== false', () => {
  const cells = pure.projectVisible(MODEL[0], null, COLUMNS);
  // coord/name/points/whFillPct are defaultVisible:true; underDefended is false.
  assert.deepStrictEqual(cells.map((c) => c.key), ['coord', 'name', 'points', 'whFillPct']);
});

// ============================================================
// resolvePillClasses
// ============================================================

test('resolvePillClasses: incoming-nuke wins over under-defended and wh-near-full', () => {
  const res = pure.resolvePillClasses(MODEL[0]); // all three flags true
  assert.ok(res.classes.indexOf('twt-row-nuke') !== -1);
  assert.ok(res.accent); // accent color present
});

test('resolvePillClasses: under-defended ranks above wh-near-full', () => {
  const res = pure.resolvePillClasses(MODEL[3]); // underDefended true, whNearFull false
  assert.ok(res.classes.indexOf('twt-row-underdef') !== -1);
});

test('resolvePillClasses: wh-near-full only', () => {
  const res = pure.resolvePillClasses(MODEL[2]); // whNearFull only
  assert.ok(res.classes.indexOf('twt-row-whfull') !== -1);
});

test('resolvePillClasses: no flags -> empty classes, no accent', () => {
  const res = pure.resolvePillClasses(MODEL[4]);
  assert.deepStrictEqual(res.classes, []);
  assert.ok(!res.accent);
});

test('resolvePillClasses: incoming-nuke fires on nukesEst>0, NOT on isNuke (own offensive village)', () => {
  // An estimated incoming nuke (nukesEst>0) with no explicit boolean still goes purple.
  const fromEstimate = pure.resolvePillClasses({ nukesEst: 2 });
  assert.ok(fromEstimate.classes.indexOf('twt-row-nuke') !== -1, 'nukesEst>0 => incoming-nuke pill');
  // A village that is ITSELF an offensive nuke must NOT get the incoming-nuke pill.
  const ownNuke = pure.resolvePillClasses({ isNuke: true, nukesEst: 0 });
  assert.strictEqual(ownNuke.classes.indexOf('twt-row-nuke'), -1, 'isNuke alone => no incoming-nuke pill');
});

// ============================================================
// buildBBCode
// ============================================================

test('buildBBCode: emits TW [table][**]..[/**] header then [*] data rows', () => {
  const bb = pure.buildBBCode([MODEL[0]], [col('coord'), col('name'), col('points')]);
  assert.ok(bb.indexOf('[table]') === 0);
  assert.ok(bb.indexOf('[/table]') !== -1);
  assert.ok(/\[\*\*\]Coords\[\|\|\]Village\[\|\|\]Points\[\/\*\*\]/.test(bb));
});

test('buildBBCode: coord columns render [coord]x|y[/coord]', () => {
  const bb = pure.buildBBCode([MODEL[0]], [col('coord'), col('name')]);
  assert.ok(bb.indexOf('[coord]500|500[/coord]') !== -1);
});

test('buildBBCode: empty view still yields a valid header-only table', () => {
  const bb = pure.buildBBCode([], [col('coord'), col('name')]);
  assert.ok(bb.indexOf('[table]') === 0);
  assert.ok(bb.indexOf('[/table]') !== -1);
});

// ============================================================
// buildCSV
// ============================================================

test('buildCSV: quotes only cells that need it (comma / quote / newline)', () => {
  const csv = pure.buildCSV([MODEL[3], MODEL[4]], [col('name'), col('points')]);
  const lines = csv.split(/\r?\n/);
  assert.strictEqual(lines[0], 'Village,Points');
  // Delta "Quote" has a quote -> escaped+quoted; Echo, City has a comma -> quoted.
  assert.ok(lines[1].indexOf('"Delta ""Quote"""') !== -1);
  assert.ok(lines[2].indexOf('"Echo, City"') !== -1);
});

test('buildCSV: numbers exported raw (no thousands separators)', () => {
  const csv = pure.buildCSV([MODEL[0]], [col('points')]);
  assert.ok(/\b9000\b/.test(csv));
  assert.ok(csv.indexOf('9.000') === -1 && csv.indexOf('9,000') === -1);
});

test('buildCSV: coord cells exported raw x|y (no [coord] tags)', () => {
  const csv = pure.buildCSV([MODEL[0]], [col('coord')]);
  assert.ok(csv.indexOf('500|500') !== -1);
  assert.ok(csv.indexOf('[coord]') === -1);
});

// ============================================================
// formatCellForExport
// ============================================================

test('formatCellForExport: null/undefined -> empty string', () => {
  assert.strictEqual(pure.formatCellForExport(null, col('name')), '');
  assert.strictEqual(pure.formatCellForExport(undefined, col('name')), '');
});

test('formatCellForExport: number emitted raw (does NOT call descriptor.format)', () => {
  assert.strictEqual(pure.formatCellForExport(9000, col('points')), '9000');
});

test('formatCellForExport: coord column emits raw x|y string', () => {
  assert.strictEqual(pure.formatCellForExport('500|500', col('coord')), '500|500');
});

// ============================================================
// computeVirtualWindow
// ============================================================

test('computeVirtualWindow: total=0 -> empty window, both pads 0', () => {
  const w = pure.computeVirtualWindow(0, 20, 400, 0);
  assert.strictEqual(w.startIndex, 0);
  assert.strictEqual(w.endIndex, 0);
  assert.strictEqual(w.padTop, 0);
  assert.strictEqual(w.padBottom, 0);
});

test('computeVirtualWindow: scrollTop=0 starts at index 0', () => {
  const w = pure.computeVirtualWindow(0, 20, 400, 1000);
  assert.strictEqual(w.startIndex, 0);
  assert.strictEqual(w.padTop, 0);
  assert.ok(w.endIndex > 0 && w.endIndex <= 1000);
});

test('computeVirtualWindow: mid-scroll has a non-zero top pad and an aligned window', () => {
  const rowH = 20;
  const w = pure.computeVirtualWindow(2000, rowH, 400, 1000);
  assert.ok(w.startIndex > 0);
  assert.strictEqual(w.padTop, w.startIndex * rowH);
  assert.strictEqual(w.padTop + (w.endIndex - w.startIndex) * rowH + w.padBottom, 1000 * rowH);
});

test('computeVirtualWindow: scrolled beyond content clamps within bounds', () => {
  const w = pure.computeVirtualWindow(999999, 20, 400, 1000);
  assert.ok(w.endIndex <= 1000);
  assert.ok(w.startIndex <= w.endIndex);
  assert.strictEqual(w.padBottom, (1000 - w.endIndex) * 20);
});

test('computeVirtualWindow: exact fit / overscan never throws and stays in bounds', () => {
  const w = pure.computeVirtualWindow(0, 25, 250, 10); // 10 rows fit exactly
  assert.strictEqual(w.startIndex, 0);
  assert.ok(w.endIndex >= 10);
  assert.ok(w.endIndex <= 10);
});

// ============================================================
// badgeCellModel + tier chips (badge columns)
// ============================================================

const BADGE_COL = {
  key: 'attackTier', label: 'Atk tier', domain: 'troops',
  render: 'badge', badge: true, tierChips: ['full', 'partial', 'empty'],
  colorKeyField: 'attackTierColorKey', sortType: 'str'
};

test('badgeCellModel: reads tier object (icon + label + %) and colorKey', () => {
  const row = {
    attackTier: { tier: 'full', label: 'NUKE', icon: '⚔', colorKey: 'red', nukePercent: 95 }
  };
  const m = pure.badgeCellModel(row, BADGE_COL);
  assert.strictEqual(m.tier, 'full');
  assert.strictEqual(m.label, 'NUKE');
  assert.strictEqual(m.colorKey, 'red');
  assert.strictEqual(m.pct, 95);
  assert.ok(m.text.indexOf('NUKE') !== -1);
  assert.ok(m.text.indexOf('95%') !== -1);
  assert.ok(m.text.indexOf('⚔') !== -1);
});

test('badgeCellModel: falls back to row[colorKeyField] when the object lacks colorKey', () => {
  const row = {
    attackTier: { tier: 'partial', label: 'PARTIAL', nukePercent: 50 },
    attackTierColorKey: 'orange'
  };
  const m = pure.badgeCellModel(row, BADGE_COL);
  assert.strictEqual(m.colorKey, 'orange');
});

test('badgeCellModel: defPercent used when nukePercent absent', () => {
  const row = { defTier: { tier: 'empty', label: 'OPEN', colorKey: 'red', defPercent: 12 } };
  const m = pure.badgeCellModel(row, { key: 'defTier', render: 'badge' });
  assert.strictEqual(m.pct, 12);
  assert.strictEqual(m.colorKey, 'red');
});

test('badgeCellModel: grey fallback colorKey, fail-safe on missing tier', () => {
  const m = pure.badgeCellModel({}, BADGE_COL);
  assert.strictEqual(m.colorKey, 'grey');
  assert.strictEqual(m.text, '');
});

test('tier filter op: eq against nested tier value via applyFilters', () => {
  const rows = [
    { id: 1, attackTier: { tier: 'full' } },
    { id: 2, attackTier: { tier: 'partial' } },
    { id: 3, attackTier: { tier: 'empty' } },
    { id: 4, attackTier: { tier: 'full' } }
  ];
  const out = pure.applyFilters(rows, [{ key: 'attackTier', op: 'tier', value: 'full' }]);
  assert.deepStrictEqual(out.map((r) => r.id), [1, 4]);
});

test('computeFilterCounts: per-tier-chip counts match applyFilters', () => {
  const rows = [
    { attackTier: { tier: 'full' } },
    { attackTier: { tier: 'full' } },
    { attackTier: { tier: 'partial' } },
    { attackTier: { tier: 'empty' } }
  ];
  const chips = BADGE_COL.tierChips.map((tv) => ({ key: 'attackTier', op: 'tier', value: tv }));
  const counts = pure.computeFilterCounts(rows, chips);
  assert.strictEqual(counts['attackTier|tier|full'], 2);
  assert.strictEqual(counts['attackTier|tier|partial'], 1);
  assert.strictEqual(counts['attackTier|tier|empty'], 1);
});
