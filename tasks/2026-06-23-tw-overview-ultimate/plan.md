# tw-overview Ultimate — Approach C Unified TDD Implementation Plan

**Date:** 2026-06-24  
**Status:** AWAITING APPROVAL (hard gate)  
**Design:** [design.md](./design.md)  
**Repo:** `/Users/denispaulik/git/tw-tools`  
**Plan workflow:** `wf_51319982-6fb` (15 agents, adversarially verified)

## Goal

Rewrite scripts/tw-overview.js from a 1681-line monolith into a thin orchestrator over Approach-C extracted pure libs: ONE unified per-village master model JOINed by village id, ONE declarative COLUMN registry driving headers/filters/sorts/visibility/export, a generic table engine, versioned config with saved-view presets, a sequential single-lock read-only Fetch-All orchestrator across all four game-data domains (Economy, Buildings, Incomings, Map/rank) surfaced through an 8-tab Dashboard+domains UI — shipped as ONE self-contained dist/tw-overview.min.js with node:test coverage on the pure libs and three tech-debt fixes, built ON the uncommitted WIP without reverting it.

## Architecture

Architecture C on a B substrate. Pure logic lives in two NEW libs plus extensions to three existing libs, all browser IIFEs concatenated by build.js in ONE outer IIFE and terser-minified to ONE dist bundle loaded via $.getScript; jQuery-only runtime, no runtime module loader. lib/tw-core.js (extend): pure string->data parsers (parseVillagesTxt keeping rank, parsePlayersTxt, parseTribesTxt, parseBuildingInfoXml), buildIndexBy, promoted getContinent (Y-then-X, byte-identical to tw-map-tools), buildVillageIndex, fetchPlayers/fetchTribes (1h TTL) + fetchBuildingInfo (24h static caps); fetchAllVillages additively keeps bonusId (village.txt col 6 is bonus_id, NOT rank) and builds byId/byOwner/byContinent. lib/tw-commands.js (extend): parseIncoming emits the TARGET village for per-target aggregation; keeps its own CMD_TYPE vocabulary {cleaner,noble,scout,support,unknown}. lib/tw-overview-core.js (NEW, pure, dual-export): COLUMN_REGISTRY + getColumn/columnsForDomain/gateColumnsByWorld/resolveVisibleColumns; the RowMatrix-based parseOverviewTable(matrix,cfg) generalizing parseCompleteOverview/parseUnitHeaders across units|prod|buildings|incomings (columns mapped by header img src/class via buildColumnMap, NEVER indices; 'stone'==clay alias; dedup type=complete 5-rows-per-village by id); a single jQuery-touching extractRowMatrix(html,$) adapter; computeDerivedFlags (isNuke/hasNoble/hasIncomings/underDefended/whNearFull/isFull/academyReady), calcArmyPower, threshold predicate builders + composeAnd/countMatching, multi-key sortBy comparator, locale-tolerant parseLocaleNumber, geo (fieldDistance/nearestEnemy/distanceToFront continent-bucketed), fake/nuke ESTIMATE (estimateAttackUnits per-command, classifyTrainKind per-train), buildMasterModel JOIN, cacheKeyFor (UNPREFIXED), CACHE_TTL_MS, detectPremium (jQuery-free scan), aggregateIncomingsByTarget. lib/tw-table.js (NEW, pure core + DOM layer, dual-export): TWTools.Table.pure.* (applyFilters/computeFilterCounts/applyMultiSort/toggleSortKey/projectVisible/resolvePillClasses/buildBBCode/buildCSV/formatCellForExport/computeVirtualWindow) plus a node-safe DOM render() engine (sticky thead, column-toggle + threshold filter chips with live counts, multi-sort clicks, virtualized tbody, row pills, BBCode/CSV export of current view); ships its OWN inline escapeHtml + clipboard fallback, only probes TWTools.UI.toast. lib/tw-config-core.js (NEW, pure, browser-attach): versioned config (CONFIG_VERSION=2), mergeDefaults/deepMerge, dated migrateConfig importing legacy two_ keys, 5 seeded view presets + CRUD + import/export, intOr/clampInt/swapIfInverted, load/save/patch taking a store adapter (real key twt_two_config). scripts/tw-overview.js (thin orchestrator): config hookup, COLUMN_REGISTRY preset wiring, buildMasterModel call, callback-chained sequential Fetch-All behind a single fetchLock with >=200ms gaps and per-domain TTLs (incomings 2m / troops 5m / econ+buildings 15m / map 1h), Premium feature-detect/degrade, 8-tab createCard assembly [Dashboard, Troops, Economy, Buildings, Incomings, Map, Commands, Settings] with lazy per-tab render, Commands-tab upgrades, and three tech-debt fixes (VERSION->2.0.0; Clear-Cache->real keys; recalculateNukeStatus across all 5 buckets + master). Tests: node v24.12 native node:test over tests/unit/**/*.test.js (glob form mandatory), bundled lib source IS tested source via typeof-guarded module.exports tails that survive into the bundle but are INERT in-browser.

## Estimate

**42 tasks · 7 milestones.** 42 tasks across 7 checkpointable milestones. Roughly: M1 foundation 5 tasks (~0.5d), M2 core-ext+overview-core pure logic 12 tasks (the largest, test-first, ~2.5d), M3 registry+master+Fetch-All 5 tasks (~1.5d), M4 table engine 5 tasks (~1.5d), M5 config+presets 6 tasks (~1d), M6 entry+tabs+Commands+tech-debt+incomings 7 tasks (~2.5d), M7 polish+regression+E2E 2 tasks (~0.5d). ~10 working days for one engineer. Pure-logic tasks are strictly test-first (RED commit then GREEN commit); wiring/DOM tasks verify via build + in-game smoke (DOM untested by design). Every milestone ends buildable+testable+committable so execution can checkpoint and resume.

## Cross-cutting decisions (consistency points resolved across subsystems)

1. BUILD LOAD ORDER (single canonical array, written ONCE in build.js SCRIPT_LIBS): SCRIPT_LIBS['tw-overview.js'] = ['tw-core.js','tw-ui.js','tw-commands.js','tw-overview-core.js','tw-config-core.js','tw-table.js']. Rationale: tw-core defines window.TWTools+Storage+DataFetcher first; tw-ui adds UI/toast; tw-commands HARD-THROWS at lib/tw-commands.js:4-7 if window.TWTools is absent so it MUST follow tw-core/tw-ui; the three NEW pure libs follow (overview-core before tw-table because tw-table consumes its predicates/comparators/registry; tw-config-core anywhere after tw-core, placed before tw-table); scripts/tw-overview.js is appended automatically last by buildScript. readFileOrNull (build.js:73-79) returns null and buildScript skips missing libs (build.js:189-196), so the array is registered ONCE up front and the build stays GREEN as the NEW libs are created incrementally. THREE subsystems edit this one key — reconcile to exactly this six-element array, last-write-wins would silently drop libs.

2. CACHE-KEY DOUBLE-PREFIX (resolved): the local Store wrapper (tw-overview.js:130-162) prepends 'two_' on top of tw-core Storage's 'twt_', so real localStorage keys are twt_two_*. OverviewCore.cacheKeyFor returns UNPREFIXED keys (domain_worldKey_gGID) and TWConfig.CONFIG_KEY is the bare 'config'; all access goes through the prefixed Store/localStore adapter (never TWTools.Storage.get('config') directly). Per-domain TTL caches and the config blob share the twt_ namespace but are separate tiers (config has NO TTL).

3. SHARED FUNCTION SIGNATURES across libs: getContinent(x,y) is defined byte-identically as 'K'+floor(y/100)+floor(x/100) (Y-then-X, matching tw-map-tools.js:161) — promoted into tw-core (canonical) AND mirrored in OverviewCore for node-testability; tw-map-tools delegates to TWTools.getContinent. The unit constant tables (ATTACK_VALUES/DEF_VALUES/ALL_UNITS/UNITS_NO_ARCHERS/OFFENSIVE_UNITS/DEFENSIVE_UNITS, currently tw-overview.js:47-82) move VERBATIM into OverviewCore as the single source of truth; the orchestrator reads them from OverviewCore. cacheKeyFor/CACHE_TTL_MS live in OverviewCore and are consumed by the orchestrator's runFetchAll and clearAllCaches. classifyNukeFlag/collectOverviewCacheKeys/recomputeBucketsNuke are the pinned pure seams the three tech-debt fixes delegate to.

4. TWO CMD_TYPE VOCABULARIES kept separate (no global collision — separate IIFE scopes after concat): tw-commands.js CMD_TYPE {cleaner,noble,scout,support,unknown} is used ONLY inside the ESTIMATE classifier (classifyUnit/classifyTrainKind); the overview file keeps its LOCAL CMD_TYPE {attack,support,return,other} for the command-row type column. EN8 must not conflate them.

5. NODE-COMPAT ENVELOPE (single contract for the pure libs): each pure lib is its own browser IIFE that (a) attaches its surface to window.TWTools.X only-if-absent (idempotent, matching tw-core.js:1031-1056), and (b) ends with a `if (typeof module !== 'undefined' && module.exports) { module.exports = API; }` tail. The build's bare outer IIFE (build.js:204) passes no args so terser CANNOT prove `module` undefined — the tail SURVIVES into dist but is INERT in-browser (typeof module === 'undefined'). The pure layer references NO bare window/$/document at module top level (only inside browser-only branches), so node require() never throws. extractRowMatrix(html,$) and all DOM methods take $/window as injected params or early-return when absent. Build verification asserts the BROWSER token (e.g. 'OverviewCore') is present, NEVER that 'module.exports' is absent.

