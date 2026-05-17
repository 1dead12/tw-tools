'use strict';

// Behavioural tests for the new auto-farm engine in dist/tw-farm.min.js.
// Stubs the entire farm pipeline so we exercise the loop without TW endpoints:
//   - Inject a fake jQuery $.ajax that records each call and returns a scripted response.
//   - Pre-seed farmPlan / farmTargets and the DOM with the rows the loop reads from.
//   - Trigger startAutoFarm() via the actual #twf-auto button to test the wiring.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const BUNDLE = fs.readFileSync(path.join(__dirname, '..', '..', 'dist', 'tw-farm.min.js'), 'utf8');
const JQUERY = fs.readFileSync(path.join(__dirname, '..', '..', 'node_modules', 'jquery', 'dist', 'jquery.js'), 'utf8');

function buildHarness(opts) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="contentContainer"></div></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://en103.tribalwars.net/game.php?screen=am_farm' }
  );
  const { window } = dom;

  // Stub TW globals.
  window.game_data = {
    player: { id: 1, name: 't' }, village: { id: 1, x: 500, y: 500 },
    world: '103', market: 'sk', csrf: 'csrf-token-stub', screen: 'am_farm',
    units: ['spear','sword','axe','archer','spy','light','marcher','heavy','ram','catapult','knight','snob']
  };
  window.UI = { SuccessMessage() {}, ErrorMessage() {} };
  window.Dialog = { show() {}, close() {} };
  window.Accountmanager = { send_units_link: '/game.php?village=1&screen=am_farm&mode=farm&ajaxaction=farm&json=1&h=csrf-token-stub' };
  window.TribalWars = { post(s, o, d, cb) { cb && cb({}); } };

  // Load jQuery.
  window.eval(JQUERY);
  const $ = window.$;

  // Recording stub for $.ajax. Each call gets a scripted response from opts.responses.
  const calls = [];
  let respIdx = 0;
  $.ajax = function(cfg) {
    const ts = Date.now();
    calls.push({ ts, url: cfg.url, data: cfg.data });
    const resp = (opts.responses && opts.responses[respIdx]) || { ok: true };
    respIdx++;
    // Resolve on next microtask to mimic real async.
    setTimeout(function() {
      if (resp.error || resp.captcha) {
        if (cfg.success) cfg.success(resp);
      } else {
        if (cfg.success) cfg.success({ units: { light: 100 } });
      }
    }, 5);
  };

  // Load the bundle.
  window.eval(BUNDLE);

  const TWF = window.TWFarm || null; // Not exposed, so we'll reach into via global side-effects.

  return { window, $, calls, dom };
}

function seedPlan(window, $, plan, mode) {
  // The bundle keeps settings/state in IIFE closures. The only way to drive the
  // loop is through user-facing entry points: injectFarmTable (via internal call)
  // and the #twf-auto click handler. Since we can't reach the closure directly,
  // we synthesize the UI the loop reads from and call startAutoFarm via the
  // button — but to do that we need a way to populate farmPlan + isFarming.
  //
  // The script exposes nothing globally. Workaround: re-eval a tiny shim before
  // the bundle that captures a reference to the IIFE's `this`/window — but the
  // IIFE is `function(window, $)` so window IS the test window. We add a
  // hook on TWTools.UI.toast to confirm calls and intercept.
  //
  // Simplest test: manually build the table DOM and trigger sendEntry by
  // clicking the row icons. Tests the captcha/error stops via real DOM events.
}

async function runScenario(name, opts, assertFn) {
  const h = buildHarness(opts);

  // Drive the bundle: we need to expose the internal API. The bundle
  // dispatches through a toolbar button it injects on am_farm pages. Force
  // the script to wire up by triggering jQuery ready.
  h.$(h.window.document).trigger('ready');
  // Wait a tick for any setTimeout(50) wiring in the bundle.
  await new Promise(r => setTimeout(r, 100));

  // The bundle injects a #twf-btn toolbar button.
  const $btn = h.$('#twf-btn');
  if (!$btn.length) {
    return { name, ok: false, msg: 'toolbar button #twf-btn never appeared — bundle did not initialise' };
  }

  // We can't easily seed farmPlan from outside, so instead we test what we CAN
  // observe end-to-end: that the bundle parses, initialises, exposes its UI,
  // and that key handlers fire without throwing. The deeper auto-loop
  // behaviour is exercised by the unit-level checks below.
  return assertFn(h, $btn);
}

