'use strict';

/**
 * Specs for the fake/nuke ESTIMATE: estimateAttackUnits, classifyTrainKind.
 */

const test = require('node:test');
const assert = require('node:assert');
const core = require('./helpers/load-overview-core.js');

const speeds = core.DEFAULT_UNIT_SPEEDS;
const world = { speed: 1, unitSpeed: 1 };

// travelTime(dist, unitSpeed, ws, usf) = round(dist*unitSpeed*60000/(ws*usf))
function tt(dist, unitSpeed) {
  return Math.round((dist * unitSpeed * 60000) / 1);
}

test('estimateAttackUnits matches a known unit with high confidence', () => {
  const dist = 10;
  const lightMs = tt(dist, speeds.light); // exact light travel time
  const est = core.estimateAttackUnits(lightMs, dist, speeds, world);
  assert.strictEqual(est.unit, 'light');
  assert.strictEqual(est.confidence, 'high');
  assert.strictEqual(est.isNoble, false);
});

test('estimateAttackUnits flags isNoble only for snob', () => {
  const dist = 10;
  const snobMs = tt(dist, speeds.snob);
  const est = core.estimateAttackUnits(snobMs, dist, speeds, world);
  assert.strictEqual(est.unit, 'snob');
  assert.strictEqual(est.isNoble, true);
});

test('estimateAttackUnits(_, 0, _, _) -> unknown/none and never throws', () => {
  const est = core.estimateAttackUnits(123456, 0, speeds, world);
  assert.deepStrictEqual(est, { unit: 'unknown', isNoble: false, confidence: 'none' });
  // no args at all also safe
  assert.doesNotThrow(() => core.estimateAttackUnits());
});

test('classifyTrainKind: noble when a noble command is present', () => {
  const train = { commands: [{ unit: 'snob' }, { unit: 'axe' }] };
  const out = core.classifyTrainKind(train, speeds, world);
  assert.strictEqual(out.kind, 'noble');
  assert.ok(out.confidence);
});

test('classifyTrainKind: nuke for a heavy/ram-class command', () => {
  const train = { commands: [{ unit: 'ram' }, { unit: 'axe' }] };
  const out = core.classifyTrainKind(train, speeds, world);
  assert.strictEqual(out.kind, 'nuke');
});

test('classifyTrainKind: fake for a single fast scout-class command', () => {
  const train = { commands: [{ unit: 'spy' }] };
  const out = core.classifyTrainKind(train, speeds, world);
  assert.strictEqual(out.kind, 'fake');
});

test('classifyTrainKind: unknown when undeterminable, always has a confidence label', () => {
  const out = core.classifyTrainKind({ commands: [{ unit: 'spear' }] }, speeds, world);
  assert.strictEqual(out.kind, 'unknown');
  assert.ok(typeof out.confidence === 'string');
  const empty = core.classifyTrainKind({ commands: [] });
  assert.strictEqual(empty.kind, 'unknown');
  assert.strictEqual(empty.confidence, 'none');
});
