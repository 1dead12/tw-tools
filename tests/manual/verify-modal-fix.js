'use strict';

// Sanity check: createCard must render visibly even when localStorage holds
// an offscreen saved position (the regression Denis reported).

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SCENARIOS = [
  {
    name: 'fresh user, no saved position',
    viewport: { w: 1920, h: 1080 },
    savedPos: null,
    expect: { visible: true }
  },
  {
    name: 'saved position from a wider monitor (was reproducing the bug)',
    viewport: { w: 1280, h: 800 },
    savedPos: { left: 2400, top: 1500, width: 720, height: 600 },
    expect: { visible: true }
  },
  {
    name: 'saved position at far left edge with huge width',
    viewport: { w: 1366, h: 768 },
    savedPos: { left: 0, top: 0, width: 5000, height: 5000 },
    expect: { visible: true }
  },
  {
    name: 'garbage saved position (NaN)',
    viewport: { w: 1920, h: 1080 },
    savedPos: { left: NaN, top: NaN, width: NaN, height: NaN },
    expect: { visible: true }
  },
  {
    name: 'valid saved position inside viewport — should be respected',
    viewport: { w: 1920, h: 1080 },
    savedPos: { left: 100, top: 100, width: 800, height: 600 },
    expect: { visible: true, left: 100, top: 100, width: 800, height: 600 }
  }
];

const bundle = fs.readFileSync(path.join(__dirname, '..', '..', 'dist', 'tw-planner.min.js'), 'utf8');

function isVisibleInViewport(rect, w, h) {
  // Need at least 50px of card on screen horizontally and 30px vertically
  // (matches the drag-bound thresholds used internally).
  const visibleW = Math.min(rect.left + rect.width, w) - Math.max(rect.left, 0);
  const visibleH = Math.min(rect.top + rect.height, h) - Math.max(rect.top, 0);
  return visibleW >= 50 && visibleH >= 30;
}

let pass = 0, fail = 0;

for (const sc of SCENARIOS) {
  try {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://en103.tribalwars.net/' }
  );
  const { window } = dom;

  // Stub viewport — JSDOM defaults to 1024x768.
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: sc.viewport.w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: sc.viewport.h });

  // Pre-seed localStorage with the supposedly-bad saved position.
  // The Storage helper uses key prefix 'twt_' and the card id is 'twp-main'.
  if (sc.savedPos) {
    window.localStorage.setItem(
      'twt_card_pos_twp-main',
      JSON.stringify({ value: sc.savedPos })
    );
  }

  // Load jQuery into the window.
  const jq = fs.readFileSync(path.join(__dirname, '..', '..', 'node_modules', 'jquery', 'dist', 'jquery.js'), 'utf8');
  window.eval(jq);

  // Mock minimal TW globals so the bundle's init() can run silently.
  window.game_data = {
    player: { id: 1, name: 'tester' },
    village: { id: 1, x: 500, y: 500 },
    world: '103',
    market: 'sk',
    units: ['spear','sword','axe','archer','spy','light','marcher','heavy','ram','catapult','knight','snob']
  };

  // Run the bundle.
  window.eval(bundle);

  // The bundle wires init via $(document).ready. Force-run it.
  // Don't wait for AJAX (jsdom has no real network); we just need createCard.
  // We can't easily trigger the full init path without TW endpoints, so instead
  // call TWTools.UI.createCard directly with the same options the planner uses.
  const card = window.TWTools.UI.createCard({
    id: 'twp-main',
    title: 'Attack Planner',
    version: '2.0.0',
    tabs: [
      { id: 'plan',     label: 'Plan' },
      { id: 'fakes',    label: 'Fakes' },
      { id: 'settings', label: 'Settings' }
    ],
    width: 720, height: 600, minWidth: 550, minHeight: 400
  });

  const el = card.element[0];
  const rect = {
    left: parseFloat(el.style.left),
    top: parseFloat(el.style.top),
    width: parseFloat(el.style.width),
    height: parseFloat(el.style.height)
  };

  const visible = isVisibleInViewport(rect, sc.viewport.w, sc.viewport.h);

  let ok = visible === sc.expect.visible;
  const detail = ['left', 'top', 'width', 'height']
    .filter(k => k in sc.expect)
    .map(k => {
      const match = rect[k] === sc.expect[k];
      if (!match) ok = false;
      return `${k}=${rect[k]}${match ? '' : ` (want ${sc.expect[k]})`}`;
    }).join(' ');

  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${sc.name}\n` +
    `      viewport=${sc.viewport.w}x${sc.viewport.h}  rect=${JSON.stringify(rect)}` +
    (detail ? `\n      expects ${detail}` : '')
  );

  ok ? pass++ : fail++;
  } catch (e) {
    console.log(`FAIL  ${sc.name}\n      threw: ${e && e.message}`);
    fail++;
  }
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