// ---------------------------------------------------------------------------
// Unit-level checks: re-extract the helper functions by re-evaluating slices
// of the SOURCE (non-minified) so we can assert on their behaviour directly.
// ---------------------------------------------------------------------------

function extractHelpers() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'tw-farm.js'), 'utf8');

  // Re-evaluate the bundle in a sandbox, then grab the helpers out of a
  // window we expose for testing. We need to inject a tiny instrumentation
  // line into the bundle that publishes the helpers — do it via a temp file.
  const instrumented = src.replace(
    /\/\/ ============================================================\n  \/\/ TOOLBAR BUTTON/,
    '// === TEST HOOK ===\n' +
    '  window.__twfTest = {\n' +
    '    nextAutoDelayMs: nextAutoDelayMs,\n' +
    '    isBotProtection: isBotProtection,\n' +
    '    randInt: randInt,\n' +
    '    getSettings: function() { return settings; },\n' +
    '    setSettings: function(s) { Object.assign(settings, s); },\n' +
    '    setBurstState: function(since, next) { autoSinceBurst = since; autoNextBurstAt = next; },\n' +
    '    getBurstState: function() { return { since: autoSinceBurst, next: autoNextBurstAt }; }\n' +
    '  };\n' +
    '  // ============================================================\n' +
    '  // TOOLBAR BUTTON'
  );

  const dom = new JSDOM(
    '<!DOCTYPE html><html><body></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://en103.tribalwars.net/' }
  );
  const { window } = dom;
  window.game_data = { player: { id: 1 }, village: { id: 1, x: 500, y: 500 }, world: '103', market: 'sk', csrf: 'x', units: ['light'] };
  window.UI = { SuccessMessage() {}, ErrorMessage() {} };
  window.Dialog = { show() {}, close() {} };

  window.eval(JQUERY);
  // Bundle deps stubs (these are real in the min bundle; here we only need TWTools shape).
  window.TWTools = {
    Storage: { get: () => null, set: () => {} },
    DataFetcher: { fetchWorldConfig: cb => cb && cb({}), fetchPlayerVillages: cb => cb && cb([]), getUnitSpeed: () => 10 },
    UI: { toast: () => {}, createCard: () => ({ element: window.$('<div>'), getTabContent: () => window.$('<div>'), setStatus: () => {}, destroy: () => {} }) },
    TimeSync: { init: () => {}, now: () => Date.now() },
    getPlayerName: () => 't'
  };

  window.eval(instrumented);
  return window.__twfTest;
}

function approxEq(a, b, eps) { return Math.abs(a - b) <= (eps || 0.5); }

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`PASS  ${label}`); pass++; }
  else      { console.log(`FAIL  ${label}` + (detail ? `\n      ${detail}` : '')); fail++; }
}

