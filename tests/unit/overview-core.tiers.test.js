'use strict';

/**
 * Specs for the attack/defense tier classifiers + the curated derived flags
 * (offType, fakeAvailable, nobleTrainReady, scoutReady, economy/buildings/map
 * flags) added in lib/tw-overview-core.js. All PURE + fail-safe.
 *
 * Pops use the REAL sk104 values baked into UNIT_POP
 * (axe1/light4/ram5/cata8/spear1/sword1/heavy6/spy2/snob100), with archer:1,
 * marcher:5 for archer worlds.
 */

const test = require('node:test');
const assert = require('node:assert');
const core = require('./helpers/load-overview-core.js');

// ------------------------------------------------------------------
// UNIT_POP defaults
// ------------------------------------------------------------------
test('UNIT_POP carries the real per-world pops', () => {
  const p = core.UNIT_POP;
  assert.strictEqual(p.axe, 1);
  assert.strictEqual(p.light, 4);
  assert.strictEqual(p.ram, 5);
  assert.strictEqual(p.catapult, 8);
  assert.strictEqual(p.spear, 1);
  assert.strictEqual(p.sword, 1);
  assert.strictEqual(p.heavy, 6);
  assert.strictEqual(p.spy, 2);
  assert.strictEqual(p.snob, 100);
  assert.strictEqual(p.archer, 1);
  assert.strictEqual(p.marcher, 5);
});

// ------------------------------------------------------------------
// classifyAttackTier
// ------------------------------------------------------------------
test('classifyAttackTier: 6500 axe + 3000 light + 300 ram -> full / RED', () => {
  // offPop = 6500*1 + 3000*4 + 300*5 = 6500 + 12000 + 1500 = 20000 -> fraction 1.0
  const t = core.classifyAttackTier({ axe: 6500, light: 3000, ram: 300 }, { targetNukePop: 20000 });
  assert.strictEqual(t.offensivePop, 20000);
  assert.strictEqual(t.tier, 'full');
  assert.strictEqual(t.colorKey, 'red'); // polarity B default
  assert.strictEqual(t.nukePercent, 100);
  assert.strictEqual(t.label, 'NUKE');
  assert.ok(t.icon && typeof t.icon === 'string');
});

test('classifyAttackTier: 3000 axe -> partial / ORANGE', () => {
  // offPop = 3000 -> fraction 0.15 ... wait: 3000/20000 = 0.15 -> empty.
  // Use a clearer partial case: 9000 axe -> 0.45 -> partial.
  const t = core.classifyAttackTier({ axe: 9000 }, { targetNukePop: 20000 });
  assert.strictEqual(t.tier, 'partial');
  assert.strictEqual(t.colorKey, 'orange');
});

test('classifyAttackTier: 3000 axe is below partial (empty)', () => {
  const t = core.classifyAttackTier({ axe: 3000 }, { targetNukePop: 20000 });
  // 3000/20000 = 0.15 < 0.40 -> empty
  assert.strictEqual(t.tier, 'empty');
  assert.strictEqual(t.colorKey, 'green'); // polarity B: empty=green
});

test('classifyAttackTier: 500 axe -> empty', () => {
  const t = core.classifyAttackTier({ axe: 500 }, { targetNukePop: 20000 });
  assert.strictEqual(t.tier, 'empty');
});

test('classifyAttackTier: high off but ram < minRam -> NOT full (downgraded to partial)', () => {
  // offPop full (20000) but only 100 rams (< 200) -> guard fails -> partial.
  const t = core.classifyAttackTier({ axe: 7500, light: 3000, ram: 100 }, { targetNukePop: 20000 });
  // offPop = 7500 + 12000 + 500 = 20000 -> fraction 1.0 but ram 100 < 200
  assert.notStrictEqual(t.tier, 'full');
  assert.strictEqual(t.tier, 'partial');
});