6. TEST COMMAND is the GLOB form: package.json scripts.test = 'node --test "tests/unit/**/*.test.js"' (and test:watch with --watch). The bare-dir form 'node --test tests/unit/' FAILS on node v24 ('Cannot find module'). The glob also scopes discovery to tests/unit, excluding the existing tests/e2e/*.spec.js Playwright suite. node v24.12 ships node:test/node:assert natively — NO new devDependencies. The 'test' script is added exactly ONCE (idempotent across subsystems).

7. READ-ONLY + RATE-SAFE contract lives ENTIRELY in the orchestrator: one module-level fetchLock boolean (replaces the old isFetching at tw-overview.js:285), released in BOTH success AND error branches of every $.ajax; runFetchAll is a callback-chained sequential stepper (NOT Promise.all — the jQuery runtime has no async/await) with setTimeout(REQUEST_DELAY=200) gaps; every request is a GET of overview_villages with a mode param or map .txt (never POST). The pure libs and table engine do NO network I/O and structurally cannot violate read-only.

8. FIXTURES are real saved raw response bodies (not DevTools-rendered/pretty-printed) preserving header img src+class (the column-mapping contract), session tokens stripped, trimmed to ~3-5 villages incl. one duplicate type=complete 5-row village (dedup-by-id) and a non-K00 continent + one enemy player (nearest-enemy); map .txt slices kept small (a few lines) for deterministic, repo-light tests. A dependency-free html-to-rowmatrix tokenizer in tests/unit/helpers produces the SAME RowMatrix shape as extractRowMatrix so parseOverviewTable is covered in node without jsdom.


## Milestones

| # | Milestone | Tasks |
|---|-----------|-------|
| | **M1 — Build + test harness & lib registration** | T01, T02, T03, T04, T05 |
| | **M2 — Core extensions + overview-core pure logic (test-first)** | T06, T07, T08, T09, T10, T11, T12, T13, T14, T15, T16, T17 |
| | **M3 — COLUMN registry + master model + Fetch-All orchestrator** | T18, T19, T20, T21, T22 |
| | **M4 — Generic table engine** | T23, T24, T25, T26, T27 |
| | **M5 — Versioned config + saved view presets + migration** | T28, T29, T30, T31, T32, T33 |
| | **M6 — Entry orchestrator, 8 tabs, Commands upgrades, tech-debt** | T34, T35, T36, T37, T38, T39, T40 |
| | **M7 — Polish, full-suite + cross-script regression, in-game E2E** | T41, T42 |


### M1 — Build + test harness & lib registration

_Wire the single SCRIPT_LIBS entry (canonical six-lib order) and the glob node:test runner so the build stays GREEN before any new lib exists (readFileOrNull skips missing libs) and the harness lands GREEN (skip-guarded) — a true foundation every later subsystem depends on. Ends buildable+testable+committable._

#### T01 — Register the canonical six-lib SCRIPT_LIBS entry for tw-overview.js  `[wire]`
- **Files:** `/Users/denispaulik/git/tw-tools/build.js`
- **Depends on:** —
- **Steps:**
  1. Read build.js:49-51 (SCRIPT_LIBS object literal, currently only the 'tw-snipe.js' entry).
  1. Add a trailing comma after the 'tw-snipe.js' line, then add the canonical single ordered array: 'tw-overview.js': ['tw-core.js','tw-ui.js','tw-commands.js','tw-overview-core.js','tw-config-core.js','tw-table.js']. This is the ONE place the key is written (three subsystems touch it — last-write-wins would drop libs).
  1. Confirm order rationale: tw-core (window.TWTools+Storage), tw-ui (UI/toast), tw-commands (HARD-THROWS at tw-commands.js:4-7 without window.TWTools), then the NEW pure libs (overview-core before tw-table; tw-config-core before tw-table), then buildScript appends scripts/tw-overview.js last automatically.
  1. Run the testCmd: the four not-yet-created libs are skipped by readFileOrNull (build.js:73-79)/buildScript (build.js:189-196); the build MUST succeed and the SUMMARY 'Libs:' line must list only tw-core.js + tw-ui.js + tw-commands.js in order.
- **Verify:** `node build.js --only=tw-overview`
- **Commit:** `build(overview): register overview libs incl tw-commands + new pure libs in load order

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T02 — Add glob node:test runner scripts to package.json  `[wire]`
- **Files:** `/Users/denispaulik/git/tw-tools/package.json`
- **Depends on:** —
- **Steps:**
  1. Read package.json scripts block (lines 5-13).
  1. Add a trailing comma after 'build:map-tools', then add "test": "node --test \"tests/unit/**/*.test.js\"" and "test:watch": "node --test --watch \"tests/unit/**/*.test.js\"". GLOB form is MANDATORY — 'node --test tests/unit/' fails on node v24 ('Cannot find module'); the glob also excludes tests/e2e Playwright specs.
  1. Do NOT add devDependencies — verify node:test is native: node -e "require('node:test'); require('node:assert')".
  1. Create tests/unit/ (only tests/e2e exists today). Run the testCmd — with no specs yet it exits 0.
- **Verify:** `node -e "require('node:test'); require('node:assert'); console.log('ok')"`
- **Commit:** `test(overview): wire native node:test runner via glob discovery

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T03 — Create tests/unit layout, fixtures loader, dependency-free html-to-rowmatrix tokenizer, skip-guarded smoke specs  `[test]`
- **Files:** `/Users/denispaulik/git/tw-tools/tests/unit/fixtures/load.js`, `/Users/denispaulik/git/tw-tools/tests/unit/fixtures/.gitkeep`, `/Users/denispaulik/git/tw-tools/tests/unit/helpers/html-to-rowmatrix.js`, `/Users/denispaulik/git/tw-tools/tests/unit/overview-core.smoke.test.js`, `/Users/denispaulik/git/tw-tools/tests/unit/table.smoke.test.js`
- **Depends on:** T02
- **Steps:**
  1. Create tests/unit/fixtures/load.js exporting readFixture(name)=fs.readFileSync(path.join(__dirname,name),'utf8') plus EXPECTED_FIXTURES=['overview-units-complete.html','overview-prod.html','overview-buildings.html','overview-incomings.html','village.sample.txt','player.sample.txt','ally.sample.txt']; add .gitkeep.
  1. Create tests/unit/helpers/html-to-rowmatrix.js: dependency-free regex tokenizer emitting the RowMatrix shape {headers:[{text,iconSrc,cssClass,colIndex}], rows:[{cells:[{text,iconSrc,links:[{href,text}]}]}], hasNextPage, infoBoxText} — rows via <tr>...</tr>, cells via <t[hd]...>...</t[hd]>, img src via /<img[^>]*src="([^"]+)"/, class via /class="([^"]*)"/, links via /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, next-page via selected paged-nav-item with following sibling, infoBoxText from class="info_box".
  1. Write overview-core.smoke.test.js: const test=require('node:test'),assert=require('node:assert'),fs=require('node:fs'),path=require('node:path'); LIB=path.join(__dirname,'..','lib','tw-overview-core.js') (one level up — NOT ../../lib). test('overview-core dual-export',{skip:!fs.existsSync(LIB)?'lib not built yet':false},()=>{const core=require(LIB); assert.strictEqual(typeof core.parseLocaleNumber,'function'); assert.deepStrictEqual(core.parseOverviewTable({headers:[],rows:[],hasNextPage:false,infoBoxText:''},{}),...);}).
  1. Write table.smoke.test.js with the identical skip-guard against lib/tw-table.js asserting Table.pure helpers exist and run on empty input.
  1. Run npm test — expect 2 skipped, 0 failed, exit 0 (libs absent). Harness is a GREEN foundation; the SAME specs auto-exercise the libs once they land.
- **Verify:** `npm test`
- **Commit:** `test(overview): unit harness, fixtures loader, rowmatrix tokenizer, skip-guarded smoke specs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T04 — Capture real overview + map fixtures  `[test]`
- **Files:** `/Users/denispaulik/git/tw-tools/tests/unit/fixtures/overview-units-complete.html`, `/Users/denispaulik/git/tw-tools/tests/unit/fixtures/overview-prod.html`, `/Users/denispaulik/git/tw-tools/tests/unit/fixtures/overview-buildings.html`, `/Users/denispaulik/git/tw-tools/tests/unit/fixtures/overview-incomings.html`, `/Users/denispaulik/git/tw-tools/tests/unit/fixtures/village.sample.txt`, `/Users/denispaulik/git/tw-tools/tests/unit/fixtures/player.sample.txt`, `/Users/denispaulik/git/tw-tools/tests/unit/fixtures/ally.sample.txt`
- **Depends on:** T03
- **Steps:**
  1. In-game (Premium world) save the raw response bodies (View-Source, NOT DevTools DOM) of overview_villages mode=complete (units), mode=prod, mode=buildings, mode=incomings&subtype=attacks. Trim to ~3-5 villages incl. one duplicate type=complete 5-row village and header rows with img src/class incl. archer/church/watchtower variants. Include an info_box snippet for the empty-group test.
  1. Download small slices of /map/village.txt (cols id,name,x,y,owner,points,bonus_id — note rank is player.txt), /map/player.txt (incl. one enemy), /map/ally.txt — a few lines each, a non-K00 continent.
  1. Strip session tokens (csrf, h=) but KEEP real header img src + class (the column-mapping contract under test).
  1. Place files in tests/unit/fixtures/ with the EXPECTED_FIXTURES names. Keep total size small.
  1. Run the testCmd to confirm every fixture loads non-empty.
