'use strict';

/**
 * Loader for the pure OverviewCore lib under node:test.
 *
 * lib/tw-overview-core.js follows the node-compat envelope: its module.exports tail
 * makes it require()-able directly with no DOM. This thin re-export keeps the spec
 * files terse and gives a single place to adjust the path if the layout moves.
 */

module.exports = require('../../../lib/tw-overview-core.js');