test('classifyAttackTier: colorPolarity A inverts full/empty', () => {
  const full = core.classifyAttackTier({ axe: 6500, light: 3000, ram: 300 },
    { targetNukePop: 20000, colorPolarity: 'A' });
  assert.strictEqual(full.tier, 'full');
  assert.strictEqual(full.colorKey, 'green'); // inverted
  const empty = core.classifyAttackTier({ axe: 100 }, { targetNukePop: 20000, colorPolarity: 'A' });
  assert.strictEqual(empty.tier, 'empty');
  assert.strictEqual(empty.colorKey, 'red'); // inverted
});

test('classifyAttackTier: includeArchers adds marcher pop', () => {
  const noArch = core.classifyAttackTier({ marcher: 4000 }, { targetNukePop: 20000 });
  assert.strictEqual(noArch.offensivePop, 0); // marcher ignored without includeArchers
  const arch = core.classifyAttackTier({ marcher: 4000 }, { targetNukePop: 20000, includeArchers: true });
  assert.strictEqual(arch.offensivePop, 4000 * 5); // 20000
});

test('classifyAttackTier: fail-safe on garbage input', () => {
  const t = core.classifyAttackTier(null, null);
  assert.strictEqual(t.tier, 'empty');
  assert.strictEqual(t.offensivePop, 0);
  assert.strictEqual(t.nukePercent, 0);
});

test('classifyAttackTier: injected unitPops override defaults', () => {
  const t = core.classifyAttackTier({ axe: 10000 }, { targetNukePop: 20000, unitPops: { axe: 2 } });
  assert.strictEqual(t.offensivePop, 20000); // 10000 * 2
  // fraction 1.0 but ram 0 < minRam(200) -> NOT full -> partial.
  assert.strictEqual(t.tier, 'partial');
});

// ------------------------------------------------------------------
// classifyDefTier
// ------------------------------------------------------------------
test('classifyDefTier: full stack -> full / GREEN (fixed danger polarity)', () => {
  // defPop = spear*1 + sword*1 + heavy*6. 9500 spear + 9500 sword + 167 heavy =
  // 9500 + 9500 + 1002 = 20002 -> fraction ~1.0 -> full.
  const t = core.classifyDefTier({ spear: 9500, sword: 9500, heavy: 167 }, { targetDefPop: 20000 });
  assert.strictEqual(t.tier, 'full');
  assert.strictEqual(t.colorKey, 'green');
  assert.ok(t.defPercent >= 100);
});

test('classifyDefTier: empty -> RED danger; partial -> ORANGE', () => {
  const empty = core.classifyDefTier({ spear: 100 }, { targetDefPop: 20000 });
  assert.strictEqual(empty.tier, 'empty');
  assert.strictEqual(empty.colorKey, 'red');
  const partial = core.classifyDefTier({ spear: 9000 }, { targetDefPop: 20000 }); // 0.45
  assert.strictEqual(partial.tier, 'partial');
  assert.strictEqual(partial.colorKey, 'orange');
});

test('classifyDefTier: defense polarity NOT flipped by colorPolarity:A', () => {
  const empty = core.classifyDefTier({ spear: 100 }, { targetDefPop: 20000, colorPolarity: 'A' });
  assert.strictEqual(empty.colorKey, 'red'); // still red despite polarity A
});

test('classifyDefTier: stacked at >= 2x targetDefPop', () => {
  // defPop 40000 = 6667 heavy * 6 = 40002 -> fraction 2.0 -> stacked
  const t = core.classifyDefTier({ heavy: 6667 }, { targetDefPop: 20000 });
  assert.strictEqual(t.stacked, true);
  const notStacked = core.classifyDefTier({ heavy: 3000 }, { targetDefPop: 20000 });
  assert.strictEqual(notStacked.stacked, false);
});

