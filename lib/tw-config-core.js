/**
 * tw-config-core — versioned config + saved-view presets for the Overview suite.
 *
 * @version 2.0.0
 * @pure    No DOM / jQuery / localStorage / window references at module load.
 *          Persistence is performed only through an injected STORE ADAPTER, so the
 *          whole module is node-testable with a fake store.
 *
 * ONE file, two runtimes (node-compat envelope — see
 * tasks/2026-06-23-tw-overview-ultimate/node-compat-envelope.md):
 *   - In the browser bundle it attaches TWTools.Config (idempotent, first-wins).
 *   - Under node it is require()-able and exports the same API object.
 *
 * CACHE-KEY CONTRACT (do NOT double-prefix): CONFIG_KEY is the BARE 'config'. The
 * caller's Store wrapper prepends 'two_' and tw-core's Storage prepends 'twt_', so
 * the REAL localStorage key is `twt_two_config`. This lib NEVER touches localStorage
 * and NEVER re-prefixes — every read/write goes through the store adapter's get/set.
 *
 * Two-tier persistence: the config blob (this lib) has NO TTL; per-domain data
 * caches (the orchestrator) live in a SEPARATE tier with TTLs.
 *
 * Conventions adopted from the user's own scripts: versioned spread-merge config
 * ({...DEFAULTS, ...parsed}) + dated migrateConfig() that restores the SAVED
 * cfgVersion BEFORE migrating; hydrate-first patch-merge on save (partial writes
 * never clobber siblings); saved views [{name,visibleColumns,filters,sort,group}]
 * with import/export; NaN-safe intOr + clamps + auto-swap inverted pairs; defensive
 * try/catch everywhere (fail-safe: never throw; unknown/missing -> DEFAULT_CONFIG).
 */