- **Verify:** `node -e "const {readFixture,EXPECTED_FIXTURES}=require('./tests/unit/fixtures/load.js'); EXPECTED_FIXTURES.forEach(f=>{const s=readFixture(f); if(!s.length) throw new Error('empty: '+f); console.log(f, s.length);});"`
- **Commit:** `test(overview): add saved overview HTML + map.txt fixtures

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T05 — Document the node-compat envelope contract for the pure libs (docs only)  `[docs]`
- **Files:** `/Users/denispaulik/git/tw-tools/tasks/2026-06-23-tw-overview-ultimate/node-compat-envelope.md`
- **Depends on:** —
- **Steps:**
  1. Write a markdown contract into the task dir defining the exact HEAD/BODY/TAIL/CALL-SITE every pure lib (tw-overview-core.js, tw-table.js, tw-config-core.js) must use. Does NOT create/edit the lib files (owned by later tasks).
  1. HEAD: ;(function(root,$){ 'use strict'; var TWTools = root.TWTools || (root.TWTools = {}); — reuses window.TWTools in browser, creates on globalThis in node.
  1. BODY rule: define pure fns; attach browser surface TWTools.OverviewCore/{Table}/{Config} only-if-absent (matching tw-core.js:1031-1056). HARD RULE: pure fns NEVER reference bare window/$/document at module top level (only browser-only branches); all DOM/$.ajax stays in tw-core/tw-ui/tw-commands.
  1. TAIL (before IIFE close): if (typeof module !== 'undefined' && module.exports) { module.exports = API; } — INERT (not stripped) in the browser bundle; correctness relies on the runtime typeof guard, NOT dead-code elimination.
  1. CALL SITE: })(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), typeof jQuery !== 'undefined' ? jQuery : undefined);
  1. Document the verification ritual: node require() exits 0; node build.js --only=tw-overview succeeds; min.js asserts the browser token present (NOT that module.exports is absent — terser keeps the guarded branch).
  1. Run the testCmd (file-exists check).
- **Verify:** `node -e "if(!require('fs').existsSync('./tasks/2026-06-23-tw-overview-ultimate/node-compat-envelope.md')) throw new Error('contract doc missing'); console.log('ok');"`
- **Commit:** `docs(overview): document dual browser-IIFE + node export envelope for pure libs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`


### M2 — Core extensions + overview-core pure logic (test-first)

_Extract genuinely pure string->data parsers into tw-core and build the pure heart (tw-overview-core.js) test-first: locale parse, RowMatrix parseOverviewTable across 4 domains, dedup/split, derived flags, army power, predicates, multi-sort, geo, fake/nuke ESTIMATE. All node-tested with zero jsdom. Each RED->GREEN pair is committable._

#### T06 — RED: tw-core pure-parser specs + window/jQuery shim harness  `[test]`
- **Files:** `/Users/denispaulik/git/tw-tools/tests/helpers/load-core.js`, `/Users/denispaulik/git/tw-tools/tests/unit/tw-core.parse.test.js`
- **Depends on:** T03
- **Steps:**
  1. Create tests/helpers/load-core.js: set global.window={}; provide a minimal jQuery stub (chainable no-op; jQuery.ajax=function(){}); fs.readFileSync lib/tw-core.js; vm.runInThisContext / Function-wrap bound to (window, jQuery); return global.window.TWTools. Export loadTWCore().
  1. Create tests/unit/tw-core.parse.test.js (node:test): parseVillagesTxt '1,Dorf%20A,500,500,99,1234,7' -> {id:1,name:'Dorf A',x:500,y:500,owner:99,points:1234,bonusId:7}; blank/short lines skipped; junk -> []. parsePlayersTxt '7,Spieler%2B,3,12,5000,4' -> {id:7,name:'Spieler+',tribe:3,villages:12,points:5000,rank:4}. parseTribesTxt ally.txt row. parseBuildingInfoXml '<config><main><max_level>30</max_level></main></config>' -> {main:{max_level:30}}; '' -> {}. buildIndexBy([{id:1},{id:1}],'id') last-wins; non-array -> {}. getContinent(500,500)==='K55', getContinent(5,5)==='K00', getContinent(523,477)==='K45'.
  1. Run npm test — MUST be RED (functions undefined).
- **Verify:** `npm test`
- **Commit:** `test(core): RED pure-parser specs + window/jQuery shim harness

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T07 — GREEN: tw-core pure parsers + buildIndexBy + getContinent  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/lib/tw-core.js`
- **Depends on:** T06
- **Steps:**
  1. Add pure fns parseVillagesTxt (keeps bonusId from col 6), parsePlayersTxt, parseTribesTxt, parseBuildingInfoXml (regex tag scan on the STRING, no DOMParser), buildIndexBy (unique last-wins AND array-grouping mode), getContinent ('K'+Math.floor(y/100)+Math.floor(x/100), byte-identical to tw-map-tools.js:161) inside the existing IIFE above the public-API block. All fail-safe (guard -> []/{}/null), decodeURIComponent(name.replace(/\+/g,' ')).
  1. Expose each on window.TWTools via the existing `if (!existing.X) existing.X = X;` guard pattern (tw-core.js:1034-1055). Do NOT add module.exports/require — the harness shims globals instead.
  1. Run npm test — MUST be GREEN. Run npm run build:overview — single bundle emits, no terser error.
- **Verify:** `npm test && npm run build:overview`
- **Commit:** `feat(core): pure parsers (villages keep bonusId) + buildIndexBy + getContinent

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T08 — fetchAllVillages delegates + bonusId + byId/byOwner/byContinent; fetchPlayers/fetchTribes/fetchBuildingInfo; buildVillageIndex  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/lib/tw-core.js`, `/Users/denispaulik/git/tw-tools/tests/unit/tw-core.parse.test.js`
- **Depends on:** T07
- **Steps:**
  1. Refactor DataFetcher.fetchAllVillages (tw-core.js:873-909): replace the inline csv loop with var villages = parseVillagesTxt(csv); keep the SAME callback(villages) signature and cache key 'all_villages' (CACHE_TTL.allVillages). villages now carry .bonusId (additive). Build _allVillagesById/_byOwner/_byContinent via buildIndexBy lazily; expose getVillageById/getVillagesByOwner/getVillagesByContinent.
  1. Add DataFetcher.fetchPlayers(callback) (GET /map/player.txt, parsePlayersTxt, cache 'players' 1h, _playersById, getPlayerById) and fetchTribes(callback) (/map/ally.txt, parseTribesTxt, cache 'tribes' 1h, getTribeById); error -> callback([]). Add CACHE_TTL.players=CACHE_TTL.tribes=3600000.
  1. Add DataFetcher.fetchBuildingInfo(callback): GET /interface.php?func=get_building_info, pass xhr.responseText STRING to parseBuildingInfoXml (same code path as the unit test), cache 'building_info' CACHE_TTL.buildingInfo=24*3600000; error -> callback({}). NOTE: 24h static caps, NOT the 15m mode=buildings scrape.
  1. Add DataFetcher.buildVillageIndex(villages, players) returning {byId,byOwner,byContinent}; byId merges owner rank+tribe+points from the optional players map (player.txt); continent via getContinent. Pure-ish (no AJAX). Extend tw-core.parse.test.js: assert byId merges owner rank into the village row, bonusId carried, continent correct.
  1. Run npm test (GREEN — parse specs + new index spec). Run npm run build:overview && npm run build:snipe (snipe is the heaviest tw-core consumer + bundles tw-commands — cheap backward-compat smoke).
- **Verify:** `npm test && npm run build:overview && npm run build:snipe`
- **Commit:** `feat(core): fetchAllVillages bonusId+indexes, fetchPlayers/Tribes/BuildingInfo, buildVillageIndex

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T09 — Promote getContinent: delegate from tw-map-tools  `[wire]`
- **Files:** `/Users/denispaulik/git/tw-tools/scripts/tw-map-tools.js`
- **Depends on:** T08
- **Steps:**
  1. Remove the local getContinent(x,y) definition (tw-map-tools.js:161-~163). Replace its call sites (e.g. tw-map-tools.js:388) with TWTools.getContinent(...). tw-map-tools already hard-requires window.TWTools at init.
  1. grep to confirm no bare getContinent( references remain before building.
  1. Run npm run build:map-tools — single bundle emits, no error (sibling-script backward-compat gate).
- **Verify:** `npm run build:map-tools`
- **Commit:** `refactor(map-tools): delegate getContinent to TWTools.getContinent

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T10 — Scaffold lib/tw-overview-core.js (node-compat envelope, fail-safe stubs, dual-export)  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/lib/tw-overview-core.js`, `/Users/denispaulik/git/tw-tools/tests/unit/helpers/load-overview-core.js`
- **Depends on:** T03, T05
- **Steps:**
  1. Create lib/tw-overview-core.js using the T05 envelope: HEAD ;(function(root,$){'use strict'; var TWTools=root.TWTools||(root.TWTools={}); — header docblock with @version, @pure, ESTIMATE warning, 'TW DOM quirk: stone element == clay', and a RowMatrix typedef.
  1. Add fail-safe STUBS for EVERY API fn (parsers return {rows:[],hasNextPage:false}; numeric->0; geo->null/Infinity; predicates->fn) so the file requires cleanly under node and exposes the full API object. The pure layer must reference NO bare window/$/document at top level; only extractRowMatrix uses the injected $.
  1. Attach browser surface TWTools.OverviewCore only-if-absent; add the typeof-guarded module.exports tail; close with the node-safe call site.
  1. Create tests/unit/helpers/load-overview-core.js: module.exports = require('../../../lib/tw-overview-core.js');
  1. Gate on syntax+require (NOT npm test passing with zero specs): node --check lib/tw-overview-core.js && node -e "const A=require('./lib/tw-overview-core.js'); if(typeof A.parseLocaleNumber!=='function')process.exit(1);"
- **Verify:** `node --check lib/tw-overview-core.js && node -e "const A=require('./lib/tw-overview-core.js'); if(typeof A.parseLocaleNumber!=='function'){process.exit(1)}"`
- **Commit:** `feat(overview-core): scaffold pure lib (envelope, stubs, dual-export)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T11 — TEST+IMPL: parseLocaleNumber, extractCoords/parseCoordsObj, shared unit constant tables  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/tests/unit/overview-core.parse.test.js`, `/Users/denispaulik/git/tw-tools/lib/tw-overview-core.js`
- **Depends on:** T10
- **Steps:**
  1. RED: overview-core.parse.test.js — parseLocaleNumber '1.234'->1234, '12 345'->12345, '1 234'->1234 (NBSP), '1,234'->1234, ''->0, 'abc'->0, null->0, '-3'->-3 (never NaN). extractCoords('Foo (123|456)')->'123|456', none->''. parseCoordsObj('x (12|34)')->{x:12,y:34}, 'none'->null. UNIT_HEADER_ALIASES.stone==='clay', .wood==='wood'; ATTACK_VALUES.light===130, DEF_VALUES.heavy===200, ALL_UNITS.length===12 (parity with tw-overview.js:47-82). Run npm test -> FAIL.
  1. GREEN: parseLocaleNumber = String(text||'').replace(/[\s ]/g,'').replace(/[.,]/g,'') keeping a leading '-', then parseInt(_,10)||0. Port extractCoords verbatim (tw-overview.js:755); add parseCoordsObj mirroring tw-core.parseCoords. Move ATTACK_VALUES/DEF_VALUES/ALL_UNITS/UNITS_NO_ARCHERS/OFFENSIVE_UNITS/DEFENSIVE_UNITS VERBATIM from tw-overview.js:47-82; add UNIT_HEADER_ALIASES={stone:'clay',wood:'wood',iron:'iron',...each unit identity}. Run npm test -> GREEN.
- **Verify:** `npm test`
- **Commit:** `feat(overview-core): locale-tolerant parse, coords, shared unit tables

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T12 — TEST+IMPL: buildColumnMap, parseOverviewTable (4 domains), dedupById, splitByCategory, extractRowMatrix  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/tests/unit/overview-core.parse.test.js`, `/Users/denispaulik/git/tw-tools/lib/tw-overview-core.js`
- **Depends on:** T04, T11
- **Steps:**
  1. RED: using html-to-rowmatrix on each fixture, call parseOverviewTable(matrix, DOMAIN_CONFIGS.units): assert correct id/name/coords, spear count read via the header-icon column AND a shuffled-header fixture-variant still maps correctly (proves NOT a hardcoded index), hasNextPage===true. splitByCategory -> 5 categories + per-bucket id dedup. prod: wood/clay/iron via parseLocaleNumber AND 'stone' header lands on key 'clay'. buildings: main/wall/storage levels mapped by buildings/<name>.png. incomings: per-row source coords/player/distanceFloat/arrivalText via pure labelMap AND the TARGET village captured. dedupById(keep:'first') collapses duplicated-id rows. empty-group: infoBoxText with 'nepatrí' -> {rows:[],emptyGroup:msg}. Run npm test -> FAIL.
  1. GREEN: buildColumnMap(headers, headerIconRegex, aliasMap) matches header.iconSrc (group1), aliasMap stone->clay, cssClass fallback /unit-type-(\w+)/, returns {key:colIndex} (NEVER indices). parseOverviewTable(matrix,cfg): detect id/name/coords from links matching cfg.idColLinkPattern (default /village=(\d+)/ + '(x|y)'); compute cellOffset (parent vs 5-row sub-row, mirroring tw-overview.js:470-486); map data cols via buildColumnMap; apply (cfg.cellReaders[key]||parseLocaleNumber)(cell); surface infoBoxText -> emptyGroup on nepatr/belong/gehört/'no villages'; whole body try/catch -> {rows:[],hasNextPage:false}. DOMAIN_CONFIGS units/prod/buildings/incomings (regexes+labelMaps+cellReaders; incomings labelMatcher ports ONLY the multi-lang token table from tw-commands.js:201-240, NOT jQuery code). dedupById (stable) + splitByCategory (5-bucket + per-bucket dedup). extractRowMatrix(html,$) adapter producing the IDENTICAL RowMatrix as the tokenizer (browser-only, not node-tested). Run npm test -> GREEN.
- **Verify:** `npm test`
- **Commit:** `feat(overview-core): generalized parseOverviewTable + per-domain configs + dedup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T13 — TEST+IMPL: computeDerivedFlags, calcArmyPower, threshold predicates, composeAnd, countMatching  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/tests/unit/overview-core.flags.test.js`, `/Users/denispaulik/git/tw-tools/lib/tw-overview-core.js`
- **Depends on:** T11
- **Steps:**
  1. RED: isNuke at/above nukeThreshold (offCount=axe+light, +marcher only when includeArchers); hasNoble when snob>0; hasIncomings when incCount>0; underDefended ONLY when defPower<defThreshold AND hasIncomings; whNearFull at warnPct; isFull at fullPct; academyReady when HQ>=20&&smithy>=20&&market>=10. calcArmyPower offPower/defPower match ATTACK_VALUES/DEF_VALUES sums (archer variants only when includeArchers). predicate.gte/lte/eq/flag/between; composeAnd([])->alwaysTrue; countMatching counts. Assert computeDerivedFlags returns a COPY (no input mutation). Run npm test -> FAIL.
  1. GREEN: calcArmyPower (port the loop from tw-overview.js:795-820), computeDerivedFlags (shallow-copy + flags; centralizes the splitIntoCategories/recalculateNukeStatus logic so the across-5-buckets stale-flag bug is fixed once), predicate builders, composeAnd, countMatching. Run npm test -> GREEN.
- **Verify:** `npm test`
- **Commit:** `feat(overview-core): derived flags, army power, threshold predicates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T14 — TEST+IMPL: multi-key sortBy comparator with tie-breakers  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/tests/unit/overview-core.sort.test.js`, `/Users/denispaulik/git/tw-tools/lib/tw-overview-core.js`
- **Depends on:** T11
- **Steps:**
  1. RED: sortBy([{key:'points',dir:'desc',type:'num'}]) numeric desc; a second key breaks ties; type:'str' uses localeCompare; missing/NaN keys sort LAST in both directions; equal rows preserve input order under Array.prototype.sort (stability assertion, NOT an internal index tiebreak); empty spec -> comparator returns 0. Run npm test -> FAIL.
  1. GREEN: comparator FACTORY — per spec entry coerce (Number with NaN treated as +Infinity-last for 'num'; String+localeCompare for 'str'/default), apply dir sign, first non-zero wins; empty spec -> ()=>0. Document reliance on stable Array.prototype.sort (V8); do NOT claim an internal index tiebreak. Run npm test -> GREEN.
- **Verify:** `npm test`
- **Commit:** `feat(overview-core): multi-key sortBy comparator with tie-breakers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T15 — TEST+IMPL: geo math — getContinent, fieldDistance, nearestEnemy, distanceToFront  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/tests/unit/overview-core.geo.test.js`, `/Users/denispaulik/git/tw-tools/lib/tw-overview-core.js`
- **Depends on:** T11
- **Steps:**
  1. RED: getContinent(523,477)->'K45' (Y-then-X, matches tw-map-tools.js:161); fieldDistance({x:500,y:500},{x:503,y:504})->5; nearestEnemy prefers same/neighbor-continent buckets but returns the globally-nearest once neighbors exhausted (near-out-of-bucket vs far-in-bucket fixture); nearestEnemy([])->null; distanceToFront returns nearest enemy dist, Infinity when none. Run npm test -> FAIL.
  1. GREEN: getContinent (mirror tw-core), fieldDistance (mirror tw-core.distance), internal byContinent index builder, nearestEnemy (3x3 continent neighborhood first, widen when empty, reduce to global min within searched set), distanceToFront via nearestEnemy. Pure (byContinent optional). Run npm test -> GREEN.
- **Verify:** `npm test`
- **Commit:** `feat(overview-core): continent + distance + nearest-enemy geo math

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T16 — TEST+IMPL: fake/nuke ESTIMATE — estimateAttackUnits, classifyTrainKind  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/tests/unit/overview-core.estimate.test.js`, `/Users/denispaulik/git/tw-tools/lib/tw-overview-core.js`
- **Depends on:** T11
- **Steps:**
  1. RED: with injected unitSpeeds (mirror DEFAULT_UNIT_SPEEDS) + worldConfig{speed:1,unitSpeed:1}: estimateAttackUnits(travelTime for a known speed over dist=10) returns the matching unit, confidence 'high', isNoble true only when classified unit==='snob'; estimateAttackUnits(_,0,_,_) -> {unit:'unknown',isNoble:false,confidence:'none'} and NEVER throws. classifyTrainKind: nobleCount>0 -> 'noble'; fastest command heavy/ram-class -> 'nuke'; single fast scout-class -> 'fake'; undeterminable -> 'unknown'; a confidence label is always present. Run npm test -> FAIL.
  1. GREEN: port classifyUnit math from tw-commands.js:475-551 into a pure travelTime helper (mirror tw-core.travelTime) + estimateAttackUnits wrapper returning {unit,isNoble,confidence} (NO isNuke here — that is train-level; NO TWTools global reads). classifyTrainKind over groupIntoTrains-shaped input. Run npm test -> GREEN.
- **Verify:** `npm test`
- **Commit:** `feat(overview-core): fake/nuke ESTIMATE (classifyUnit port, pure)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T17 — Verify M2: full pure suite GREEN + overview build picks up overview-core  `[test]`
- **Files:** `/Users/denispaulik/git/tw-tools/lib/tw-overview-core.js`
- **Depends on:** T12, T13, T14, T15, T16
- **Steps:**
  1. Run npm test — all tw-core + overview-core specs GREEN.
  1. Run npm run build:overview and confirm the SUMMARY 'Libs:' line now lists tw-core.js + tw-ui.js + tw-commands.js + tw-overview-core.js (tw-config-core/tw-table still skipped). grep -q OverviewCore dist/tw-overview.min.js (browser token present). Do NOT assert module.exports absent.
  1. Confirm node still loads the SAME bundled source via the smoke spec (T03 now exercises the lib, not skipped).
- **Verify:** `npm test && npm run build:overview && grep -q OverviewCore dist/tw-overview.min.js`
- **Commit:** `chore(overview): verify pure-core suite + overview-core bundled

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`


### M3 — COLUMN registry + master model + Fetch-All orchestrator

_Land the declarative COLUMN_REGISTRY, buildMasterModel JOIN, cacheKeyFor/CACHE_TTL_MS, detectPremium, buildVillageIndex, and the sequential single-lock read-only Fetch-All orchestrator with per-domain caching + Premium degrade. The unified substrate every tab renders from._

#### T18 — RED: COLUMN_REGISTRY helpers + gating specs  `[test]`
- **Files:** `/Users/denispaulik/git/tw-tools/tests/unit/overview-registry.test.js`
- **Depends on:** T12
- **Steps:**
  1. Require lib/tw-overview-core.js. Assert COLUMN_REGISTRY non-empty, unique keys, each descriptor has key/label/domain/format(function); each domain (troops/economy/buildings/incomings/map) has its design columns.
  1. getColumn known->descriptor, unknown->null; columnsForDomain('buildings') returns only buildings cols.
  1. gateColumnsByWorld drops church when world.church===0, archer when world.archer===false; no-flag cols always pass; undefined world value keeps the col. resolveVisibleColumns honors saved order, drops unknown keys, falls back to defaultVisible.
  1. Run npm test -> FAIL.
- **Verify:** `npm test`
- **Commit:** `test(overview-core): RED specs for COLUMN_REGISTRY + world gating

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T19 — RED: buildMasterModel / cacheKeyFor / CACHE_TTL_MS / detectPremium / aggregateIncomingsByTarget specs  `[test]`
- **Files:** `/Users/denispaulik/git/tw-tools/tests/unit/overview-master-model.test.js`
- **Depends on:** T12, T13
- **Steps:**
  1. buildMasterModel({troops:{1:{axe:100,total:100}}, econ:{1:{wood:5000}}}, {byId:{1:{x:500,y:500,points:9000,rank:12}}}) -> ONE merged row id1, continent 'K55', coords '500|500', wood 5000, axe 100; omitting econ -> wood undefined, no throw; village absent from byId still yields a row; dedup one row per id; non-object -> [].
  1. cacheKeyFor('incomings',0,'en123') === 'incomings_en123_g0' (UNPREFIXED); troops key differs. CACHE_TTL_MS: incomings=120000 < troops=300000 < econ=900000 === buildings=900000 < map=3600000.
  1. detectPremium(html with overview_table+'Production' header, 'prod') -> {available:true}; html with 'premium_account_required' -> {available:false, reason}; '' -> {available:false}. aggregateIncomingsByTarget([]) -> {} (placeholder).
  1. Run npm test -> FAIL.
- **Verify:** `npm test`
- **Commit:** `test(overview-core): RED specs for master model, cacheKey/TTL, premium detect

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T20 — GREEN: COLUMN_REGISTRY + registry helpers + world gating  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/lib/tw-overview-core.js`
- **Depends on:** T18
- **Steps:**
  1. Define COLUMN_REGISTRY: array of descriptors {key,label,domain,get,sortAccessor?,format,bbHeader?,csvHeader?,isCoordCol?,coordGet?,thresholds?,featureFlag?,defaultVisible,sortable?,filterable?,toggleable?,headerImg?} covering identity (name/coords/continent/points/rank), troops (units+off/def/isNuke/hasNoble), economy (whFillPct/wood/clay/iron/whCap/prodPerH/timeToFull/merchants/hideCap), buildings (HQ/wall/smithy/farm/warehouse/academy/rally/market/barracks/stable/workshop/watchtower/church + derived flags), incomings (incCount/soonest/nukesEst/fakesEst/noblesEst/underDefended/defPower/nearestSource), map (distFront/nearestEnemy/bonus). format uses local jQuery-free formatNum/parseIntSafe.
  1. Implement getColumn, columnsForDomain, gateColumnsByWorld (no-flag keeps; undefined world value keeps), resolveVisibleColumns (saved order, drop unknown, defaultVisible fallback). All pure fail-safe.
  1. Run npm test -> T18 GREEN.
- **Verify:** `npm test`
- **Commit:** `feat(overview-core): COLUMN_REGISTRY + getColumn/columnsForDomain/gate/resolveVisible

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T21 — GREEN: buildMasterModel + cacheKeyFor + CACHE_TTL_MS + detectPremium + aggregateIncomingsByTarget placeholder  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/lib/tw-overview-core.js`
- **Depends on:** T19, T20
- **Steps:**
  1. buildMasterModel(domains, villageIndex): a Map by id over the UNION of domain keys and villageIndex.byId keys; shallow-merge per-domain rows; pull x/y/name/owner/points/rank/bonusId from byId; coords+continent only when finite; derive state pill flags via computeDerivedFlags precedence (incomingNuke when nukeEst>0, underDefended when underDefended&&incCount>0, whNearFull when whFillPct>=90); never throw; [] for non-object.
  1. cacheKeyFor(domain,gid,worldKey) returns UNPREFIXED `${domain}_${worldKey}_g${gid}` (Store adds two_, Storage adds twt_). CACHE_TTL_MS = {incomings:120000, troops:300000, econ:900000, buildings:900000, map:3600000}.
  1. detectPremium(probeHtml, mode): jQuery-free string+regex scan -> {available, reason}; empty -> {available:false}. aggregateIncomingsByTarget(rows) placeholder returning {} (real impl lives behind parseIncoming target extension in M6; buildMasterModel tolerates empty incomings).
  1. Run npm test -> T19 GREEN. Run npm run build:overview.
- **Verify:** `npm test && npm run build:overview`
- **Commit:** `feat(overview-core): buildMasterModel JOIN + cacheKeyFor/TTL + premium detect

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T22 — Wire Fetch-All orchestrator + per-domain caching + premium degrade (partial — fetch spine)  `[wire]`
- **Files:** `/Users/denispaulik/git/tw-tools/scripts/tw-overview.js`
- **Depends on:** T21
- **Steps:**
  1. Replace CACHE_TTL (tw-overview.js:37) with CACHE_TTL_MS = TWTools.OverviewCore.CACHE_TTL_MS and a troopsTtl alias; update fetchTroopData's Store.setCache (tw-overview.js:372) to troopsTtl. Compute currentWorldKey from a sanitized location.host; add module-level masterRows=[] and domainData={}.
  1. Add module-level var fetchLock=false and replace ALL isFetching reads/writes (tw-overview.js:285,327,332,351,371,378,1022) with fetchLock; release in BOTH success AND error branches of every $.ajax.
  1. Add per-domain fetchers (troops reuses fetchTroopData; econ/buildings/incomings/map call OverviewCore parsers + tw-core fetchers). Each: early-return if fetchLock (toast 'Fetch in progress'); read/write its OWN cacheKeyFor key with the domain's CACHE_TTL_MS; release fetchLock in success+error. READ-ONLY GET overview_villages with a mode param only (mode=prod / mode=buildings / mode=incomings&subtype=attacks) + map/village.txt/player.txt/ally.txt; no POST.
  1. Implement runFetchAll(domains,onProgress,onDone) as a callback-chained recursive step(i): call fetcher[domains[i]] then setTimeout(()=>step(i+1), REQUEST_DELAY=200); guard the whole run with fetchLock; on last domain buildVillageIndex then masterRows=OverviewCore.buildMasterModel(domainData, idx); onDone(masterRows); onProgress->card.setStatus.
  1. Premium: probe GET mode=prod; detectPremium; if unavailable degradeEconToGameData (fill econ for the open village from game_data.village) + note + SKIP the multi-village econ fetch; same for buildings. Route troops splitByCategory output (deduped) into domainData.troops; domainData.incomings = aggregateIncomingsByTarget placeholder ([]).
  1. Run node build.js --only=tw-overview && npm test.
- **Verify:** `node build.js --only=tw-overview && npm test`
- **Commit:** `feat(overview): sequential single-lock Fetch-All + per-domain TTL cache + premium degrade

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`


### M4 — Generic table engine

_Build the reusable declarative-registry table engine: pure helpers (filters/counts/multi-sort/projection/export/pills/virtual-window) test-first, then the node-safe DOM render layer (sticky thead, virtualized tbody, chips, multi-sort, export of current view) and its bundle wiring._

#### T23 — RED: tw-table pure-helper specs + model/column fixture  `[test]`
- **Files:** `/Users/denispaulik/git/tw-tools/tests/unit/fixtures/table-model.sample.js`, `/Users/denispaulik/git/tw-tools/tests/unit/tw-table.pure.test.js`
- **Depends on:** T03
- **Steps:**
  1. Create tests/unit/fixtures/table-model.sample.js (module.exports) with MODEL (~6 rows {id,name,x,y,coord,points,rank,whFillPct,prodTotal,defPower,incomings,nukesEst, underDefended/whNearFull/incomingNuke booleans mixed}) and COLUMNS (coord descriptor {key:'coord',isCoordCol:true,get,coordGet,bbHeader,csvHeader,defaultVisible:true}; name; numeric points with thresholds:[{label:'>5k',op:'gte',value:5000}]; flag underDefended defaultVisible:false). No HTML/jQuery.
  1. Create tests/unit/tw-table.pure.test.js: const Table=require('../../lib/tw-table.js'); reference Table.pure.* (require throws MODULE_NOT_FOUND = RED). One test per behavior: applyFilters gte/lte/eq/flag/search + unknown-op passthrough + empty passthrough; computeFilterCounts keyed 'key|op|value' = applyFilters(rows,[chip],columns).length; applyMultiSort tiebreak + returns-copy (MODEL unchanged) + asc/desc + string-vs-numeric; toggleSortKey replace/toggle-sole/append-additive/toggle-existing + not-mutated; projectVisible registry-order + defaultVisible!==false fallback + ignores unknown; resolvePillClasses priority nuke>underdef>whfull + accent + none; buildBBCode coord->[coord]x|y[/coord] + bbHeader order + empty-view; buildCSV escaping-only-when-needed + raw numbers + coord raw; formatCellForExport null->'' + number raw (no separators) + coord branch; computeVirtualWindow total=0 / scrollTop=0 / beyond-content / exact-fit / overscan.
  1. Run npm test — CONFIRM MODULE_NOT_FOUND for ../../lib/tw-table.js (RED).
- **Verify:** `npm test`
- **Commit:** `test(overview): RED specs + fixtures for tw-table pure helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T24 — GREEN: lib/tw-table.js pure core (node-safe IIFE, non-throwing guard)  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/lib/tw-table.js`
- **Depends on:** T23
- **Steps:**
  1. Create lib/tw-table.js with the T05 envelope. NODE-SAFE NON-THROWING guard (do NOT copy tw-ui/tw-commands throw-if-!TWTools — it crashes node:test): var TWTools=(root&&root.TWTools)||{}; if(typeof window!=='undefined'&&window.document){window.TWTools=TWTools;} (attach to a real browser window only).
  1. Implement ALL pure helpers per the spec with ZERO DOM/jQuery/window access, fail-safe everywhere. applyMultiSort = decorate-with-index/sort/undecorate (stable). buildBBCode/buildCSV iterate visibleCols via formatCellForExport (coord cols [coord]x|y[/coord] in BB, raw x|y in CSV). formatCellForExport MUST NOT call descriptor.format (export stays raw; display formatting is DOM-only).
  1. Expose TWTools.Table.pure = {applyFilters,computeFilterCounts,applyMultiSort,toggleSortKey,projectVisible,resolvePillClasses,buildBBCode,buildCSV,formatCellForExport,computeVirtualWindow}; add the typeof-guarded module.exports tail = TWTools.Table; close with the node-safe call site.
  1. Run npm test until all T23 specs pass (GREEN).
- **Verify:** `npm test`
- **Commit:** `feat(overview): tw-table pure core — filters, counts, multi-sort, projection, export, pills, virtual-window

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T25 — DOM layer: render(), sticky thead, virtualized tbody, idempotent styles, row pills  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/lib/tw-table.js`
- **Depends on:** T24
- **Steps:**
  1. Add inline escapeHtml(str) (the &/</>/double-quote replacer — NOT TWTools.escapeHtml, it does not exist) and inline copyText(text) (navigator.clipboard with textarea+execCommand fallback — NOT TWTools.copyToClipboard). toast uses TWTools.UI&&TWTools.UI.toast when present, else no-op.
  1. _injectStyles() guarded by document.getElementById('twt-table-styles'). Parchment palette (#f4e4bc/#e8d8a8, text #3e2e14); table.twt-grid thead th sticky top:0 z-index:2; THREE pill classes scoped under table.twt-grid (.twt-row-nuke rgba(128,0,128,.10), .twt-row-underdef rgba(200,0,0,.10), .twt-row-whfull rgba(200,140,0,.12)); accent = inline box-shadow:inset 3px 0 0 <accent> from resolvePillClasses.
  1. render(container,model,opts): if !$ (node) return a no-op controller {update,setSort,setFilters,setVisible,getViewRows:()=>[],exportBBCode:()=>'',exportCSV:()=>'',destroy,element:null}. Else resolve container; _injectStyles(); id='twt-table-'+opts.id; REMOVE existing same-id root + $(document).off('.twtbl_'+opts.id); build wrap+toolbar+viewport+grid. State: visibleCols=projectVisible(opts.columns,opts.visibleColumns); sort=opts.sort||[]; filters=opts.filters||[]; pipeline viewRows=applyMultiSort(applyFilters(model,filters,columns),sort,columns).
  1. _buildHeader: th[data-col=key] content = descriptor.headerImg?<img>:escapeHtml(label) (NEVER index) + sort-rank/arrow badge. _buildBody: virtualize when viewRows.length>150 via computeVirtualWindow slice + top/bottom spacer tr with explicit heights (NOT translateY, to preserve sticky); each tr resolvePillClasses + inline accent; each td descriptor.format?format(get(row),row):escapeHtml(String(get(row))); coord cols render a TW link via coordGet (DOM-only). Namespaced rAF-throttled viewport scroll handler repaints only the tbody slice.
  1. update/setSort/setFilters/setVisible patch state + repaint and DO NOT fire callbacks (user-gesture-only, T26). Run npm test — pure tests STILL GREEN (DOM untested by design).
- **Verify:** `npm test`
- **Commit:** `feat(overview): tw-table DOM render — sticky thead, virtualized tbody, idempotent styles + pills

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T26 — Interaction layer: column-toggle + filter chips with counts, multi-sort clicks, export buttons  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/lib/tw-table.js`
- **Depends on:** T25
- **Steps:**
  1. _buildToolbar(): column-toggle chips (per col where toggleable!==false; .active when in visibleCols) + threshold filter chips from descriptor.thresholds[] -> ActiveFilter{key,op,value,label} each showing live count from computeFilterCounts + Export BBCode / Export CSV buttons.
  1. Single namespaced delegation set .twtbl_<id> on the wrap root (established ONCE in render): chip[data-toggle-col] -> flip key -> visibleCols=projectVisible(columns,newKeys) -> repaint -> opts.onVisibleChange. chip[data-filter-id] -> add/remove ActiveFilter (AND) -> repaint+refresh counts -> opts.onFilterChange. thead th[data-col] (sortable!==false) click -> sort=toggleSortKey(sort,key,e.shiftKey) -> repaint -> opts.onSortChange. Callbacks fire ONLY here.
  1. Export buttons: BBCode->buildBBCode(getViewRows(),visibleCols,{title:opts.title}); CSV->buildCSV(getViewRows(),visibleCols); copy via inline copyText; toast when TWTools.UI.toast present. controller.exportBBCode/exportCSV return strings. Every repaint idempotent (rebuild toolbar+thead+tbody from state; delegation established once).
  1. Run npm test — pure tests back toggleSortKey/applyFilters/computeFilterCounts/buildBBCode/buildCSV; GREEN.
- **Verify:** `npm test`
- **Commit:** `feat(overview): tw-table interactions — toggle/filter chips with counts, multi-sort, export of current view

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T27 — Verify M4: tw-table bundled + node export surface intact  `[test]`
- **Files:** `/Users/denispaulik/git/tw-tools/lib/tw-table.js`
- **Depends on:** T26
- **Steps:**
  1. Run npm run build:overview; confirm the SUMMARY 'Libs:' line now lists tw-table.js and dist/tw-overview.min.js regenerates with no terser error.
  1. Run npm test (pure suite GREEN after wiring).
  1. Smoke the node export surface: node -e "const T=require('./lib/tw-table.js'); console.log(Object.keys(T.pure).sort().join(','))" — confirm all 10 pure helper names print (require() standalone + node-safe call site + module.exports tail intact).
- **Verify:** `npm run build:overview && npm test && node -e "const T=require('./lib/tw-table.js'); if(Object.keys(T.pure).length<10)process.exit(1)"`
- **Commit:** `chore(overview): verify tw-table bundled + node export surface

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`


### M5 — Versioned config + saved view presets + migration

_Migrate flat two_* settings to ONE versioned twt_two_config blob (test-first pure lib), seed 5 view presets with CRUD + import/export, and wire the orchestrator to load/persist via the store adapter. Two-tier persistence (config vs TTL caches)._

#### T28 — RED: versioned config + migration + presets specs (fakeStore)  `[test]`
- **Files:** `/Users/denispaulik/git/tw-tools/tests/unit/tw-config-core.test.js`
- **Depends on:** T03
- **Steps:**
  1. At top set global.window={}; require('../../lib/tw-config-core.js'); const TWConfig=global.window.TWTools.Config (lib must NOT reference jQuery/localStorage/document at load -> require must not throw). Build fakeStore {map:{}, get(k){return this.map[k]!==undefined?this.map[k]:null;}, set(k,v){this.map[k]=v;}, remove(k){delete this.map[k];}}.
  1. mergeDefaults(null) deepEquals DEFAULT_CONFIG (cfgVersion=2); mergeDefaults({thresholds:{nukeThreshold:7000}}) keeps whNearFullPct=90 and stamps cfgVersion=2. migrateConfig(null) -> cfgVersion=2, views.length===5; migrateConfig('garbage') and migrateConfig({cfgVersion:'x'}) return valid v2 WITHOUT throwing; migrateConfig({cfgVersion:2, views:[userView]}) preserves the user view and re-seeds to >=5. migrate_v1_to_v2({settings:{includeArchers:true,nukeThreshold:7000,exportFormat:'csv'},viewType:'outside',groupId:'42'}) -> ui.includeArchers/exportFormat/viewType/groupId + thresholds.nukeThreshold=7000.
  1. seedViews idempotent (length 5); a {name:'Mine'} survives; an edited seed (same name) NOT overwritten. saveView upsert by name; deleteView; renameView collision returns config unchanged; renameView happy-path; exportViews->importViews round-trip count; importViews(config,'not json') returns config unchanged. intOr/clampInt/swapIfInverted. deepMerge sibling-safety + array-replace-wholesale. load/save/patch: load(empty fakeStore) returns stamped v2 AND persists; load with only legacy keys migrates; two sequential patches preserve siblings.
  1. Run npm test -> RED (lib absent).
- **Verify:** `npm test`
- **Commit:** `test(overview): RED specs for versioned config, migration, presets

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T29 — GREEN: tw-config-core base — schema, DEFAULT_CONFIG, deepMerge, mergeDefaults, coercion  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/lib/tw-config-core.js`
- **Depends on:** T28
- **Steps:**
  1. Create lib/tw-config-core.js with the T05 envelope (take root, reference NO jQuery/localStorage/document at load). CONFIG_VERSION=2, CONFIG_KEY='config' (NOT 'twov_config' — local Store adds two_, tw-core adds twt_, real key twt_two_config).
  1. DEFAULT_CONFIG = {cfgVersion:2, thresholds:{nukeThreshold:5000, whNearFullPct:90, distFrontMax:25}, ui:{includeArchers:false, exportFormat:'bbcode', viewType:'own_home', groupId:'0', activeTab:'troops', theme:'parchment'}, columns:{visible:['name','total'], order:[]}, filters:[], sort:{key:'name',dir:'asc'}, views:[] (backfilled in T31)}.
  1. deepMerge(base,patch): null/undefined patch -> deep clone base; plain objects recurse; arrays+primitives REPLACE wholesale. mergeDefaults(partial,defaults): non-plain-object -> deepClone(d) stamped; else deepMerge(deepClone(d),partial) + cfgVersion stamp. intOr/clampInt/swapIfInverted.
  1. Attach existing.Config = existing.Config || {...} (first-loaded-wins, matching tw-core.js:1034). Add the typeof-guarded module.exports tail. Run npm test — mergeDefaults/deepMerge/coercion groups GREEN; migration/preset/load still red.
- **Verify:** `npm test`
- **Commit:** `feat(overview): tw-config-core base (schema, defaults, deepMerge, coercion)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T30 — GREEN: migration logic (migrate_v1_to_v2, dated migrateConfig)  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/lib/tw-config-core.js`
- **Depends on:** T29
- **Steps:**
  1. migrate_v1_to_v2(legacy): guard non-object -> {}; s=legacy.settings||{}; return {ui:{includeArchers:!!s.includeArchers, exportFormat:(s.exportFormat==='csv'?'csv':'bbcode'), viewType:legacy.viewType||'own_home', groupId:legacy.groupId!=null?String(legacy.groupId):'0'}, thresholds:{nukeThreshold:intOr(s.nukeThreshold, DEFAULT_CONFIG.thresholds.nukeThreshold)}} (un-stamped partial).
  1. migrateConfig(raw, legacy): try/catch -> mergeDefaults(null) on throw. If raw plain object with numeric cfgVersion: ===CONFIG_VERSION -> finalize(mergeDefaults(raw)); <CONFIG_VERSION -> ordered step chain (currently mergeDefaults(raw); // v2->v3 slot). Else base=legacy!=null?migrate_v1_to_v2(legacy):null; finalize(mergeDefaults(base)). finalize(cfg): if raw.views is Array keep first; cfg.views=seedViews(cfg.views||[]); return cfg (never drop views).
  1. Add migrateConfig + migrate_v1_to_v2 to the attach object. Run npm test — migration groups GREEN.
- **Verify:** `npm test`
- **Commit:** `feat(overview): dated migrateConfig importing legacy two_ keys (fail-safe)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T31 — GREEN: seeded presets, CRUD, import/export, load/save/patch  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/lib/tw-config-core.js`
- **Depends on:** T30
- **Steps:**
  1. Define SEED_VIEWS = 5 entries {name, visibleColumns:[], filters:[{key,op,value}], sort:{key,dir}, group:'0', seed:true}: Front Nukes ([{key:'isNuke',op:'eq',value:true},{key:'distFront',op:'lte',value:25}], sort off desc); Eco low-WH ([{key:'whFillPct',op:'lte',value:60}], whFillPct asc); Defense Gaps ([{key:'underDefended',op:'eq',value:true}], defPower asc); Frontline ([{key:'distFront',op:'lte',value:25}], distFront asc); Full-offense-ready ([{key:'isNuke',op:'eq',value:true},{key:'snob',op:'gte',value:1}], total desc). Star label is UI-only; stored name has NO star. Wire DEFAULT_CONFIG.views to a deep clone of SEED_VIEWS. NOTE: filter/sort keys are inert DATA owned by COLUMN_REGISTRY; the table engine no-ops unknown/stale keys.
  1. seedViews(views): merge-by-name, clone seed only when no existing view shares the name (never overwrite user edits). saveView (upsert by name, seed forced false). deleteView (filter by name). renameView (return config UNCHANGED on collision/missing/no-op; else remap). exportViews=JSON.stringify(config.views); importViews(config,json): parse, merge-by-name, re-seed; return config UNCHANGED on parse error/non-array. applyView(config,name) -> patch {ui:{}, columns:{visible}, filters, sort} or null.
  1. load(store): raw=store.get('config'); legacy={settings:store.get('settings'), viewType:store.get('view_type'), groupId:store.get('group_id')}; cfg=migrateConfig(raw,legacy); save(store,cfg); return cfg (legacy keys NOT removed). save(store,config){store.set('config',config);return config;}. patch(store,partial){cur=mergeDefaults(store.get('config')); merged=deepMerge(cur,partial); merged.cfgVersion=CONFIG_VERSION; return save(store,merged);}.
  1. Add all to the attach object. Run npm test — full config suite GREEN.
- **Verify:** `npm test`
- **Commit:** `feat(overview): seed 5 view presets + CRUD, import/export, load/save/patch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T32 — Verify config-core bundled into overview build  `[test]`
- **Files:** `/Users/denispaulik/git/tw-tools/lib/tw-config-core.js`
- **Depends on:** T31
- **Steps:**
  1. Run npm run build:overview; confirm the SUMMARY 'Libs:' line lists tw-config-core.js and dist regenerates with no terser error.
  1. Verify the lib bundled: node -e "const s=require('fs').readFileSync('dist/tw-overview.min.js','utf8'); process.exit(/\.Config/.test(s)?0:1)" (.Config attach survives mangling — TWTools is in terser reserved).
  1. Run npm test (config suite still GREEN).
- **Verify:** `npm run build:overview && node -e "const s=require('fs').readFileSync('dist/tw-overview.min.js','utf8');process.exit(/\.Config/.test(s)?0:1)"`
- **Commit:** `chore(overview): verify tw-config-core bundled

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T33 — Wire orchestrator to load/persist via TWConfig + store adapter  `[wire]`
- **Files:** `/Users/denispaulik/git/tw-tools/scripts/tw-overview.js`
- **Depends on:** T22, T32
- **Steps:**
  1. Extend the guard at tw-overview.js:22-24 to also require window.TWTools.Config. Add var TWConfig=TWTools.Config; and var config=null.
  1. Add a localStore adapter bound to the existing Store so TWConfig uses the SAME two_ path: var localStore={get:function(k){return Store.get(k,null);}, set:function(k,v){Store.set(k,v);}, remove:function(k){TWTools.Storage.remove(STORAGE_PREFIX+k);}}; (do NOT call TWTools.Storage directly, or the twt_two_ double-prefix is lost).
  1. Rewrite loadSettings() (tw-overview.js:176): config=TWConfig.load(localStore); settings={includeArchers:config.ui.includeArchers, nukeThreshold:config.thresholds.nukeThreshold, exportFormat:config.ui.exportFormat}; currentViewType=config.ui.viewType||'own_home'; currentGroupId=config.ui.groupId||'0' (keep the settings shim so calculateArmySummary/getActiveUnits/splitIntoCategories keep working). Rewrite saveSettings() (tw-overview.js:190) to config=TWConfig.patch(localStore,{ui:{includeArchers,exportFormat}, thresholds:{nukeThreshold}}).
  1. Replace Store.set('view_type',...) (tw-overview.js:1011) with config=TWConfig.patch(localStore,{ui:{viewType:currentViewType}}); and Store.set('group_id',...) (tw-overview.js:1024) with config=TWConfig.patch(localStore,{ui:{groupId:currentGroupId}}). Leave per-domain TTL cache calls untouched (separate tier).
  1. Run npm run build:overview cleanly.
- **Verify:** `npm run build:overview`
- **Commit:** `refactor(overview): load and persist via versioned twt_two_config

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`


### M6 — Entry orchestrator, 8 tabs, Commands upgrades, tech-debt

_Strip extracted logic from the entry file, assemble the 8-tab Dashboard+domains UI with lazy render, upgrade the Commands tab (multi-sort/live countdown/export/ESTIMATE tags), extend tw-commands.parseIncoming to emit target, and apply the three tech-debt fixes (test-first on their pure seams)._

#### T34 — RED: pure seams for the three tech-debt fixes (classifyNukeFlag, collectOverviewCacheKeys, recomputeBucketsNuke)  `[test]`
- **Files:** `/Users/denispaulik/git/tw-tools/tests/unit/overview-techdebt.test.js`
- **Depends on:** T13
- **Steps:**
  1. Create tests/unit/overview-techdebt.test.js: const {classifyNukeFlag, collectOverviewCacheKeys, recomputeBucketsNuke}=require('../../lib/tw-overview-core.js').
  1. classifyNukeFlag({axe:3000,light:2000},{nukeThreshold:5000,includeArchers:false})===true; ({axe:1000,light:1000},...)===false; includeArchers:true with {axe:3000,marcher:2500,light:0} counts marcher (true) but false with includeArchers:false (mirrors offCount=axe+light(+marcher)>=threshold).
  1. collectOverviewCacheKeys('two_',['0','1']) returns EXACTLY [two_troop_all_g0, two_troop_all_g1, two_command_data, two_econ_g0, two_econ_g1, two_buildings_g0, two_buildings_g1, two_incomings_g0, two_incomings_g1, two_map_villages, two_map_players] and NEVER any /two_troop_data_/ key (order-independent, sort both sides).
  1. recomputeBucketsNuke(allTroopData, settings) sets isNuke on EVERY one of the 5 buckets (own_home,in_village,outside,in_transit,own_all); seed each bucket with one over + one under threshold; assert every bucket flagged; missing bucket -> skipped, never throws.
  1. Run npm test -> RED (helpers not yet in lib).
- **Verify:** `npm test`
- **Commit:** `test(overview): RED node:test for nuke-classifier, cache-key set, all-bucket recompute

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T35 — GREEN: tech-debt pure seams in tw-overview-core.js  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/lib/tw-overview-core.js`
- **Depends on:** T34
- **Steps:**
  1. classifyNukeFlag(units, settings): offCount = (units.axe||0)+(units.light||0)+(settings.includeArchers?(units.marcher||0):0); return offCount >= settings.nukeThreshold. Pure.
  1. collectOverviewCacheKeys(prefix, groupIds): for each gid push prefix+'troop_all_g'+gid, prefix+'econ_g'+gid, prefix+'buildings_g'+gid, prefix+'incomings_g'+gid; plus prefix+'command_data', prefix+'map_villages', prefix+'map_players'. Returns the de-duped array; NEVER a troop_data_* key. Pure.
  1. recomputeBucketsNuke(allTroopData, settings): for each of the 5 bucket keys, if Array, set row.isNuke=classifyNukeFlag(row.units||row, settings) for each row; tolerate missing bucket; return allTroopData. Pure (mutate-in-place by contract).
  1. Add to the OverviewCore API + module.exports. Run npm test -> T34 GREEN.
- **Verify:** `npm test`
- **Commit:** `feat(overview-core): pure seams classifyNukeFlag/collectOverviewCacheKeys/recomputeBucketsNuke

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T36 — Tech-debt fixes 1+2+3 in the entry file (VERSION, Clear-Cache, recalculateNukeStatus)  `[fix]`
- **Files:** `/Users/denispaulik/git/tw-tools/scripts/tw-overview.js`
- **Depends on:** T33, T35
- **Steps:**
  1. FIX 1 (VERSION): edit header banner line 2 'TW Troop Overview v1.0.0'->'v2.0.0'; JSDoc line 12 '@version 1.1.0'->'2.0.0'; line 32 VERSION='1.1.0'->'2.0.0'. grep the file for 1\.0\.0 / 1\.1\.0 to confirm no hardcoded literal remains (toast line ~1678 and Settings box line ~1394 interpolate VERSION).
  1. FIX 2 (Clear-Cache): add clearAllCaches() building groupIds from availableGroups (.id) + '0', var keys=TWTools.OverviewCore.collectOverviewCacheKeys(STORAGE_PREFIX, groupIds); keys.forEach(k=>TWTools.Storage.remove(k)). Replace the Clear-Cache click body (tw-overview.js:1417-1426 — the never-written troop_data_<view> loop at line 1420) with clearAllCaches(); reset allTroopData={}; troopData=[]; commandData=[]; masterRows=[]; toast 'Cache cleared'; keep config key (STORAGE_PREFIX+'config') intact.
  1. FIX 3 (recalculateNukeStatus): rewrite tw-overview.js:1432-1441 to TWTools.OverviewCore.recomputeBucketsNuke(allTroopData, settings); also re-flag masterRows (row.isNuke=classifyNukeFlag(row.units, settings)); then troopData=allTroopData[currentViewType]||[]. Remove the redundant inline offCount loop. Confirm both existing call sites (Save Settings line 1411, init hydrate line 1655/1647) remain valid.
  1. Run npm test (seams GREEN) && npm run build:overview; grep dist for 2.0.0 present and two_troop_data_ ABSENT.
- **Verify:** `npm test && npm run build:overview`
- **Commit:** `fix(overview): VERSION->2.0.0, Clear-Cache real keys, recalc nuke across all 5 buckets+master

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T37 — Extend tw-commands.parseIncoming to emit the TARGET village + real aggregateIncomingsByTarget  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/lib/tw-commands.js`, `/Users/denispaulik/git/tw-tools/lib/tw-overview-core.js`, `/Users/denispaulik/git/tw-tools/tests/unit/overview-master-model.test.js`
- **Depends on:** T16, T21, T36
- **Steps:**
  1. In lib/tw-commands.js parseIncoming (line 168) add the TARGET village to each emitted command object (target village id + coords from the info_village link / target column), preserving the existing source/origin/arrival fields and the CMD_TYPE vocabulary. Browser-only (jQuery DOM) — not node-tested directly.
  1. Implement the real OverviewCore.aggregateIncomingsByTarget(rows): pure reduce of per-command rows (each carrying target id) into {targetId:{incCount, soonestArrivalMs, nukesEst, fakesEst, noblesEst, sources:[...]}} using classifyTrainKind over groupIntoTrains-shaped input. Fail-safe ({} on bad input). Extend overview-master-model.test.js with a target-aggregation spec.
  1. Update the orchestrator (T22's incomings fetcher) to feed parseIncoming target output through aggregateIncomingsByTarget into domainData.incomings.
  1. Run npm test (GREEN) && npm run build:overview && npm run build:snipe (snipe bundles tw-commands — backward-compat smoke).
- **Verify:** `npm test && npm run build:overview && npm run build:snipe`
- **Commit:** `feat(overview): parseIncoming emits target + pure aggregateIncomingsByTarget

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T38 — Thin the entry file: strip extracted pure logic, delegate to OverviewCore  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/scripts/tw-overview.js`
- **Depends on:** T36, T37
- **Steps:**
  1. Remove the now-extracted pure functions from scripts/tw-overview.js and the duplicate constant tables (parseCompleteOverview:395, splitIntoCategories:529, parseUnitHeaders:583, sortTroopData:853, parseIntSafe:906, formatNum:896, escapeHtml:917, extractCoords:755, and the unit constants at 47-82). Replace all call sites with TWTools.OverviewCore.* (e.g. fetchTroopData -> OverviewCore.extractRowMatrix + parseOverviewTable + splitByCategory).
  1. Keep fetchTroopData itself (troops domain fetcher) and calculateArmySummary's caller path, delegating parsing/power to OverviewCore.calcArmyPower. Keep the LOCAL CMD_TYPE {attack,support,return,other} for the command-row type column (do NOT replace with tw-commands CMD_TYPE).
  1. Run npm run build:overview cleanly (entry now thin; guard at line 22 already extended in T33).
- **Verify:** `npm run build:overview`
- **Commit:** `refactor(overview): thin entry — delegate parse/dedup/sort/power to OverviewCore

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T39 — 8-tab createCard assembly with lazy per-tab render + Fetch-All button + ~1000x580 card  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/scripts/tw-overview.js`
- **Depends on:** T38
- **Steps:**
  1. Update createCard (tw-overview.js:1616-1641): title 'Village Overview', version VERSION (2.0.0), width:1000, height:580, minWidth:700, minHeight:360. Tabs: [dashboard,troops,economy,buildings,incomings,map,commands,settings].
  1. Add var renderedTabs={}. In onTabChange render a tab ONLY on first activation (renderedTabs flag). Routing: dashboard->renderDashboard($panel,masterRows) (full cross-domain column-toggle chips + saved-view preset picker, then TWTools.Table.render); troops/economy/buildings/incomings/map->renderDomainTab($panel,domain,masterRows) (applyPreset(domain) from COLUMN_REGISTRY over masterRows -> TWTools.Table.render); commands->renderCommands($panel,commandData); settings->renderSettings($panel).
  1. REMOVE the eager renderSettings(card.getTabContent('settings')) call (~line 1664) — Settings becomes lazy (the old eager call was a latent double-render). Route the initial troops render (line 1656/1659) through renderDomainTab('troops') and set renderedTabs.troops=true.
  1. Add a global 'Fetch All' toolbar button -> runFetchAll(['troops','economy','buildings','incomings','map'], onProgress->card.setStatus, onDone->function(m){masterRows=m; renderedTabs={}; re-render the active tab;}). Keep idempotent DOM injection (reuse #two-main if present; createCard handles position-persist).
  1. Run npm run build:overview cleanly.
- **Verify:** `npm run build:overview`
- **Commit:** `feat(overview): 8-tab Dashboard+domains assembly, lazy render, Fetch-All, 1000x580 card

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T40 — Commands tab upgrades + settings form binding + Views presets sub-panel  `[impl]`
- **Files:** `/Users/denispaulik/git/tw-tools/scripts/tw-overview.js`
- **Depends on:** T39
- **Steps:**
  1. renderCommands: multi-column sort via TWTools.OverviewCore.sortBy(rows,[{key,dir}]) persisted in config.commandsSort (keep LOCAL CMD_TYPE for the type column); live countdown column via a SINGLE setInterval re-rendering only countdown cells with TWTools.TimeSync.now() (track interval id; clear on tab-change-away + onClose); BBCode/CSV export of the current filtered+sorted view via the table engine; fake/nuke ESTIMATE 'EST' badge gated on get_config+get_unit_info loaded first, using TWTools.Commands.classifyUnit + groupIntoTrains + TWTools.distance (NEVER certainty). Keep the legacy mode=commands feed (key two_command_data) SEPARATE from the incomings radar (two_incomings_g*, 2m).
  1. renderSettings (tw-overview.js:1357): keep #two-set-archers/#two-set-nuke/#two-set-export; add #two-set-whfull (0-100, config.thresholds.whNearFullPct) and #two-set-front (1-200, config.thresholds.distFrontMax). Save handler binds via TWConfig.clampInt(TWConfig.intOr($val,fallback),min,max) then config=TWConfig.patch(localStore,{ui:{includeArchers,exportFormat}, thresholds:{nukeThreshold,whNearFullPct,distFrontMax}}); keep recalculateNukeStatus()+toast. Add a swapIfInverted hook comment for future min/max pairs. Show config.cfgVersion in the info box.
  1. Append a 'Saved Views' sub-section: select #two-view-preset (seeds shown with star label, value=stored name), Apply/Save/Delete/Rename buttons, Import textarea + Export. Namespaced idempotent handlers ($panel.off('.twviews').on('click.twviews',...)): Apply->TWConfig.applyView+patch+re-render; Save->TWConfig.saveView (columns/filters as fail-safe placeholders until full wiring)+save; Delete->TWConfig.deleteView; Rename->reference-equality collision toast; Import->TWConfig.importViews; Export->copyText(TWConfig.exportViews). Re-render the panel after each CRUD. Persist active tab in onTabChange via TWConfig.patch(localStore,{ui:{activeTab:tabId}}).
  1. Run npm run build:overview cleanly.
- **Verify:** `npm run build:overview`
- **Commit:** `feat(overview): Commands tab upgrades + settings binding + saved-view presets UI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`


### M7 — Polish, full-suite + cross-script regression, in-game E2E

_Final cross-script backward-compat build (every sibling bundle), full node:test pass, dist invariant checks (single bundle, per-file IIFE, no runtime require/import, version string), and the documented in-game smoke checklist (sequential >=200ms, single in-flight, per-domain cache reuse, premium degrade, presets persist)._

#### T41 — Full suite + ALL-script cross-regression build + dist invariants  `[test]`
- **Files:** `/Users/denispaulik/git/tw-tools/scripts/tw-overview.js`, `/Users/denispaulik/git/tw-tools/build.js`
- **Depends on:** T40
- **Steps:**
  1. Run npm test — all pure-lib specs GREEN (tw-core + overview-core + table + config + techdebt + master-model).
  1. Run a FULL npm run build (snipe/scavenge/clock/planner/overview/map-tools) — prove the modified shared tw-core.js/tw-commands.js/tw-map-tools.js did not break any sibling bundle; inspect summary for errors and that each dist/*.min.js regenerated.
  1. dist invariants on dist/tw-overview.min.js: grep version 2.0.0 PRESENT; two_troop_data_ ABSENT; runtime require(/import  ABSENT (only the typeof-guarded inert module.exports tails remain); browser tokens OverviewCore + Table + Config present; each lib stays its own IIFE (the bundle still parses via node --check). Paste terminal evidence.
- **Verify:** `npm test && npm run build && node --check dist/tw-overview.min.js && grep -q '2.0.0' dist/tw-overview.min.js && ! grep -q 'two_troop_data_' dist/tw-overview.min.js`
- **Commit:** `chore(overview): full suite + all-script regression build + dist invariants verified

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

#### T42 — In-game E2E smoke checklist (manual, per design §9)  `[test]`
- **Files:** `/Users/denispaulik/git/tw-tools/tasks/2026-06-23-tw-overview-ultimate/in-game-smoke-checklist.md`
- **Depends on:** T41
- **Steps:**
  1. Load dist/tw-overview.min.js via the existing premium quickbar entry (Overview -> 1dead12.github.io/tw-tools/dist/tw-overview.min.js?v=Date.now()).
  1. Verify: card opens ~1000x580, 8 tabs, lazy render (no fetch until a tab is opened or Fetch-All run). Run Fetch-All -> confirm SEQUENTIAL requests with >=200ms gaps + single in-flight (no overlap) via Network tab, progress bar advances, master JOINs and every tab re-renders.
  1. Verify per-domain cache reuse (second Fetch-All within TTL serves from cache; incomings refetch after 2m). Verify Premium degrade: on a non-premium probe, Economy/Buildings degrade to game_data current-village + note (tab not hidden). Verify columns map by header icon (archer/church/watchtower worlds), type=complete dedup (no double-count), 'stone'==clay in Economy, row pills (red/amber/purple), multi-sort (shift-click), filter chips with counts, BBCode/CSV export of current view, live Commands countdown, fake/nuke EST badges.
  1. Verify saved preset persists across reload (twt_two_config survives), Clear-Cache clears caches but keeps config. Record results in the checklist markdown; no completion claim without evidence.
- **Verify:** `node -e "if(!require('fs').existsSync('./tasks/2026-06-23-tw-overview-ultimate/in-game-smoke-checklist.md')) throw new Error('checklist missing'); console.log('ok');"`
- **Commit:** `docs(overview): in-game E2E smoke checklist + results

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`


## Risk table

| Risk | Mitigation |
|------|-----------|
| node:test cannot require() the browser IIFE libs (no module.exports; they reference window/jQuery). | Two-layer split + the node-compat envelope (T05): pure libs end with a typeof-guarded module.exports tail and reference NO bare window/$/document at top level; tw-core (browser-only) is exercised via the window/jQuery shim harness (tests/helpers/load-core.js). The tail survives terser but is INERT in-browser (typeof module==='undefined'). |
| The test command form: 'node --test tests/unit/' FAILS on node v24 (treats the dir as a module entry). | Use the GLOB form 'node --test "tests/unit/**/*.test.js"' (verified working; also scopes out tests/e2e Playwright specs). The smoke specs are { skip: !fs.existsSync(LIB) }-guarded so the harness lands GREEN before the libs exist. |
| SCRIPT_LIBS['tw-overview.js'] is co-edited by three subsystems — independent writes (last-write-wins) silently drop libs. | Written exactly ONCE in T01 as the canonical six-element array ['tw-core.js','tw-ui.js','tw-commands.js','tw-overview-core.js','tw-config-core.js','tw-table.js']; readFileOrNull skips not-yet-created libs so early registration is safe; T17/T27/T32 each assert their lib appears in the build 'Libs:' line. |
| Cache-key double-prefix (Store adds two_, Storage adds twt_) -> twt_two_two_* misses if a lib re-prefixes. | cacheKeyFor + CONFIG_KEY are UNPREFIXED bare keys; all access goes through the prefixed Store/localStore adapter; T19/T28 assert UNPREFIXED keys and the real twt_two_config target. |
| village.txt col 6 is bonus_id, NOT rank — naively reading it as rank corrupts the model. | parseVillagesTxt keeps bonusId; player rank comes from player.txt index 5 JOINed via owner in buildVillageIndex (MasterRow.rank undefined until Map domain supplies players, tolerated). Asserted in T06/T08. |
| Columns shift across worlds (archer/church/watchtower); hardcoded indices break. | buildColumnMap maps by header img src/class via headerIconRegex + aliasMap (stone->clay), never indices; T12 includes a shuffled-header fixture variant proving position-independence; world-config gating hides absent feature cols. |
| type=complete renders 5 rows per village -> double counting. | dedupById (keep:'first') + splitByCategory per-bucket id dedup, ported from splitIntoCategories; T12 asserts dedup explicitly; fixtures include a duplicate 5-row village. |
| Fetch-All could overlap requests or wedge the lock on error (read-only/rate-safe violation). | Single fetchLock released in BOTH success AND error branches of every $.ajax; runFetchAll is a callback-chained stepper with setTimeout(200) gaps (NOT Promise.all); audited per-fetcher in T22. The pure libs/table do no network I/O. |
| Premium feature-detect false-negative hides Economy/Buildings even when available. | detectPremium degrades to game_data current-village + a visible note rather than hard-hiding the tab; Fetch-All can retry; degrade path tested in T19 (detectPremium) and verified in-game (T42). |
| Fake/nuke is an estimate; mislabeling could mislead. | estimateAttackUnits returns {unit,isNoble,confidence} (per-command, no isNuke); classifyTrainKind is train-level; always labeled ESTIMATE with a confidence, gated on get_config+get_unit_info; tests assert structure + dist<=0 no-throw, not ground truth. |
| distance-to-front O(own×all) freeze on large maps. | nearestEnemy/distanceToFront bucket enemies by continent (3x3 neighborhood first, widen when empty); T15 asserts the globally-nearest result is still correct. |
| Changing shared tw-core.js/tw-commands.js/tw-map-tools.js could break sibling bundles (snipe/planner/scavenge/clock/map-tools). | Additive-only changes (bonusId, new fetchers, getContinent delegation); identical callback signatures + cache keys; per-script smoke builds (build:snipe at T08/T37, build:map-tools at T09) and a FULL npm run build cross-regression gate at T41. |
| Live Commands countdown setInterval leaks timers / re-renders a hidden panel. | Module-level interval id, cleared on tab-change-away from Commands AND on card close (T40). |
| Building uncommitted WIP could be accidentally reverted. | All edits are additive on top of the WIP (fetchGroups forceRefresh + 2m TTL preserved); branch before execution per design §8; no file is rewritten wholesale where the WIP lives. |
| localStorage ~5MB quota shared across all tw-tools scripts. | Map cache stores only trimmed cols (id,name,x,y,owner,points,bonusId); keys namespaced with worldKey; Storage.set swallows quota errors (non-fatal — session still works in-memory). |

## Build & verify procedure

PURE-LIB UNIT TESTS (node v24.12 native, no deps): `npm test` runs `node --test \"tests/unit/**/*.test.js\"` over tests/unit/**; covers tw-core parsers, overview-core (parseLocaleNumber, parseOverviewTable 4 domains via the dependency-free html-to-rowmatrix tokenizer, dedup/split, flags, army power, predicates, multi-sort, geo, ESTIMATE, COLUMN_REGISTRY, buildMasterModel, cacheKeyFor/TTL, detectPremium, the 3 tech-debt seams), tw-table pure helpers, and tw-config-core (migration/presets/load/save/patch via a fakeStore). `npm run test:watch` for the RED->GREEN loop. The bundled lib source IS the tested source (typeof-guarded module.exports tails). BUILD (single self-contained bundle): `npm run build:overview` => `node build.js --only=tw-overview` concatenates the six libs IN ORDER (tw-core, tw-ui, tw-commands, tw-overview-core, tw-config-core, tw-table) + scripts/tw-overview.js, wraps in ONE outer IIFE, terser-minifies (reserved covers $/jQuery/TWTools/game_data) => dist/tw-overview.min.js + dist/tw-overview.quickbar.js ($.getScript wrapper). Stays GREEN even before the new libs exist (readFileOrNull skips them). DIST INVARIANTS (T41): `node --check dist/tw-overview.min.js` parses; `grep -q '2.0.0'` present; `! grep -q 'two_troop_data_'` (no-op key removed); no runtime `require(`/`import ` (only inert typeof-guarded tails); browser tokens OverviewCore + Table + Config present. CROSS-SCRIPT REGRESSION: `npm run build` rebuilds every sibling bundle to prove the shared-lib edits did not break snipe/planner/scavenge/clock/map-tools; cheap per-script smoke builds (build:snipe, build:map-tools) run earlier to localize breakage. IN-GAME E2E (manual, design §9, T42): load via the premium quickbar (Overview -> 1dead12.github.io/tw-tools/dist/tw-overview.min.js?v=Date.now()); verify 8-tab lazy render, Fetch-All SEQUENTIAL with >=200ms gaps + single in-flight (Network tab), per-domain cache reuse + TTL (incomings 2m vs troops 5m), Premium degrade-with-note, header-icon column mapping, type=complete dedup, stone==clay, row pills, multi-sort, filter chips with counts, BBCode/CSV export of current view, live countdown, fake/nuke EST badges, preset persistence across reload, Clear-Cache keeps config. Existing Playwright suite in tests/e2e/ runs separately (excluded from the node:test glob). Every completion claim requires pasted terminal/Network evidence.

## Open issues (need your input)

- FIXTURE CAPTURE (T04) requires a logged-in Premium world session to save raw View-Source response bodies for mode=complete/prod/buildings/incomings and small map .txt slices. Please confirm which world/market (worldKey) to capture from, or provide saved HTML so the column-mapping/dedup specs run against real DOM rather than hand-crafted approximations.
- SEED PRESET filter/sort keys (distFront, whFillPct, underDefended, off, defPower, snob) must exactly match the final COLUMN_REGISTRY key ids. They are stored as inert DATA and the table engine no-ops unknown keys, but please confirm the canonical key names (e.g. 'distFront' vs 'distance_to_front', 'whFillPct' vs 'wh_fill') so presets are immediately functional.
- CARD DEFAULT SIZE ~1000x580 (min 700x360) may exceed small/mobile viewports. The design defaults it; confirm acceptable, or whether a smaller mobile default is wanted (tw-core already injects mobile-responsive .twt-card CSS).
- DEFERRED post-v1 per design §10: conquests-feed-near-front, activity/last-growth heuristic, combined-tab advanced analytics, per-village tags/notes. Confirm these stay out of scope for this plan (currently excluded).
- BRANCH NAME: design §8 says branch before execution and build ON the uncommitted WIP (do not revert). Confirm the feature branch name (suggest feat/tw-overview-ultimate) and that committing/pushing should wait for your explicit go (per repo git policy).

## Adversarial review — issues caught & fixed

- Broken test command fixed across all sections: 'node --test tests/unit/' fails on node v24; standardized to the GLOB form 'node --test "tests/unit/**/*.test.js"' (verified), which also excludes tests/e2e Playwright specs.
- Red-commit / inverted-dependency fixed: the build+test harness (T01-T03) is the FOUNDATION (dependsOn []), landing GREEN via { skip: !fs.existsSync(LIB) } guards before the new libs exist, instead of committing specs that hard-require not-yet-created libs and leaving npm test RED.
- Incorrect terser claim fixed: terser does NOT dead-strip the typeof-guarded module.exports tail (free identifier 'module' is unprovable at bundle scope); it SURVIVES but is INERT in-browser. Build verification asserts the BROWSER token (OverviewCore/Table/Config) is present, NOT that module.exports is absent.
- village.txt col 6 wrong-field bug fixed: col 6 is bonus_id, NOT rank (confirmed vs tw-map-tools); parseVillagesTxt keeps bonusId and player rank is JOINed from player.txt index 5 via owner in buildVillageIndex.
- Cache double-prefix bug fixed: Store(two_)+Storage(twt_) means cacheKeyFor/CONFIG_KEY must return UNPREFIXED keys; the never-written two_troop_data_<view> key in the old Clear-Cache (tw-overview.js:1420) is replaced by collectOverviewCacheKeys returning the REAL two_troop_all_g*/two_command_data/per-domain keys (asserted to NEVER produce a troop_data_* key).
- Non-existent shared helpers caught: escapeHtml/copyToClipboard/exportBBCode/exportCSV are file-locals in scripts/tw-overview.js, NOT on TWTools (only TWTools.UI.toast exists); tw-table.js ships its OWN inline escapeHtml + clipboard fallback and only probes TWTools.UI.toast.
- Node-guard global-pollution fixed: tw-table.js uses a non-throwing guard and attaches to window only when window.document exists (avoids polluting globalThis under node, and avoids copying tw-ui/tw-commands' throw-if-!TWTools which crashes node:test).
- ESTIMATE modeling fixed: estimateAttackUnits returns {unit,isNoble,confidence} per-command (no isNuke); nuke/fake is train-level in classifyTrainKind. sortBy stability relies on documented stable Array.prototype.sort (no impossible internal index tiebreak in a bare comparator).
- getContinent formula pinned to Y-then-X ('K'+floor(y/100)+floor(x/100)) byte-identical to tw-map-tools.js:161, promoted to tw-core and mirrored in OverviewCore; the incomings labelMap ports ONLY the multi-lang token table (pure), not the jQuery $table code.
- Ownership/scope fixes: the node-compat envelope is documented as a docs-only contract (T05) that does NOT edit the lib files; the eager renderSettings double-render is removed (Settings made lazy); fetchLock is released in BOTH success+error branches; tw-commands CMD_TYPE and the overview LOCAL CMD_TYPE are kept as separate vocabularies; missing npm test script is added once; package.json file-lists corrected (test script in the harness task, build.js-only change in wiring tasks).
