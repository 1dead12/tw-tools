'use strict';

/**
 * Fixture loader for node:test unit specs.
 * Fixtures are raw response bodies (View-Source HTML) of the TW overview pages
 * plus small slices of the world map .txt files, used to test the pure parsers
 * in lib/tw-overview-core.js and lib/tw-core.js headlessly.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Read a fixture file as UTF-8 text.
 * @param {string} name - File name inside tests/unit/fixtures/.
 * @returns {string} File contents.
 */
function readFixture(name) {
  return fs.readFileSync(path.join(__dirname, name), 'utf8');
}

/**
 * Read a REAL game-DOM fixture (genuine sk104 capture) from fixtures/real/.
 * These are ground truth for the parser-hardening specs.
 * @param {string} name - File name inside tests/unit/fixtures/real/.
 * @returns {string} File contents.
 */
function readReal(name) {
  return fs.readFileSync(path.join(__dirname, 'real', name), 'utf8');
}

/**
 * The fixtures the parser specs expect to exist.
 * Capture real ones from a logged-in Premium world (View-Source, NOT the DevTools DOM).
 * @type {string[]}
 */
const EXPECTED_FIXTURES = [
  'overview-units-complete.html',
  'overview-prod.html',
  'overview-buildings.html',
  'overview-incomings.html',
  'village.sample.txt',
  'player.sample.txt',
  'ally.sample.txt'
];

/**
 * The REAL fixtures (genuine sk104 capture, Premium active) used by the
 * parser-hardening specs. Ground truth for column mapping / value parsing.
 * @type {string[]}
 */
const REAL_FIXTURES = [
  'overview-units-complete.html',
  'overview-prod.html',
  'overview-nonpremium.html',
  'overview-buildings.html',
  'overview-incomings-content.html',
  'get_config.xml',
  'get_unit_info.xml',
  'get_building_info.xml',
  'village.sample.txt',
  'player.sample.txt',
  'ally.sample.txt'
];

module.exports = { readFixture, readReal, EXPECTED_FIXTURES, REAL_FIXTURES };
