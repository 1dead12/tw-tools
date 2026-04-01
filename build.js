#!/usr/bin/env node

/**
 * TW Tools Build System
 *
 * Concatenates shared libraries with individual scripts,
 * minifies with terser, and generates quickbar wrappers.
 *
 * Usage:
 *   node build.js                    # Build all scripts
 *   node build.js --only=tw-snipe    # Build single script
 *   node build.js --only=tw-clock    # Build single script
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

// ============================================================
// CONFIG
// ============================================================

const ROOT = __dirname;
const LIB_DIR = path.join(ROOT, 'lib');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');
const DIST_DIR = path.join(ROOT, 'dist');

/**
 * GitHub Pages base URL for quickbar script loading.
 * @type {string}
 */
const GITHUB_PAGES_BASE = 'https://1dead12.github.io/tw-tools/dist';

/**
 * Standard library files included in every build (in order).
 * tw-commands.js is optional and only included for scripts that need it.
 * Files that don't exist are silently skipped.
 * @type {string[]}
 */
const STANDARD_LIBS = ['tw-core.js', 'tw-ui.js'];

/**
 * Script-specific library overrides.
 * If a script is listed here, it gets these libs INSTEAD of STANDARD_LIBS.
 * @type {Object.<string, string[]>}
 */
const SCRIPT_LIBS = {
  'tw-snipe.js': ['tw-core.js', 'tw-ui.js', 'tw-commands.js']
};

/**
 * Scripts to exclude from the build (legacy monoliths, test files, etc.).
 * @type {string[]}
 */
const EXCLUDED_SCRIPTS = [
  'tw-precision-timer-v5.js',
  'tw-precision-timer-v5.min.js',
  'tw-precision-timer-v5.quickbar.js',
  'tw-precision-timer-v5-test.html'
];

// ============================================================
// HELPERS
// ============================================================

/**
 * Read a file and return its content, or null if it doesn't exist.
 * @param {string} filePath - Absolute file path.
 * @returns {string|null} File content or null.
 */
function readFileOrNull(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return null;
  }
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 * @param {string} dirPath - Directory path.
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Get the script name without extension.
 * @param {string} filename - Filename like "tw-clock.js".
 * @returns {string} Name like "tw-clock".
 */
function getScriptName(filename) {
  return filename.replace(/\.js$/, '');
}

/**
 * Parse command line arguments.
 * @returns {{ only: string|null }} Parsed args.
 */
function parseArgs() {
  const args = process.argv.slice(2);
  let only = null;

  for (const arg of args) {
    if (arg.startsWith('--only=')) {
      only = arg.split('=')[1];
      // Normalize: ensure .js extension for matching
      if (!only.endsWith('.js')) {
        only = only + '.js';
      }
    }
  }

  return { only };
}

/**
 * Format byte size for display.
 * @param {number} bytes - Size in bytes.
 * @returns {string} Formatted size string.
 */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// ============================================================
// BUILD PIPELINE
// ============================================================

/**
 * Get library files for a given script.
 * @param {string} scriptFilename - Script filename.
 * @returns {string[]} Array of library filenames to include.
 */
function getLibsForScript(scriptFilename) {
  if (SCRIPT_LIBS[scriptFilename]) {
    return SCRIPT_LIBS[scriptFilename];
  }
  return STANDARD_LIBS;
}

/**
 * Discover all buildable script files.
 * @param {string|null} onlyScript - If set, only build this script.
 * @returns {string[]} Array of script filenames.
 */
function discoverScripts(onlyScript) {
  const allFiles = fs.readdirSync(SCRIPTS_DIR).filter(f => {
    return f.endsWith('.js') && !EXCLUDED_SCRIPTS.includes(f);
  });

  if (onlyScript) {
    if (allFiles.includes(onlyScript)) {
      return [onlyScript];
    }
    console.error(`Error: Script "${onlyScript}" not found in ${SCRIPTS_DIR}`);
    console.error(`Available scripts: ${allFiles.join(', ')}`);
    process.exit(1);
  }

  return allFiles;
}

/**
 * Build a single script: concatenate libs + script, minify, generate quickbar.
 * @param {string} scriptFilename - Script filename (e.g. "tw-clock.js").
 * @returns {Promise<Object>} Build result with sizes and paths.
 */