// ------------------------------------------------------------------
// classifyOffType
// ------------------------------------------------------------------
test('classifyOffType: axe-heavy / lc-heavy / balanced', () => {
  // axePop / offPop > 0.75 -> axe-heavy.
  assert.strictEqual(core.classifyOffType({ axe: 9000, light: 500 }), 'axe-heavy');
  // lightPop dominant: light 4000*4=16000 vs axe 1000 -> light/off = 16000/17000 ~ 0.94 -> lc-heavy
  assert.strictEqual(core.classifyOffType({ axe: 1000, light: 4000 }), 'lc-heavy');
  // balanced: axe 5000 (5000) + light 1000 (4000) -> axe 0.55, light 0.44 -> balanced
  assert.strictEqual(core.classifyOffType({ axe: 5000, light: 1000 }), 'balanced');
  // no offense -> balanced
  assert.strictEqual(core.classifyOffType({ spear: 100 }), 'balanced');
});

// ------------------------------------------------------------------
// computeDerivedFlags — tier + curated fields
// ------------------------------------------------------------------
test('computeDerivedFlags attaches attackTier/defTier + flat % + colorKey + hasFullNuke', () => {
  const out = core.computeDerivedFlags(
    { axe: 6500, light: 3000, ram: 300, units: { axe: 6500, light: 3000, ram: 300 } },
    { targetNukePop: 20000 });
  assert.ok(out.attackTier && out.attackTier.tier === 'full');
  assert.strictEqual(out.attackTierColorKey, 'red');
  assert.strictEqual(out.nukePercent, 100);
  assert.strictEqual(out.offensivePop, 20000);
  assert.strictEqual(out.hasFullNuke, true);
  assert.ok(out.defTier && out.defTier.tier === 'empty');
  assert.strictEqual(out.defTierColorKey, 'red');
  // offPop = 6500 + 12000 + 1500 = 20000; lightPop/off = 0.6 > 0.55 -> lc-heavy.
  assert.strictEqual(out.offType, 'lc-heavy');
});

test('computeDerivedFlags: fakeAvailable when has offensive units AND nukeFraction < 0.40', () => {
  const fake = core.computeDerivedFlags({ axe: 1000, units: { axe: 1000 } }, { targetNukePop: 20000 });
  // offPop 1000 -> fraction 0.05 < 0.40 AND axe>=1 -> fakeAvailable
  assert.strictEqual(fake.fakeAvailable, true);
  const noFake = core.computeDerivedFlags({ axe: 6500, light: 3000, ram: 300, units: { axe: 6500, light: 3000, ram: 300 } }, { targetNukePop: 20000 });
  assert.strictEqual(noFake.fakeAvailable, false); // fraction >= 0.40
  const noUnits = core.computeDerivedFlags({ spear: 500, units: { spear: 500 } }, { targetNukePop: 20000 });
  assert.strictEqual(noUnits.fakeAvailable, false); // no offensive units at all
});

test('computeDerivedFlags: nobleTrainReady when snob>=4 AND nukeFraction>=0.6', () => {
  const ready = core.computeDerivedFlags(
    { snob: 4, axe: 7000, light: 1500, ram: 250, units: { snob: 4, axe: 7000, light: 1500, ram: 250 } },
    { targetNukePop: 20000 });
  // offPop = 7000 + 6000 + 1250 = 14250 -> 0.71 >= 0.6, snob 4
  assert.strictEqual(ready.nobleTrainReady, true);
  const notEnoughSnob = core.computeDerivedFlags(
    { snob: 2, axe: 8000, light: 2000, ram: 300, units: { snob: 2, axe: 8000, light: 2000, ram: 300 } },
    { targetNukePop: 20000 });
  assert.strictEqual(notEnoughSnob.nobleTrainReady, false);
  const tooSmall = core.computeDerivedFlags(
    { snob: 4, axe: 2000, units: { snob: 4, axe: 2000 } }, { targetNukePop: 20000 });
  assert.strictEqual(tooSmall.nobleTrainReady, false); // fraction 0.1 < 0.6
});

