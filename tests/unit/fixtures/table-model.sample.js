'use strict';

/**
 * Pure (no HTML / no jQuery) model + column fixture for the tw-table pure-helper
 * specs. MODEL is ~6 per-village master rows with a mix of flag states; COLUMNS is
 * a small descriptor set exercising coord / string / numeric+thresholds / flag.
 *
 * Column descriptors mirror the COLUMN_REGISTRY shape consumed by the table engine:
 *   { key, label, get(row), format(value,row)?, sortType, thresholds[], coord meta }
 */

var MODEL = [
  {
    id: 1, name: 'Alpha', x: 500, y: 500, coord: '500|500',
    points: 9000, rank: 12, whFillPct: 95, prodTotal: 4200, defPower: 1200,
    incomings: 3, nukesEst: 2,
    underDefended: true, whNearFull: true, incomingNuke: true
  },
  {
    id: 2, name: 'Bravo', x: 480, y: 512, coord: '480|512',
    points: 6500, rank: 30, whFillPct: 40, prodTotal: 3100, defPower: 8000,
    incomings: 0, nukesEst: 0,
    underDefended: false, whNearFull: false, incomingNuke: false
  },
  {
    id: 3, name: 'Charlie', x: 333, y: 666, coord: '333|666',
    points: 5000, rank: 45, whFillPct: 92, prodTotal: 2700, defPower: 500,
    incomings: 1, nukesEst: 0,
    underDefended: false, whNearFull: true, incomingNuke: false
  },
  {
    id: 4, name: 'Delta "Quote"', x: 612, y: 489, coord: '612|489',
    points: 12000, rank: 4, whFillPct: 10, prodTotal: 5400, defPower: 14000,
    incomings: 5, nukesEst: 0,
    underDefended: true, whNearFull: false, incomingNuke: false
  },
  {
    id: 5, name: 'Echo, City', x: 501, y: 503, coord: '501|503',
    points: 3000, rank: 88, whFillPct: 60, prodTotal: 1800, defPower: 2200,
    incomings: 0, nukesEst: 0,
    underDefended: false, whNearFull: false, incomingNuke: false
  },
  {
    id: 6, name: 'Foxtrot', x: 700, y: 700, coord: '700|700',
    points: 5000, rank: 45, whFillPct: 88, prodTotal: 2700, defPower: 9000,
    incomings: 2, nukesEst: 3,
    underDefended: false, whNearFull: false, incomingNuke: true
  }
];

var COLUMNS = [
  {
    key: 'coord', label: 'Coords', domain: 'identity',
    isCoordCol: true,
    get: function (row) { return row ? row.coord : ''; },
    coordGet: function (row) { return row ? { x: row.x, y: row.y } : null; },
    bbHeader: 'Coords', csvHeader: 'Coords',
    sortType: 'str', defaultVisible: true
  },
  {
    key: 'name', label: 'Village', domain: 'identity',
    get: function (row) { return row ? row.name : ''; },
    bbHeader: 'Village', csvHeader: 'Village',
    sortType: 'str', filterable: true, defaultVisible: true
  },
  {
    key: 'points', label: 'Points', domain: 'identity',
    get: function (row) { return row ? row.points : 0; },
    format: function (v) { return String(v); },
    bbHeader: 'Points', csvHeader: 'Points',
    sortType: 'num', defaultVisible: true,
    thresholds: [{ label: '>5k', op: 'gte', value: 5000 }]
  },
  {
    key: 'whFillPct', label: 'WH %', domain: 'economy',
    get: function (row) { return row ? row.whFillPct : 0; },
    bbHeader: 'WH%', csvHeader: 'WH%',
    sortType: 'num', defaultVisible: true,
    thresholds: [{ label: '>=90', op: 'gte', value: 90 }]
  },
  {
    key: 'underDefended', label: 'Under-def', domain: 'incomings',
    get: function (row) { return row ? row.underDefended : false; },
    sortType: 'num', defaultVisible: false,
    thresholds: [{ label: 'under-def', op: 'flag', value: true }]
  }
];

module.exports = { MODEL: MODEL, COLUMNS: COLUMNS };
