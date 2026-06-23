/**
 * tw-overview-core — the pure heart of the Overview dashboard.
 *
 * @version 2.0.0
 * @pure  Every exported function is a pure string/data transform: it NEVER touches
 *        the DOM, window, $ or the network at module top level, and NEVER throws —
 *        bad input yields []/{}/0/null. The single jQuery-touching seam,
 *        extractRowMatrix(html, $), takes $ as an injected param and early-returns
 *        when it is absent (browser-only; not node-tested).
 *
 * ESTIMATE WARNING: estimateAttackUnits / classifyTrainKind infer the unit/train kind
 *        from travel time. They are ESTIMATES (with a confidence label), never certainty.
 *
 * TW DOM quirk: the clay column's element carries class="stone" — UNIT_HEADER_ALIASES
 *        and the prod config alias 'stone' -> 'clay'.
 *
 * RowMatrix typedef (produced by extractRowMatrix in-browser, by the html-to-rowmatrix
 * test tokenizer in node — identical shape):
 *   {
 *     headers:     [{ text, iconSrc, cssClass, colIndex }],
 *     rows:        [{ cells: [{ text, iconSrc, cssClass, links: [{ href, text }] }] }],
 *     hasNextPage: boolean,
 *     infoBoxText: string
 *   }
 *
 * Node-compat envelope: dual browser-IIFE + module.exports tail (see
 * tasks/2026-06-23-tw-overview-ultimate/node-compat-envelope.md).
 */