test('computeDerivedFlags: scoutReady (spy>=50), catNuke (cat>=200), stacked', () => {
  const sc = core.computeDerivedFlags({ spy: 50, units: { spy: 50 } }, {});
  assert.strictEqual(sc.scoutReady, true);
  const noSc = core.computeDerivedFlags({ spy: 49, units: { spy: 49 } }, {});
  assert.strictEqual(noSc.scoutReady, false);
  const cat = core.computeDerivedFlags({ catapult: 200, units: { catapult: 200 } }, {});
  assert.strictEqual(cat.catNuke, true);
});

test('computeDerivedFlags: economy flags (whFull/resLow/farmCapped/freeFarmSpace/merchantsFree)', () => {
  const eco = core.computeDerivedFlags(
    { whFillPct: 99, popMax: 24000, popUsed: 23000, merchantsFree: 3, whCap: 100000, wood: 5000, clay: 80000, iron: 90000 },
    {});
  assert.strictEqual(eco.whFull, true);
  assert.strictEqual(eco.freeFarmSpace, 1000);
  assert.strictEqual(eco.farmCapped, true); // 23000 >= 0.95*24000 = 22800
  assert.strictEqual(eco.merchantsFree, 3);
  assert.strictEqual(eco.merchantsAvailable, true);
  assert.strictEqual(eco.resLow, true); // wood 5000 < 0.10 * 100000 = 10000
});

test('computeDerivedFlags: buildings + map flags (noWall/underBuilt/frontline)', () => {
  const b = core.computeDerivedFlags({ wall: 15, main: 18, distFront: 10 }, { frontBand: 25 });
  assert.strictEqual(b.noWall, true);
  assert.strictEqual(b.underBuilt, true);
  assert.strictEqual(b.frontline, true);
  const far = core.computeDerivedFlags({ wall: 20, main: 20, distFront: 60 }, { frontBand: 25 });
  assert.strictEqual(far.noWall, false);
  assert.strictEqual(far.underBuilt, false);
  assert.strictEqual(far.frontline, false);
});

test('computeDerivedFlags does NOT mutate input (tier fields added only to copy)', () => {
  const row = { axe: 6500, light: 3000, ram: 300, units: { axe: 6500, light: 3000, ram: 300 } };
  const out = core.computeDerivedFlags(row, { targetNukePop: 20000 });
  assert.strictEqual(row.attackTier, undefined);
  assert.ok(out.attackTier);
  assert.notStrictEqual(out, row);
});

// ------------------------------------------------------------------
// registry: badge columns + tier chips meta
// ------------------------------------------------------------------
test('COLUMN_REGISTRY has attackTier/defTier badge columns with tierChips meta', () => {
  const atk = core.getColumn('attackTier');
  assert.ok(atk);
  assert.strictEqual(atk.render, 'badge');
  assert.strictEqual(atk.badge, true);
  assert.deepStrictEqual(atk.tierChips, ['full', 'partial', 'empty']);
  assert.strictEqual(atk.filterable, true);
  const def = core.getColumn('defTier');
  assert.ok(def);
  assert.strictEqual(def.render, 'badge');
  assert.deepStrictEqual(def.tierChips, ['full', 'partial', 'empty']);
});

test('COLUMN_REGISTRY has nukePercent as a sortable numeric % column', () => {
  const np = core.getColumn('nukePercent');
  assert.ok(np);
  assert.strictEqual(np.sortable, true);
  assert.strictEqual(np.sortType, 'num');
  assert.strictEqual(np.format(73), '73%');
});

test('COLUMN_REGISTRY has all new curated keys', () => {
  ['attackTier', 'nukePercent', 'offensivePop', 'hasFullNuke', 'offType', 'catNuke',
    'fakeAvailable', 'defTier', 'defPercent', 'defensivePop', 'stacked',
    'nobleTrainReady', 'scoutReady', 'whFull', 'whNearFull', 'resLow',
    'merchantsFree', 'merchantsAvailable', 'freeFarmSpace', 'farmCapped',
    'noWall', 'underBuilt', 'frontline'].forEach((k) => {
    assert.ok(core.getColumn(k), 'registry has key ' + k);
  });
});