async function buildScript(scriptFilename) {
  const scriptName = getScriptName(scriptFilename);
  const scriptPath = path.join(SCRIPTS_DIR, scriptFilename);

  // Read the script source
  const scriptSource = fs.readFileSync(scriptPath, 'utf8');

  // Determine which libs this script needs
  const libFiles = getLibsForScript(scriptFilename);

  // Read and concatenate library sources (skip missing files)
  const libSources = [];
  const includedLibs = [];

  for (const libFile of libFiles) {
    const libPath = path.join(LIB_DIR, libFile);
    const libSource = readFileOrNull(libPath);
    if (libSource) {
      libSources.push(libSource);
      includedLibs.push(libFile);
    }
  }

  // Concatenate: libs first, then script
  // Each part is already wrapped in its own IIFE, so we just join them
  const parts = [...libSources, scriptSource];
  const concatenated = parts.join('\n\n');

  // Wrap the entire concatenation in an outer IIFE for safety
  const wrapped = ';(function(){\n' + concatenated + '\n})();\n';

  // Output paths
  const minPath = path.join(DIST_DIR, scriptName + '.min.js');
  const quickbarPath = path.join(DIST_DIR, scriptName + '.quickbar.js');

  // Minify with terser
  const minified = await minify(wrapped, {
    compress: {
      drop_console: false,  // Keep console for debugging in game
      passes: 2
    },
    mangle: {
      reserved: [
        'jQuery', '$', 'TWTools', 'TribalWars', 'game_data',
        'ScavengeScreen', 'ScavengeMassScreen', 'Scavenge'
      ]
    },
    output: {
      comments: false
    }
  });

  if (minified.error) {
    throw new Error(`Minification failed for ${scriptFilename}: ${minified.error}`);
  }

  const minCode = minified.code;

  // Write minified file
  fs.writeFileSync(minPath, minCode, 'utf8');

  // Generate quickbar wrapper (cache-busting: append timestamp on each load)
  const quickbarUrl = GITHUB_PAGES_BASE + '/' + scriptName + '.min.js';
  const quickbarCode = "javascript:$.getScript('" + quickbarUrl + "?v='+Date.now());void 0;";
  fs.writeFileSync(quickbarPath, quickbarCode, 'utf8');

  return {
    script: scriptFilename,
    name: scriptName,
    libs: includedLibs,
    sourceSize: Buffer.byteLength(concatenated, 'utf8'),
    wrappedSize: Buffer.byteLength(wrapped, 'utf8'),
    minSize: Buffer.byteLength(minCode, 'utf8'),
    minPath: minPath,
    quickbarPath: quickbarPath,
    quickbarUrl: quickbarUrl
  };
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const startTime = Date.now();
  const args = parseArgs();

  console.log('');
  console.log('===========================================');
  console.log('  TW TOOLS BUILD SYSTEM');
  console.log('===========================================');
  console.log('');

  // Ensure dist directory exists
  ensureDir(DIST_DIR);

  // Discover scripts to build
  const scripts = discoverScripts(args.only);

  if (scripts.length === 0) {
    console.log('No scripts found to build.');
    return;
  }

  console.log(`Building ${scripts.length} script(s)...`);
  console.log('');

  const results = [];

  for (const script of scripts) {
    try {
      process.stdout.write(`  Building ${script}...`);
      const result = await buildScript(script);
      results.push(result);
      console.log(` done (${formatSize(result.minSize)})`);
    } catch (err) {
      console.log(` FAILED`);
      console.error(`    Error: ${err.message}`);
      results.push({ script, error: err.message });
    }
  }

  // Build summary
  console.log('');
  console.log('-------------------------------------------');
  console.log('  BUILD SUMMARY');
  console.log('-------------------------------------------');
  console.log('');

  let totalSource = 0;
  let totalMin = 0;
  let successCount = 0;
  let failCount = 0;

  for (const r of results) {
    if (r.error) {
      console.log(`  ✗ ${r.script}: ${r.error}`);
      failCount++;
    } else {
      const ratio = ((1 - r.minSize / r.wrappedSize) * 100).toFixed(1);
      console.log(`  ✓ ${r.name}`);
      console.log(`    Libs:     ${r.libs.length > 0 ? r.libs.join(' + ') : '(none)'}`);
      console.log(`    Source:   ${formatSize(r.sourceSize)}`);
      console.log(`    Minified: ${formatSize(r.minSize)} (${ratio}% reduction)`);
      console.log(`    Output:   ${path.relative(ROOT, r.minPath)}`);
      console.log(`    Quickbar: ${path.relative(ROOT, r.quickbarPath)}`);
      console.log('');
      totalSource += r.sourceSize;
      totalMin += r.minSize;
      successCount++;
    }
  }

  const elapsed = Date.now() - startTime;
  console.log('-------------------------------------------');
  console.log(`  ${successCount} succeeded, ${failCount} failed`);
  if (successCount > 1) {
    console.log(`  Total source: ${formatSize(totalSource)}`);
    console.log(`  Total min:    ${formatSize(totalMin)}`);
  }
  console.log(`  Time: ${elapsed}ms`);
  console.log('-------------------------------------------');
  console.log('');

  // Quickbar URLs for easy copy-paste
  if (successCount > 0) {
    console.log('Quickbar URLs:');
    for (const r of results) {
      if (!r.error) {
        console.log(`  ${r.name}: javascript:$.getScript('${r.quickbarUrl}');void 0;`);
      }
    }
    console.log('');
  }

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