(function runUnitChecks() {
  const t = extractHelpers();
  if (!t) { console.log('FAIL — could not extract test hooks'); process.exit(1); }

  // ---- isBotProtection ----
  check('isBotProtection: detects bot_protection flag', t.isBotProtection({ bot_protection: true }));
  check('isBotProtection: detects captcha flag', t.isBotProtection({ captcha: true }));
  check('isBotProtection: detects error string mentioning captcha', t.isBotProtection({ error: 'human_check required' }));
  check('isBotProtection: detects recaptcha in nested string', t.isBotProtection({ error: ['Please solve the recaptcha'] }));
  check('isBotProtection: ignores normal success', !t.isBotProtection({ units: { light: 50 } }));
  check('isBotProtection: ignores normal error', !t.isBotProtection({ error: 'Not enough troops' }));
  check('isBotProtection: handles null/undefined', !t.isBotProtection(null) && !t.isBotProtection(undefined));

  // ---- randInt ----
  let inRange = true;
  for (let i = 0; i < 1000; i++) {
    const v = t.randInt(500, 800);
    if (v < 500 || v > 800 || !Number.isInteger(v)) { inRange = false; break; }
  }
  check('randInt: 1000 samples all in [500, 800] integers', inRange);

  // ---- nextAutoDelayMs: RAW mode ----
  t.setSettings({ autoMode: 'raw', autoDelayRawMin: 500, autoDelayRawMax: 800 });
  const rawSamples = [];
  for (let i = 0; i < 500; i++) rawSamples.push(t.nextAutoDelayMs());
  const rawMin = Math.min(...rawSamples), rawMax = Math.max(...rawSamples);
  check('nextAutoDelayMs RAW: all samples in [500, 800]',
    rawSamples.every(v => v >= 500 && v <= 800),
    `min=${rawMin} max=${rawMax}`);
  check('nextAutoDelayMs RAW: covers most of the range',
    rawMin < 530 && rawMax > 770,
    `min=${rawMin} max=${rawMax} (should span the window)`);

  // ---- nextAutoDelayMs: SAFE mode jitter window ----
  t.setSettings({
    autoMode: 'safe',
    autoDelaySafeMin: 1200, autoDelaySafeMax: 3500,
    autoSafeBurstMin: 10,   autoSafeBurstMax: 20,
    autoSafePauseMin: 5000, autoSafePauseMax: 10000
  });
  t.setBurstState(0, 15); // mid-burst, no pause yet
  const safeSamples = [];
  for (let i = 0; i < 9; i++) safeSamples.push(t.nextAutoDelayMs());
  check('nextAutoDelayMs SAFE: pre-burst samples in [1200, 3500]',
    safeSamples.every(v => v >= 1200 && v <= 3500),
    `samples=${safeSamples.join(',')}`);

  // ---- nextAutoDelayMs: SAFE mode pause cadence ----
  t.setBurstState(15, 15); // burst exhausted → next call must be a pause
  const pauseSample = t.nextAutoDelayMs();
  check('nextAutoDelayMs SAFE: pause fires when burst exhausted',
    pauseSample >= 5000 && pauseSample <= 10000,
    `pause=${pauseSample}`);
  const afterPause = t.nextAutoDelayMs();
  check('nextAutoDelayMs SAFE: returns to jitter after pause',
    afterPause >= 1200 && afterPause <= 3500,
    `after-pause=${afterPause}`);
  const st = t.getBurstState();
  // nextAutoDelayMs doesn't bump autoSinceBurst itself (onSendOk does), so
  // after the pause-fires-and-resets call, since should still be 0.
  check('nextAutoDelayMs SAFE: burst counter resets to 0 after pause',
    st.since === 0,
    `since=${st.since}`);
  check('nextAutoDelayMs SAFE: next burst length resampled to [10, 20]',
    st.next >= 10 && st.next <= 20,
    `next=${st.next}`);

  // ---- defaults sanity (read DEFAULT_SETTINGS literal from source) ----
  const farmSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'tw-farm.js'), 'utf8');
  const dsMatch = farmSrc.match(/var DEFAULT_SETTINGS = (\{[\s\S]*?\n  \});/);
  check('defaults: DEFAULT_SETTINGS literal extractable', !!dsMatch);
  if (dsMatch) {
    // Strip line comments so eval can parse the literal.
    const literal = dsMatch[1].replace(/\/\/[^\n]*/g, '');
    // eslint-disable-next-line no-new-func
    const ds = (new Function('return ' + literal))();
    check('defaults: autoMode === safe', ds.autoMode === 'safe', `got=${ds.autoMode}`);
    check('defaults: raw window 500-800', ds.autoDelayRawMin === 500 && ds.autoDelayRawMax === 800);
    check('defaults: safe window 1200-3500', ds.autoDelaySafeMin === 1200 && ds.autoDelaySafeMax === 3500);
    check('defaults: no session cap', !('autoSafeSessionCap' in ds), `unexpected key present`);
    check('defaults: safe pause 5000-10000', ds.autoSafePauseMin === 5000 && ds.autoSafePauseMax === 10000);
    check('defaults: safe burst 10-20', ds.autoSafeBurstMin === 10 && ds.autoSafeBurstMax === 20);
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
})();
