'use strict';

/**
 * Pure-parser specs for lib/tw-core.js, run through the window/jQuery shim harness.
 *
 * Covers: parseVillagesTxt (keeps bonusId from col 6), parsePlayersTxt, parseTribesTxt,
 * parseBuildingInfoXml, buildIndexBy, getContinent, and the village-index JOIN
 * (buildVillageIndex merging player rank/tribe/points by owner).
 */

const test = require('node:test');
const assert = require('node:assert');
const { loadTWCore } = require('../helpers/load-core.js');

const TWTools = loadTWCore();

// ------------------------------------------------------------------
// parseVillagesTxt — cols id,name,x,y,owner,points,bonus_id (col 6 = bonusId, NOT rank)
// ------------------------------------------------------------------
test('parseVillagesTxt parses a row keeping bonusId from col 6', () => {
  const out = TWTools.parseVillagesTxt('1,Dorf%20A,500,500,99,1234,7');
  assert.deepStrictEqual(out, [
    { id: 1, name: 'Dorf A', x: 500, y: 500, owner: 99, points: 1234, bonusId: 7 }
  ]);
});

test('parseVillagesTxt skips blank and short lines, junk -> []', () => {
  const csv = '1,Dorf%20A,500,500,99,1234,7\n\n   \nbroken,row\n2,Dorf%20B,510,500,0,800,0';
  const out = TWTools.parseVillagesTxt(csv);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[1].id, 2);
  assert.strictEqual(out[1].bonusId, 0);
  assert.deepStrictEqual(TWTools.parseVillagesTxt('not real data at all'), []);
  assert.deepStrictEqual(TWTools.parseVillagesTxt(''), []);
  assert.deepStrictEqual(TWTools.parseVillagesTxt(null), []);
});

// ------------------------------------------------------------------
// parsePlayersTxt — cols id,name,tribe,villages,points,rank (rank lives HERE, not village.txt)
// ------------------------------------------------------------------
test('parsePlayersTxt parses a row with rank from col 5', () => {
  const out = TWTools.parsePlayersTxt('7,Spieler%2B,3,12,5000,4');
  assert.deepStrictEqual(out, [
    { id: 7, name: 'Spieler+', tribe: 3, villages: 12, points: 5000, rank: 4 }
  ]);
});

test('parsePlayersTxt fail-safe on junk/empty', () => {
  assert.deepStrictEqual(TWTools.parsePlayersTxt(''), []);
  assert.deepStrictEqual(TWTools.parsePlayersTxt('x'), []);
  assert.deepStrictEqual(TWTools.parsePlayersTxt(null), []);
});

// ------------------------------------------------------------------
// parseTribesTxt — ally.txt: id,name,tag,members,villages,points,all_points,rank
// ------------------------------------------------------------------
test('parseTribesTxt parses an ally.txt row', () => {
  const out = TWTools.parseTribesTxt('3001,My%20Tribe,MINE,15,120,500000,2500000,3');
  assert.strictEqual(out.length, 1);
  const t = out[0];
  assert.strictEqual(t.id, 3001);
  assert.strictEqual(t.name, 'My Tribe');
  assert.strictEqual(t.tag, 'MINE');
  assert.strictEqual(t.rank, 3);
  assert.deepStrictEqual(TWTools.parseTribesTxt(''), []);
  assert.deepStrictEqual(TWTools.parseTribesTxt(null), []);
});

// ------------------------------------------------------------------
// parseBuildingInfoXml — regex tag scan on the STRING (no DOMParser)
// ------------------------------------------------------------------
test('parseBuildingInfoXml parses nested max_level nodes', () => {
  const xml = '<config><main><max_level>30</max_level></main>' +
    '<wall><max_level>20</max_level></wall></config>';
  const out = TWTools.parseBuildingInfoXml(xml);
  assert.strictEqual(out.main.max_level, 30);
  assert.strictEqual(out.wall.max_level, 20);
});

test('parseBuildingInfoXml fail-safe -> {} on empty/junk', () => {
  assert.deepStrictEqual(TWTools.parseBuildingInfoXml(''), {});
  assert.deepStrictEqual(TWTools.parseBuildingInfoXml(null), {});
});

// ------------------------------------------------------------------
// buildIndexBy — unique last-wins by default
// ------------------------------------------------------------------
test('buildIndexBy indexes by key, last-wins on duplicates', () => {
  const idx = TWTools.buildIndexBy([{ id: 1, v: 'a' }, { id: 2 }, { id: 1, v: 'b' }], 'id');
  assert.strictEqual(idx[1].v, 'b');
  assert.strictEqual(idx[2].id, 2);
});

test('buildIndexBy fail-safe -> {} on non-array', () => {
  assert.deepStrictEqual(TWTools.buildIndexBy(null, 'id'), {});
  assert.deepStrictEqual(TWTools.buildIndexBy({}, 'id'), {});
});

// ------------------------------------------------------------------
// getContinent — 'K' + floor(y/100) + floor(x/100)  (Y-then-X)
// ------------------------------------------------------------------
test('getContinent uses Y-then-X (byte-identical to tw-map-tools)', () => {
  assert.strictEqual(TWTools.getContinent(500, 500), 'K55');
  assert.strictEqual(TWTools.getContinent(5, 5), 'K00');
  assert.strictEqual(TWTools.getContinent(523, 477), 'K45');
});

// ------------------------------------------------------------------
// buildVillageIndex — JOIN owner rank/tribe/points from player.txt
// ------------------------------------------------------------------
test('buildVillageIndex merges owner rank from players and carries bonusId/continent', () => {
  const villages = [
    { id: 1001, name: 'V1', x: 500, y: 500, owner: 2001, points: 9500, bonusId: 7 }
  ];
  const players = [
    { id: 2001, name: 'Me', tribe: 3001, villages: 2, points: 18300, rank: 42 }
  ];
  const idx = TWTools.DataFetcher.buildVillageIndex(villages, players);
  const row = idx.byId[1001];
  assert.strictEqual(row.bonusId, 7);
  assert.strictEqual(row.rank, 42);
  assert.strictEqual(row.continent, 'K55');
  assert.ok(idx.byOwner[2001].length >= 1);
  assert.ok(Array.isArray(idx.byContinent.K55));
});