;(function (root, $) {
  'use strict';

  // Non-throwing namespace guard. In node `root` is globalThis (or the test's
  // global.window); attach unconditionally — this lib has NO DOM behaviour, so it
  // is always safe to expose, and node:test reads window.TWTools.Config.
  var TWTools = (root && root.TWTools) || (root && (root.TWTools = {})) || {};

  // ============================================================
  // VERSION + SCHEMA
  // ============================================================

  var CONFIG_VERSION = 3;

  // BARE key — the Store/Storage adapters add the two_/twt_ prefixes. Reading
  // TWTools.Storage.get('config') directly would MISS the real twt_two_config key.
  var CONFIG_KEY = 'config';

  /**
   * The 5 seeded view presets. Each references REAL COLUMN_REGISTRY keys (see
   * lib/tw-overview-core.js COLUMN_REGISTRY) so they are immediately functional in
   * the table engine. Filter/sort keys are inert DATA owned by the registry — the
   * table engine no-ops unknown/stale keys, so this stays forward-compatible.
   *
   * The ⭐ star is a UI-only label; the STORED name carries NO star.
   * @type {Array.<Object>}
   */
  var SEED_VIEWS = [
    {
      name: 'Front Nukes',
      visibleColumns: ['name', 'coords', 'off', 'snob', 'distFront', 'isNuke'],
      filters: [
        { key: 'isNuke', op: 'eq', value: true },
        { key: 'distFront', op: 'lte', value: 25 }
      ],
      sort: [{ key: 'off', dir: 'desc' }],
      group: '0',
      seed: true
    },
    {
      name: 'Eco low-WH',
      visibleColumns: ['name', 'coords', 'whFillPct', 'wood', 'clay', 'iron'],
      filters: [
        { key: 'whFillPct', op: 'lte', value: 60 }
      ],
      sort: [{ key: 'whFillPct', dir: 'asc' }],
      group: '0',
      seed: true
    },
    {
      name: 'Defense Gaps',
      visibleColumns: ['name', 'coords', 'defPower', 'incCount', 'nukesEst', 'underDefended'],
      filters: [
        { key: 'underDefended', op: 'eq', value: true }
      ],
      sort: [{ key: 'nukesEst', dir: 'desc' }],
      group: '0',
      seed: true
    },
    {
      name: 'Frontline',
      visibleColumns: ['name', 'coords', 'continent', 'distFront', 'points'],
      filters: [
        { key: 'distFront', op: 'lte', value: 25 }
      ],
      sort: [{ key: 'distFront', dir: 'asc' }],
      group: '0',
      seed: true
    },
    {
      name: 'Full-offense-ready',
      visibleColumns: ['name', 'coords', 'off', 'snob', 'total', 'isNuke'],
      filters: [
        { key: 'off', op: 'gte', value: 0 },
        { key: 'isNuke', op: 'eq', value: true }
      ],
      sort: [{ key: 'off', dir: 'desc' }],
      group: '0',
      seed: true
    },
    // ---- v3 curated tier presets (reference REAL registry keys) ----
    {
      name: 'Send-out wave',
      visibleColumns: ['name', 'coords', 'attackTier', 'nukePercent', 'ram', 'snob'],
      filters: [
        { key: 'attackTier', op: 'tier', value: 'full' },
        { key: 'hasIncomings', op: 'eq', value: false }
      ],
      sort: [{ key: 'nukePercent', dir: 'desc' }],
      group: '0',
      seed: true
    },
    {
      name: 'Defense needed',
      visibleColumns: ['name', 'coords', 'defTier', 'defPercent', 'incCount', 'underDefended'],
      filters: [
        { key: 'underDefended', op: 'eq', value: true }
      ],
      sort: [{ key: 'defPercent', dir: 'asc' }],
      group: '0',
      seed: true
    },
    {
      name: 'Economy overflow',
      visibleColumns: ['name', 'coords', 'whFillPct', 'wood', 'clay', 'iron', 'whNearFull'],
      filters: [
        { key: 'whNearFull', op: 'eq', value: true }
      ],
      sort: [{ key: 'whFillPct', dir: 'desc' }],
      group: '0',
      seed: true
    },
    {
      name: 'Noble-ready',
      visibleColumns: ['name', 'coords', 'snob', 'nobleTrainReady', 'academyReady', 'nukePercent'],
      filters: [
        { key: 'nobleTrainReady', op: 'eq', value: true }
      ],
      sort: [{ key: 'snob', dir: 'desc' }],
      group: '0',
      seed: true
    },
    {
      name: 'Fakes available',
      visibleColumns: ['name', 'coords', 'attackTier', 'nukePercent', 'fakeAvailable'],
      filters: [
        { key: 'fakeAvailable', op: 'eq', value: true }
      ],
      sort: [{ key: 'name', dir: 'asc' }],
      group: '0',
      seed: true
    }
  ];

  /**
   * The full default config blob (cfgVersion 2). Spread-merged UNDER the saved blob
   * so new keys appear forward-compatibly. `views` is backfilled from SEED_VIEWS.
   * @type {Object}
   */
  var DEFAULT_CONFIG = {
    cfgVersion: CONFIG_VERSION,
    thresholds: {
      nukeThreshold: 5000,
      includeArchers: false,
      defThreshold: 0,
      whNearFullPct: 90,
      fullPct: 100,
      distFrontMax: 25,
      // attack/defense tier classification (farm-space based)
      targetNukePop: 20000,
      greenFraction: 0.90,
      orangeFraction: 0.40,
      minRam: 200,
      targetDefPop: 20000,
      frontBand: 25
    },
    ui: {
      includeArchers: false,
      exportFormat: 'bbcode',
      viewType: 'own_home',
      groupId: '0',
      activeTab: 'troops',
      theme: 'parchment',
      colorPolarity: 'B' // B = full nuke RED (default); A = inverted
    },
    columns: { visible: ['name', 'total'], order: [] },
    filters: [],
    sort: [{ key: 'name', dir: 'asc' }],
    views: cloneViews(SEED_VIEWS)
  };

  // ============================================================
  // COERCION HELPERS (NaN-safe)
  // ============================================================

  /**
   * Parse an int, falling back when the result is NaN. Leading-number tolerant
   * (parseInt semantics) so '12px' -> 12.
   * @param {*} v
   * @param {number} fallback
   * @returns {number}
   */
  function intOr(v, fallback) {
    var n = parseInt(v, 10);
    return isNaN(n) ? (fallback || 0) : n;
  }

  /**
   * Clamp an int to [min,max]. NaN -> min. Default min 0 (never negative).
   * @param {*} v
   * @param {number} [min=0]
   * @param {number} [max=Infinity]
   * @returns {number}
   */
  function clampInt(v, min, max) {
    if (min === undefined || min === null) min = 0;
    if (max === undefined || max === null) max = Infinity;
    var n = parseInt(v, 10);
    if (isNaN(n)) n = min;
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
  }

  /**
   * Auto-swap an inverted (min,max) pair so [lo,hi] is always returned.
   * @param {number} a
   * @param {number} b
   * @returns {[number, number]}
   */
  function swapIfInverted(a, b) {
    return (a > b) ? [b, a] : [a, b];
  }

  // ============================================================
  // DEEP CLONE / MERGE
  // ============================================================

  function isPlainObject(o) {
    return o !== null && typeof o === 'object' && !Array.isArray(o);
  }

  /** Structural deep clone (objects + arrays; primitives by value). @private */
  function deepClone(v) {
    if (Array.isArray(v)) {
      var arr = [];
      for (var i = 0; i < v.length; i++) arr.push(deepClone(v[i]));
      return arr;
    }
    if (isPlainObject(v)) {
      var out = {};
      for (var k in v) { if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = deepClone(v[k]); }
      return out;
    }
    return v;
  }

  function cloneViews(views) {
    return deepClone(Array.isArray(views) ? views : []);
  }

  /**
   * Coerce a sort spec into the canonical multi-key ARRAY form [{key,dir}], the shape
   * required by Table.applyMultiSort / OverviewCore.sortBy. Accepts an array (validated),
   * a single {key,dir} object (wrapped), or anything else (-> default name-asc).
   * @param {*} s
   * @returns {Array.<{key:string, dir:string}>}
   * @private
   */
  function normalizeSort(s) {
    var arr = Array.isArray(s) ? s : (isPlainObject(s) ? [s] : []);
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i];
      if (isPlainObject(e) && typeof e.key === 'string' && e.key) {
        out.push({ key: e.key, dir: (e.dir === 'desc') ? 'desc' : 'asc' });
      }
    }
    return out.length ? out : [{ key: 'name', dir: 'asc' }];
  }

  /**
   * Deep-merge `patch` onto a deep clone of `base`. Plain objects recurse; arrays
   * and primitives REPLACE wholesale (never element-merged). A null/undefined patch
   * yields a deep clone of base.
   * @param {Object} base
   * @param {?Object} patch
   * @returns {Object}
   */
  function deepMerge(base, patch) {
    var out = deepClone(isPlainObject(base) ? base : {});
    if (patch === null || patch === undefined || !isPlainObject(patch)) return out;
    for (var k in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
      var pv = patch[k];
      if (isPlainObject(pv) && isPlainObject(out[k])) {
        out[k] = deepMerge(out[k], pv);
      } else {
        out[k] = deepClone(pv); // array / primitive / new object -> replace wholesale
      }
    }
    return out;
  }

  /**
   * Spread the defaults UNDER the saved partial so new keys appear forward-
   * compatibly, then stamp cfgVersion. A non-plain-object partial yields a stamped
   * clone of the defaults.
   * @param {?Object} partial
   * @param {Object} [defaults=DEFAULT_CONFIG]
   * @returns {Object}
   */
  function mergeDefaults(partial, defaults) {
    var d = isPlainObject(defaults) ? defaults : DEFAULT_CONFIG;
    var out;
    if (!isPlainObject(partial)) {
      out = deepClone(d);
    } else {
      out = deepMerge(deepClone(d), partial);
    }
    out.cfgVersion = CONFIG_VERSION;
    return out;
  }

  // ============================================================
  // SEEDED VIEWS (merge-by-name, never overwrite user edits)
  // ============================================================

  /**
   * Merge the SEED_VIEWS into an existing view list by name — a seed is cloned in
   * ONLY when no existing view already shares its name (user edits to a seed-named
   * view are never overwritten). Idempotent: re-seeding a seeded list is a no-op.
   * @param {Array.<Object>} [views]
   * @returns {Array.<Object>}
   */
  function seedViews(views) {
    var out = Array.isArray(views) ? deepClone(views) : [];
    var have = {};
    for (var i = 0; i < out.length; i++) {
      if (out[i] && typeof out[i].name === 'string') have[out[i].name] = true;
    }
    for (var s = 0; s < SEED_VIEWS.length; s++) {
      if (!have[SEED_VIEWS[s].name]) out.push(deepClone(SEED_VIEWS[s]));
    }
    return out;
  }

  // ============================================================
  // MIGRATION (dated; restore SAVED version before migrating)
  // ============================================================

  /**
   * Import the legacy flat two_* keys into an UN-STAMPED v2 partial blob.
   * Guarded: non-object -> {}.
   * @param {?Object} legacy - {settings:{includeArchers,nukeThreshold,exportFormat}, viewType, groupId}
   * @returns {Object}
   */
  function migrate_v1_to_v2(legacy) {
    if (!isPlainObject(legacy)) return {};
    var s = isPlainObject(legacy.settings) ? legacy.settings : {};
    return {
      ui: {
        includeArchers: !!s.includeArchers,
        exportFormat: (s.exportFormat === 'csv' ? 'csv' : 'bbcode'),
        viewType: legacy.viewType || 'own_home',
        groupId: (legacy.groupId !== undefined && legacy.groupId !== null) ? String(legacy.groupId) : '0'
      },
      thresholds: {
        includeArchers: !!s.includeArchers,
        nukeThreshold: intOr(s.nukeThreshold, DEFAULT_CONFIG.thresholds.nukeThreshold)
      }
    };
  }

  /**
   * Restore the SAVED cfgVersion first, then apply dated migrations. Never throws —
   * unknown/garbage/missing -> a freshly merged DEFAULT_CONFIG. The seeded views are
   * always backfilled; an existing views array is preserved.
   * @param {*} raw - The saved config blob (any shape, possibly garbage).
   * @param {?Object} [legacy] - Legacy flat two_* keys, used when there is no v2 blob.
   * @returns {Object} A valid v2 config.
   */
  function migrateConfig(raw, legacy) {
    try {
      // finalize: re-seed views, never drop a saved view.
      function finalize(cfg) {
        var existing = (isPlainObject(raw) && Array.isArray(raw.views)) ? raw.views
          : (Array.isArray(cfg.views) ? cfg.views : []);
        cfg.views = seedViews(existing);
        cfg.cfgVersion = CONFIG_VERSION;
        return cfg;
      }

      if (isPlainObject(raw) && typeof raw.cfgVersion === 'number' && !isNaN(raw.cfgVersion)) {
        var v = raw.cfgVersion;
        if (v === CONFIG_VERSION) {
          return finalize(mergeDefaults(raw));
        }
        if (v < CONFIG_VERSION) {
          // Dated step chain (restore-saved-before-migrate). v1->v2 (legacy import),
          // v2->v3 (tier thresholds + colorPolarity + curated presets). mergeDefaults
          // spreads the new v3 defaults UNDER the saved blob, so the new threshold
          // keys / ui.colorPolarity appear forward-compatibly; seedViews backfills
          // the 5 new presets without clobbering user-edited same-name views.
          var stepped = mergeDefaults(raw);
          // (future) v3 -> v4 slot goes here.
          return finalize(stepped);
        }
        // A newer/unknown version: take what we can, stamp down to ours.
        return finalize(mergeDefaults(raw));
      }

      // No v2 blob — import legacy flat keys when present.
      var base = (legacy !== undefined && legacy !== null) ? migrate_v1_to_v2(legacy) : null;
      return finalize(mergeDefaults(base));
    } catch (e) {
      return mergeDefaults(null);
    }
  }

  // ============================================================
  // PRESET CRUD
  // ============================================================

  function viewIndexByName(views, name) {
    if (!Array.isArray(views)) return -1;
    for (var i = 0; i < views.length; i++) {
      if (views[i] && views[i].name === name) return i;
    }
    return -1;
  }

  /**
   * Upsert a view by name into config.views (seed flag forced false). Fail-safe:
   * an invalid view returns the config unchanged.
   * @param {Object} config
   * @param {Object} view - {name, visibleColumns, filters, sort, group}
   * @returns {Object} A NEW config object.
   */
  function saveView(config, view) {
    if (!isPlainObject(config) || !isPlainObject(view) || typeof view.name !== 'string' || !view.name) {
      return config;
    }
    var out = deepMerge(config, {});
    var stored = deepClone(view);
    stored.seed = false;
    stored.sort = normalizeSort(view.sort); // keep the canonical multi-key array shape
    var idx = viewIndexByName(out.views, view.name);
    if (idx === -1) { out.views.push(stored); } else { out.views[idx] = stored; }
    return out;
  }

  /**
   * Remove a view by name. No-op (returns the SAME config) when absent.
   * @param {Object} config
   * @param {string} name
   * @returns {Object}
   */
  function deleteView(config, name) {
    if (!isPlainObject(config) || viewIndexByName(config.views, name) === -1) return config;
    var out = deepMerge(config, {});
    out.views = out.views.filter(function (v) { return !(v && v.name === name); });
    return out;
  }

  /**
   * Rename a view. Returns the config UNCHANGED (reference-equal) on a name
   * collision, a missing source, or a no-op rename.
   * @param {Object} config
   * @param {string} fromName
   * @param {string} toName
   * @returns {Object}
   */
  function renameView(config, fromName, toName) {
    if (!isPlainObject(config) || typeof toName !== 'string' || !toName) return config;
    if (fromName === toName) return config;
    if (viewIndexByName(config.views, fromName) === -1) return config;
    if (viewIndexByName(config.views, toName) !== -1) return config; // collision
    var out = deepMerge(config, {});
    var idx = viewIndexByName(out.views, fromName);
    out.views[idx].name = toName;
    return out;
  }

  /**
   * Build a patch-shaped object (ui + columns.visible + filters + sort) for the
   * named view, or null when the view does not exist.
   * @param {Object} config
   * @param {string} name
   * @returns {?Object}
   */
  function applyView(config, name) {
    if (!isPlainObject(config)) return null;
    var idx = viewIndexByName(config.views, name);
    if (idx === -1) return null;
    var v = config.views[idx];
    return {
      ui: (v.group !== undefined && v.group !== null) ? { groupId: String(v.group) } : {},
      columns: { visible: Array.isArray(v.visibleColumns) ? v.visibleColumns.slice() : [] },
      filters: Array.isArray(v.filters) ? deepClone(v.filters) : [],
      // sort is a multi-key ARRAY [{key,dir}] (matches Table.applyMultiSort / OverviewCore.sortBy).
      // Coerce a legacy single-object sort into a one-element array for forward-compat.
      sort: normalizeSort(v.sort)
    };
  }

  // ============================================================
  // IMPORT / EXPORT
  // ============================================================

  /**
   * Serialize config.views to a JSON string.
   * @param {Object} config
   * @returns {string}
   */
  function exportViews(config) {
    try {
      var views = (isPlainObject(config) && Array.isArray(config.views)) ? config.views : [];
      return JSON.stringify(views);
    } catch (e) {
      return '[]';
    }
  }

  /**
   * Merge a JSON array of views into config (merge-by-name + re-seed). Returns the
   * config UNCHANGED (reference-equal) on a parse error or a non-array payload.
   * @param {Object} config
   * @param {string} json
   * @returns {Object}
   */
  function importViews(config, json) {
    if (!isPlainObject(config)) return config;
    var parsed;
    try { parsed = JSON.parse(json); } catch (e) { return config; }
    if (!Array.isArray(parsed)) return config;
    var out = deepMerge(config, {});
    var merged = Array.isArray(out.views) ? out.views.slice() : [];
    for (var i = 0; i < parsed.length; i++) {
      var v = parsed[i];
      if (!isPlainObject(v) || typeof v.name !== 'string') continue;
      var idx = viewIndexByName(merged, v.name);
      if (idx === -1) { merged.push(deepClone(v)); } else { merged[idx] = deepClone(v); }
    }
    out.views = seedViews(merged);
    return out;
  }

  // ============================================================
  // LOAD / SAVE / PATCH (store adapter; hydrate-first)
  // ============================================================

  /**
   * Load the config via the store adapter. Migrates a saved v2 blob OR the legacy
   * flat two_* keys (settings / view_type / group_id), then persists+returns the
   * stamped v2 config. Legacy keys are NOT removed (non-destructive migration).
   * @param {{get:function, set:function, remove?:function}} store
   * @returns {Object}
   */
  function load(store) {
    var raw = store ? store.get(CONFIG_KEY) : null;
    var legacy = store ? {
      settings: store.get('settings'),
      viewType: store.get('view_type'),
      groupId: store.get('group_id')
    } : null;
    var cfg = migrateConfig(raw, legacy);
    save(store, cfg);
    return cfg;
  }

  /**
   * Persist the config under the bare CONFIG_KEY (the adapter adds prefixes).
   * @param {{set:function}} store
   * @param {Object} config
   * @returns {Object} The same config.
   */
  function save(store, config) {
    if (store && typeof store.set === 'function') store.set(CONFIG_KEY, config);
    return config;
  }

  /**
   * Hydrate-first patch-merge: read the current config, deep-merge the partial,
   * re-stamp the version, persist, and return it. Partial writes never clobber
   * sibling keys (or the views array).
   * @param {{get:function, set:function}} store
   * @param {Object} partial
   * @returns {Object}
   */
  function patch(store, partial) {
    var cur = mergeDefaults(store ? store.get(CONFIG_KEY) : null);
    var merged = deepMerge(cur, isPlainObject(partial) ? partial : {});
    merged.cfgVersion = CONFIG_VERSION;
    return save(store, merged);
  }

  // ============================================================
  // PUBLIC API + node-compat tail
  // ============================================================

  var Config = {
    CONFIG_VERSION: CONFIG_VERSION,
    CONFIG_KEY: CONFIG_KEY,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    SEED_VIEWS: SEED_VIEWS,
    // merge / coercion
    deepMerge: deepMerge,
    mergeDefaults: mergeDefaults,
    intOr: intOr,
    clampInt: clampInt,
    swapIfInverted: swapIfInverted,
    // migration
    migrateConfig: migrateConfig,
    migrate_v1_to_v2: migrate_v1_to_v2,
    // presets
    seedViews: seedViews,
    saveView: saveView,
    deleteView: deleteView,
    renameView: renameView,
    applyView: applyView,
    exportViews: exportViews,
    importViews: importViews,
    // persistence (store adapter)
    load: load,
    save: save,
    patch: patch
  };

  // Attach browser surface only-if-absent (idempotent, first-loaded-wins,
  // matching tw-core.js ~1034).
  TWTools.Config = TWTools.Config || Config;

  // Node-compat tail — inert in-browser (typeof module === 'undefined').
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Config;
  }

})(
  typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this),
  typeof jQuery !== 'undefined' ? jQuery : undefined
);
