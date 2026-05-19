'use strict';

// Run every manual verification suite. Bail on first failure.

const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  'verify-modal-fix.js',
  'verify-autofarm.js',
  'verify-filters.js',
  'verify-pagination.js',
  'verify-wallbreak.js'
];

let totalPass = 0, totalFail = 0;
for (const suite of SUITES) {
  console.log(`\n===== ${suite} =====`);
  const res = spawnSync(process.execPath, [path.join(__dirname, suite)], { stdio: 'inherit' });
  // Each suite ends with "N pass, M fail" — we trust their exit code here.
  if (res.status === 0) totalPass++;
  else { totalFail++; }
}

console.log(`\n----- Aggregate: ${totalPass} suites pass, ${totalFail} suites fail -----`);
process.exit(totalFail === 0 ? 0 : 1);
