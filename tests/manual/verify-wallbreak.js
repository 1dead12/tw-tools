'use strict';

// Wall-break routing: the planner picks Template A for low-wall targets and
// Template B for walled targets, respecting per-template cooldown / distance.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const FARM_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'tw-farm.js'), 'utf8');
const JQUERY   = fs.readFileSync(path.join(__dirname, '..', '..', 'node_modules', 'jquery', 'dist', 'jquery.js'), 'utf8');

function instrument() {
  return FARM_SRC.replace(
    /\/\/ ============================================================\n  \/\/ TOOLBAR BUTTON/,
    '  window.__twfTest = {\n' +
    '    buildPlan: buildPlan,\n' +
    '    loadSettings: loadSettings,\n' +
    '    getTemplate: getTemplate,\n' +
    '    setSourceVillages: function(v) { sourceVillages = v; },\n' +
    '    setFarmTargets:    function(v) { farmTargets = v; },\n' +
    '    setOutgoing:       function(v) { outgoingAttacks = v; },\n' +
    '    setTemplates:      function(a, b, aUnits, bUnits) { realTemplateA = a; realTemplateB = b; templateAUnits = aUnits; templateBUnits = bUnits; },\n' +
    '    getFarmPlan:       function() { return farmPlan; }\n' +
    '  };\n' +
    '  // ============================================================\n' +
    '  // TOOLBAR BUTTON'
  );
}

const dom = new JSDOM(
  '<!DOCTYPE html><html><body></body></html>',
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://sk103.divoke-kmene.sk/' }
);
const { window } = dom;
window.game_data = { player: { id: 1 }, village: { id: 1, x: 500, y: 500 }, world: '103', market: 'sk', csrf: 'x', units: ['light','axe','ram','catapult'], screen: 'am_farm' };
window.UI = { SuccessMessage() {}, ErrorMessage() {} };
window.Dialog = { show() {}, close() {} };
window.eval(JQUERY);
if (!window.$.trim) window.$.trim = function(s) { return s == null ? '' : String(s).replace(/^\s+|\s+$/g, ''); };
window.TWTools = {
  Storage: { get: () => null, set: () => {} },
  DataFetcher: { _worldConfig: { speed: 1, unitSpeed: 1 } },
  UI: { toast: () => {} },
  TimeSync: { init: () => {}, now: () => 0 },
  getPlayerId: () => 1, getVillageId: () => 1, getCsrf: () => 'x',
  parseCoords: c => { var m = c.match(/(\d+)\|(\d+)/); return m ? { x: +m[1], y: +m[2] } : null; },
  distance: (a, b) => Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2),
  travelTime: (d, s) => d * s * 60000,
  pad2: n => (n < 10 ? '0' + n : '' + n),
  DATE_WORDS: { today: ['dnes'] }
};
window.eval(instrument());

const t = window.__twfTest;
t.loadSettings();

// Two source villages with plenty of units.
t.setSourceVillages([
  { id: 11, name: 'src-1', coords: '500|500', coordsParsed: { x: 500, y: 500 },
    units: { light: 1000, axe: 1000, ram: 50, catapult: 50 }, lcAvailable: 1000 },
  { id: 12, name: 'src-2', coords: '500|501', coordsParsed: { x: 500, y: 501 },
    units: { light: 1000, axe: 1000, ram: 50, catapult: 50 }, lcAvailable: 1000 }
]);

// Targets spanning wall 0..5.
t.setFarmTargets([
  { id: 101, coords: '501|500', coordsParsed: { x: 501, y: 500 }, playerName: '', lootStatus: 'yellow', maxLoot: false, wallLevel: 0, lastReportMs: 0, hasActiveAttack: false },
  { id: 102, coords: '502|500', coordsParsed: { x: 502, y: 500 }, playerName: '', lootStatus: 'yellow', maxLoot: false, wallLevel: 1, lastReportMs: 0, hasActiveAttack: false },
  { id: 103, coords: '503|500', coordsParsed: { x: 503, y: 500 }, playerName: '', lootStatus: 'yellow', maxLoot: false, wallLevel: 2, lastReportMs: 0, hasActiveAttack: false },
  { id: 104, coords: '504|500', coordsParsed: { x: 504, y: 500 }, playerName: '', lootStatus: 'yellow', maxLoot: false, wallLevel: 3, lastReportMs: 0, hasActiveAttack: false },
  { id: 105, coords: '505|500', coordsParsed: { x: 505, y: 500 }, playerName: '', lootStatus: 'yellow', maxLoot: false, wallLevel: 5, lastReportMs: 0, hasActiveAttack: false }
]);
t.setOutgoing([]);
t.setTemplates(1, 2, { light: 1 }, { axe: 10, ram: 1, catapult: 1 });

t.buildPlan(function() {});
const plan = t.getFarmPlan();
const byCoord = {};
plan.forEach(p => { if (!byCoord[p.targetCoords]) byCoord[p.targetCoords] = []; byCoord[p.targetCoords].push(p.templateLabel); });

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`PASS  ${label}`); pass++; }
  else      { console.log(`FAIL  ${label}` + (detail ? `\n      ${detail}` : '')); fail++; }
}

// Default routing: A wins (wallMin=0, wallMax=2) for walls 0..2; B wins (wallMin=1, wallMax=99) for walls 3+.
// A is tried first, so anything A accepts goes to A — that's the intended cascade.
check('wall 0 → A (in A band)',          (byCoord['501|500'] || []).every(x => x === 'A'), 'got: ' + JSON.stringify(byCoord['501|500']));
check('wall 1 → A (still in A band)',    (byCoord['502|500'] || []).every(x => x === 'A'), 'got: ' + JSON.stringify(byCoord['502|500']));
check('wall 2 → A (top of A band)',      (byCoord['503|500'] || []).every(x => x === 'A'), 'got: ' + JSON.stringify(byCoord['503|500']));
check('wall 3 → B (above A.wallMax)',    (byCoord['504|500'] || []).every(x => x === 'B'), 'got: ' + JSON.stringify(byCoord['504|500']));
check('wall 5 → B',                       (byCoord['505|500'] || []).every(x => x === 'B'), 'got: ' + JSON.stringify(byCoord['505|500']));
check('plan is non-empty',                plan.length > 0, 'plan=' + plan.length);
check('every plan entry has wallLevel',   plan.every(p => typeof p.wallLevel === 'number'));
// Cross-source cooldown: with cooldown active, second source's attack on the same target lands within the
// cooldown window of the first source's, so the planner correctly drops it. Verify that behaviour.
check('cross-source cooldown blocks double-hits', new Set(plan.map(p => p.targetCoords)).size === plan.length,
  'expected 1 attack per target this session; got duplicates: ' + plan.map(p => p.targetCoords).join(','));

// Sub-scenario: B rejects when wall > B.wallMax. Tighten B and rebuild.
const B = t.getTemplate('B');
B.wallMax = 4; // now B refuses wall 5
t.buildPlan(function() {});
const plan2 = t.getFarmPlan();
const wall5 = plan2.filter(p => p.targetCoords === '505|500');
check('wall 5 → rejected when B.wallMax=4', wall5.length === 0,
  'expected 0 attacks on wall-5 target, got ' + wall5.length);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
