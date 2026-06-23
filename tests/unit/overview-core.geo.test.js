'use strict';

/**
 * Specs for geo math: getContinent, fieldDistance, nearestEnemy, distanceToFront.
 */

const test = require('node:test');
const assert = require('node:assert');
const core = require('./helpers/load-overview-core.js');

test('getContinent uses Y-then-X (matches tw-map-tools.js:161)', () => {
  assert.strictEqual(core.getContinent(523, 477), 'K45');
  assert.strictEqual(core.getContinent(500, 500), 'K55');
  assert.strictEqual(core.getContinent(5, 5), 'K00');
});

test('fieldDistance is Euclidean (3-4-5)', () => {
  assert.strictEqual(core.fieldDistance({ x: 500, y: 500 }, { x: 503, y: 504 }), 5);
});

test('nearestEnemy finds the closest within the continent neighbourhood', () => {
  const from = { x: 500, y: 500 }; // K55
  const enemies = [
    { id: 1, x: 503, y: 504 }, // dist 5, same continent K55
    { id: 2, x: 560, y: 560 }, // farther, same continent
    { id: 3, x: 610, y: 495 }  // K56 neighbour, farther
  ];
  const ne = core.nearestEnemy(from, enemies);
  assert.ok(ne);
  assert.strictEqual(ne.village.id, 1);
  assert.strictEqual(ne.dist, 5);
});

test('nearestEnemy widens to the global set when the neighbourhood is empty', () => {
  const from = { x: 500, y: 500 }; // K55, no neighbours within 3x3
  const enemies = [
    { id: 9, x: 120, y: 110 },  // continent K11 (outside 3x3 from K55), nearer
    { id: 8, x: 100, y: 100 }   // continent K11, farther
  ];
  const ne = core.nearestEnemy(from, enemies);
  assert.ok(ne, 'falls back to global nearest when neighbourhood empty');
  assert.strictEqual(ne.village.id, 9); // global minimum within the searched (global) set
});

test('nearestEnemy([]) -> null', () => {
  assert.strictEqual(core.nearestEnemy({ x: 1, y: 1 }, []), null);
  assert.strictEqual(core.nearestEnemy(null, [{ x: 1, y: 1 }]), null);
});

test('distanceToFront returns nearest enemy distance, Infinity when none', () => {
  const from = { x: 500, y: 500 };
  const d = core.distanceToFront(from, [{ x: 503, y: 504 }]);
  assert.strictEqual(d, 5);
  assert.strictEqual(core.distanceToFront(from, []), Infinity);
});
