'use strict';

/**
 * Specs for the multi-key sortBy comparator.
 */

const test = require('node:test');
const assert = require('node:assert');
const core = require('./helpers/load-overview-core.js');

test('sortBy numeric desc', () => {
  const rows = [{ points: 100 }, { points: 300 }, { points: 200 }];
  rows.sort(core.sortBy([{ key: 'points', dir: 'desc', type: 'num' }]));
  assert.deepStrictEqual(rows.map((r) => r.points), [300, 200, 100]);
});

test('sortBy: a second key breaks ties', () => {
  const rows = [
    { grp: 1, points: 50 },
    { grp: 1, points: 90 },
    { grp: 2, points: 10 }
  ];
  rows.sort(core.sortBy([
    { key: 'grp', dir: 'asc', type: 'num' },
    { key: 'points', dir: 'desc', type: 'num' }
  ]));
  assert.deepStrictEqual(rows.map((r) => [r.grp, r.points]), [[1, 90], [1, 50], [2, 10]]);
});

test('sortBy type:str uses localeCompare', () => {
  const rows = [{ name: 'Charlie' }, { name: 'alpha' }, { name: 'Bravo' }];
  rows.sort(core.sortBy([{ key: 'name', dir: 'asc', type: 'str' }]));
  // localeCompare is case-insensitive-ish for ordering: alpha, Bravo, Charlie
  assert.deepStrictEqual(rows.map((r) => r.name), ['alpha', 'Bravo', 'Charlie']);
});

test('sortBy: missing/NaN num keys sort LAST in both directions', () => {
  const asc = [{ p: 5 }, {}, { p: 2 }];
  asc.sort(core.sortBy([{ key: 'p', dir: 'asc', type: 'num' }]));
  assert.deepStrictEqual(asc.map((r) => r.p), [2, 5, undefined]);

  const desc = [{ p: 5 }, {}, { p: 2 }];
  desc.sort(core.sortBy([{ key: 'p', dir: 'desc', type: 'num' }]));
  assert.deepStrictEqual(desc.map((r) => r.p), [5, 2, undefined]);
});

test('sortBy: equal rows preserve input order (stable sort)', () => {
  const rows = [
    { p: 1, tag: 'a' },
    { p: 1, tag: 'b' },
    { p: 1, tag: 'c' }
  ];
  rows.sort(core.sortBy([{ key: 'p', dir: 'asc', type: 'num' }]));
  assert.deepStrictEqual(rows.map((r) => r.tag), ['a', 'b', 'c']);
});

test('sortBy([]) comparator returns 0 (no reordering)', () => {
  const cmp = core.sortBy([]);
  assert.strictEqual(cmp({ a: 1 }, { a: 2 }), 0);
  const rows = [{ x: 3 }, { x: 1 }, { x: 2 }];
  rows.sort(cmp);
  assert.deepStrictEqual(rows.map((r) => r.x), [3, 1, 2]);
});
