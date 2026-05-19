'use strict';

// Pagination respects settings.maxPages (0 = unlimited, N = exactly N pages).
// We mock $.ajax to count fetches and return fake FA pages with Farm_page=N+1
// in the href so the parser walks on.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const FARM_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'tw-farm.js'), 'utf8');
const JQUERY   = fs.readFileSync(path.join(__dirname, '..', '..', 'node_modules', 'jquery', 'dist', 'jquery.js'), 'utf8');

function fakeFAPage(currentPage, lastPage) {
  // Minimal FA HTML — one #plunder_list row + a pagination link to the next page.
  var nextLink = currentPage < lastPage
    ? '<a href="/game.php?screen=am_farm&Farm_page=' + (currentPage + 1) + '">→</a>'
    : '';
  return '<table id="plunder_list" class="vis">' +
    '<tr id="farm_row_' + (1000 + currentPage) + '">' +
      '<td><a href="?screen=info_village&id=' + (1000 + currentPage) + '">(500|' + (500 + currentPage) + ')</a></td>' +
      '<td>0</td><td>0</td><td>0</td>' +
    '</tr></table>' + nextLink;
}

function instrument() {
  return FARM_SRC.replace(
    /\/\/ ============================================================\n  \/\/ TOOLBAR BUTTON/,
    '  window.__twfTest = {\n' +
    '    fetchFarmTargets: fetchFarmTargets,\n' +
    '    parseFarmTargets: parseFarmTargets,\n' +
    '    loadSettings: loadSettings,\n' +
    '    setSettings: function(s) { Object.assign(settings, s); }\n' +
    '  };\n' +
    '  // ============================================================\n' +
    '  // TOOLBAR BUTTON'
  );
}

async function runScenario(label, totalPages, maxPagesSetting, expectedCalls) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="contentContainer">' + fakeFAPage(0, totalPages - 1) + '</div></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://sk103.divoke-kmene.sk/game.php?screen=am_farm' }
  );
  const { window } = dom;
  window.game_data = { player: { id: 1 }, village: { id: 5649, x: 500, y: 500 }, world: '103', market: 'sk', csrf: 'x', units: ['light'], screen: 'am_farm' };
  window.UI = { SuccessMessage() {}, ErrorMessage() {} };
  window.Dialog = { show() {}, close() {} };
  window.eval(JQUERY);
  // jQuery 3.5+ removed $.trim; TW ships an older jQuery. Polyfill for tests.
  if (!window.$.trim) window.$.trim = function(s) { return s == null ? '' : String(s).replace(/^\s+|\s+$/g, ''); };
  window.TWTools = {
    Storage: { get: () => null, set: () => {} },
    DataFetcher: { fetchWorldConfig: cb => cb && cb({}), _worldConfig: { speed: 1, unitSpeed: 1 } },
    UI: { toast: () => {} },
    TimeSync: { init: () => {}, now: () => 0 },
    getPlayerId: () => 1, getVillageId: () => 5649, getCsrf: () => 'x',
    parseCoords: c => { var m = c.match(/(\d+)\|(\d+)/); return m ? { x: +m[1], y: +m[2] } : null; },
    distance: (a, b) => 1,
    pad2: n => (n < 10 ? '0' + n : '' + n),
    DATE_WORDS: { today: ['dnes'] }
  };

  // Stub $.ajax to serve fake FA pages and count calls.
  const calls = [];
  window.$.ajax = function(cfg) {
    var m = (cfg.url || '').match(/Farm_page=(\d+)/);
    var page = m ? parseInt(m[1], 10) : 0;
    calls.push(page);
    setTimeout(() => cfg.success(fakeFAPage(page, totalPages - 1)), 1);
  };

  window.eval(instrument());
  const t = window.__twfTest;
  t.loadSettings();
  t.setSettings({ maxPages: maxPagesSetting });

  // Drive fetchFarmTargets; wait for completion.
  await new Promise(resolve => {
    t.fetchFarmTargets(function() { resolve(); }, function() {});
  });

  if (calls.length === expectedCalls) {
    console.log(`PASS  ${label} (calls=${calls.length})`);
    return true;
  } else {
    console.log(`FAIL  ${label} — expected ${expectedCalls} ajax calls, got ${calls.length} (pages: ${calls.join(',')})`);
    return false;
  }
}

(async () => {
  let pass = 0, fail = 0;
  function tally(ok) { if (ok) pass++; else fail++; }

  // 5 total pages, cap = 0 (unlimited) → fetches pages 1..4 (4 ajax calls; page 0 = DOM, no ajax)
  tally(await runScenario('unlimited cap walks all pages', 5, 0, 4));
  // 5 total pages, cap = 3 → 2 ajax calls (page 0 = DOM, pages 1, 2 = ajax; stop)
  tally(await runScenario('cap=3 stops after 3 pages total',  5, 3, 2));
  // 5 total pages, cap = 1 → 0 ajax calls (only DOM)
  tally(await runScenario('cap=1 stops at the DOM page',      5, 1, 0));
  // 10 total pages, cap = 10 → 9 ajax calls
  tally(await runScenario('cap=10 fetches 10 pages',          10, 10, 9));
  // 2 total pages, cap = 0 → 1 ajax call
  tally(await runScenario('2-page server with unlimited cap', 2, 0, 1));

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
})();
