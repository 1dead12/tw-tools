'use strict';

/**
 * Window/jQuery shim harness for lib/tw-core.js.
 *
 * lib/tw-core.js is a browser-attach-only IIFE: `(function(window, $){ ... })(window, jQuery)`.
 * It has NO module.exports tail (by design — it is not part of the dual-export pure layer).
 * To exercise its pure parsers under node:test we fs-read the source and run it bound to a
 * shimmed `window` + a minimal chainable jQuery stub, then return the populated
 * window.TWTools surface.
 *
 * This keeps the BUNDLED source as the TESTED source (no hand-mirror), matching the
 * node-compat philosophy without adding module.exports to tw-core.js.
 */

const fs = require('node:fs');
const path = require('node:path');

const CORE_PATH = path.join(__dirname, '..', '..', 'lib', 'tw-core.js');

/**
 * Build a minimal chainable jQuery stub. tw-core.js only touches $ inside AJAX /
 * DOM code paths that the pure-parser tests never call, so a no-op chainable is enough.
 * @returns {Function} jQuery-like function.
 */
function makeJQueryStub() {
  function chain() { return jq; }
  const jq = function () { return jq; };
  // Chainable no-ops used by tw-core's DOM/AJAX helpers (never hit by parser tests).
  const methods = [
    'find', 'each', 'attr', 'text', 'html', 'val', 'children', 'next',
    'filter', 'trim', 'data', 'append', 'eq', 'first', 'is', 'addClass',
    'removeClass', 'on', 'off', 'css', 'remove'
  ];
  methods.forEach(function (m) { jq[m] = chain; });
  jq.trim = function (s) { return String(s == null ? '' : s).trim(); };
  jq.ajax = function () { /* no-op: parser tests never fetch */ };
  return jq;
}

/**
 * Load lib/tw-core.js into a fresh shimmed global window and return window.TWTools.
 * @returns {Object} The populated TWTools surface.
 */
function loadTWCore() {
  const src = fs.readFileSync(CORE_PATH, 'utf8');
  const windowShim = {};
  windowShim.window = windowShim; // self-reference, like a real browser window
  const jQueryStub = makeJQueryStub();

  // The source ends with `})(window, jQuery);` referencing bare `window`/`jQuery`.
  // Wrap it in a function that provides those identifiers as locals.
  const runner = new Function('window', 'jQuery', 'document', src);
  runner(windowShim, jQueryStub, undefined);

  return windowShim.TWTools;
}

module.exports = { loadTWCore };