;(function (root, $) {
  'use strict';

  var TWTools = root.TWTools || (root.TWTools = {});

  // ============================================================
  // UNIT CONSTANT TABLES (single source of truth — moved VERBATIM
  // from scripts/tw-overview.js:47-82)
  // ============================================================

  /** All unit types in standard TW display order. */
  var ALL_UNITS = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];

  /** Units without archers. */
  var UNITS_NO_ARCHERS = ['spear', 'sword', 'axe', 'spy', 'light', 'heavy', 'ram', 'catapult', 'knight', 'snob'];

  /** Offensive units for power calculation. */
  var OFFENSIVE_UNITS = ['axe', 'light', 'ram', 'catapult'];

  /** Defensive units for power calculation. */
  var DEFENSIVE_UNITS = ['spear', 'sword', 'heavy'];

  /** Offensive archer units (added only when includeArchers). */
  var OFFENSIVE_ARCHER_UNITS = ['marcher'];

  /** Defensive archer units (added only when includeArchers). */
  var DEFENSIVE_ARCHER_UNITS = ['archer'];

  /** Offensive attack values per unit (used for power estimation). */
  var ATTACK_VALUES = {
    spear: 10, sword: 25, axe: 40, archer: 15,
    spy: 0, light: 130, marcher: 120, heavy: 150,
    ram: 2, catapult: 100, knight: 150, snob: 30
  };

  /** General defense values per unit (infantry). */
  var DEF_VALUES = {
    spear: 15, sword: 50, axe: 10, archer: 50,
    spy: 2, light: 30, marcher: 40, heavy: 200,
    ram: 20, catapult: 8, knight: 250, snob: 100
  };

  /**
   * Header-icon token -> canonical unit/key alias map.
   * The TW DOM quirk: the clay column's icon/class is "stone" -> 'clay'.
   * Every unit maps to its own identity so buildColumnMap can normalize uniformly.
   */
  var UNIT_HEADER_ALIASES = {
    stone: 'clay', wood: 'wood', iron: 'iron',
    spear: 'spear', sword: 'sword', axe: 'axe', archer: 'archer',
    spy: 'spy', light: 'light', marcher: 'marcher', heavy: 'heavy',
    ram: 'ram', catapult: 'catapult', knight: 'knight', snob: 'snob'
  };

  // Default unit speeds (minutes per field) — mirror of tw-core DEFAULT_UNIT_SPEEDS,
  // kept local so the pure layer never reads a bare global at load time.
  var DEFAULT_UNIT_SPEEDS = {
    spear: 18, sword: 22, axe: 18, archer: 18, spy: 9,
    light: 10, marcher: 10, heavy: 11,
    ram: 30, catapult: 30, knight: 10, snob: 35
  };

  // ============================================================
  // NUMBER / COORD PARSING
  // ============================================================

  /**
   * Locale-tolerant integer parse. Strips spaces (incl. NBSP) and thousands
   * separators ('.' / ','), keeps a leading '-', never returns NaN.
   * @param {*} text - Raw cell text.
   * @returns {number} Parsed integer (0 on failure).
   */
  function parseLocaleNumber(text) {
    if (text === null || text === undefined) return 0;
    var s = String(text);
    // Strip all whitespace incl. NBSP ( ) and thin/figure spaces.
    s = s.replace(/[\s   ]/g, '');
    // Strip thousands separators.
    s = s.replace(/[.,]/g, '');
    // Keep only digits and a leading minus.
    var neg = /^-/.test(s);
    s = s.replace(/[^\d]/g, '');
    if (!s) return 0;
    var n = parseInt(s, 10);
    if (isNaN(n)) return 0;
    return neg ? -n : n;
  }

  /**
   * Extract a coordinate substring "x|y" from text (verbatim from
   * tw-overview.js:755).
   * @param {string} text - Text potentially containing "x|y".
   * @returns {string} "x|y" or "".
   */
  function extractCoords(text) {
    var match = (text || '').match(/(\d{1,3}\|\d{1,3})/);
    return match ? match[1] : '';
  }

  /**
   * Parse a coordinate object {x, y} from text (mirrors tw-core.parseCoords).
   * @param {string} text - Text potentially containing "x|y".
   * @returns {?{x:number, y:number}} Coords or null.
   */
  function parseCoordsObj(text) {
    var m = (text || '').match(/(\d{1,3})\|(\d{1,3})/);
    if (!m) return null;
    return { x: parseInt(m[1], 10), y: parseInt(m[2], 10) };
  }

  // ============================================================
  // COLUMN MAPPING + GENERALIZED TABLE PARSER
  // ============================================================

  /**
   * Map header cells to data keys by header <img src> (group 1 of headerIconRegex)
   * or class fallback, normalizing through aliasMap. NEVER by hardcoded index.
   * @param {Array} headers - RowMatrix headers.
   * @param {RegExp} headerIconRegex - Regex with a capture group for the token.
   * @param {Object} [aliasMap] - token -> canonical key.
   * @returns {Object.<string, number>} key -> colIndex.
   */
  function buildColumnMap(headers, headerIconRegex, aliasMap) {
    var map = {};
    if (!Array.isArray(headers)) return map;
    aliasMap = aliasMap || {};
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i] || {};
      var token = null;
      var srcM = headerIconRegex && (h.iconSrc || '').match(headerIconRegex);
      if (srcM && srcM[1]) {
        token = srcM[1];
      } else {
        // class fallbacks: unit-type-<x>, or a bare class token that matches alias.
        var cls = h.cssClass || '';
        var clsM = cls.match(/unit-type-(\w+)/);
        if (clsM) {
          token = clsM[1];
        } else {
          // Any whitespace-separated class token that is a known alias key.
          var parts = cls.split(/\s+/);
          for (var p = 0; p < parts.length; p++) {
            if (parts[p] && (aliasMap[parts[p]] || UNIT_HEADER_ALIASES[parts[p]])) {
              token = parts[p];
              break;
            }
          }
        }
      }
      if (token) {
        var key = aliasMap[token] || UNIT_HEADER_ALIASES[token] || token;
        if (map[key] === undefined) map[key] = (h.colIndex !== undefined ? h.colIndex : i);
      }
    }
    return map;
  }

  /**
   * Detect the village id / name / coords from a row's cells via link patterns.
   * Returns null when the row carries no village link (a 5-row sub-row).
   * @param {Object} row - RowMatrix row.
   * @param {RegExp} idLinkPattern - e.g. /village=(\d+)/.
   * @returns {?{id:number, name:string, coords:string}}
   */
  function detectIdentity(row, idLinkPattern) {
    if (!row || !Array.isArray(row.cells)) return null;
    for (var c = 0; c < row.cells.length; c++) {
      var cell = row.cells[c];
      var links = (cell && cell.links) || [];
      for (var l = 0; l < links.length; l++) {
        var href = links[l].href || '';
        var text = links[l].text || '';
        var coords = extractCoords(text);
        // A village identity link: matches the id pattern AND carries coords.
        var idM = href.match(idLinkPattern);
        if (idM && coords) {
          var name = text.replace(/\s*\(\d{1,3}\|\d{1,3}\)\s*K?\d*\s*$/, '').trim();
          return { id: parseInt(idM[1], 10), name: name, coords: coords };
        }
      }
    }
    return null;
  }

  /**
   * Detect whether the infoBoxText signals an empty group ("village does not belong",
   * multi-lang).
   * @param {string} infoBoxText
   * @returns {?string} The message when it is an empty-group notice, else null.
   */
  function detectEmptyGroup(infoBoxText) {
    if (!infoBoxText) return null;
    var t = String(infoBoxText).toLowerCase();
    var tokens = ['nepatr', 'belong', 'gehört', 'gehort', 'no villages', 'keine', 'no result', 'žiadne', 'ziadne'];
    for (var i = 0; i < tokens.length; i++) {
      if (t.indexOf(tokens[i]) !== -1) return infoBoxText;
    }
    return null;
  }

  /**
   * Generalized overview-table parser shared by units|prod|buildings|incomings.
   * Maps data columns by header icon/class (never indices); handles the 5-row
   * sub-row offset (parent rows carry the village link, sub-rows are shifted by 1).
   * Fail-safe: any error -> {rows:[], villages:[], hasNextPage:false}.
   *
   * @param {Object} matrix - RowMatrix {headers, rows, hasNextPage, infoBoxText}.
   * @param {Object} cfg - Domain config (DOMAIN_CONFIGS.*).
   * @returns {{rows:Array, villages:Array, hasNextPage:boolean, emptyGroup?:string}}
   */
  function parseOverviewTable(matrix, cfg) {
    var empty = { rows: [], villages: [], hasNextPage: false };
    try {
      if (!matrix || typeof matrix !== 'object') return empty;
      cfg = cfg || {};
      var headers = matrix.headers || [];
      var rawRows = matrix.rows || [];
      var hasNextPage = !!matrix.hasNextPage;

      var emptyMsg = detectEmptyGroup(matrix.infoBoxText);
      if (emptyMsg) {
        return { rows: [], villages: [], hasNextPage: false, emptyGroup: emptyMsg };
      }

      var idLinkPattern = cfg.idColLinkPattern || /village=(\d+)/;
      var colMap = buildColumnMap(headers, cfg.headerIconRegex, cfg.aliasMap);
      var cellReaders = cfg.cellReaders || {};
      var emitSubRows = !!cfg.emitSubRows; // incomings: every row is its own record

      var out = [];
      var current = null;

      for (var r = 0; r < rawRows.length; r++) {
        var row = rawRows[r];
        if (!row || !Array.isArray(row.cells)) continue;

        var identity = detectIdentity(row, idLinkPattern);
        var hasLink = !!identity;

        if (emitSubRows) {
          // Each row is a standalone record (incomings). Skip rows with no identity.
          if (!identity) continue;
          var rec = readRowData(row, colMap, cellReaders, 0, cfg);
          rec.id = identity.id;
          rec.name = identity.name;
          rec.coords = identity.coords;
          var co = parseCoordsObj(identity.coords);
          if (co) { rec.x = co.x; rec.y = co.y; }
          // Optional secondary extractions (source/player) for incomings.
          if (typeof cfg.rowEnhancer === 'function') cfg.rowEnhancer(rec, row, cfg);
          out.push(rec);
          continue;
        }

        // Multi-row-per-village mode (units/prod/buildings): parent row has the link.
        if (hasLink) {
          current = identity;
        }
        if (!current) continue;

        // Parent rows: offset 0. Sub-rows (no link): shifted by 1 (missing name cell).
        var cellOffset = hasLink ? 0 : 1;
        var data = readRowData(row, colMap, cellReaders, cellOffset, cfg);

        // For units/buildings/prod we keep ONE row per village (the parent row),
        // mirroring the dedup-by-id contract. We record only parent rows here;
        // sub-row category handling is done by splitByCategory on the raw rows.
        if (hasLink) {
          data.id = current.id;
          data.name = current.name;
          data.coords = current.coords;
          var c2 = parseCoordsObj(current.coords);
          if (c2) { data.x = c2.x; data.y = c2.y; }
          data.category = cfg.parentCategory || 'own_home';
          out.push(data);
        }
      }

      // Multi-row-per-village domains dedup by village id; incomings (emitSubRows)
      // keep every command row as its own record (per-target aggregation is later).
      var result = emitSubRows ? out : dedupById(out, 'first');
      return { rows: result, villages: result, hasNextPage: hasNextPage };
    } catch (e) {
      return empty;
    }
  }

  /**
   * Read the mapped data columns out of one row, applying per-key cell readers
   * (default parseLocaleNumber) at colIndex - cellOffset.
   * @private
   */
  function readRowData(row, colMap, cellReaders, cellOffset, cfg) {
    var data = {};
    var cells = row.cells || [];
    for (var key in colMap) {
      if (!colMap.hasOwnProperty(key)) continue;
      var idx = colMap[key] - cellOffset;
      if (idx < 0) idx = 0;
      var cell = cells[idx];
      var text = cell ? (cell.text || '') : '';
      var reader = cellReaders[key] || parseLocaleNumber;
      data[key] = reader(text, cell, cfg);
    }
    return data;
  }

  /**
   * Stable dedup of rows by id. keep:'first' keeps the earliest, 'last' the latest.
   * @param {Array} rows
   * @param {string} [keep] - 'first' (default) | 'last'.
   * @returns {Array}
   */
  function dedupById(rows, keep) {
    if (!Array.isArray(rows)) return [];
    var seen = {};
    var order = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || row.id === undefined || row.id === null) continue;
      var id = row.id;
      if (seen[id] === undefined) {
        seen[id] = order.length;
        order.push(row);
      } else if (keep === 'last') {
        order[seen[id]] = row;
      }
    }
    return order;
  }

  // Category labels (multi-lang) -> the 5 buckets, mirroring tw-overview.js.
  var LABEL_TO_CATEGORY = {
    'vlastné': 'own_home', 'vlastne': 'own_home', 'own': 'own_home', 'eigene': 'own_home',
    'v dedine': 'in_village', 'in village': 'in_village', 'im dorf': 'in_village',
    'vonku': 'outside', 'outside': 'outside', 'mimo': 'outside', 'außerhalb': 'outside',
    'na ceste': 'in_transit', 'in transit': 'in_transit', 'unterwegs': 'in_transit',
    'celkovo': 'own_all', 'celkom': 'own_all', 'total': 'own_all', 'gesamt': 'own_all'
  };
  var CATEGORY_ORDER = ['own_home', 'in_village', 'outside', 'in_transit', 'own_all'];

  /**
   * Split a raw units RowMatrix into the 5 category buckets, deduped per bucket by id.
   * Parent rows (with village link) carry id/name/coords; the 4 sub-rows that follow
   * map to the remaining categories (by label, else positional fallback).
   * @param {Object} matrix - units RowMatrix.
   * @param {Object} [cfg] - units DOMAIN_CONFIG (for column map).
   * @returns {Object.<string, Array>} {own_home, in_village, outside, in_transit, own_all}.
   */
  function splitByCategory(matrix, cfg) {
    var buckets = { own_home: {}, in_village: {}, outside: {}, in_transit: {}, own_all: {} };
    var order = { own_home: [], in_village: [], outside: [], in_transit: [], own_all: [] };
    try {
      if (!matrix || !Array.isArray(matrix.rows)) {
        return finalizeBuckets(buckets, order);
      }
      cfg = cfg || (DOMAIN_CONFIGS && DOMAIN_CONFIGS.units) || {};
      var colMap = buildColumnMap(matrix.headers || [], cfg.headerIconRegex, cfg.aliasMap);
      var idLinkPattern = cfg.idColLinkPattern || /village=(\d+)/;

      var currentId = 0;
      var currentName = '';
      var currentCoords = '';
      var rowInBlock = 0;

      for (var r = 0; r < matrix.rows.length; r++) {
        var row = matrix.rows[r];
        if (!row || !Array.isArray(row.cells)) continue;

        var identity = detectIdentity(row, idLinkPattern);
        var hasLink = !!identity;
        if (hasLink) {
          currentId = identity.id;
          currentName = identity.name;
          currentCoords = identity.coords;
          rowInBlock = 0;
        }
        if (!currentId) continue;

        var cellOffset = hasLink ? 0 : 1;

        // Determine category from the label cell (first cell text).
        var firstText = (row.cells[0] && row.cells[0].text ? row.cells[0].text : '')
          .toLowerCase().replace(/\s+/g, ' ').trim();
        var cat = LABEL_TO_CATEGORY[firstText] || CATEGORY_ORDER[rowInBlock] || 'own_home';

        var units = {};
        var total = 0;
        for (var key in colMap) {
          if (!colMap.hasOwnProperty(key)) continue;
          var idx = colMap[key] - cellOffset;
          if (idx < 0) idx = 0;
          var cell = row.cells[idx];
          var count = parseLocaleNumber(cell ? cell.text : '');
          units[key] = count;
          if (ALL_UNITS.indexOf(key) !== -1) total += count;
        }

        if (buckets[cat] && buckets[cat][currentId] === undefined) {
          var entry = {
            id: currentId,
            name: currentName || ('Village ' + currentCoords),
            coords: currentCoords,
            units: units,
            total: total
          };
          buckets[cat][currentId] = entry;
          order[cat].push(currentId);
        }
        rowInBlock++;
      }
      return finalizeBuckets(buckets, order);
    } catch (e) {
      return finalizeBuckets(buckets, order);
    }
  }

  function finalizeBuckets(buckets, order) {
    var out = {};
    for (var cat in buckets) {
      if (!buckets.hasOwnProperty(cat)) continue;
      var arr = [];
      var ids = order[cat] || [];
      for (var i = 0; i < ids.length; i++) {
        arr.push(buckets[cat][ids[i]]);
      }
      out[cat] = arr;
    }
    return out;
  }

  // ============================================================
  // INCOMINGS multi-lang label token table (ported ONLY the token table
  // from tw-commands.js:201-240, not its jQuery code)
  // ============================================================

  var INCOMING_LABEL_TOKENS = {
    command: ['príkaz', 'command', 'befehl', 'polecenie', 'opdracht'],
    target: ['cieľ', 'target', 'ziel', 'cel', 'doel'],
    origin: ['pôvod', 'zdroj', 'origin', 'herkunft', 'pochodzenie', 'oorsprong'],
    player: ['hráč', 'player', 'spieler', 'gracz', 'speler'],
    distance: ['vzdialenosť', 'distance', 'entfernung', 'dystans', 'afstand'],
    arrival: ['čas príchodu', 'príchodu', 'príchod', 'arrival', 'ankunft', 'przybycie', 'aankomst']
  };

  /**
   * Reader that captures a SOURCE village from a row (for incomings).
   * Looks at the cell links for a second village link (not the target).
   * @private
   */
  function incomingsRowEnhancer(rec, row, cfg) {
    var cells = row.cells || [];
    // Walk cells; collect village links and player links.
    var villageLinks = [];
    var playerName = '';
    var arrivalText = '';
    var cmdType = 'unknown';
    for (var c = 0; c < cells.length; c++) {
      var cell = cells[c];
      var links = (cell && cell.links) || [];
      for (var l = 0; l < links.length; l++) {
        var href = links[l].href || '';
        var text = links[l].text || '';
        if (/info_player|screen=info_player|id=\d+/.test(href) && /info_player/.test(href)) {
          playerName = text;
        } else if (/village=\d+/.test(href) && extractCoords(text)) {
          villageLinks.push(text);
        }
      }
      // Arrival = any cell holding HH:MM:SS.
      var ct = (cell && cell.text) || '';
      if (/\d{1,2}:\d{2}:\d{2}/.test(ct)) arrivalText = ct.trim();
      // Command type from an icon src.
      var icon = (cell && cell.iconSrc) || '';
      if (/attack/.test(icon)) cmdType = 'attack';
      else if (/support|def/.test(icon) && cmdType === 'unknown') cmdType = 'support';
    }
    // First village link is the TARGET (already in rec via identity); a later one is SOURCE.
    if (villageLinks.length >= 2) {
      var srcText = villageLinks[1];
      rec.sourceCoords = extractCoords(srcText);
      rec.sourceName = srcText.replace(/\s*\(\d{1,3}\|\d{1,3}\)\s*K?\d*\s*$/, '').trim();
    } else {
      rec.sourceCoords = '';
      rec.sourceName = '';
    }
    rec.player = playerName || 'Unknown';
    rec.arrivalText = arrivalText;
    rec.cmdType = cmdType;
    // distanceFloat between target and source when both coords known.
    var tgt = parseCoordsObj(rec.coords);
    var src = parseCoordsObj(rec.sourceCoords);
    rec.distanceFloat = (tgt && src) ? fieldDistance(tgt, src) : 0;
  }

  // ============================================================
  // DOMAIN CONFIGS
  // ============================================================

  var DOMAIN_CONFIGS = {
    units: {
      headerIconRegex: /unit_(\w+)\.png/,
      aliasMap: UNIT_HEADER_ALIASES,
      idColLinkPattern: /village=(\d+)/,
      parentCategory: 'own_home',
      cellReaders: {}
    },
    prod: {
      // Economy: wood/clay/iron icons. Clay's class is "stone" -> aliased to 'clay'.
      headerIconRegex: /\/(holz|lehm|eisen|wood|clay|stone|iron)\.png/,
      aliasMap: {
        holz: 'wood', wood: 'wood',
        lehm: 'clay', stone: 'clay', clay: 'clay',
        eisen: 'iron', iron: 'iron'
      },
      idColLinkPattern: /village=(\d+)/,
      parentCategory: 'prod',
      cellReaders: {}
    },
    buildings: {
      headerIconRegex: /buildings\/(\w+)\.png/,
      aliasMap: {
        main: 'main', wall: 'wall', storage: 'storage', farm: 'farm',
        smith: 'smith', market: 'market', snob: 'academy', place: 'rally',
        barracks: 'barracks', stable: 'stable', garage: 'workshop',
        watchtower: 'watchtower', church: 'church', statue: 'statue',
        hide: 'hide', wood: 'wood', stone: 'clay', iron: 'iron'
      },
      idColLinkPattern: /village=(\d+)/,
      parentCategory: 'buildings',
      cellReaders: {}
    },
    incomings: {
      headerIconRegex: null,
      aliasMap: {},
      idColLinkPattern: /village=(\d+)/,
      emitSubRows: true,
      cellReaders: {},
      rowEnhancer: incomingsRowEnhancer
    }
  };

  // ============================================================
  // DERIVED FLAGS / ARMY POWER / PREDICATES
  // ============================================================

  /**
   * Sum offensive & defensive power of a units map per ATTACK_VALUES/DEF_VALUES.
   * Archer variants count only when includeArchers (mirrors tw-overview.js:795-820).
   * @param {Object} units - {unitType: count}.
   * @param {boolean} [includeArchers]
   * @returns {{offPower:number, defPower:number}}
   */
  function calcArmyPower(units, includeArchers) {
    units = units || {};
    var offUnits = OFFENSIVE_UNITS.concat(includeArchers ? OFFENSIVE_ARCHER_UNITS : []);
    var defUnits = DEFENSIVE_UNITS.concat(includeArchers ? DEFENSIVE_ARCHER_UNITS : []);
    var offPower = 0;
    var defPower = 0;
    var j;
    for (j = 0; j < offUnits.length; j++) {
      offPower += (units[offUnits[j]] || 0) * (ATTACK_VALUES[offUnits[j]] || 0);
    }
    for (j = 0; j < defUnits.length; j++) {
      defPower += (units[defUnits[j]] || 0) * (DEF_VALUES[defUnits[j]] || 0);
    }
    return { offPower: offPower, defPower: defPower };
  }

  /**
   * Compute derived state flags for one village row WITHOUT mutating input.
   * Centralizes the isNuke/hasNoble/underDefended/whNearFull/isFull/academyReady
   * logic (fixes the across-buckets stale-flag bug once).
   * @param {Object} row - A master/village row.
   * @param {Object} [opts] - Thresholds {nukeThreshold, includeArchers, defThreshold,
   *                          warnPct, fullPct}.
   * @returns {Object} A COPY of row with flags added.
   */
  function computeDerivedFlags(row, opts) {
    var out = {};
    row = row || {};
    for (var k in row) { if (row.hasOwnProperty(k)) out[k] = row[k]; }
    opts = opts || {};

    // Accept EITHER a nested {units:{...}} OR flat unit keys directly on the row.
    // The overview parser emits flat keys (row.axe), so fall back to `out` itself.
    var units = out.units || out;
    var nukeThreshold = opts.nukeThreshold || 0;
    var includeArchers = !!opts.includeArchers;
    var defThreshold = opts.defThreshold || 0;
    var warnPct = (opts.warnPct !== undefined) ? opts.warnPct : 90;
    var fullPct = (opts.fullPct !== undefined) ? opts.fullPct : 100;

    var offCount = (units.axe || 0) + (units.light || 0);
    if (includeArchers) offCount += (units.marcher || 0);

    out.isNuke = offCount >= nukeThreshold && nukeThreshold > 0;
    out.hasNoble = (units.snob || 0) > 0;

    var incCount = (out.incCount !== undefined) ? out.incCount : 0;
    out.hasIncomings = incCount > 0;

    var power = calcArmyPower(units, includeArchers);
    // Populate the registry off/defPower columns from computed power (unless already set).
    out.off = (out.off !== undefined) ? out.off : power.offPower;
    var defPower = (out.defPower !== undefined) ? out.defPower : power.defPower;
    out.defPower = defPower;
    out.underDefended = (defThreshold > 0) && (defPower < defThreshold) && out.hasIncomings;

    var fillPct = (out.whFillPct !== undefined) ? out.whFillPct : null;
    out.whNearFull = (fillPct !== null) && (fillPct >= warnPct);
    out.isFull = (fillPct !== null) && (fillPct >= fullPct);

    var hq = out.main !== undefined ? out.main : (out.hq || 0);
    var smithy = out.smith !== undefined ? out.smith : (out.smithy || 0);
    var market = out.market || 0;
    out.academyReady = (hq >= 20) && (smithy >= 20) && (market >= 10);

    return out;
  }

  // ---- Threshold predicate builders ----

  /**
   * Build a predicate over a row. ops: gte/lte/eq compare row[key] to value;
   * flag tests truthiness of row[key]; between tests min<=row[key]<=max.
   * @param {string} op
   * @param {string} key
   * @param {*} value
   * @param {*} [value2] - upper bound for 'between'.
   * @returns {function(Object): boolean}
   */
  function predicate(op, key, value, value2) {
    switch (op) {
      case 'gte': return function (row) { return num(row, key) >= value; };
      case 'lte': return function (row) { return num(row, key) <= value; };
      case 'eq': return function (row) { return num(row, key) === value; };
      case 'flag': return function (row) { return !!(row && row[key]); };
      case 'between': return function (row) { var v = num(row, key); return v >= value && v <= value2; };
      default: return function () { return true; };
    }
  }

  function num(row, key) {
    if (!row) return 0;
    var v = row[key];
    if (typeof v === 'number') return v;
    var n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  /**
   * Compose an array of predicates with logical AND. Empty -> alwaysTrue.
   * @param {Array.<Function>} preds
   * @returns {function(Object): boolean}
   */
  function composeAnd(preds) {
    if (!Array.isArray(preds) || preds.length === 0) return function () { return true; };
    return function (row) {
      for (var i = 0; i < preds.length; i++) {
        if (typeof preds[i] === 'function' && !preds[i](row)) return false;
      }
      return true;
    };
  }

  /**
   * Count rows matching a predicate.
   * @param {Array} rows
   * @param {Function} pred
   * @returns {number}
   */
  function countMatching(rows, pred) {
    if (!Array.isArray(rows) || typeof pred !== 'function') return 0;
    var n = 0;
    for (var i = 0; i < rows.length; i++) {
      if (pred(rows[i])) n++;
    }
    return n;
  }

  // ============================================================
  // MULTI-KEY SORT
  // ============================================================

  /**
   * Build a multi-key comparator from a sort spec.
   * Each entry: {key, dir:'asc'|'desc', type:'num'|'str'}. NaN/missing num keys
   * sort LAST in both directions. Empty spec -> comparator returns 0 (stable).
   * Relies on the stable Array.prototype.sort (V8) for tie-breaking — no internal
   * index tiebreak is fabricated.
   * @param {Array.<{key:string,dir:string,type:string}>} spec
   * @returns {function(Object, Object): number}
   */
  function sortBy(spec) {
    if (!Array.isArray(spec) || spec.length === 0) {
      return function () { return 0; };
    }
    return function (a, b) {
      for (var i = 0; i < spec.length; i++) {
        var s = spec[i] || {};
        var dirSign = (s.dir === 'desc') ? -1 : 1;
        var cmp;
        if (s.type === 'str') {
          var sa = strOf(a, s.key);
          var sb = strOf(b, s.key);
          cmp = sa.localeCompare(sb) * dirSign;
        } else {
          var na = numOrInf(a, s.key);
          var nb = numOrInf(b, s.key);
          // Missing/NaN sort LAST regardless of direction.
          if (na === Infinity && nb === Infinity) cmp = 0;
          else if (na === Infinity) cmp = 1;
          else if (nb === Infinity) cmp = -1;
          else cmp = (na < nb ? -1 : na > nb ? 1 : 0) * dirSign;
        }
        if (cmp !== 0) return cmp;
      }
      return 0;
    };
  }

  function strOf(row, key) {
    if (!row) return '';
    var v = row[key];
    return v === undefined || v === null ? '' : String(v);
  }

  function numOrInf(row, key) {
    if (!row) return Infinity;
    var v = row[key];
    if (v === undefined || v === null) return Infinity;
    var n = (typeof v === 'number') ? v : Number(v);
    return isNaN(n) ? Infinity : n;
  }

  // ============================================================
  // GEO MATH
  // ============================================================

  function getContinent(x, y) {
    return 'K' + Math.floor((y || 0) / 100) + Math.floor((x || 0) / 100);
  }

  /**
   * Euclidean field distance between two coordinate points.
   * @param {{x:number,y:number}} a
   * @param {{x:number,y:number}} b
   * @returns {number}
   */
  function fieldDistance(a, b) {
    if (!a || !b) return 0;
    var dx = (a.x || 0) - (b.x || 0);
    var dy = (a.y || 0) - (b.y || 0);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function continentXY(cont) {
    // 'K' + cy + cx  (cy = floor(y/100), cx = floor(x/100)). Single-digit each in TW.
    var m = String(cont).match(/^K(\d)(\d)$/);
    if (!m) return null;
    return { cy: parseInt(m[1], 10), cx: parseInt(m[2], 10) };
  }

  /**
   * Find the nearest enemy village to `from`, searching the 3x3 continent
   * neighbourhood first and widening to the global set when neighbours are empty;
   * always reduces to the global minimum within the searched set.
   * @param {{x:number,y:number}} from
   * @param {Array.<{x:number,y:number}>} enemies
   * @param {Object} [byContinent] - optional precomputed continent index.
   * @returns {?{village:Object, dist:number}}
   */
  function nearestEnemy(from, enemies, byContinent) {
    if (!from || !Array.isArray(enemies) || enemies.length === 0) return null;

    // Build continent index if not provided.
    var index = byContinent;
    if (!index) {
      index = {};
      for (var e = 0; e < enemies.length; e++) {
        var ev = enemies[e];
        var c = getContinent(ev.x, ev.y);
        if (!index[c]) index[c] = [];
        index[c].push(ev);
      }
    }

    var fromCont = getContinent(from.x, from.y);
    var origin = continentXY(fromCont);
    var searchSet = [];
    if (origin) {
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var ny = origin.cy + dy;
          var nx = origin.cx + dx;
          if (ny < 0 || nx < 0 || ny > 9 || nx > 9) continue;
          var key = 'K' + ny + nx;
          if (index[key]) searchSet = searchSet.concat(index[key]);
        }
      }
    }

    // Widen to the global set when the neighbourhood is empty.
    if (searchSet.length === 0) searchSet = enemies;

    return reduceNearest(from, searchSet);
  }

  function reduceNearest(from, set) {
    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < set.length; i++) {
      var d = fieldDistance(from, set[i]);
      if (d < bestDist) {
        bestDist = d;
        best = set[i];
      }
    }
    if (!best) return null;
    return { village: best, dist: bestDist };
  }

  /**
   * Distance from a village to the nearest enemy ("front"). Infinity when none.
   * @param {{x:number,y:number}} from
   * @param {Array} enemies
   * @param {Object} [byContinent]
   * @returns {number}
   */
  function distanceToFront(from, enemies, byContinent) {
    var ne = nearestEnemy(from, enemies, byContinent);
    return ne ? ne.dist : Infinity;
  }

  // ============================================================
  // FAKE / NUKE ESTIMATE (port of classifyUnit math, pure)
  // ============================================================

  /**
   * Pure travel time (ms): round(dist * unitSpeed * 60000 / (worldSpeed * unitSpeedFactor)).
   * Mirror of tw-core.travelTime.
   * @private
   */
  function travelTimeMs(dist, unitSpeed, worldSpeed, unitSpeedFactor) {
    worldSpeed = worldSpeed || 1;
    unitSpeedFactor = unitSpeedFactor || 1;
    return Math.round((dist * unitSpeed * 60000) / (worldSpeed * unitSpeedFactor));
  }

  /**
   * Estimate the unit type of a single command from its observed travel time.
   * Pure: no globals read. NEVER throws.
   * @param {number} observedMs - Observed travel time in ms.
   * @param {number} dist - Distance in fields.
   * @param {Object} [unitSpeeds] - {unit: minutesPerField}.
   * @param {Object} [worldConfig] - {speed, unitSpeed}.
   * @returns {{unit:string, isNoble:boolean, confidence:string}}
   */
  function estimateAttackUnits(observedMs, dist, unitSpeeds, worldConfig) {
    unitSpeeds = unitSpeeds || DEFAULT_UNIT_SPEEDS;
    worldConfig = worldConfig || { speed: 1, unitSpeed: 1 };
    var ws = worldConfig.speed || 1;
    var usf = worldConfig.unitSpeed || 1;

    if (!dist || dist <= 0 || !observedMs || observedMs <= 0) {
      return { unit: 'unknown', isNoble: false, confidence: 'none' };
    }

    var best = null;
    var bestDiff = Infinity;
    var bestPercent = 100;
    for (var i = 0; i < ALL_UNITS.length; i++) {
      var name = ALL_UNITS[i];
      var speed = unitSpeeds[name] || DEFAULT_UNIT_SPEEDS[name];
      if (!speed) continue;
      var expected = travelTimeMs(dist, speed, ws, usf);
      var diff = Math.abs(observedMs - expected);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = name;
        bestPercent = expected > 0 ? (diff / expected) * 100 : 100;
      }
    }

    if (!best) return { unit: 'unknown', isNoble: false, confidence: 'none' };

    var confidence;
    if (bestPercent <= 2) confidence = 'high';
    else if (bestPercent <= 5) confidence = 'medium';
    else if (bestPercent <= 10) confidence = 'low';
    else confidence = 'none';

    return { unit: best, isNoble: best === 'snob', confidence: confidence };
  }

  /**
   * Classify a TRAIN (group of commands) as noble/nuke/fake/unknown.
   * Train-level (NOT unit-level): nobleCount>0 -> 'noble'; fastest command of a
   * heavy/ram-class unit -> 'nuke'; a single fast scout-class command -> 'fake';
   * undeterminable -> 'unknown'. Always returns a confidence label.
   * @param {{commands:Array}|Array} train - groupIntoTrains-shaped input.
   * @param {Object} [unitSpeeds]
   * @param {Object} [worldConfig]
   * @returns {{kind:string, confidence:string}}
   */
  function classifyTrainKind(train, unitSpeeds, worldConfig) {
    var commands = Array.isArray(train) ? train : (train && train.commands) || [];
    if (!Array.isArray(commands) || commands.length === 0) {
      return { kind: 'unknown', confidence: 'none' };
    }

    var nobleCount = 0;
    var estimates = [];
    var maxConfidence = 'none';
    for (var i = 0; i < commands.length; i++) {
      var cmd = commands[i] || {};
      // Accept either a pre-classified unit or estimate from travel time.
      var est;
      if (cmd.unit) {
        est = { unit: cmd.unit, isNoble: cmd.unit === 'snob', confidence: cmd.confidence || 'high' };
      } else {
        est = estimateAttackUnits(cmd.travelMs || cmd.observedMs, cmd.dist, unitSpeeds, worldConfig);
      }
      estimates.push(est);
      if (est.isNoble || cmd.type === 'noble') nobleCount++;
      maxConfidence = strongerConfidence(maxConfidence, est.confidence);
    }

    if (nobleCount > 0) return { kind: 'noble', confidence: maxConfidence };

    // Heavy/ram-class fastest command => nuke.
    var nukeUnits = { axe: 1, light: 1, ram: 1, catapult: 1, marcher: 1, heavy: 1 };
    var scoutUnits = { spy: 1 };
    var hasNuke = false;
    var allScout = estimates.length > 0;
    for (var j = 0; j < estimates.length; j++) {
      if (nukeUnits[estimates[j].unit]) hasNuke = true;
      if (!scoutUnits[estimates[j].unit]) allScout = false;
    }

    if (hasNuke) return { kind: 'nuke', confidence: maxConfidence };
    if (allScout) return { kind: 'fake', confidence: maxConfidence };
    return { kind: 'unknown', confidence: maxConfidence };
  }

  function strongerConfidence(a, b) {
    var rank = { none: 0, low: 1, medium: 2, high: 3 };
    return (rank[b] || 0) > (rank[a] || 0) ? b : a;
  }

  // ============================================================
  // FORMAT HELPERS (jQuery-free, used by COLUMN_REGISTRY descriptors)
  // ============================================================

  /**
   * Format an integer with dot-separated thousands (jQuery-free).
   * @param {*} n
   * @returns {string}
   */
  function formatNum(n) {
    var v = (typeof n === 'number') ? n : Number(n);
    if (isNaN(v)) return '0';
    return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  /** Format a value as a percentage string (e.g. 73 -> '73%'). */
  function formatPct(n) {
    var v = (typeof n === 'number') ? n : Number(n);
    if (isNaN(v)) return '-';
    return Math.round(v) + '%';
  }

  /** Identity/string formatter — '' for null/undefined. */
  function formatStr(s) {
    return (s === null || s === undefined) ? '' : String(s);
  }

  /** Boolean flag formatter — '✓' / ''. */
  function formatFlag(b) {
    return b ? '✓' : '';
  }

  // ============================================================
  // COLUMN REGISTRY (declarative — drives headers / sort / filter /
  // visibility / export across every domain table)
  // ============================================================

  /**
   * One column descriptor. The MINIMAL contract enforced by the registry helpers
   * is {key, label, domain, format}; the rest are optional hints consumed by the
   * table engine (M4) and config presets (M5).
   *
   *  @typedef {Object} ColumnDescriptor
   *  @property {string}   key            Unique column key (camelCase — preset-stable).
   *  @property {string}   label          Header label.
   *  @property {string}   domain         identity|troops|economy|buildings|incomings|map.
   *  @property {function} format         (value, row) -> display string.
   *  @property {function} [get]          (row) -> raw value (defaults to row[key]).
   *  @property {boolean}  [sortable]
   *  @property {string}   [sortType]     'num' | 'str'.
   *  @property {boolean}  [filterable]
   *  @property {boolean}  [defaultVisible]
   *  @property {boolean}  [exportable]
   *  @property {string}   [featureFlag]  world-config key to gate on (church/archer/...).
   */

  /** Build a numeric column descriptor. @private */
  function numCol(key, label, domain, opts) {
    opts = opts || {};
    return {
      key: key, label: label, domain: domain,
      get: opts.get || makeGetter(key),
      format: opts.format || formatNum,
      sortable: opts.sortable !== false,
      sortType: 'num',
      filterable: opts.filterable !== false,
      defaultVisible: !!opts.defaultVisible,
      exportable: opts.exportable !== false,
      featureFlag: opts.featureFlag
    };
  }

  /** Build a string column descriptor. @private */
  function strCol(key, label, domain, opts) {
    opts = opts || {};
    return {
      key: key, label: label, domain: domain,
      get: opts.get || makeGetter(key),
      format: opts.format || formatStr,
      sortable: opts.sortable !== false,
      sortType: 'str',
      filterable: !!opts.filterable,
      defaultVisible: !!opts.defaultVisible,
      exportable: opts.exportable !== false,
      featureFlag: opts.featureFlag
    };
  }

  /** Build a boolean/flag column descriptor. @private */
  function flagCol(key, label, domain, opts) {
    opts = opts || {};
    return {
      key: key, label: label, domain: domain,
      get: opts.get || makeGetter(key),
      format: opts.format || formatFlag,
      sortable: opts.sortable !== false,
      sortType: 'num',
      filterable: opts.filterable !== false,
      defaultVisible: !!opts.defaultVisible,
      exportable: opts.exportable !== false,
      featureFlag: opts.featureFlag
    };
  }

  function makeGetter(key) {
    return function (row) { return row ? row[key] : undefined; };
  }

  /**
   * The single source of truth for every column across all domains.
   * Keys are camelCase and STABLE — the seed view presets (M5) reference them by name.
   * @type {ColumnDescriptor[]}
   */
  var COLUMN_REGISTRY = [
    // ---- identity ----
    strCol('name', 'Village', 'identity', { defaultVisible: true, filterable: true }),
    strCol('coords', 'Coords', 'identity', { defaultVisible: true }),
    strCol('continent', 'K', 'identity', { defaultVisible: true }),
    numCol('points', 'Points', 'identity', { defaultVisible: true }),
    numCol('rank', 'Rank', 'identity', {}),

    // ---- troops (per-unit + total + power + flags) ----
    numCol('spear', 'Spear', 'troops', {}),
    numCol('sword', 'Sword', 'troops', {}),
    numCol('axe', 'Axe', 'troops', { defaultVisible: true }),
    numCol('archer', 'Archer', 'troops', { featureFlag: 'archer' }),
    numCol('spy', 'Spy', 'troops', {}),
    numCol('light', 'LC', 'troops', { defaultVisible: true }),
    numCol('marcher', 'MA', 'troops', { featureFlag: 'archer' }),
    numCol('heavy', 'HC', 'troops', {}),
    numCol('ram', 'Ram', 'troops', {}),
    numCol('catapult', 'Cat', 'troops', {}),
    numCol('knight', 'Pala', 'troops', { featureFlag: 'knight' }),
    numCol('snob', 'Noble', 'troops', { defaultVisible: true }),
    numCol('total', 'Total', 'troops', { defaultVisible: true }),
    numCol('off', 'Off', 'troops', {}),
    numCol('defPower', 'Def', 'troops', { defaultVisible: true }),
    flagCol('isNuke', 'Nuke', 'troops', {}),
    flagCol('hasNoble', 'Has noble', 'troops', {}),

    // ---- economy (warehouse fill%, resources, prod/h, merchants, hide, points) ----
    numCol('whFillPct', 'WH %', 'economy', { defaultVisible: true, format: formatPct }),
    numCol('wood', 'Wood', 'economy', { defaultVisible: true }),
    numCol('clay', 'Clay', 'economy', { defaultVisible: true }),
    numCol('iron', 'Iron', 'economy', { defaultVisible: true }),
    numCol('whCap', 'WH cap', 'economy', {}),
    numCol('prodPerH', 'Prod/h', 'economy', {}),
    numCol('timeToFull', 'To full', 'economy', {}),
    numCol('merchants', 'Merch', 'economy', {}),
    numCol('hideCap', 'Hide', 'economy', {}),

    // ---- buildings (levels + derived flags) ----
    // NOTE: keys are aligned with DOMAIN_CONFIGS.buildings parser output (smith /
    // storage / farm), so the master-model JOIN populates them. Aliases below keep
    // the design names (smithy/warehouse) addressable for presets.
    numCol('main', 'HQ', 'buildings', { defaultVisible: true }),
    numCol('wall', 'Wall', 'buildings', { defaultVisible: true }),
    numCol('smith', 'Smith', 'buildings', {}),
    numCol('farm', 'Farm', 'buildings', {}),
    numCol('storage', 'WH', 'buildings', {}),
    numCol('academy', 'Acad', 'buildings', {}),
    numCol('rally', 'Rally', 'buildings', {}),
    numCol('market', 'Market', 'buildings', {}),
    numCol('barracks', 'Barr', 'buildings', {}),
    numCol('stable', 'Stable', 'buildings', {}),
    numCol('workshop', 'Wshop', 'buildings', {}),
    numCol('watchtower', 'WT', 'buildings', { featureFlag: 'watchtower' }),
    numCol('church', 'Church', 'buildings', { featureFlag: 'church' }),
    // Alias columns (same data, design-friendly keys) — read the parser keys.
    numCol('smithy', 'Smith', 'buildings', { get: function (row) { return row ? row.smith : undefined; } }),
    numCol('warehouse', 'WH', 'buildings', { get: function (row) { return row ? row.storage : undefined; } }),
    flagCol('academyReady', 'Acad-ready', 'buildings', {}),

    // ---- incomings (count, soonest, nukes/fakes/nobles est, under-defended, defPower) ----
    numCol('incCount', 'Inc', 'incomings', { defaultVisible: true }),
    strCol('soonest', 'Soonest', 'incomings', { defaultVisible: true }),
    numCol('nukesEst', 'Nukes~', 'incomings', {}),
    numCol('fakesEst', 'Fakes~', 'incomings', {}),
    numCol('noblesEst', 'Nobles~', 'incomings', {}),
    flagCol('underDefended', 'Under-def', 'incomings', { defaultVisible: true }),
    strCol('nearestSource', 'Source', 'incomings', {}),

    // ---- map (distance-to-front, nearest enemy, continent, bonus, barb targets) ----
    numCol('distFront', 'Dist front', 'map', { defaultVisible: true }),
    strCol('nearestEnemy', 'Nearest enemy', 'map', {}),
    numCol('bonus', 'Bonus', 'map', {}),
    numCol('barbTargets', 'Barbs', 'map', {})
  ];

  // Lazy key -> descriptor index for getColumn.
  var _columnIndex = null;
  function ensureColumnIndex() {
    if (_columnIndex) return _columnIndex;
    _columnIndex = {};
    for (var i = 0; i < COLUMN_REGISTRY.length; i++) {
      _columnIndex[COLUMN_REGISTRY[i].key] = COLUMN_REGISTRY[i];
    }
    return _columnIndex;
  }

  /**
   * Get a column descriptor by key.
   * @param {string} key
   * @returns {?ColumnDescriptor} The descriptor, or null when unknown.
   */
  function getColumn(key) {
    if (!key) return null;
    return ensureColumnIndex()[key] || null;
  }

  /**
   * All descriptors for one domain (identity|troops|economy|buildings|incomings|map).
   * @param {string} domain
   * @returns {ColumnDescriptor[]}
   */
  function columnsForDomain(domain) {
    if (!domain) return [];
    var out = [];
    for (var i = 0; i < COLUMN_REGISTRY.length; i++) {
      if (COLUMN_REGISTRY[i].domain === domain) out.push(COLUMN_REGISTRY[i]);
    }
    return out;
  }

  /**
   * Gate (hide) feature columns the world does not support. A column with a
   * featureFlag is dropped ONLY when the world config explicitly says the feature
   * is absent (value === 0 or false). No-flag columns always pass; an undefined
   * world value keeps the column (do not over-hide).
   * @param {ColumnDescriptor[]} columns
   * @param {Object} worldConfig - e.g. {archer:true, church:0, watchtower:1, knight:1}.
   * @returns {ColumnDescriptor[]}
   */
  function gateColumnsByWorld(columns, worldConfig) {
    if (!Array.isArray(columns)) return [];
    if (!worldConfig || typeof worldConfig !== 'object') return columns.slice();
    var out = [];
    for (var i = 0; i < columns.length; i++) {
      var col = columns[i];
      var flag = col && col.featureFlag;
      if (!flag) { out.push(col); continue; }
      var val = worldConfig[flag];
      // Only drop on an explicit "absent" signal.
      if (val === 0 || val === false || val === '0') continue;
      out.push(col);
    }
    return out;
  }

  /**
   * Resolve the ordered list of visible column keys for a table.
   * Honors the saved order, drops unknown keys, and falls back to `defaults`
   * when nothing valid remains.
   * @param {Array.<string>} saved - Persisted column order.
   * @param {Array.<string>} defaults - Fallback default-visible keys.
   * @returns {Array.<string>}
   */
  function resolveVisibleColumns(saved, defaults) {
    defaults = Array.isArray(defaults) ? defaults : [];
    if (!Array.isArray(saved) || saved.length === 0) return defaults.slice();
    var index = ensureColumnIndex();
    var out = [];
    for (var i = 0; i < saved.length; i++) {
      if (index[saved[i]] && out.indexOf(saved[i]) === -1) out.push(saved[i]);
    }
    return out.length ? out : defaults.slice();
  }

  // ============================================================
  // MASTER MODEL (JOIN all domains by village id into ONE row)
  // ============================================================

  /**
   * Join every per-domain row set + the village index into ONE per-village master
   * row keyed by id. Each domain's data is a map {id: row} (or an array of rows
   * carrying .id). Coordinates/continent come from villageIndex.byId. Derived state
   * flags are attached via computeDerivedFlags. Fail-safe: [] for non-object input,
   * never throws.
   *
   * @param {Object.<string, (Object|Array)>} domainData - {troops, econ, buildings, incomings, map}.
   * @param {{byId:Object}} villageIndex - From DataFetcher.buildVillageIndex.
   * @param {Object} [opts] - Threshold opts forwarded to computeDerivedFlags.
   * @returns {Array.<Object>} One master row per village id.
   */
  function buildMasterModel(domainData, villageIndex, opts) {
    try {
      if (!domainData || typeof domainData !== 'object') return [];
      var byId = (villageIndex && villageIndex.byId && typeof villageIndex.byId === 'object')
        ? villageIndex.byId : {};

      var merged = {}; // id -> row
      var order = [];

      function ensureRow(id) {
        if (merged[id] === undefined) {
          merged[id] = { id: toIdNum(id) };
          order.push(id);
        }
        return merged[id];
      }

      // Merge each domain's rows.
      for (var domain in domainData) {
        if (!domainData.hasOwnProperty(domain)) continue;
        var bag = domainData[domain];
        if (!bag || typeof bag !== 'object') continue;
        var rows = Array.isArray(bag) ? bag : objectValues(bag);
        for (var r = 0; r < rows.length; r++) {
          var src = rows[r];
          if (!src || typeof src !== 'object' || src.id === undefined || src.id === null) continue;
          var row = ensureRow(src.id);
          shallowAssign(row, src);
        }
      }

      // Merge identity/geo from the village index (covers villages with no domain rows too).
      for (var vid in byId) {
        if (!byId.hasOwnProperty(vid)) continue;
        var v = byId[vid];
        if (!v) continue;
        var mrow = ensureRow(v.id !== undefined ? v.id : vid);
        if (v.name !== undefined && mrow.name === undefined) mrow.name = v.name;
        if (v.owner !== undefined) mrow.owner = v.owner;
        if (v.points !== undefined) mrow.points = v.points;
        if (v.rank !== undefined && v.rank !== null) mrow.rank = v.rank;
        if (v.bonusId !== undefined) mrow.bonus = v.bonusId;
        if (isFiniteNum(v.x) && isFiniteNum(v.y)) {
          mrow.x = v.x;
          mrow.y = v.y;
          mrow.coords = v.x + '|' + v.y;
          mrow.continent = (v.continent || getContinent(v.x, v.y));
        } else if (v.continent && mrow.continent === undefined) {
          mrow.continent = v.continent;
        }
      }

      // Build the final ordered array with derived flags.
      var out = [];
      for (var i = 0; i < order.length; i++) {
        out.push(computeDerivedFlags(merged[order[i]], opts));
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  function toIdNum(id) {
    var n = (typeof id === 'number') ? id : parseInt(id, 10);
    return isNaN(n) ? id : n;
  }

  function isFiniteNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function objectValues(obj) {
    var out = [];
    for (var k in obj) { if (obj.hasOwnProperty(k)) out.push(obj[k]); }
    return out;
  }

  function shallowAssign(dst, src) {
    for (var k in src) {
      if (src.hasOwnProperty(k) && k !== 'id') dst[k] = src[k];
    }
    if (src.id !== undefined && src.id !== null) dst.id = toIdNum(src.id);
    return dst;
  }

  // ============================================================
  // CACHING (keys are UNPREFIXED — the Store/Storage adapters add two_/twt_)
  // ============================================================

  /**
   * Per-domain cache key. Returns an UNPREFIXED key `${domain}_${worldKey}_g${gid}`;
   * the local Store wrapper prepends 'two_' and tw-core Storage prepends 'twt_', so
   * the real localStorage key is twt_two_${domain}_${worldKey}_g${gid}. NEVER
   * double-prefix here.
   * @param {string} domain - e.g. 'troops' | 'econ' | 'buildings' | 'incomings' | 'map'.
   * @param {(number|string)} gid - Group id ('0' = all villages).
   * @param {string} worldKey - Runtime-detected world key (e.g. 'en123', 'sk88').
   * @returns {string}
   */
  function cacheKeyFor(domain, gid, worldKey) {
    var d = domain === undefined || domain === null ? '' : String(domain);
    var w = worldKey === undefined || worldKey === null ? '' : String(worldKey);
    var g = gid === undefined || gid === null ? '0' : String(gid);
    return d + '_' + w + '_g' + g;
  }

  /**
   * Per-domain cache TTLs in ms. config has NO TTL (it is a permanent blob).
   * @type {Object.<string, number>}
   */
  var CACHE_TTL_MS = {
    troops: 5 * 60 * 1000,      // 300000
    econ: 15 * 60 * 1000,       // 900000
    buildings: 15 * 60 * 1000,  // 900000
    incomings: 2 * 60 * 1000,   // 120000
    map: 60 * 60 * 1000,        // 3600000
    config: null
  };

  // ============================================================
  // PREMIUM DETECT (jQuery-free string scan; injectable for node tests)
  // ============================================================

  /**
   * Detect whether a Premium overview mode (prod/buildings) is available, by
   * scanning the probe HTML for premium-required markers vs the overview table.
   * jQuery-FREE and pure — takes the HTML string (and optional mode) directly.
   * @param {string} probeHtml - Raw HTML of a mode=prod / mode=buildings probe.
   * @param {string} [mode] - The probed mode (for the reason message).
   * @returns {{available:boolean, reason?:string}}
   */
  function detectPremium(probeHtml, mode) {
    var html = String(probeHtml || '');
    if (!html) return { available: false, reason: 'empty response' };

    var lower = html.toLowerCase();
    // Explicit premium-required markers (multi-lang / class hooks).
    var blockers = [
      'premium_account_required', 'premium account required',
      'premium-account', 'screen=premium', 'prémiový účet', 'premiovy ucet',
      'premium_account', 'account_manager_settings'
    ];
    for (var i = 0; i < blockers.length; i++) {
      if (lower.indexOf(blockers[i]) !== -1) {
        return { available: false, reason: 'premium required for mode=' + (mode || '?') };
      }
    }

    // Positive signal: the overview table / prod-buildings nav is present.
    var positive = /overview_table|production_table|id="units_table"|id="production"|>\s*production\s*</i.test(html)
      || /mode=prod|mode=buildings/i.test(html);
    if (positive) return { available: true };

    return { available: false, reason: 'no overview table in mode=' + (mode || '?') };
  }

  // ============================================================
  // INCOMINGS AGGREGATION (M3 PLACEHOLDER — real impl is M6 / T37)
  // ============================================================

  /**
   * Group incoming command records by TARGET village id. A correct-but-minimal
   * placeholder for M3: returns {targetId: {count, soonestMs}}. The full
   * nukes/fakes/nobles ESTIMATE + under-defended JOIN lands in M6 (T37).
   * @param {Array.<Object>} commands - Rows from parseOverviewTable(incomings).
   * @returns {Object.<string, {count:number, soonestMs:number}>}
   */
  function aggregateIncomingsByTarget(commands) {
    var out = {};
    if (!Array.isArray(commands)) return out;
    for (var i = 0; i < commands.length; i++) {
      var c = commands[i];
      if (!c || c.id === undefined || c.id === null) continue;
      var tid = c.id;
      if (!out[tid]) out[tid] = { count: 0, soonestMs: Infinity };
      out[tid].count++;
      var ms = (typeof c.arrivalMs === 'number') ? c.arrivalMs
        : (typeof c.arrival_ms === 'number') ? c.arrival_ms : Infinity;
      if (ms < out[tid].soonestMs) out[tid].soonestMs = ms;
    }
    // Normalize the sentinel Infinity (no arrival data) to 0.
    for (var k in out) {
      if (out.hasOwnProperty(k) && out[k].soonestMs === Infinity) out[k].soonestMs = 0;
    }
    return out;
  }

  // ============================================================
  // BROWSER-ONLY DOM SEAM (injected $; early-return without it)
  // ============================================================

  /**
   * Adapter: turn a raw HTML page + jQuery into the SAME RowMatrix shape the
   * test tokenizer produces. Browser-only (not node-tested). Returns an empty
   * matrix when $ is absent.
   * @param {string} html
   * @param {Function} jq - jQuery (injected).
   * @returns {Object} RowMatrix.
   */
  function extractRowMatrix(html, jq) {
    var emptyMatrix = { headers: [], rows: [], hasNextPage: false, infoBoxText: '' };
    if (!jq) return emptyMatrix;
    try {
      var $page = jq('<div/>').html(html || '');
      var headers = [];
      var rows = [];

      var $rows = $page.find('tr');
      $rows.each(function () {
        var $tr = jq(this);
        var $cells = $tr.find('td, th');
        var isHeaderRow = $tr.find('th').length > 0;
        var cells = [];
        $cells.each(function (i) {
          var $c = jq(this);
          var $img = $c.find('img').first();
          var links = [];
          $c.find('a[href]').each(function () {
            var $a = jq(this);
            links.push({ href: $a.attr('href') || '', text: jq.trim($a.text()) });
          });
          cells.push({
            text: jq.trim($c.text()),
            iconSrc: ($img.attr('src') || ''),
            cssClass: ($c.attr('class') || ''),
            links: links,
            colIndex: i
          });
        });
        if (isHeaderRow && headers.length === 0) {
          headers = cells.map(function (cell, i) {
            return { text: cell.text, iconSrc: cell.iconSrc, cssClass: cell.cssClass, colIndex: i };
          });
        } else if (cells.length) {
          rows.push({ cells: cells });
        }
      });

      var hasNextPage = false;
      var $nav = $page.find('.paged-nav-item');
      if ($nav.length > 1) {
        var $cur = $nav.filter('.selected, .active');
        hasNextPage = $cur.length > 0
          ? $cur.next('.paged-nav-item').length > 0
          : $page.find('a.paged-nav-item[href*="page="]').length > 0;
      }

      var infoBoxText = jq.trim($page.find('.info_box').text());

      return { headers: headers, rows: rows, hasNextPage: hasNextPage, infoBoxText: infoBoxText };
    } catch (e) {
      return emptyMatrix;
    }
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  var OverviewCore = {
    // constant tables
    ALL_UNITS: ALL_UNITS,
    UNITS_NO_ARCHERS: UNITS_NO_ARCHERS,
    OFFENSIVE_UNITS: OFFENSIVE_UNITS,
    DEFENSIVE_UNITS: DEFENSIVE_UNITS,
    ATTACK_VALUES: ATTACK_VALUES,
    DEF_VALUES: DEF_VALUES,
    UNIT_HEADER_ALIASES: UNIT_HEADER_ALIASES,
    DEFAULT_UNIT_SPEEDS: DEFAULT_UNIT_SPEEDS,
    DOMAIN_CONFIGS: DOMAIN_CONFIGS,

    // parse
    parseLocaleNumber: parseLocaleNumber,
    extractCoords: extractCoords,
    parseCoordsObj: parseCoordsObj,
    buildColumnMap: buildColumnMap,
    parseOverviewTable: parseOverviewTable,
    dedupById: dedupById,
    splitByCategory: splitByCategory,
    extractRowMatrix: extractRowMatrix,

    // flags / power / predicates
    calcArmyPower: calcArmyPower,
    computeDerivedFlags: computeDerivedFlags,
    predicate: predicate,
    composeAnd: composeAnd,
    countMatching: countMatching,

    // sort
    sortBy: sortBy,

    // geo
    getContinent: getContinent,
    fieldDistance: fieldDistance,
    nearestEnemy: nearestEnemy,
    distanceToFront: distanceToFront,

    // estimate
    estimateAttackUnits: estimateAttackUnits,
    classifyTrainKind: classifyTrainKind,

    // format helpers
    formatNum: formatNum,
    formatPct: formatPct,

    // column registry + helpers
    COLUMN_REGISTRY: COLUMN_REGISTRY,
    getColumn: getColumn,
    columnsForDomain: columnsForDomain,
    gateColumnsByWorld: gateColumnsByWorld,
    resolveVisibleColumns: resolveVisibleColumns,

    // master model + caching + premium + incomings aggregation
    buildMasterModel: buildMasterModel,
    cacheKeyFor: cacheKeyFor,
    CACHE_TTL_MS: CACHE_TTL_MS,
    detectPremium: detectPremium,
    aggregateIncomingsByTarget: aggregateIncomingsByTarget
  };

  // Attach browser surface only-if-absent (idempotent).
  TWTools.OverviewCore = TWTools.OverviewCore || OverviewCore;

  // Node-compat tail — inert in-browser (typeof module === 'undefined').
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = OverviewCore;
  }

})(
  typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this),
  typeof jQuery !== 'undefined' ? jQuery : undefined
);
