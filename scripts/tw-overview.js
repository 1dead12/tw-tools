/**
 * TW Village Overview v2.0.0
 * Unified per-village intel dashboard: one master model JOINed by village id,
 * surfaced through 8 tabs (Dashboard + Troops/Economy/Buildings/Incomings/Map +
 * Commands + Settings), all driven by a declarative COLUMN registry and a generic
 * table engine, with versioned config + saved view presets.
 *
 * Features:
 * - Dashboard tab: cross-domain column-toggle over the unified master model
 * - Domain tabs (Troops/Economy/Buildings/Incomings/Map): each a built-in preset view
 * - Commands tab: multi-sort, live countdown, BBCode/CSV export, fake/nuke ESTIMATE tags
 * - Settings tab: thresholds, archers, export format, theme + saved view presets
 * - Fetch All: sequential, single-lock, READ-ONLY across all domains
 * - NEVER auto-sends anything
 *
 * @version 2.0.0
 * @requires jQuery, TribalWars game environment, window.TWTools
 *           (tw-core.js, tw-ui.js, tw-commands.js, tw-overview-core.js,
 *            tw-config-core.js, tw-table.js)
 */
;(function(window, $) {
  'use strict';

  // ============================================================
  // GUARD: TWTools must be loaded
  // ============================================================

  if (!window.TWTools || !window.TWTools.UI) {
    throw new Error('tw-overview.js requires tw-core.js and tw-ui.js (window.TWTools.UI missing)');
  }
  if (!window.TWTools.Config) {
    throw new Error('tw-overview.js requires tw-config-core.js (window.TWTools.Config missing)');
  }

  var TWTools = window.TWTools;
  var TWConfig = TWTools.Config;

  // ============================================================
  // CONFIG & CONSTANTS
  // ============================================================

  var VERSION = '2.0.0';
  var ID_PREFIX = 'two-';
  var STORAGE_PREFIX = 'two_';

  var OverviewCore = TWTools.OverviewCore || {};

  /**
   * Per-domain cache TTLs (ms). Sourced from the pure lib so the orchestrator and
   * the tests share ONE source of truth: incomings 2m / troops 5m / econ+buildings
   * 15m / map 1h. config has NO TTL.
   * @type {Object.<string, number>}
   */
  var CACHE_TTL_MS = (OverviewCore.CACHE_TTL_MS) || {
    troops: 5 * 60 * 1000, econ: 15 * 60 * 1000, buildings: 15 * 60 * 1000,
    incomings: 2 * 60 * 1000, map: 60 * 60 * 1000, config: null
  };

  /** Troop cache TTL alias (back-compat for fetchTroopData). */
  var troopsTtl = CACHE_TTL_MS.troops;

  /** Minimum delay between AJAX requests to avoid rate limiting */
  var REQUEST_DELAY = 200;

  /**
   * Runtime-detected world key (NEVER hardcoded). Prefers game_data.world, then a
   * sanitized location.host. Used to namespace per-domain caches across worlds/markets.
   * @returns {string}
   */
  function detectWorldKey() {
    try {
      if (typeof game_data !== 'undefined' && game_data && game_data.world) {
        return String(game_data.world).replace(/[^a-z0-9]/gi, '');
      }
    } catch (e) { /* game_data not present */ }
    try {
      if (typeof location !== 'undefined' && location.host) {
        return String(location.host).replace(/[^a-z0-9]/gi, '');
      }
    } catch (e2) { /* no location */ }
    return 'world';
  }

  /** @type {string} World key for cache namespacing. */
  var currentWorldKey = detectWorldKey();

  // Unit constant tables: the SINGLE source of truth lives in OverviewCore
  // (moved verbatim there). Read them from the lib; fall back to local literals
  // only if the lib is somehow absent (keeps the entry resilient).
  var ALL_UNITS = OverviewCore.ALL_UNITS ||
    ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];
  var UNITS_NO_ARCHERS = OverviewCore.UNITS_NO_ARCHERS ||
    ['spear', 'sword', 'axe', 'spy', 'light', 'heavy', 'ram', 'catapult', 'knight', 'snob'];
  var OFFENSIVE_UNITS = OverviewCore.OFFENSIVE_UNITS || ['axe', 'light', 'ram', 'catapult'];
  var DEFENSIVE_UNITS = OverviewCore.DEFENSIVE_UNITS || ['spear', 'sword', 'heavy'];
  var OFFENSIVE_ARCHER_UNITS = ['marcher'];
  var DEFENSIVE_ARCHER_UNITS = ['archer'];
  var ATTACK_VALUES = OverviewCore.ATTACK_VALUES || {
    spear: 10, sword: 25, axe: 40, archer: 15,
    spy: 0, light: 130, marcher: 120, heavy: 150,
    ram: 2, catapult: 100, knight: 150, snob: 30
  };
  var DEF_VALUES = OverviewCore.DEF_VALUES || {
    spear: 15, sword: 50, axe: 10, archer: 50,
    spy: 2, light: 30, marcher: 40, heavy: 200,
    ram: 20, catapult: 8, knight: 250, snob: 100
  };

  /** Command types */
  var CMD_TYPE = {
    ATTACK: 'attack',
    SUPPORT: 'support',
    RETURN: 'return',
    OTHER: 'other'
  };

  /** @type {string} Currently selected view type for troops overview */
  var currentViewType = 'own_home';

  /** @type {string} Currently selected group ID ('0' = all villages) */
  var currentGroupId = '0';

  /** @type {Array.<{id: string, name: string}>} Available village groups */
  var availableGroups = [{ id: '0', name: 'All villages' }];

  // ============================================================
  // STORAGE (wraps TWTools.Storage with local prefix)
  // ============================================================

  var Store = {
    /**
     * Get a setting value from localStorage.
     * @param {string} key - Setting key.
     * @param {*} fallback - Default value.
     * @returns {*} Stored or default value.
     */
    get: function(key, fallback) {
      var val = TWTools.Storage.get(STORAGE_PREFIX + key);
      return val !== null ? val : fallback;
    },

    /**
     * Set a setting value in localStorage (permanent).
     * @param {string} key - Setting key.
     * @param {*} value - Value to store.
     */
    set: function(key, value) {
      TWTools.Storage.set(STORAGE_PREFIX + key, value);
    },

    /**
     * Set a cached value with TTL.
     * @param {string} key - Cache key.
     * @param {*} value - Value to store.
     * @param {number} ttlMs - Time-to-live in ms.
     */
    setCache: function(key, value, ttlMs) {
      TWTools.Storage.set(STORAGE_PREFIX + key, value, ttlMs);
    },

    /**
     * Get a cached value (null if expired).
     * @param {string} key - Cache key.
     * @returns {*} Stored value or null.
     */
    getCache: function(key) {
      return TWTools.Storage.get(STORAGE_PREFIX + key);
    }
  };

  /**
   * Store adapter for TWConfig — bound to the SAME prefixed Store path so the
   * versioned config blob lands at the real twt_two_config key. TWConfig passes
   * BARE keys ('config', 'settings', 'view_type', 'group_id'); this adapter (and
   * ONLY this adapter) adds the two_/twt_ prefixes via Store/Storage. NEVER call
   * TWTools.Storage.get('config') directly — that would miss the double prefix.
   * @type {{get: function, set: function, remove: function}}
   */
  var localStore = {
    get: function(key) { return Store.get(key, null); },
    set: function(key, value) { Store.set(key, value); },
    remove: function(key) { TWTools.Storage.remove(STORAGE_PREFIX + key); }
  };

  // ============================================================
  // SETTINGS
  // ============================================================

  /** @type {Object} Current settings (a flat shim over the versioned config blob) */
  var settings = {};

  /** @type {?Object} The hydrated versioned config blob (twt_two_config). */
  var config = null;

  /**
   * Load the versioned config via TWConfig (migrating the legacy flat two_* keys on
   * first load), then project it onto the flat `settings` shim that the existing
   * army-summary/unit-list/category-split code still reads.
   */
  function loadSettings() {
    config = TWConfig.load(localStore);
    settings = {
      includeArchers: config.ui.includeArchers,
      nukeThreshold: config.thresholds.nukeThreshold,
      exportFormat: config.ui.exportFormat
    };
    currentViewType = config.ui.viewType || 'own_home';
    currentGroupId = config.ui.groupId || '0';
  }

  /**
   * Persist the settings-form values into the versioned config (hydrate-first
   * patch-merge — never clobbers sibling keys or the saved views).
   */
  function saveSettings() {
    config = TWConfig.patch(localStore, {
      ui: {
        includeArchers: settings.includeArchers,
        exportFormat: settings.exportFormat
      },
      thresholds: {
        includeArchers: settings.includeArchers,
        nukeThreshold: settings.nukeThreshold
      }
    });
  }

  /**
   * The full threshold set fed into OverviewCore.buildMasterModel / computeDerivedFlags
   * (isNuke / underDefended / whNearFull / isFull). Sourced from the versioned config
   * with fail-safe fallbacks for an un-hydrated config.
   * @returns {{nukeThreshold:number, includeArchers:boolean, defThreshold:number, warnPct:number, fullPct:number}}
   */
  function masterModelThresholds() {
    var t = (config && config.thresholds) || {};
    var ui = (config && config.ui) || {};
    return {
      nukeThreshold: (t.nukeThreshold !== undefined) ? t.nukeThreshold : settings.nukeThreshold,
      includeArchers: (t.includeArchers !== undefined) ? t.includeArchers : settings.includeArchers,
      defThreshold: (t.defThreshold !== undefined) ? t.defThreshold : 0,
      warnPct: (t.whNearFullPct !== undefined) ? t.whNearFullPct : 90,
      fullPct: (t.fullPct !== undefined) ? t.fullPct : 100,
      // attack/defense tier classification (farm-space based).
      targetNukePop: (t.targetNukePop !== undefined) ? t.targetNukePop : 20000,
      greenFraction: (t.greenFraction !== undefined) ? t.greenFraction : 0.90,
      orangeFraction: (t.orangeFraction !== undefined) ? t.orangeFraction : 0.40,
      minRam: (t.minRam !== undefined) ? t.minRam : 200,
      targetDefPop: (t.targetDefPop !== undefined) ? t.targetDefPop : 20000,
      frontBand: (t.frontBand !== undefined) ? t.frontBand : 25,
      colorPolarity: (ui.colorPolarity === 'A') ? 'A' : 'B',
      // Real per-world pops (get_unit_info) when loaded; else core UNIT_POP defaults.
      unitPops: loadedUnitPops || OverviewCore.UNIT_POP
    };
  }

  // ============================================================
  // DATA STRUCTURES
  // ============================================================

  /**
   * @typedef {Object} VillageTroops
   * @property {number} id - Village ID.
   * @property {string} name - Village name.
   * @property {string} coords - Village coordinates "x|y".
   * @property {Object.<string, number>} units - Unit counts by type.
   * @property {number} total - Total troop count.
   * @property {boolean} isNuke - Whether this village qualifies as a nuke.
   * @property {boolean} hasNoble - Whether this village has 1+ noble.
   */

  /**
   * @typedef {Object} CommandInfo
   * @property {string} type - Command type (attack/support/return/other).
   * @property {string} sourceName - Source village name.
   * @property {string} sourceCoords - Source coordinates.
   * @property {string} targetName - Target village name.
   * @property {string} targetCoords - Target coordinates.
   * @property {string} arrival - Arrival time text.
   * @property {number} arrivalMs - Arrival time in ms (for sorting).
   * @property {string} units - Visible units description.
   */

  /**
   * All troop data organized by category.
   * Keys: 'own_home', 'in_village', 'outside', 'in_transit', 'own_all' (celkovo).
   * Each value is an array of VillageTroops objects.
   * Fetched ONCE from type=complete, then filtered client-side by view.
   * @type {Object.<string, VillageTroops[]>}
   */
  var allTroopData = {};

  /** @type {VillageTroops[]} Currently displayed troop data (filtered by view) */
  var troopData = [];

  /** @type {CommandInfo[]} All fetched command data */
  var commandData = [];

  /**
   * Single in-flight lock for ALL read-only fetches (troops + the Fetch-All domains).
   * Replaces the old isFetching flag. Released in BOTH success AND error branches.
   * @type {boolean}
   */
  var fetchLock = false;

  /**
   * Per-domain raw parsed data, keyed by domain ('troops','econ','buildings',
   * 'incomings','map'). Each value is a {id: row} map or array consumed by
   * OverviewCore.buildMasterModel.
   * @type {Object.<string, (Object|Array)>}
   */
  var domainData = {};

  /** @type {Array.<Object>} The unified per-village master model (JOIN of all domains). */
  var masterRows = [];

  /** @type {string|null} Premium-degrade note shown to the user (null when premium OK). */
  var premiumNote = null;

  // ============================================================
  // DATA FETCHING — TROOPS
  // ============================================================

  /**
   * Fetch troop data from the combined overview page.
   * Handles pagination for players with many villages.
   * @param {function(VillageTroops[])} callback - Called with troop data array.
   * @param {function(string)} statusCb - Status update callback.
   */
  /**
   * Row label to view category mapping.
   * The game's complete view uses 5 sub-rows per village with these labels.
   * We also support the modulo approach (row index % 5) as fallback.
   * @type {Object.<string, string>}
   */
  var LABEL_TO_CATEGORY = {
    'vlastné': 'own_home', 'vlastne': 'own_home', 'own': 'own_home',
    'v dedine': 'in_village', 'in village': 'in_village',
    'vonku': 'outside', 'outside': 'outside',
    'na ceste': 'in_transit', 'in transit': 'in_transit', 'unterwegs': 'in_transit',
    'celkovo': 'own_all', 'total': 'own_all', 'gesamt': 'own_all'
  };

  /** Category order for modulo fallback (index 0-4 in the 5-row block) */
  var CATEGORY_ORDER = ['own_home', 'in_village', 'outside', 'in_transit', 'own_all'];

  function fetchTroopData(callback, statusCb) {
    // Cache key includes only group (we fetch ALL views at once from type=complete)
    var cacheKey = 'troop_all_g' + currentGroupId;

    // Check cache — allTroopData has all 5 categories
    var cached = Store.getCache(cacheKey);
    if (cached && cached.own_home) {
      allTroopData = cached;
      troopData = allTroopData[currentViewType] || [];
      callback(troopData);
      return;
    }

    // NB: the fetchLock is owned EXCLUSIVELY by runFetchAll (the only caller).
    // fetchTroopData must NOT guard on it or release it, or it would bail before
    // calling back (stalling the domain stepper) / drop the lock mid-chain.
    if (statusCb) statusCb('Fetching troop overview (all views)...');

    // Always fetch type=complete — contains ALL 5 sub-rows per village
    var groupParam = (currentGroupId && currentGroupId !== '0') ? '&group=' + currentGroupId : '';
    var matrices = [];
    var page = 0;

    function fetchPage() {
      var url = '/game.php?screen=overview_villages&mode=units&type=complete' + groupParam + '&page=' + page;

      $.ajax({
        url: url,
        dataType: 'html',
        timeout: 15000,
        success: function(html) {
          // Delegate ALL parsing to the pure OverviewCore (DOM seam = extractRowMatrix).
          var matrix = OverviewCore.extractRowMatrix(html, $);

          // Empty group detection via the pure parser's emptyGroup signal.
          var probe = OverviewCore.parseOverviewTable(matrix, OverviewCore.DOMAIN_CONFIGS.units);
          if (probe.emptyGroup) {
            allTroopData = OverviewCore.splitByCategory({ headers: [], rows: [] }, OverviewCore.DOMAIN_CONFIGS.units);
            allTroopData._emptyGroupMsg = probe.emptyGroup;
            troopData = [];
            callback(troopData);
            return;
          }

          matrices.push(matrix);
          if (statusCb) {
            statusCb('Loaded page ' + (page + 1) + ' (' + (matrix.rows ? Math.floor(matrix.rows.length / 5) : 0) + ' villages)...');
          }

          if (probe.hasNextPage && page < 100) {
            page++;
            setTimeout(fetchPage, REQUEST_DELAY);
          } else {
            // Merge all page matrices into one, then split into the 5 buckets (pure).
            var merged = { headers: matrices[0] ? matrices[0].headers : [], rows: [] };
            for (var p = 0; p < matrices.length; p++) {
              if (matrices[p] && matrices[p].rows) merged.rows = merged.rows.concat(matrices[p].rows);
            }
            allTroopData = OverviewCore.splitByCategory(merged, OverviewCore.DOMAIN_CONFIGS.units);
            // Compute derived isNuke/hasNoble flags across ALL 5 buckets.
            OverviewCore.recomputeBucketsNuke(allTroopData, {
              nukeThreshold: settings.nukeThreshold, includeArchers: settings.includeArchers
            });
            annotateBucketNobles(allTroopData);
            Store.setCache(cacheKey, allTroopData, troopsTtl);
            troopData = allTroopData[currentViewType] || [];
            callback(troopData);
          }
        },
        error: function() {
          if (statusCb) statusCb('Error fetching troop data.');
          callback([]);
        }
      });
    }

    fetchPage();
  }

  /**
   * Annotate hasNoble on every bucket row (snob>0). isNuke is handled by
   * OverviewCore.recomputeBucketsNuke; this fills the companion flag.
   * @param {Object} buckets - allTroopData (5 buckets).
   */
  function annotateBucketNobles(buckets) {
    if (!buckets) return;
    CATEGORY_ORDER.forEach(function(cat) {
      var arr = buckets[cat];
      if (!Array.isArray(arr)) return;
      for (var i = 0; i < arr.length; i++) {
        var u = arr[i] && arr[i].units;
        arr[i].hasNoble = !!(u && (u.snob || 0) > 0);
      }
    });
  }

  // ============================================================
  // FETCH-ALL ORCHESTRATOR (sequential, single-lock, READ-ONLY)
  // ============================================================
  //
  // A callback-chained sequential stepper (NOT Promise.all — the jQuery runtime has
  // no async/await) that fetches each enabled domain behind ONE fetchLock with a
  // >=200ms gap, parses via OverviewCore, caches per-domain under cacheKeyFor with
  // the per-domain CACHE_TTL_MS, then JOINs everything via buildMasterModel. Every
  // request is a READ-ONLY GET (overview_villages with a mode param, or a map .txt) —
  // never a POST, never an auto-send.

  /** Group URL fragment for the current group (empty for 'all'). */
  function groupUrlParam() {
    return (currentGroupId && currentGroupId !== '0') ? '&group=' + currentGroupId : '';
  }

  /**
   * Detect Premium availability by probing mode=prod (READ-ONLY GET). Calls
   * cb(detectResult) where detectResult = {available, reason?}. Never throws.
   * @param {function(Object)} cb
   */
  function probePremium(cb) {
    // Authoritative source: game_data knows whether Premium / Account Manager is active.
    // (The HTML word-scan heuristic false-positives — the prod page still contains the
    // word "Prémiový" in menus/upsell even when Premium IS active.)
    var feat = (window.game_data && window.game_data.features) || {};
    var premiumActive = !!(feat.Premium && feat.Premium.active);
    var amActive = !!(feat.AccountManager && feat.AccountManager.active);
    if (premiumActive || amActive) {
      cb({ available: true, reason: 'game_data Premium/AM active' });
      return;
    }
    // Fallback (e.g. sitter contexts where features may be absent): probe heuristically.
    $.ajax({
      url: '/game.php?screen=overview_villages&mode=prod' + groupUrlParam() + '&page=0',
      dataType: 'html',
      timeout: 15000,
      success: function(html) {
        cb(OverviewCore.detectPremium ? OverviewCore.detectPremium(html, 'prod') : { available: true });
      },
      error: function() {
        cb({ available: false, reason: 'probe failed' });
      }
    });
  }

  /**
   * Degrade economy to the open village's game_data (free, no AJAX) when Premium
   * is unavailable. Fills domainData.econ for the current village only.
   */
  function degradeEconToGameData() {
    domainData.econ = {};
    try {
      if (typeof game_data !== 'undefined' && game_data && game_data.village) {
        var v = game_data.village;
        var id = parseInt(v.id, 10) || 0;
        if (id) {
          domainData.econ[id] = {
            id: id,
            wood: parseInt(v.wood, 10) || 0,
            clay: parseInt(v.stone, 10) || 0, // TW DOM quirk: stone == clay
            iron: parseInt(v.iron, 10) || 0,
            whCap: parseInt(v.storage_max, 10) || 0
          };
        }
      }
    } catch (e) { /* game_data absent — leave econ empty */ }
    premiumNote = 'Premium unavailable: Economy/Buildings limited to the open village (game_data).';
  }

  /**
   * Generic READ-ONLY overview-mode fetcher with per-domain caching. Paginates,
   * parses via OverviewCore.parseOverviewTable, caches the result under cacheKeyFor,
   * and calls done(rowsById). Releases the caller's responsibility for fetchLock
   * (the orchestrator owns the lock across the whole run).
   * @param {string} domain - Cache domain ('econ'|'buildings'|'incomings').
   * @param {string} mode - overview_villages mode param (e.g. 'prod','buildings','incomings&subtype=attacks').
   * @param {Object} cfg - OverviewCore.DOMAIN_CONFIGS.* parse config.
   * @param {boolean} emitArray - true to keep an array (incomings), false for a {id:row} map.
   * @param {function(string)} onProgress
   * @param {function((Object|Array))} done
   */
  function fetchOverviewMode(domain, mode, cfg, emitArray, onProgress, done) {
    var cacheKey = OverviewCore.cacheKeyFor(domain, currentGroupId, currentWorldKey);
    var cached = Store.getCache(cacheKey);
    if (cached) { done(cached); return; }

    var ttl = CACHE_TTL_MS[domain] || troopsTtl;
    var acc = [];
    var page = 0;

    function step() {
      var url = '/game.php?screen=overview_villages&mode=' + mode + groupUrlParam() + '&page=' + page;
      $.ajax({
        url: url,
        dataType: 'html',
        timeout: 15000,
        success: function(html) {
          var matrix = OverviewCore.extractRowMatrix(html, $);
          var parsed = OverviewCore.parseOverviewTable(matrix, cfg);
          acc = acc.concat(parsed.rows || []);
          if (onProgress) onProgress(domain + ': ' + acc.length + ' rows');
          if (parsed.hasNextPage && page < 100) {
            page++;
            setTimeout(step, REQUEST_DELAY);
          } else {
            var result = emitArray ? acc : indexById(acc);
            Store.setCache(cacheKey, result, ttl);
            done(result);
          }
        },
        error: function() {
          // Fail-safe: emit what we have (cache only a non-empty partial).
          var result = emitArray ? acc : indexById(acc);
          if (acc.length) Store.setCache(cacheKey, result, ttl);
          done(result);
        }
      });
    }

    step();
  }

  /**
   * Clear all REAL per-domain overview caches (troop_all_g*, command_data, and
   * every per-domain cacheKeyFor key) via the covered collectOverviewCacheKeys
   * seam. The versioned config blob (two_config) is intentionally KEPT.
   * Fixes the old no-op that cleared a never-written two_troop_data_<view> key.
   */
  function clearAllCaches() {
    var groupIds = ['0'];
    for (var i = 0; i < availableGroups.length; i++) {
      if (availableGroups[i].id && groupIds.indexOf(availableGroups[i].id) === -1) {
        groupIds.push(availableGroups[i].id);
      }
    }
    if (currentGroupId && groupIds.indexOf(currentGroupId) === -1) groupIds.push(currentGroupId);

    var keys = OverviewCore.collectOverviewCacheKeys
      ? OverviewCore.collectOverviewCacheKeys(STORAGE_PREFIX, groupIds)
      : [];
    for (var k = 0; k < keys.length; k++) {
      TWTools.Storage.remove(keys[k]);
    }
  }

  /**
   * Project the per-target incomings aggregate ({targetId: summary}) into an
   * id-bearing {id: row} map with master-model field names, so buildMasterModel
   * merges incCount / nukesEst / soonest / underDefended onto each village row.
   * @param {Object} agg - OverviewCore.aggregateIncomingsByTarget output.
   * @returns {Object.<string, Object>} {id: incomingsRow}.
   */
  function projectIncomingsToRows(agg) {
    var out = {};
    if (!agg || typeof agg !== 'object') return out;
    for (var tid in agg) {
      if (!agg.hasOwnProperty(tid)) continue;
      var s = agg[tid];
      var idNum = parseInt(tid, 10);
      out[tid] = {
        id: isNaN(idNum) ? tid : idNum,
        incCount: s.count || 0,
        soonest: s.soonestMs || 0,
        nukesEst: s.nukesEst || 0,
        fakesEst: s.fakesEst || 0,
        noblesEst: s.noblesEst || 0,
        // incomingNuke drives the purple pill; underDefended is finalized in
        // computeDerivedFlags (defPower<threshold AND hasIncomings) during JOIN.
        incomingNuke: (s.nukesEst || 0) > 0,
        nearestSource: s.nearestSource ? (s.nearestSource.name || s.nearestSource.coords || '') : ''
      };
    }
    return out;
  }

  /** Index an array of rows by id into a {id: row} map. */
  function indexById(rows) {
    var map = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r && r.id !== undefined && r.id !== null) map[r.id] = r;
    }
    return map;
  }

  /**
   * Fetch the map domain (villages + players) and build the village index. The
   * index is also returned so buildMasterModel can JOIN identity/geo. READ-ONLY.
   * @param {function(string)} onProgress
   * @param {function(Object)} done - done(villageIndex {byId,byOwner,byContinent}).
   */
  function fetchMapDomain(onProgress, done) {
    if (onProgress) onProgress('map: villages...');
    TWTools.DataFetcher.fetchAllVillages(function(villages) {
      TWTools.DataFetcher.fetchPlayers(function(players) {
        var idx = TWTools.DataFetcher.buildVillageIndex(villages, players);
        done(idx);
      });
    });
  }

  /**
   * Per-domain fetcher table. Each fetcher(onProgress, done) writes into domainData
   * and calls done(). Troops reuses the existing fetchTroopData spine (deduped
   * via splitIntoCategories -> own_home bucket). The map fetcher additionally
   * stashes the village index on domainData._villageIndex for the JOIN.
   * @type {Object.<string, function(function(string), function())>}
   */
  var DOMAIN_FETCHERS = {
    troops: function(onProgress, done) {
      fetchTroopData(function(rows) {
        domainData.troops = indexById(rows || []);
        done();
      }, onProgress);
    },
    econ: function(onProgress, done) {
      fetchOverviewMode('econ', 'prod', OverviewCore.DOMAIN_CONFIGS.prod, false, onProgress, function(map) {
        domainData.econ = map;
        done();
      });
    },
    buildings: function(onProgress, done) {
      fetchOverviewMode('buildings', 'buildings', OverviewCore.DOMAIN_CONFIGS.buildings, false, onProgress, function(map) {
        domainData.buildings = map;
        done();
      });
    },
    incomings: function(onProgress, done) {
      fetchOverviewMode('incomings', 'incomings&subtype=attacks', OverviewCore.DOMAIN_CONFIGS.incomings, true, onProgress, function(arr) {
        // Aggregate per TARGET village (count + nukes/fakes/nobles ESTIMATE via
        // classifyTrainKind), then project into id-bearing master rows so the
        // incoming-nuke purple pill (nukesEst>0) + under-defended JOIN light up.
        var agg = OverviewCore.aggregateIncomingsByTarget(arr, loadedUnitSpeeds, loadedWorldConfig);
        domainData.incomings = projectIncomingsToRows(agg);
        domainData._incomingsRaw = arr;
        done();
      });
    },
    map: function(onProgress, done) {
      fetchMapDomain(onProgress, function(idx) {
        domainData._villageIndex = idx;
        done();
      });
    }
  };

  /**
   * Sequential, single-lock, READ-ONLY Fetch-All across the enabled domains.
   * Premium degrade: probe mode=prod first; if unavailable, fill econ from
   * game_data current village + note, and SKIP the multi-village econ/buildings
   * fetches. JOINs everything via buildMasterModel on completion. Releases the
   * lock in BOTH the success and error paths.
   *
   * @param {Array.<string>} domains - Ordered domains to fetch (subset of DOMAIN_FETCHERS keys).
   * @param {function(string)} [onProgress] - Status callback.
   * @param {function(Array.<Object>)} [onDone] - Receives masterRows.
   */
  function runFetchAll(domains, onProgress, onDone) {
    if (fetchLock) {
      TWTools.UI.toast('Fetch already in progress...', 'warning');
      return;
    }
    domains = (domains && domains.length) ? domains.slice() : ['troops', 'econ', 'buildings', 'incomings', 'map'];
    fetchLock = true;
    premiumNote = null;
    domainData = {};

    function finish() {
      // Build the unified master model (identity/geo from the map index when present).
      var idx = domainData._villageIndex || { byId: {} };
      var join = {};
      ['troops', 'econ', 'buildings', 'incomings', 'map'].forEach(function(d) {
        if (domainData[d]) join[d] = domainData[d];
      });
      try {
        masterRows = OverviewCore.buildMasterModel(join, idx, masterModelThresholds());
      } catch (e) {
        masterRows = [];
      }
      fetchLock = false; // release on SUCCESS path
      if (onDone) onDone(masterRows);
    }

    function runDomains(list) {
      var i = 0;
      function next() {
        if (i >= list.length) { finish(); return; }
        var dom = list[i];
        var fetcher = DOMAIN_FETCHERS[dom];
        i++;
        if (!fetcher) { setTimeout(next, 0); return; }
        try {
          fetcher(onProgress, function() {
            setTimeout(next, REQUEST_DELAY); // >=200ms gap between domains
          });
        } catch (e) {
          fetchLock = false; // release on ERROR path
          if (onProgress) onProgress('Error in ' + dom + ': ' + (e && e.message));
          // Continue with remaining domains after the gap; re-acquire the lock.
          fetchLock = true;
          setTimeout(next, REQUEST_DELAY);
        }
      }
      next();
    }

    // Premium feature-detect/degrade BEFORE the multi-village econ/buildings fetches.
    var needsPremium = domains.indexOf('econ') !== -1 || domains.indexOf('buildings') !== -1;
    if (!needsPremium) {
      runDomains(domains);
      return;
    }

    probePremium(function(detect) {
      if (detect && detect.available) {
        runDomains(domains);
      } else {
        // Degrade: fill econ from game_data, skip the multi-village econ/buildings fetches.
        degradeEconToGameData();
        if (onProgress) onProgress(premiumNote);
        var filtered = [];
        for (var k = 0; k < domains.length; k++) {
          if (domains[k] !== 'econ' && domains[k] !== 'buildings') filtered.push(domains[k]);
        }
        runDomains(filtered);
      }
    });
  }

  // ============================================================
  // DATA FETCHING — COMMANDS
  // ============================================================

  /**
   * Fetch command data from the commands overview page.
   * @param {function(CommandInfo[])} callback - Called with command data array.
   * @param {function(string)} statusCb - Status update callback.
   */
  function fetchCommandData(callback, statusCb) {
    // Check cache first
    var cached = Store.getCache('command_data');
    if (cached && cached.length > 0) {
      commandData = cached;
      callback(cached);
      return;
    }

    if (statusCb) statusCb('Fetching command overview...');

    $.ajax({
      url: '/game.php?screen=overview_villages&mode=commands',
      dataType: 'html',
      timeout: 15000,
      success: function(html) {
        var commands = parseCommandsPage(html);
        commandData = commands;
        Store.setCache('command_data', commands, troopsTtl);
        if (statusCb) statusCb('Loaded ' + commands.length + ' commands.');
        callback(commands);
      },
      error: function() {
        if (statusCb) statusCb('Error fetching commands.');
        callback([]);
      }
    });
  }

  /**
   * Parse the commands overview page for outgoing/incoming commands.
   * @param {string} html - Raw HTML of the commands page.
   * @returns {CommandInfo[]} Parsed command data.
   */
  function parseCommandsPage(html) {
    var $page = $('<div/>').html(html);
    var commands = [];

    // TW commands page has tables/rows with command information
    // Each command row typically has: icon (attack/support/return), source, target, arrival time
    $page.find('table.vis tr, #commands_table tr').each(function() {
      var $row = $(this);
      var $cells = $row.find('td');

      if ($cells.length < 3) return;

      // Determine command type from icon
      var type = CMD_TYPE.OTHER;
      var $icon = $row.find('img[src*="command"], img[class*="command"]');
      var iconSrc = ($icon.attr('src') || '') + ' ' + ($icon.attr('class') || '');

      if (iconSrc.indexOf('attack') !== -1) {
        type = CMD_TYPE.ATTACK;
      } else if (iconSrc.indexOf('support') !== -1 || iconSrc.indexOf('def') !== -1) {
        type = CMD_TYPE.SUPPORT;
      } else if (iconSrc.indexOf('return') !== -1 || iconSrc.indexOf('back') !== -1) {
        type = CMD_TYPE.RETURN;
      }

      // Parse source and target
      var $links = $row.find('a[href*="village"]');
      var sourceName = '';
      var sourceCoords = '';
      var targetName = '';
      var targetCoords = '';

      if ($links.length >= 2) {
        sourceName = $.trim($links.eq(0).text());
        sourceCoords = extractCoords(sourceName);
        sourceName = sourceName.replace(/\s*\(\d{1,3}\|\d{1,3}\)\s*/, '').trim();

        targetName = $.trim($links.eq(1).text());
        targetCoords = extractCoords(targetName);
        targetName = targetName.replace(/\s*\(\d{1,3}\|\d{1,3}\)\s*/, '').trim();
      } else if ($links.length === 1) {
        targetName = $.trim($links.eq(0).text());
        targetCoords = extractCoords(targetName);
        targetName = targetName.replace(/\s*\(\d{1,3}\|\d{1,3}\)\s*/, '').trim();
      }

      // Parse arrival time
      var arrivalText = '';
      var arrivalMs = 0;
      $cells.each(function() {
        var text = $(this).text();
        // Look for time pattern HH:MM:SS
        if (text.match(/\d{1,2}:\d{2}:\d{2}/)) {
          arrivalText = $.trim(text);
          arrivalMs = TWTools.parseArrivalTime(arrivalText) || 0;
        }
      });

      // Parse visible units (if shown)
      var unitsText = '';
      var $unitsCell = $row.find('td.unit_count, td:last');
      if ($unitsCell.length > 0) {
        var unitTexts = [];
        $unitsCell.find('img[src*="unit_"]').each(function() {
          var src = $(this).attr('src') || '';
          var unitMatch = src.match(/unit_(\w+)/);
          if (unitMatch) {
            var count = $.trim($(this).parent().text() || $(this).next().text());
            if (count) unitTexts.push(unitMatch[1] + ': ' + count);
          }
        });
        unitsText = unitTexts.join(', ');
      }

      if (sourceName || targetName) {
        commands.push({
          type: type,
          sourceName: sourceName,
          sourceCoords: sourceCoords,
          targetName: targetName,
          targetCoords: targetCoords,
          arrival: arrivalText,
          arrivalMs: arrivalMs,
          units: unitsText
        });
      }
    });

    // Sort by arrival time
    commands.sort(function(a, b) {
      return a.arrivalMs - b.arrivalMs;
    });

    return commands;
  }

  /**
   * Extract coordinates from a village name/text string.
   * @param {string} text - Text potentially containing "x|y" coords.
   * @returns {string} Coordinates string "x|y" or empty string.
   */
  function extractCoords(text) {
    var match = (text || '').match(/(\d{1,3}\|\d{1,3})/);
    return match ? match[1] : '';
  }

  // ============================================================
  // FORMAT HELPERS
  // ============================================================

  /**
   * Escape HTML special characters.
   * @param {string} str - Raw string.
   * @returns {string} Escaped string.
   */
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');
  }

  /**
   * Get display name for command type.
   * @param {string} type - Command type constant.
   * @returns {string} Display name.
   */
  function cmdTypeName(type) {
    var names = {};
    names[CMD_TYPE.ATTACK] = 'Attack';
    names[CMD_TYPE.SUPPORT] = 'Support';
    names[CMD_TYPE.RETURN] = 'Return';
    names[CMD_TYPE.OTHER] = 'Other';
    return names[type] || type;
  }

  /**
   * Get CSS color for command type.
   * @param {string} type - Command type constant.
   * @returns {string} CSS color string.
   */
  function cmdTypeColor(type) {
    if (type === CMD_TYPE.ATTACK) return '#cc0000';
    if (type === CMD_TYPE.SUPPORT) return '#2e7d32';
    if (type === CMD_TYPE.RETURN) return '#0066cc';
    return '#888';
  }

  // ============================================================
  // UI — UNIFIED DOMAIN/DASHBOARD TABS (table-engine driven)
  // ============================================================

  /** @type {Object.<string, Object>} Active Table controllers keyed by tab id. */
  var tableControllers = {};

  /** @type {?Object} The createCard handle (set in init). */
  var overviewCard = null;

  /** @type {Object.<string, boolean>} Which tabs have been rendered (lazy). */
  var renderedTabs = {};

  /** Domain tab id -> the registry domain name. */
  var TAB_DOMAIN = {
    troops: 'troops', economy: 'economy', buildings: 'buildings',
    incomings: 'incomings', map: 'map'
  };

  /**
   * Resolve the column descriptors for a domain tab as a built-in preset view:
   * identity columns + that domain's columns, gated by the world config.
   * @param {string} domain - troops|economy|buildings|incomings|map.
   * @returns {Array.<Object>} Column descriptors.
   */
  function presetColumnsForDomain(domain) {
    var identity = OverviewCore.columnsForDomain('identity');
    var domainCols = OverviewCore.columnsForDomain(domain);
    var cols = identity.concat(domainCols);
    var worldCfg = (config && config.world) || null;
    return worldCfg ? OverviewCore.gateColumnsByWorld(cols, worldCfg) : cols;
  }

  /** Default-visible keys among a column set. */
  function defaultVisibleKeys(cols) {
    var keys = [];
    for (var i = 0; i < cols.length; i++) {
      if (cols[i] && cols[i].defaultVisible) keys.push(cols[i].key);
    }
    return keys;
  }

  /**
   * Build the "Fetch All" toolbar shared by the dashboard/domain tabs. Surfaces
   * the premium-degrade note when present.
   * @param {jQuery} $panel
   * @param {string} tabId
   * @returns {jQuery} The toolbar element.
   */
  function buildMasterToolbar($panel, tabId) {
    var $bar = $('<div class="' + ID_PREFIX + 'toolbar" style="margin-bottom:6px;"></div>');
    $bar.append('<button class="btn" id="' + ID_PREFIX + 'fetch-all" style="font-weight:bold;">Fetch All</button> ');
    if (premiumNote) {
      $bar.append('<span style="font-size:9px;color:#a05000;margin-left:6px;">' + escapeHtml(premiumNote) + '</span>');
    }
    $bar.find('#' + ID_PREFIX + 'fetch-all').on('click', function() {
      doFetchAll(tabId);
    });
    return $bar;
  }

  /** Per-domain visible-column persistence (config.domainColumns.<domain>). */
  function resolveDomainVisible(domain, cols) {
    var dc = (config && config.domainColumns && config.domainColumns[domain]) || null;
    var defaults = defaultVisibleKeys(cols);
    return OverviewCore.resolveVisibleColumns(dc, defaults);
  }
  function persistDomainVisible(domain, keys) {
    var patch = { domainColumns: {} };
    patch.domainColumns[domain] = keys;
    config = TWConfig.patch(localStore, patch);
  }
  function domainSort(domain) {
    var ds = (config && config.domainSort && config.domainSort[domain]) || null;
    return Array.isArray(ds) ? ds : [];
  }
  function persistDomainSort(domain, sort) {
    var patch = { domainSort: {} };
    patch.domainSort[domain] = sort;
    config = TWConfig.patch(localStore, patch);
  }

  /**
   * Render a DOMAIN tab (troops/economy/buildings/incomings/map): the master model
   * rendered through the table engine with that domain's preset columns.
   * @param {jQuery} $panel
   * @param {string} tabId
   */
  function renderDomainTab($panel, tabId) {
    $panel.off('.twdom').empty();
    var domain = TAB_DOMAIN[tabId] || 'troops';
    $panel.append(buildMasterToolbar($panel, tabId));

    if (!masterRows || masterRows.length === 0) {
      $panel.append('<p style="padding:6px;color:#7a6840;">No data yet. Click "Fetch All" to build the unified model.</p>');
      return;
    }

    var cols = presetColumnsForDomain(domain);
    var visible = resolveDomainVisible(domain, cols);
    var $host = $('<div class="' + ID_PREFIX + 'grid-host"></div>');
    $panel.append($host);

    tableControllers[tabId] = TWTools.Table.render($host, masterRows, {
      id: tabId,
      columns: cols,
      visibleColumns: visible,
      sort: domainSort(domain),
      title: 'Overview-' + tabId,
      onVisibleChange: function(keys) { persistDomainVisible(domain, keys); },
      onSortChange: function(sort) { persistDomainSort(domain, sort); }
    });
  }

  /**
   * Render the DASHBOARD tab: cross-domain column-toggle across ALL domains over
   * the unified master model (resolveVisibleColumns over saved config).
   * @param {jQuery} $panel
   */
  function renderDashboard($panel) {
    $panel.off('.twdash').empty();
    $panel.append(buildMasterToolbar($panel, 'dashboard'));

    if (!masterRows || masterRows.length === 0) {
      $panel.append('<p style="padding:6px;color:#7a6840;">No data yet. Click "Fetch All" to build the unified model.</p>');
      return;
    }

    // ALL columns across every domain (identity + all domains), world-gated.
    var allCols = OverviewCore.COLUMN_REGISTRY.slice();
    var worldCfg = (config && config.world) || null;
    if (worldCfg) allCols = OverviewCore.gateColumnsByWorld(allCols, worldCfg);

    // Visible keys from saved config.columns (resolveVisibleColumns), else defaults.
    var saved = (config && config.columns && config.columns.visible) || [];
    var defaults = defaultVisibleKeys(allCols);
    var visible = OverviewCore.resolveVisibleColumns(saved, defaults);

    var $host = $('<div class="' + ID_PREFIX + 'grid-host"></div>');
    $panel.append($host);

    tableControllers.dashboard = TWTools.Table.render($host, masterRows, {
      id: 'dashboard',
      columns: allCols,
      visibleColumns: visible,
      sort: (config && config.sort && config.sort.key)
        ? [{ key: config.sort.key, dir: config.sort.dir || 'asc' }]
        : [],
      title: 'Dashboard',
      onVisibleChange: function(keys) {
        config = TWConfig.patch(localStore, { columns: { visible: keys } });
      },
      onSortChange: function(sort) {
        var s = (sort && sort[0]) ? sort[0] : { key: 'name', dir: 'asc' };
        config = TWConfig.patch(localStore, { sort: { key: s.key, dir: s.dir } });
      }
    });
  }

  /**
   * Drive the Fetch-All orchestrator with progress, then re-render the active tab.
   * @param {string} activeTabId
   */
  function doFetchAll(activeTabId) {
    if (fetchLock) { TWTools.UI.toast('Fetch already in progress...', 'warning'); return; }
    if (overviewCard) overviewCard.setStatus('Fetching all domains (sequential, read-only)...');
    // Orchestrator domain names are: troops, econ, buildings, incomings, map
    // (the 'economy' TAB maps to the 'econ' fetch domain).
    runFetchAll(['troops', 'econ', 'buildings', 'incomings', 'map'],
      function(status) { if (overviewCard) overviewCard.setStatus(status); },
      function(rows) {
        masterRows = rows;
        renderedTabs = {}; // force lazy re-render of every tab
        if (overviewCard) overviewCard.setStatus(rows.length + ' villages in the master model.');
        activateTab(activeTabId);
        TWTools.UI.toast('Fetch All complete: ' + rows.length + ' villages', 'success');
      });
  }

  /**
   * Recalculate isNuke status across ALL 5 view buckets AND the master rows
   * (fixes the stale-flag bug where only the visible bucket was recomputed).
   * Delegates to the covered OverviewCore.recomputeBucketsNuke seam.
   */
  function recalculateNukeStatus() {
    var nukeOpts = { nukeThreshold: settings.nukeThreshold, includeArchers: settings.includeArchers };

    // All 5 buckets (own_home, in_village, outside, in_transit, own_all).
    if (OverviewCore.recomputeBucketsNuke) {
      OverviewCore.recomputeBucketsNuke(allTroopData, nukeOpts);
    }

    // Re-flag the unified master rows too (drives the troops-tab nuke pill).
    if (OverviewCore.classifyNukeFlag) {
      for (var m = 0; m < masterRows.length; m++) {
        var mr = masterRows[m];
        if (mr) mr.isNuke = OverviewCore.classifyNukeFlag(mr.units || mr, nukeOpts);
      }
    }

    // Keep the currently-displayed bucket pointer in sync.
    troopData = allTroopData[currentViewType] || troopData;
  }

  /**
   * Re-JOIN the unified master model from whatever domain data is in memory, using
   * the CURRENT tier thresholds. Used after the Settings form changes a threshold so
   * attackTier/defTier/etc. reclassify without a re-fetch. Fail-safe: keeps the prior
   * masterRows on error.
   */
  function rebuildMasterModel() {
    try {
      var idx = (domainData && domainData._villageIndex) || { byId: {} };
      var join = {};
      ['troops', 'econ', 'buildings', 'incomings', 'map'].forEach(function(d) {
        if (domainData && domainData[d]) join[d] = domainData[d];
      });
      // Fall back to the troops-only model when only cached troops exist.
      if (!join.troops && domainData && domainData.troops) join.troops = domainData.troops;
      if (Object.keys(join).length === 0) return;
      masterRows = OverviewCore.buildMasterModel(join, idx, masterModelThresholds());
    } catch (e) { /* keep prior masterRows */ }
  }

  // ============================================================
  // UI — COMMANDS TAB (multi-sort, live countdown, export, ESTIMATE tags)
  // ============================================================

  /** @type {string} Current command filter */
  var cmdFilter = 'all';

  /** @type {?number} setInterval id for the live countdown (cleared on tab-away/close). */
  var countdownTimer = null;

  /** Stop the live countdown timer (idempotent). */
  function stopCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  /**
   * Estimate the kind of a command (nuke/fake/noble) for the ESTIMATE tag column.
   * Gated on get_config + get_unit_info being loaded first; never certainty.
   * @param {Object} cmd - A command row.
   * @returns {string} 'EST:nuke' | 'EST:fake' | 'EST:noble' | '' (ungated/unknown).
   */
  function estimateCommandTag(cmd) {
    if (!worldConfigLoaded || !cmd) return '';
    try {
      var dist = (typeof cmd.distance === 'number') ? cmd.distance
        : (cmd.sourceCoords && cmd.targetCoords)
          ? TWTools.distance(OverviewCore.parseCoordsObj(cmd.sourceCoords), OverviewCore.parseCoordsObj(cmd.targetCoords))
          : 0;
      var kind = OverviewCore.classifyTrainKind(
        { commands: [{ type: cmd.type, travelMs: cmd.travelMs, observedMs: cmd.arrivalMs, dist: dist }] },
        loadedUnitSpeeds, loadedWorldConfig
      );
      if (kind.kind === 'unknown') return '';
      return 'EST:' + kind.kind;
    } catch (e) { return ''; }
  }

  /**
   * Render the commands tab content with multi-sort, live countdown, export, and
   * fake/nuke ESTIMATE tags. Keeps the LOCAL CMD_TYPE for the type column.
   * @param {jQuery} $panel - Tab panel jQuery element.
   * @param {CommandInfo[]} data - Command data.
   */
  function renderCommands($panel, data) {
    stopCountdown();
    $panel.off('.twcmd').empty();

    var html = '<div style="margin-bottom:6px;">' +
      '<button class="btn" id="' + ID_PREFIX + 'fetch-cmds" style="font-size:9px;">Fetch Commands</button> ' +
      '<button class="btn" id="' + ID_PREFIX + 'refresh-cmds" style="font-size:9px;">Force Refresh</button> ' +
      '<button class="btn" id="' + ID_PREFIX + 'cmd-bbcode" style="font-size:9px;">BBCode</button> ' +
      '<button class="btn" id="' + ID_PREFIX + 'cmd-csv" style="font-size:9px;">CSV</button>' +
      '</div>';

    if (!data || data.length === 0) {
      html += '<p style="padding:4px;color:#7a6840;">No command data. Click "Fetch Commands" to load.</p>';
      $panel.html(html);
      $panel.on('click.twcmd', '#' + ID_PREFIX + 'fetch-cmds', function() { fetchCommandDataWithUI($panel, false); });
      $panel.on('click.twcmd', '#' + ID_PREFIX + 'refresh-cmds', function() { fetchCommandDataWithUI($panel, true); });
      return;
    }

    // Multi-key sort via OverviewCore.sortBy (persisted in config.commandsSort).
    var sortSpec = (config && config.commandsSort) || [{ key: 'arrivalMs', dir: 'asc', type: 'num' }];
    var sorted = data.slice().sort(OverviewCore.sortBy(sortSpec));

    html += '<table class="vis" style="width:100%;"><thead><tr>' +
      '<th data-sort="type" style="cursor:pointer;">Type</th>' +
      '<th data-sort="sourceName" style="cursor:pointer;">Source</th>' +
      '<th data-sort="targetName" style="cursor:pointer;">Target</th>' +
      '<th data-sort="arrivalMs" style="cursor:pointer;">Arrival</th>' +
      '<th>Countdown</th>' +
      '<th>EST</th>' +
      '<th>Units</th>' +
      '</tr></thead><tbody>';

    for (var i = 0; i < sorted.length; i++) {
      var cmd = sorted[i];
      var typeName = cmdTypeName(cmd.type);
      var estTag = estimateCommandTag(cmd);
      html += '<tr>' +
        '<td style="color:' + cmdTypeColor(cmd.type) + ';font-weight:bold;font-size:10px;">' + escapeHtml(typeName) + '</td>' +
        '<td style="font-size:10px;">' + escapeHtml(cmd.sourceName || '') +
          (cmd.sourceCoords ? ' <span style="color:#888;">(' + escapeHtml(cmd.sourceCoords) + ')</span>' : '') + '</td>' +
        '<td style="font-size:10px;">' + escapeHtml(cmd.targetName || '') +
          (cmd.targetCoords ? ' <span style="color:#888;">(' + escapeHtml(cmd.targetCoords) + ')</span>' : '') + '</td>' +
        '<td style="font-size:10px;font-family:monospace;">' + escapeHtml(cmd.arrivalText || '') + '</td>' +
        '<td class="' + ID_PREFIX + 'countdown" data-arrival="' + (cmd.arrivalMs || 0) + '" style="font-size:10px;font-family:monospace;"></td>' +
        '<td style="font-size:9px;color:#a05000;">' + escapeHtml(estTag) + '</td>' +
        '<td style="font-size:9px;color:#555;">' + escapeHtml(cmd.units || '-') + '</td>' +
        '</tr>';
    }
    html += '</tbody></table>';
    $panel.html(html);

    // Live countdown — ONE setInterval re-rendering only the countdown cells.
    function paintCountdowns() {
      var now = TWTools.TimeSync ? TWTools.TimeSync.now() : Date.now();
      $panel.find('.' + ID_PREFIX + 'countdown').each(function() {
        var arrival = parseInt($(this).attr('data-arrival'), 10) || 0;
        var remain = arrival - now;
        $(this).text(remain > 0 ? formatCountdown(remain) : 'arrived');
      });
    }
    paintCountdowns();
    countdownTimer = setInterval(paintCountdowns, 1000);

    // Header click -> multi-sort (shift-click appends).
    $panel.on('click.twcmd', 'th[data-sort]', function(e) {
      var key = $(this).attr('data-sort');
      var type = (key === 'arrivalMs') ? 'num' : 'str';
      sortSpec = toggleCommandSort(sortSpec, key, type, e.shiftKey);
      config = TWConfig.patch(localStore, { commandsSort: sortSpec });
      renderCommands($panel, data);
    });

    // Export the current sorted view via the LOCAL exporters.
    $panel.on('click.twcmd', '#' + ID_PREFIX + 'cmd-bbcode', function() { exportCommandsBBCode(sorted); });
    $panel.on('click.twcmd', '#' + ID_PREFIX + 'cmd-csv', function() { exportCommandsCSV(sorted); });
    $panel.on('click.twcmd', '#' + ID_PREFIX + 'fetch-cmds', function() { fetchCommandDataWithUI($panel, false); });
    $panel.on('click.twcmd', '#' + ID_PREFIX + 'refresh-cmds', function() { fetchCommandDataWithUI($panel, true); });
  }

  /** Toggle/append a command sort key (shift = additive multi-sort). */
  function toggleCommandSort(spec, key, type, additive) {
    spec = Array.isArray(spec) ? spec.slice() : [];
    var idx = -1;
    for (var i = 0; i < spec.length; i++) { if (spec[i].key === key) { idx = i; break; } }
    if (additive) {
      if (idx === -1) spec.push({ key: key, dir: 'asc', type: type });
      else spec[idx].dir = spec[idx].dir === 'asc' ? 'desc' : 'asc';
    } else {
      if (idx === 0 && spec.length === 1) spec[0].dir = spec[0].dir === 'asc' ? 'desc' : 'asc';
      else spec = [{ key: key, dir: 'asc', type: type }];
    }
    return spec;
  }

  /** Format a remaining-ms duration as HH:MM:SS. */
  function formatCountdown(ms) {
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    return pad(h) + ':' + pad(m) + ':' + pad(s);
  }

  /** Export the commands current view as BBCode (copied to clipboard). */
  function exportCommandsBBCode(rows) {
    if (!rows || !rows.length) { TWTools.UI.toast('No data to export', 'warning'); return; }
    var bb = '[b]Commands[/b] (' + rows.length + ')\n[table]\n';
    bb += '[**]Type[||]Source[||]Target[||]Arrival[/**]\n';
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i];
      bb += '[*]' + cmdTypeName(c.type) + '[|]' + (c.sourceName || '') + ' ' + (c.sourceCoords ? '(' + c.sourceCoords + ')' : '') +
        '[|]' + (c.targetName || '') + ' ' + (c.targetCoords ? '(' + c.targetCoords + ')' : '') +
        '[|]' + (c.arrivalText || '') + '[/*]\n';
    }
    bb += '[/table]';
    copyToClipboard(bb);
    TWTools.UI.toast('BBCode copied', 'success');
  }

  /** Export the commands current view as CSV (copied to clipboard). */
  function exportCommandsCSV(rows) {
    if (!rows || !rows.length) { TWTools.UI.toast('No data to export', 'warning'); return; }
    var csv = 'Type,Source,SourceCoords,Target,TargetCoords,Arrival\n';
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i];
      csv += cmdTypeName(c.type) + ',"' + (c.sourceName || '').replace(/"/g, '""') + '",' + (c.sourceCoords || '') +
        ',"' + (c.targetName || '').replace(/"/g, '""') + '",' + (c.targetCoords || '') + ',' + (c.arrivalText || '') + '\n';
    }
    copyToClipboard(csv);
    TWTools.UI.toast('CSV copied', 'success');
  }

  /**
   * Fetch command data with UI feedback.
   * @param {jQuery} $panel - Tab panel.
   * @param {boolean} force - Force refresh.
   */
  function fetchCommandDataWithUI($panel, force) {
    if (force) {
      TWTools.Storage.remove(STORAGE_PREFIX + 'command_data');
      commandData = [];
    }
    $panel.html('<div style="padding:8px;"><p style="color:#7a6840;">Fetching commands...</p></div>');
    fetchCommandData(function(data) {
      commandData = data;
      renderCommands($panel, data);
      if (data.length > 0) {
        TWTools.UI.toast('Loaded ' + data.length + ' commands', 'success');
      }
    }, function(status) {
      $panel.find('p').text(status);
    });
  }

  // ============================================================
  // UI — SETTINGS TAB (config-bound form + saved view presets)
  // ============================================================

  /**
   * Render the settings tab: thresholds, archers, export format bound to the
   * versioned config (NaN-safe coercion), plus the saved-views presets panel.
   * @param {jQuery} $panel - Tab panel jQuery element.
   */
  function renderSettings($panel) {
    $panel.off('.twset .twviews').empty();
    var t = (config && config.thresholds) || {};
    var ui = (config && config.ui) || {};

    var html = '<div style="padding:4px;">' +
      '<h4 style="margin:0 0 8px;color:#3e2e14;">Settings</h4>' +

      '<div style="margin-bottom:6px;">' +
        '<label><input type="checkbox" id="' + ID_PREFIX + 'set-archers"' +
          (settings.includeArchers ? ' checked' : '') + '> Include archer units</label>' +
      '</div>' +

      '<div style="margin-bottom:6px;"><label>Nuke threshold (min off troops): ' +
        '<input type="number" id="' + ID_PREFIX + 'set-nuke" value="' + (settings.nukeThreshold) +
          '" style="width:70px;font-size:10px;" min="1000" max="50000" step="500"></label></div>' +

      '<div style="margin-bottom:6px;"><label>Warehouse near-full %: ' +
        '<input type="number" id="' + ID_PREFIX + 'set-whfull" value="' + (t.whNearFullPct !== undefined ? t.whNearFullPct : 90) +
          '" style="width:60px;font-size:10px;" min="0" max="100" step="5"></label></div>' +

      '<div style="margin-bottom:6px;"><label>Distance-to-front max: ' +
        '<input type="number" id="' + ID_PREFIX + 'set-front" value="' + (t.distFrontMax !== undefined ? t.distFrontMax : 25) +
          '" style="width:60px;font-size:10px;" min="1" max="200" step="1"></label></div>' +

      // ---- attack / defense tier thresholds ----
      '<div style="margin:8px 0 4px;font-weight:bold;color:#3e2e14;">Attack / Defense tiers</div>' +
      '<div style="margin-bottom:6px;"><label>Target nuke pop (full nuke): ' +
        '<input type="number" id="' + ID_PREFIX + 'set-nukepop" value="' + (t.targetNukePop !== undefined ? t.targetNukePop : 20000) +
          '" style="width:70px;font-size:10px;" min="1000" max="50000" step="500"></label></div>' +
      '<div style="margin-bottom:6px;"><label>Target def pop (full wall): ' +
        '<input type="number" id="' + ID_PREFIX + 'set-defpop" value="' + (t.targetDefPop !== undefined ? t.targetDefPop : 20000) +
          '" style="width:70px;font-size:10px;" min="1000" max="50000" step="500"></label></div>' +
      '<div style="margin-bottom:6px;"><label>Full tier % (green/0.90): ' +
        '<input type="number" id="' + ID_PREFIX + 'set-green" value="' + Math.round((t.greenFraction !== undefined ? t.greenFraction : 0.90) * 100) +
          '" style="width:60px;font-size:10px;" min="50" max="100" step="5"></label></div>' +
      '<div style="margin-bottom:6px;"><label>Partial tier % (orange/0.40): ' +
        '<input type="number" id="' + ID_PREFIX + 'set-orange" value="' + Math.round((t.orangeFraction !== undefined ? t.orangeFraction : 0.40) * 100) +
          '" style="width:60px;font-size:10px;" min="10" max="90" step="5"></label></div>' +
      '<div style="margin-bottom:6px;"><label>Min rams for full nuke: ' +
        '<input type="number" id="' + ID_PREFIX + 'set-minram" value="' + (t.minRam !== undefined ? t.minRam : 200) +
          '" style="width:60px;font-size:10px;" min="0" max="2000" step="10"></label></div>' +
      '<div style="margin-bottom:6px;"><label>Frontline band (fields): ' +
        '<input type="number" id="' + ID_PREFIX + 'set-band" value="' + (t.frontBand !== undefined ? t.frontBand : 25) +
          '" style="width:60px;font-size:10px;" min="1" max="200" step="1"></label></div>' +
      '<div style="margin-bottom:6px;"><label>Tier colors: ' +
        '<select id="' + ID_PREFIX + 'set-polarity" style="font-size:10px;">' +
        '<option value="B"' + ((ui.colorPolarity || 'B') === 'B' ? ' selected' : '') + '>Full nuke = RED (B)</option>' +
        '<option value="A"' + (ui.colorPolarity === 'A' ? ' selected' : '') + '>Full nuke = GREEN (A)</option>' +
        '</select></label></div>' +

      '<div style="margin-bottom:6px;"><label>Export format: ' +
        '<select id="' + ID_PREFIX + 'set-export" style="font-size:10px;">' +
        '<option value="bbcode"' + (settings.exportFormat === 'bbcode' ? ' selected' : '') + '>BBCode</option>' +
        '<option value="csv"' + (settings.exportFormat === 'csv' ? ' selected' : '') + '>CSV</option>' +
        '</select></label></div>' +

      '<div style="margin-bottom:6px;"><label>Theme: ' +
        '<select id="' + ID_PREFIX + 'set-theme" style="font-size:10px;">' +
        '<option value="parchment"' + ((ui.theme || 'parchment') === 'parchment' ? ' selected' : '') + '>Parchment</option>' +
        '<option value="dark"' + (ui.theme === 'dark' ? ' selected' : '') + '>Dark</option>' +
        '</select></label></div>' +

      '<div style="margin-top:12px;">' +
        '<button class="btn" id="' + ID_PREFIX + 'save-settings" style="font-weight:bold;">Save Settings</button> ' +
        '<button class="btn" id="' + ID_PREFIX + 'clear-cache" style="font-size:9px;">Clear Cache</button>' +
      '</div>';

    // ---- Saved Views sub-panel ----
    var views = (config && config.views) || [];
    html += '<div style="margin-top:14px;padding:6px;background:#f0e0b0;border:1px solid #c0a060;border-radius:2px;">' +
      '<b>Saved Views</b><br/>' +
      '<select id="' + ID_PREFIX + 'view-preset" style="font-size:10px;margin:4px 0;">';
    for (var v = 0; v < views.length; v++) {
      var star = views[v].seed ? '⭐ ' : '';
      html += '<option value="' + escapeHtml(views[v].name) + '">' + star + escapeHtml(views[v].name) + '</option>';
    }
    html += '</select><br/>' +
      '<button class="btn" id="' + ID_PREFIX + 'view-apply" style="font-size:9px;">Apply</button> ' +
      '<button class="btn" id="' + ID_PREFIX + 'view-save" style="font-size:9px;">Save</button> ' +
      '<button class="btn" id="' + ID_PREFIX + 'view-delete" style="font-size:9px;">Delete</button> ' +
      '<button class="btn" id="' + ID_PREFIX + 'view-rename" style="font-size:9px;">Rename</button><br/>' +
      '<button class="btn" id="' + ID_PREFIX + 'view-export" style="font-size:9px;margin-top:4px;">Export config</button> ' +
      '<button class="btn" id="' + ID_PREFIX + 'view-import" style="font-size:9px;margin-top:4px;">Import config</button>' +
      '<textarea id="' + ID_PREFIX + 'view-json" style="width:100%;height:48px;font-size:9px;margin-top:4px;" ' +
        'placeholder="Paste config/views JSON here, then Import"></textarea>' +
      '</div>';

    html += '<div style="margin-top:12px;padding:4px;background:#f0e0b0;border:1px solid #c0a060;border-radius:2px;font-size:9px;color:#7a6840;">' +
      'Village Overview v' + VERSION + ' (config v' + (config ? config.cfgVersion : '?') + ')<br/>' +
      'Per-domain caches: incomings 2m / troops 5m / econ+buildings 15m / map 1h.<br/>' +
      'Clear Cache clears caches but KEEPS your config + saved views.' +
      '</div></div>';

    $panel.html(html);

    // Save handler — NaN-safe coercion via TWConfig.intOr/clampInt.
    $panel.on('click.twset', '#' + ID_PREFIX + 'save-settings', function() {
      settings.includeArchers = $panel.find('#' + ID_PREFIX + 'set-archers').is(':checked');
      settings.nukeThreshold = TWConfig.clampInt(TWConfig.intOr($panel.find('#' + ID_PREFIX + 'set-nuke').val(), 5000), 1000, 50000);
      settings.exportFormat = $panel.find('#' + ID_PREFIX + 'set-export').val();
      var whFull = TWConfig.clampInt(TWConfig.intOr($panel.find('#' + ID_PREFIX + 'set-whfull').val(), 90), 0, 100);
      var front = TWConfig.clampInt(TWConfig.intOr($panel.find('#' + ID_PREFIX + 'set-front').val(), 25), 1, 200);
      var theme = $panel.find('#' + ID_PREFIX + 'set-theme').val();

      // ---- attack/defense tier thresholds (NaN-safe + clamps) ----
      var nukePop = TWConfig.clampInt(TWConfig.intOr($panel.find('#' + ID_PREFIX + 'set-nukepop').val(), 20000), 1000, 50000);
      var defPop = TWConfig.clampInt(TWConfig.intOr($panel.find('#' + ID_PREFIX + 'set-defpop').val(), 20000), 1000, 50000);
      var greenPct = TWConfig.clampInt(TWConfig.intOr($panel.find('#' + ID_PREFIX + 'set-green').val(), 90), 10, 100);
      var orangePct = TWConfig.clampInt(TWConfig.intOr($panel.find('#' + ID_PREFIX + 'set-orange').val(), 40), 5, 100);
      // green (full) MUST be >= orange (partial); auto-swap an inverted pair.
      var swapped = TWConfig.swapIfInverted(orangePct, greenPct); // [lo, hi]
      orangePct = swapped[0];
      greenPct = swapped[1];
      var minRam = TWConfig.clampInt(TWConfig.intOr($panel.find('#' + ID_PREFIX + 'set-minram').val(), 200), 0, 2000);
      var band = TWConfig.clampInt(TWConfig.intOr($panel.find('#' + ID_PREFIX + 'set-band').val(), 25), 1, 200);
      var polarity = ($panel.find('#' + ID_PREFIX + 'set-polarity').val() === 'A') ? 'A' : 'B';

      config = TWConfig.patch(localStore, {
        ui: { includeArchers: settings.includeArchers, exportFormat: settings.exportFormat, theme: theme, colorPolarity: polarity },
        thresholds: {
          nukeThreshold: settings.nukeThreshold, whNearFullPct: whFull, distFrontMax: front,
          targetNukePop: nukePop, targetDefPop: defPop,
          greenFraction: greenPct / 100, orangeFraction: orangePct / 100,
          minRam: minRam, frontBand: band
        }
      });
      // Re-derive flags AND re-JOIN the master model with the new tier thresholds.
      recalculateNukeStatus();
      rebuildMasterModel();
      renderedTabs = {};
      activateTab((config.ui && config.ui.activeTab) || 'dashboard');
      TWTools.UI.toast('Settings saved', 'success');
    });

    // Clear-Cache — REAL keys via collectOverviewCacheKeys; KEEP config.
    $panel.on('click.twset', '#' + ID_PREFIX + 'clear-cache', function() {
      clearAllCaches();
      allTroopData = {};
      troopData = [];
      commandData = [];
      masterRows = [];
      domainData = {};
      renderedTabs = {};
      TWTools.UI.toast('Cache cleared', 'success');
    });

    // ---- Saved Views handlers (namespaced, idempotent) ----
    $panel.on('click.twviews', '#' + ID_PREFIX + 'view-apply', function() {
      var name = $panel.find('#' + ID_PREFIX + 'view-preset').val();
      var patch = TWConfig.applyView(config, name);
      if (patch) {
        config = TWConfig.patch(localStore, patch);
        renderedTabs = {};
        activateTab((config.ui && config.ui.activeTab) || 'dashboard');
        TWTools.UI.toast('Applied view: ' + name, 'success');
      }
    });
    $panel.on('click.twviews', '#' + ID_PREFIX + 'view-save', function() {
      var name = prompt('Save current view as:', 'My view');
      if (!name) return;
      var visible = (config && config.columns && config.columns.visible) || [];
      var filters = (config && config.filters) || [];
      var sort = (config && config.sort) || { key: 'name', dir: 'asc' };
      TWConfig.saveView(config, { name: name, visibleColumns: visible, filters: filters, sort: sort, group: currentGroupId });
      TWConfig.save(localStore, config);
      renderSettings($panel);
      TWTools.UI.toast('View saved: ' + name, 'success');
    });
    $panel.on('click.twviews', '#' + ID_PREFIX + 'view-delete', function() {
      var name = $panel.find('#' + ID_PREFIX + 'view-preset').val();
      TWConfig.deleteView(config, name);
      TWConfig.save(localStore, config);
      renderSettings($panel);
      TWTools.UI.toast('View deleted: ' + name, 'success');
    });
    $panel.on('click.twviews', '#' + ID_PREFIX + 'view-rename', function() {
      var oldName = $panel.find('#' + ID_PREFIX + 'view-preset').val();
      var newName = prompt('Rename view to:', oldName);
      if (!newName) return;
      var before = config.views.length;
      var renamed = TWConfig.renameView(config, oldName, newName);
      if (renamed === config && before === config.views.length) {
        TWTools.UI.toast('Rename failed (name collision?)', 'warning');
      } else {
        config = renamed;
        TWConfig.save(localStore, config);
        renderSettings($panel);
        TWTools.UI.toast('View renamed', 'success');
      }
    });
    $panel.on('click.twviews', '#' + ID_PREFIX + 'view-export', function() {
      copyToClipboard(TWConfig.exportConfig ? TWConfig.exportConfig(config) : JSON.stringify(config));
      TWTools.UI.toast('Config copied to clipboard', 'success');
    });
    $panel.on('click.twviews', '#' + ID_PREFIX + 'view-import', function() {
      var json = $panel.find('#' + ID_PREFIX + 'view-json').val();
      if (TWConfig.importConfig) {
        config = TWConfig.importConfig(localStore, json) || config;
      } else if (TWConfig.importViews) {
        config = TWConfig.importViews(config, json);
        TWConfig.save(localStore, config);
      }
      renderSettings($panel);
      TWTools.UI.toast('Config imported', 'success');
    });
  }

  // ============================================================
  // CLIPBOARD
  // ============================================================

  /**
   * Copy text to clipboard using modern API with fallback.
   * @param {string} text - Text to copy.
   */
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function() { fallbackCopyToClipboard(text); });
    } else {
      fallbackCopyToClipboard(text);
    }
  }

  /**
   * Fallback clipboard copy using a temporary textarea.
   * @param {string} text - Text to copy.
   */
  function fallbackCopyToClipboard(text) {
    var $textarea = $('<textarea/>').val(text)
      .css({ position: 'fixed', opacity: 0, left: '-9999px' }).appendTo('body');
    $textarea[0].select();
    try {
      document.execCommand('copy');
    } catch (e) {
      TWTools.UI.toast('Failed to copy. Please copy manually.', 'error');
    }
    $textarea.remove();
  }

  // ============================================================
  // MAIN CARD INITIALIZATION (8 tabs, lazy render)
  // ============================================================

  /** @type {Array.<{id:string,label:string}>} The 8 tabs. */
  var TABS = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'troops', label: 'Troops' },
    { id: 'economy', label: 'Economy' },
    { id: 'buildings', label: 'Buildings' },
    { id: 'incomings', label: 'Incomings' },
    { id: 'map', label: 'Map' },
    { id: 'commands', label: 'Commands' },
    { id: 'settings', label: 'Settings' }
  ];

  /** @type {boolean} Whether get_config/get_unit_info are loaded (gates ESTIMATE). */
  var worldConfigLoaded = false;
  var loadedWorldConfig = null;
  var loadedUnitSpeeds = null;
  /** @type {?Object} Real per-world unit pops (get_unit_info); null -> UNIT_POP defaults. */
  var loadedUnitPops = null;

  /**
   * Activate (and lazily render) a tab by id. Domain tabs render the master model;
   * dashboard renders cross-domain; commands/settings render their own panels.
   * @param {string} tabId
   */
  function activateTab(tabId) {
    if (!overviewCard) return;
    var $panel = overviewCard.getTabContent(tabId);
    if (!$panel || !$panel.length) return;

    if (tabId !== 'commands') stopCountdown(); // leaving Commands stops the timer

    if (renderedTabs[tabId]) {
      // Already rendered once; refresh only commands (live data) on revisit.
      if (tabId === 'commands') renderCommands($panel, commandData);
      return;
    }
    renderedTabs[tabId] = true;

    if (tabId === 'dashboard') renderDashboard($panel);
    else if (TAB_DOMAIN[tabId]) renderDomainTab($panel, tabId);
    else if (tabId === 'commands') renderCommands($panel, commandData);
    else if (tabId === 'settings') renderSettings($panel);
  }

  /**
   * Initialize the Village Overview card widget (8 tabs, ~1000x580, resizable).
   */
  function init() {
    loadSettings();

    // Load world config + unit info to gate the fake/nuke ESTIMATE (read-only).
    try {
      TWTools.DataFetcher.fetchWorldConfig(function(cfg) {
        loadedWorldConfig = cfg || { speed: 1, unitSpeed: 1 };
        TWTools.DataFetcher.fetchUnitInfo(function(speeds) {
          loadedUnitSpeeds = speeds || OverviewCore.DEFAULT_UNIT_SPEEDS;
          worldConfigLoaded = true;
          // Stash gating world flags onto config for column gating.
          config = TWConfig.patch(localStore, { world: gateFlagsFromWorldConfig(loadedWorldConfig) });
        });
        // Fetch real per-world farm-space pops (fail-safe -> UNIT_POP defaults), so
        // attack/defense tier classification uses the actual world economy.
        if (typeof TWTools.DataFetcher.fetchUnitPops === 'function') {
          TWTools.DataFetcher.fetchUnitPops(function(pops) {
            loadedUnitPops = pops || null;
          });
        }
      });
    } catch (e) { /* world config optional — ESTIMATE simply stays ungated */ }

    // Fetch available village groups in background (populates group state).
    TWTools.DataFetcher.fetchGroups(function(groups) {
      availableGroups = groups;
      var found = false;
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].id === currentGroupId) { found = true; break; }
      }
      if (!found) currentGroupId = '0';
    });

    overviewCard = TWTools.UI.createCard({
      id: ID_PREFIX + 'main',
      title: 'Village Overview',
      version: VERSION,
      width: 1000,
      height: 580,
      minWidth: 700,
      minHeight: 360,
      tabs: TABS,
      onTabChange: function(tabId) {
        config = TWConfig.patch(localStore, { ui: { activeTab: tabId } });
        activateTab(tabId);
      },
      onClose: function() {
        stopCountdown();
        TWTools.UI.toast('Village Overview closed', 'success');
      }
    });

    // Hydrate from cached troops (if present) into the master model so the first
    // tab shows data without a fetch.
    var cachedAll = Store.getCache('troop_all_g' + currentGroupId);
    if (cachedAll && cachedAll.own_home) {
      allTroopData = cachedAll;
      troopData = allTroopData[currentViewType] || [];
      domainData.troops = indexById(troopData);
      try {
        masterRows = OverviewCore.buildMasterModel({ troops: domainData.troops }, { byId: {} }, masterModelThresholds());
      } catch (e) { masterRows = []; }
    }

    // Render the initial (persisted) active tab lazily.
    var initialTab = (config && config.ui && config.ui.activeTab) || 'dashboard';
    var valid = false;
    for (var ti = 0; ti < TABS.length; ti++) { if (TABS[ti].id === initialTab) { valid = true; break; } }
    if (!valid) initialTab = 'dashboard';
    activateTab(initialTab);
    overviewCard.setStatus(masterRows.length
      ? (masterRows.length + ' villages from cache. Click "Fetch All" to refresh.')
      : 'Ready. Click "Fetch All" to build the unified model.');
  }

  /**
   * Derive the world feature-gate flags (archer/church/watchtower/knight) from a
   * loaded world config for COLUMN gating. Unknown -> undefined (column kept).
   * @param {Object} cfg - World config.
   * @returns {Object} Gate flags.
   */
  function gateFlagsFromWorldConfig(cfg) {
    cfg = cfg || {};
    var flags = {};
    if (cfg.archer !== undefined) flags.archer = cfg.archer;
    if (cfg.church !== undefined) flags.church = cfg.church;
    if (cfg.watchtower !== undefined) flags.watchtower = cfg.watchtower;
    if (cfg.knight !== undefined) flags.knight = cfg.knight;
    if (cfg.game && cfg.game.archer !== undefined) flags.archer = cfg.game.archer;
    if (cfg.game && cfg.game.church !== undefined) flags.church = cfg.game.church;
    if (cfg.game && cfg.game.watchtower !== undefined) flags.watchtower = cfg.game.watchtower;
    if (cfg.game && cfg.game.knight !== undefined) flags.knight = cfg.game.knight;
    return flags;
  }

  // ============================================================
  // ORCHESTRATOR HANDLE (additive — the 8-tab UI consumes this in M6)
  // ============================================================
  //
  // The Fetch-All spine is exposed without touching the existing tabs so M6 can
  // drive the Dashboard/domain tabs from the unified master model. Reading these
  // never triggers a fetch; the existing Troops/Commands/Settings flow is unchanged.

  TWTools.OverviewOrchestrator = TWTools.OverviewOrchestrator || {
    runFetchAll: runFetchAll,
    getMasterRows: function() { return masterRows; },
    getDomainData: function() { return domainData; },
    getPremiumNote: function() { return premiumNote; },
    getWorldKey: function() { return currentWorldKey; },
    cacheKeyFor: function(domain) {
      return OverviewCore.cacheKeyFor(domain, currentGroupId, currentWorldKey);
    },
    isFetching: function() { return fetchLock; }
  };

  // ============================================================
  // AUTO-START
  // ============================================================

  $(function() {
    if (!TWTools.getPlayerId()) {
      return; // Not logged in or not in game
    }

    init();
    TWTools.UI.toast('Troop Overview v' + VERSION + ' loaded', 'success');
  });

})(window, jQuery);
