/**
 * tw-table — the generic, declarative-registry table engine for the Overview suite.
 *
 * @version 2.0.0
 *
 * TWO layers in ONE file (node-compat envelope — see
 * tasks/2026-06-23-tw-overview-ultimate/node-compat-envelope.md):
 *
 *   PURE CORE  (Table.pure.*) — node-testable, ZERO DOM/jQuery/window access:
 *     applyFilters, computeFilterCounts, applyMultiSort, toggleSortKey,
 *     projectVisible, resolvePillClasses, buildBBCode, buildCSV,
 *     formatCellForExport, computeVirtualWindow.
 *
 *   DOM LAYER  (render) — browser-only, node-SAFE: attaches/executes only when a
 *     real `root.document` exists; otherwise render() returns an inert no-op
 *     controller. Ships its OWN inline escapeHtml + clipboard fallback and only
 *     PROBES the optional TWTools.UI.toast.
 *
 * Consumes TWTools.OverviewCore (sortBy / predicate / composeAnd / registry) at
 * CALL TIME, fail-safe if absent. NON-throwing namespace guard (does NOT copy the
 * throw-if-!TWTools guard from tw-ui/tw-commands — that would crash node:test).
 *
 * Read-only / generic / reusable: no network I/O, no auto-send, no Overview-only
 * assumptions baked in — any sibling script can drive it from a model + columns.
 */
;(function (root, $) {
  'use strict';

  // Non-throwing namespace guard. In node, `root` is globalThis and may have no
  // TWTools — that is fine; the pure layer needs none. Only attach to a REAL
  // browser window (root.document present).
  var TWTools = (root && root.TWTools) || {};
  if (typeof root !== 'undefined' && root && root.document) {
    root.TWTools = TWTools;
  }

  // ============================================================
  // OverviewCore bridge (consumed at call time, fail-safe if absent)
  // ============================================================

  /** @returns {?Object} TWTools.OverviewCore, or null when not loaded. */
  function core() {
    var t = (root && root.TWTools) || TWTools;
    return (t && t.OverviewCore) ? t.OverviewCore : null;
  }

  var STATE_ROW_PRIORITY = ['nuke', 'underdef', 'whfull'];

  // Pill flag -> {class, accent}. Reconciled with the .twt-card parchment theme.
  var PILL_MAP = {
    nuke:    { cssClass: 'twt-row-nuke',    accent: '#7a1f7a' }, // purple — incoming nuke
    underdef:{ cssClass: 'twt-row-underdef', accent: '#b22222' }, // red — under-defended
    whfull:  { cssClass: 'twt-row-whfull',  accent: '#c08400' }  // amber — warehouse near full
  };

  var DEFAULT_ROW_HEIGHT = 22;
  var VIRTUAL_THRESHOLD = 150;
  var VIRTUAL_OVERSCAN = 8;

  // ============================================================
  // PURE: filters
  // ============================================================

  /**
   * Build a single-spec predicate. Reuses OverviewCore.predicate when available;
   * adds a 'search' op (case-insensitive substring) which is table-engine-local.
   * Unknown ops pass everything (fail-safe). NEVER throws.
   * @private
   */
  function buildPredicate(spec) {
    spec = spec || {};
    var op = spec.op;
    var key = spec.key;
    var value = spec.value;
    if (op === 'search') {
      var needle = String(value === undefined || value === null ? '' : value).toLowerCase();
      return function (row) {
        if (!row) return false;
        var v = row[key];
        return String(v === undefined || v === null ? '' : v).toLowerCase().indexOf(needle) !== -1;
      };
    }
    var oc = core();
    if (oc && typeof oc.predicate === 'function' &&
        (op === 'gte' || op === 'lte' || op === 'eq' || op === 'flag' || op === 'between')) {
      return oc.predicate(op, key, value, spec.value2);
    }
    // Local fail-safe fallback (mirrors OverviewCore.predicate).
    switch (op) {
      case 'gte': return function (row) { return toNum(row, key) >= value; };
      case 'lte': return function (row) { return toNum(row, key) <= value; };
      case 'eq': return function (row) { return toNum(row, key) === value; };
      case 'flag': return function (row) { return !!(row && row[key]); };
      case 'between': return function (row) { var n = toNum(row, key); return n >= value && n <= spec.value2; };
      default: return function () { return true; };
    }
  }

  function toNum(row, key) {
    if (!row) return 0;
    var v = row[key];
    if (typeof v === 'number') return v;
    var n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  /**
   * Filter rows by composable AND of filterSpecs. Empty/absent spec -> rows copy.
   * @param {Array} rows
   * @param {Array.<{key,op,value}>} filterSpecs
   * @param {Array} [columns] - present for signature parity (unused by pure filter).
   * @returns {Array}
   */
  function applyFilters(rows, filterSpecs, columns) {
    if (!Array.isArray(rows)) return [];
    if (!Array.isArray(filterSpecs) || filterSpecs.length === 0) return rows.slice();
    var preds = [];
    for (var i = 0; i < filterSpecs.length; i++) preds.push(buildPredicate(filterSpecs[i]));
    var oc = core();
    var combined = (oc && typeof oc.composeAnd === 'function')
      ? oc.composeAnd(preds)
      : composeAndLocal(preds);
    var out = [];
    for (var r = 0; r < rows.length; r++) {
      if (combined(rows[r])) out.push(rows[r]);
    }
    return out;
  }

  function composeAndLocal(preds) {
    return function (row) {
      for (var i = 0; i < preds.length; i++) {
        if (typeof preds[i] === 'function' && !preds[i](row)) return false;
      }
      return true;
    };
  }

  /**
   * Count matching rows per chip. Keyed `${key}|${op}|${value}`.
   * @param {Array} rows
   * @param {Array.<{key,op,value}>} chipSpecs
   * @param {Array} [columns]
   * @returns {Object.<string, number>}
   */
  function computeFilterCounts(rows, chipSpecs, columns) {
    var out = {};
    if (!Array.isArray(rows) || !Array.isArray(chipSpecs)) return out;
    for (var i = 0; i < chipSpecs.length; i++) {
      var chip = chipSpecs[i] || {};
      var id = chip.key + '|' + chip.op + '|' + chip.value;
      out[id] = applyFilters(rows, [chip], columns).length;
    }
    return out;
  }

  // ============================================================
  // PURE: multi-sort
  // ============================================================

  /**
   * Sort rows by a multi-key sort spec; ALWAYS returns a NEW array (never mutates
   * input). Delegates to OverviewCore.sortBy for the comparator; uses a
   * decorate/sort/undecorate to keep the sort stable across runtimes.
   * @param {Array} rows
   * @param {Array.<{key,dir,type}>} sortSpec
   * @param {Array} [columns] - used to infer sortType when a spec omits `type`.
   * @returns {Array}
   */
  function applyMultiSort(rows, sortSpec, columns) {
    if (!Array.isArray(rows)) return [];
    if (!Array.isArray(sortSpec) || sortSpec.length === 0) return rows.slice();

    var spec = normalizeSortSpec(sortSpec, columns);
    var oc = core();
    var cmp = (oc && typeof oc.sortBy === 'function') ? oc.sortBy(spec) : sortByLocal(spec);

    // Decorate-with-index / sort / undecorate -> stable regardless of engine.
    var decorated = rows.map(function (row, i) { return { row: row, i: i }; });
    decorated.sort(function (a, b) {
      var c = cmp(a.row, b.row);
      return c !== 0 ? c : (a.i - b.i);
    });
    return decorated.map(function (d) { return d.row; });
  }

  function normalizeSortSpec(sortSpec, columns) {
    var byKey = columnsByKey(columns);
    var out = [];
    for (var i = 0; i < sortSpec.length; i++) {
      var s = sortSpec[i] || {};
      var type = s.type;
      if (!type && byKey[s.key]) type = byKey[s.key].sortType;
      out.push({ key: s.key, dir: s.dir === 'desc' ? 'desc' : 'asc', type: type || 'num' });
    }
    return out;
  }

  // Local fallback comparator (mirrors OverviewCore.sortBy), used only if absent.
  function sortByLocal(spec) {
    if (!Array.isArray(spec) || spec.length === 0) return function () { return 0; };
    return function (a, b) {
      for (var i = 0; i < spec.length; i++) {
        var s = spec[i] || {};
        var sign = s.dir === 'desc' ? -1 : 1;
        var c;
        if (s.type === 'str') {
          c = strOf(a, s.key).localeCompare(strOf(b, s.key)) * sign;
        } else {
          var na = numInf(a, s.key), nb = numInf(b, s.key);
          if (na === Infinity && nb === Infinity) c = 0;
          else if (na === Infinity) c = 1;
          else if (nb === Infinity) c = -1;
          else c = (na < nb ? -1 : na > nb ? 1 : 0) * sign;
        }
        if (c !== 0) return c;
      }
      return 0;
    };
  }

  function strOf(row, key) {
    if (!row) return '';
    var v = row[key];
    return (v === undefined || v === null) ? '' : String(v);
  }

  function numInf(row, key) {
    if (!row) return Infinity;
    var v = row[key];
    if (v === undefined || v === null) return Infinity;
    var n = (typeof v === 'number') ? v : Number(v);
    return isNaN(n) ? Infinity : n;
  }

  /**
   * Update a multi-sort spec from a header click. NEVER mutates the input.
   *   - additive (shift): existing key cycles asc<->desc in place; new key appends asc.
   *   - plain: replaces the spec with the sole key, cycling asc<->desc if it was the
   *     only sole key, else fresh asc.
   * @param {Array.<{key,dir}>} sortSpec
   * @param {string} key
   * @param {boolean} additive
   * @returns {Array.<{key,dir}>}
   */
  function toggleSortKey(sortSpec, key, additive) {
    var spec = Array.isArray(sortSpec) ? sortSpec.map(function (s) {
      return { key: s.key, dir: s.dir === 'desc' ? 'desc' : 'asc', type: s.type };
    }) : [];

    var idx = -1;
    for (var i = 0; i < spec.length; i++) { if (spec[i].key === key) { idx = i; break; } }

    if (additive) {
      if (idx === -1) {
        spec.push({ key: key, dir: 'asc' });
      } else {
        spec[idx].dir = spec[idx].dir === 'asc' ? 'desc' : 'asc';
      }
      return spec;
    }

    // Plain click: replace with a single key; cycle direction only when it was
    // already the sole sort key.
    if (spec.length === 1 && idx === 0) {
      return [{ key: key, dir: spec[0].dir === 'asc' ? 'desc' : 'asc' }];
    }
    return [{ key: key, dir: 'asc' }];
  }

  // ============================================================
  // PURE: projection
  // ============================================================

  function columnsByKey(columns) {
    var byKey = {};
    if (Array.isArray(columns)) {
      for (var i = 0; i < columns.length; i++) {
        if (columns[i] && columns[i].key) byKey[columns[i].key] = columns[i];
      }
    }
    return byKey;
  }

  function getColValue(row, col) {
    if (!col) return undefined;
    if (typeof col.get === 'function') return col.get(row);
    return row ? row[col.key] : undefined;
  }

  /**
   * Project one row into ordered display cells for the visible columns.
   * visibleColumns is a list of keys (registry/column order). When absent, falls
   * back to every column with defaultVisible !== false. Unknown keys are ignored.
   * Cell text uses descriptor.format(value, row) when present, else String(value).
   * @param {Object} row
   * @param {Array.<string>} visibleColumns
   * @param {Array} columns - the column descriptors.
   * @returns {Array.<{key, text, raw, col}>}
   */
  function projectVisible(row, visibleColumns, columns) {
    var byKey = columnsByKey(columns);
    var keys;
    if (Array.isArray(visibleColumns) && visibleColumns.length) {
      keys = visibleColumns;
    } else {
      keys = [];
      if (Array.isArray(columns)) {
        for (var i = 0; i < columns.length; i++) {
          if (columns[i] && columns[i].defaultVisible !== false) keys.push(columns[i].key);
        }
      }
    }
    var out = [];
    for (var k = 0; k < keys.length; k++) {
      var col = byKey[keys[k]];
      if (!col) continue;
      var raw = getColValue(row, col);
      var text;
      if (typeof col.format === 'function') {
        text = col.format(raw, row);
      } else {
        text = (raw === undefined || raw === null) ? '' : String(raw);
      }
      out.push({ key: col.key, text: text, raw: raw, col: col });
    }
    return out;
  }

  // ============================================================
  // PURE: row pills
  // ============================================================

  /**
   * Resolve the data-state pill classes for a row. Priority: incoming-nuke >
   * under-defended > wh-near-full. Returns {classes:[], accent:''} — multiple
   * classes may apply, but accent is the highest-priority one.
   * @param {Object} row - flags: incomingNuke / nukesEst (incoming) / underDefended / whNearFull.
   *   NB: isNuke means the village is itself an OFFENSIVE nuke — that is NOT an incoming nuke and
   *   must not trigger the purple pill.
   * @returns {{classes:Array.<string>, accent:string}}
   */
  function resolvePillClasses(row) {
    row = row || {};
    var states = [];
    // Purple = an incoming nuke is (estimated to be) landing here — from the incomings domain,
    // never from isNuke (which is this village's own offensive strength).
    if (row.incomingNuke || (row.nukesEst || 0) > 0) states.push('nuke');
    if (row.underDefended) states.push('underdef');
    if (row.whNearFull) states.push('whfull');

    var classes = [];
    var accent = '';
    for (var p = 0; p < STATE_ROW_PRIORITY.length; p++) {
      var st = STATE_ROW_PRIORITY[p];
      if (states.indexOf(st) !== -1) {
        classes.push(PILL_MAP[st].cssClass);
        if (!accent) accent = PILL_MAP[st].accent;
      }
    }
    return { classes: classes, accent: accent };
  }

  // ============================================================
  // PURE: export (raw — display formatting is DOM-only)
  // ============================================================

  /**
   * Format a single cell value for EXPORT. Raw by design: numbers stay
   * separator-free, coord columns emit raw "x|y", null/undefined -> ''. NEVER
   * calls descriptor.format (display formatting stays in the DOM layer).
   * @param {*} value
   * @param {Object} column
   * @returns {string}
   */
  function formatCellForExport(value, column) {
    if (value === undefined || value === null) return '';
    if (column && column.isCoordCol) {
      // value is already the coord string (from get); normalize to raw x|y.
      var s = String(value);
      var m = s.match(/(\d{1,3})\|(\d{1,3})/);
      return m ? (m[1] + '|' + m[2]) : s;
    }
    if (typeof value === 'boolean') return value ? '1' : '';
    return String(value);
  }

  /**
   * Build TW BBCode for the CURRENT view (rows already filtered/sorted; columns
   * already the visible set). Coord columns use [coord]x|y[/coord].
   * @param {Array} rows
   * @param {Array} columns - visible column descriptors.
   * @param {Object} [opts] - {title}.
   * @returns {string}
   */
  function buildBBCode(rows, columns, opts) {
    rows = Array.isArray(rows) ? rows : [];
    columns = Array.isArray(columns) ? columns : [];
    opts = opts || {};
    var lines = [];
    lines.push('[table]');

    // Header row.
    var heads = [];
    for (var h = 0; h < columns.length; h++) {
      var col = columns[h] || {};
      heads.push(col.bbHeader || col.label || col.key || '');
    }
    lines.push('[**]' + heads.join('[||]') + '[/**]');

    // Data rows.
    for (var r = 0; r < rows.length; r++) {
      var cells = [];
      for (var c = 0; c < columns.length; c++) {
        var column = columns[c];
        var raw = getColValue(rows[r], column);
        var val = formatCellForExport(raw, column);
        if (column && column.isCoordCol && val) val = '[coord]' + val + '[/coord]';
        cells.push(val);
      }
      lines.push('[*]' + cells.join('[|]'));
    }

    lines.push('[/table]');
    var body = lines.join('\n');
    return opts.title ? ('[b]' + opts.title + '[/b]\n' + body) : body;
  }

  /**
   * Build CSV for the CURRENT view. Quotes a cell only when it contains a comma,
   * a double-quote, or a newline (RFC-4180 minimal quoting). Numbers raw.
   * @param {Array} rows
   * @param {Array} columns - visible column descriptors.
   * @returns {string}
   */
  function buildCSV(rows, columns) {
    rows = Array.isArray(rows) ? rows : [];
    columns = Array.isArray(columns) ? columns : [];
    var lines = [];

    var heads = [];
    for (var h = 0; h < columns.length; h++) {
      var col = columns[h] || {};
      heads.push(csvQuote(col.csvHeader || col.label || col.key || ''));
    }
    lines.push(heads.join(','));

    for (var r = 0; r < rows.length; r++) {
      var cells = [];
      for (var c = 0; c < columns.length; c++) {
        var column = columns[c];
        var raw = getColValue(rows[r], column);
        cells.push(csvQuote(formatCellForExport(raw, column)));
      }
      lines.push(cells.join(','));
    }
    return lines.join('\n');
  }

  function csvQuote(s) {
    s = (s === undefined || s === null) ? '' : String(s);
    if (/[",\n\r]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  // ============================================================
  // PURE: virtualization window
  // ============================================================

  /**
   * Compute the slice of rows to render for a virtualized tbody.
   * @param {number} scrollTop
   * @param {number} rowHeight
   * @param {number} viewportH
   * @param {number} total - total row count.
   * @returns {{startIndex, endIndex, padTop, padBottom}}
   */
  function computeVirtualWindow(scrollTop, rowHeight, viewportH, total) {
    total = Math.max(0, total | 0);
    rowHeight = rowHeight > 0 ? rowHeight : DEFAULT_ROW_HEIGHT;
    viewportH = viewportH > 0 ? viewportH : 0;
    scrollTop = scrollTop > 0 ? scrollTop : 0;

    if (total === 0) {
      return { startIndex: 0, endIndex: 0, padTop: 0, padBottom: 0 };
    }

    var visibleCount = Math.ceil(viewportH / rowHeight) + VIRTUAL_OVERSCAN;
    var start = Math.floor(scrollTop / rowHeight) - VIRTUAL_OVERSCAN;
    if (start < 0) start = 0;
    if (start > total) start = total;

    var end = start + visibleCount;
    if (end > total) end = total;

    return {
      startIndex: start,
      endIndex: end,
      padTop: start * rowHeight,
      padBottom: (total - end) * rowHeight
    };
  }

  // ============================================================
  // PURE API object
  // ============================================================

  var PURE = {
    applyFilters: applyFilters,
    computeFilterCounts: computeFilterCounts,
    applyMultiSort: applyMultiSort,
    toggleSortKey: toggleSortKey,
    projectVisible: projectVisible,
    resolvePillClasses: resolvePillClasses,
    buildBBCode: buildBBCode,
    buildCSV: buildCSV,
    formatCellForExport: formatCellForExport,
    computeVirtualWindow: computeVirtualWindow
  };

  // ============================================================
  // DOM-ONLY helpers (inline escapeHtml + clipboard fallback)
  // ============================================================

  /**
   * Escape HTML special chars. Inline (TWTools.escapeHtml does NOT exist).
   * @param {*} str
   * @returns {string}
   */
  function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Copy text to the clipboard: navigator.clipboard first, textarea+execCommand
   * fallback. Inline (TWTools.copyToClipboard does NOT exist). Best-effort.
   * @param {string} text
   * @param {Object} [win] - window-like (for document access in browser only).
   * @returns {boolean} true when a copy path ran.
   */
  function copyText(text, win) {
    win = win || (typeof window !== 'undefined' ? window : null);
    if (!win || !win.document) return false;
    try {
      if (win.navigator && win.navigator.clipboard && win.navigator.clipboard.writeText) {
        win.navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through to execCommand */ }
    try {
      var ta = win.document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      win.document.body.appendChild(ta);
      ta.select();
      win.document.execCommand('copy');
      win.document.body.removeChild(ta);
      return true;
    } catch (e2) {
      return false;
    }
  }

  /** Probe the optional toast — no-op when TWTools.UI.toast is absent. @private */
  function maybeToast(message, type) {
    var t = (root && root.TWTools) || TWTools;
    if (t && t.UI && typeof t.UI.toast === 'function') {
      try { t.UI.toast(message, type); } catch (e) { /* ignore */ }
    }
  }

  // ============================================================
  // DOM-ONLY: idempotent style injection
  // ============================================================

  var STYLE_ID = 'twt-table-styles';

  function injectStyles(doc) {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    var css = [
      '.twt-grid-wrap { display:flex; flex-direction:column; height:100%; }',
      '.twt-grid-toolbar { display:flex; flex-wrap:wrap; gap:4px; align-items:center;',
      '  padding:4px; background:#e8d8a8; border-bottom:1px solid #c0a060; }',
      '.twt-grid-viewport { flex:1; overflow:auto; position:relative; }',
      'table.twt-grid { width:100%; border-collapse:collapse; font-size:11px;',
      '  font-family:Verdana,Arial,sans-serif; color:#3e2e14; background:#f4e4bc; }',
      'table.twt-grid thead th { position:sticky; top:0; z-index:2;',
      '  background:#e8d8a8; border:1px solid #c0a060; padding:2px 5px; cursor:pointer;',
      '  white-space:nowrap; text-align:left; }',
      'table.twt-grid thead th .twt-sort-badge { color:#7a5a20; font-size:9px; margin-left:3px; }',
      'table.twt-grid td { border:1px solid #d8c898; padding:2px 5px; white-space:nowrap; }',
      'table.twt-grid tbody tr:hover td { background:rgba(120,90,30,0.06); }',
      'table.twt-grid tr.twt-row-nuke    td { background:rgba(128,0,128,0.10); }',
      'table.twt-grid tr.twt-row-underdef td { background:rgba(200,0,0,0.10); }',
      'table.twt-grid tr.twt-row-whfull   td { background:rgba(200,140,0,0.12); }',
      '.twt-grid-chip { display:inline-block; padding:1px 7px; border:1px solid #c0a060;',
      '  border-radius:9px; background:#f4e4bc; color:#3e2e14; font-size:10px; cursor:pointer;',
      '  user-select:none; }',
      '.twt-grid-chip.active { background:#7a5a20; color:#fff; border-color:#5a3a10; }',
      '.twt-grid-chip .twt-chip-count { opacity:0.75; margin-left:4px; }',
      '.twt-grid-sep { width:1px; align-self:stretch; background:#c0a060; margin:0 3px; }',
      '.twt-grid-btn { padding:1px 8px; border:1px solid #c0a060; background:#f4e4bc;',
      '  color:#3e2e14; font-size:10px; cursor:pointer; border-radius:2px; }',
      '.twt-grid-btn:hover { background:#e8d8a8; }',
      '.twt-grid-spacer td { padding:0; border:none; background:transparent; }',
      'table.twt-grid a { color:#5a3a10; }'
    ].join('\n');
    var el = doc.createElement('style');
    el.id = STYLE_ID;
    el.type = 'text/css';
    el.textContent = css;
    (doc.head || doc.documentElement).appendChild(el);
  }

  // ============================================================
  // DOM LAYER: render(container, model, opts)
  // ============================================================

  /**
   * Render an interactive table. Browser-only; returns an INERT controller under
   * node (no $/document). The controller exposes update/setSort/setFilters/
   * setVisible/getViewRows/exportBBCode/exportCSV/destroy/element.
   *
   * @param {(string|Object)} container - selector or DOM/jQuery element.
   * @param {Array} model - per-row data.
   * @param {Object} opts - {id, title, columns, sort, filters, visibleColumns,
   *                          onSortChange, onFilterChange, onVisibleChange,
   *                          rowHeight}.
   * @returns {Object} controller.
   */
  function render(container, model, opts) {
    opts = opts || {};
    var win = (root && root.document) ? root : (typeof window !== 'undefined' ? window : null);

    // Node / no-DOM / no-jQuery -> inert controller.
    if (!$ || !win || !win.document) {
      return {
        update: function () {}, setSort: function () {}, setFilters: function () {},
        setVisible: function () {}, getViewRows: function () { return []; },
        exportBBCode: function () { return ''; }, exportCSV: function () { return ''; },
        destroy: function () {}, element: null
      };
    }

    var doc = win.document;
    injectStyles(doc);

    var id = opts.id || 't';
    var ns = '.twtbl_' + id;
    var columns = Array.isArray(opts.columns) ? opts.columns : [];
    var rowHeight = opts.rowHeight > 0 ? opts.rowHeight : DEFAULT_ROW_HEIGHT;

    // State.
    var allRows = Array.isArray(model) ? model.slice() : [];
    var sort = Array.isArray(opts.sort) ? opts.sort.slice() : [];
    var filters = Array.isArray(opts.filters) ? opts.filters.slice() : [];
    var visibleCols = projectVisibleKeys(opts.visibleColumns, columns);
    var viewRows = [];

    // Resolve + clean container; remove any prior same-id root + handlers.
    var $container = $(container);
    var rootSel = '#twt-table-' + id;
    $container.find(rootSel).remove();
    $(doc).off(ns);

    var $wrap = $('<div class="twt-grid-wrap" id="twt-table-' + id + '"></div>');
    var $toolbar = $('<div class="twt-grid-toolbar"></div>');
    var $viewport = $('<div class="twt-grid-viewport"></div>');
    var $grid = $('<table class="twt-grid"><thead></thead><tbody></tbody></table>');
    $viewport.append($grid);
    $wrap.append($toolbar).append($viewport);
    $container.append($wrap);

    function recomputeView() {
      viewRows = applyMultiSort(applyFilters(allRows, filters, columns), sort, columns);
    }

    // ---- header ----
    function buildHeader() {
      var sortRank = {};
      for (var s = 0; s < sort.length; s++) sortRank[sort[s].key] = s;
      var ths = [];
      for (var i = 0; i < visibleCols.length; i++) {
        var col = colByKey(columns, visibleCols[i]);
        if (!col) continue;
        var label = col.headerImg
          ? '<img src="' + escapeHtml(col.headerImg) + '" alt="' + escapeHtml(col.label || col.key) + '">'
          : escapeHtml(col.label || col.key);
        var badge = '';
        if (sortRank[col.key] !== undefined) {
          var dir = sort[sortRank[col.key]].dir === 'desc' ? '▼' : '▲';
          var rankNum = sort.length > 1 ? (sortRank[col.key] + 1) : '';
          badge = '<span class="twt-sort-badge">' + dir + rankNum + '</span>';
        }
        var sortable = col.sortable !== false ? ' data-sortable="1"' : '';
        ths.push('<th data-col="' + escapeHtml(col.key) + '"' + sortable + '>' + label + badge + '</th>');
      }
      $grid.children('thead').html('<tr>' + ths.join('') + '</tr>');
    }

    // ---- body ----
    function buildBody() {
      var $tbody = $grid.children('tbody');
      var total = viewRows.length;
      var html;
      if (total > VIRTUAL_THRESHOLD) {
        var scrollTop = $viewport.scrollTop() || 0;
        var viewportH = $viewport.height() || 0;
        var w = computeVirtualWindow(scrollTop, rowHeight, viewportH, total);
        html = '';
        if (w.padTop > 0) html += spacerRow(w.padTop);
        for (var r = w.startIndex; r < w.endIndex; r++) html += rowHtml(viewRows[r]);
        if (w.padBottom > 0) html += spacerRow(w.padBottom);
      } else {
        html = '';
        for (var k = 0; k < total; k++) html += rowHtml(viewRows[k]);
      }
      $tbody.html(html);
    }

    function spacerRow(h) {
      return '<tr class="twt-grid-spacer"><td colspan="' + Math.max(1, visibleCols.length) +
        '" style="height:' + h + 'px"></td></tr>';
    }

    function rowHtml(row) {
      var pills = resolvePillClasses(row);
      var cls = pills.classes.length ? (' class="' + pills.classes.join(' ') + '"') : '';
      var accent = pills.accent ? (' style="box-shadow:inset 3px 0 0 ' + pills.accent + '"') : '';
      var cells = projectVisible(row, visibleCols, columns);
      var tds = [];
      for (var i = 0; i < cells.length; i++) {
        var cell = cells[i];
        var col = cell.col;
        var inner;
        if (col && col.isCoordCol && typeof col.coordGet === 'function') {
          var co = col.coordGet(row);
          if (co && co.x !== undefined && co.y !== undefined) {
            inner = '<a href="/game.php?screen=info_village&id=' + escapeHtml(String(row && row.id)) +
              '" target="_blank">' + escapeHtml(co.x + '|' + co.y) + '</a>';
          } else {
            inner = escapeHtml(cell.text);
          }
        } else {
          inner = escapeHtml(cell.text);
        }
        tds.push('<td' + (i === 0 ? accent : '') + '>' + inner + '</td>');
      }
      return '<tr' + cls + '>' + tds.join('') + '</tr>';
    }

    // ---- toolbar (chips + export) ----
    function buildToolbar() {
      var parts = [];
      // Column-toggle chips.
      for (var i = 0; i < columns.length; i++) {
        var col = columns[i];
        if (!col || col.toggleable === false) continue;
        var on = visibleCols.indexOf(col.key) !== -1 ? ' active' : '';
        parts.push('<span class="twt-grid-chip' + on + '" data-toggle-col="' +
          escapeHtml(col.key) + '">' + escapeHtml(col.label || col.key) + '</span>');
      }
      parts.push('<span class="twt-grid-sep"></span>');

      // Threshold filter chips with live counts.
      var chipSpecs = collectChipSpecs(columns);
      var counts = computeFilterCounts(allRows, chipSpecs, columns);
      for (var f = 0; f < chipSpecs.length; f++) {
        var chip = chipSpecs[f];
        var fid = chip.key + '|' + chip.op + '|' + chip.value;
        var active = isFilterActive(chip) ? ' active' : '';
        parts.push('<span class="twt-grid-chip' + active + '" data-filter-id="' +
          escapeHtml(fid) + '">' + escapeHtml(chip.label) +
          '<span class="twt-chip-count">' + (counts[fid] || 0) + '</span></span>');
      }

      parts.push('<span class="twt-grid-sep"></span>');
      parts.push('<button class="twt-grid-btn" data-export="bbcode">BBCode</button>');
      parts.push('<button class="twt-grid-btn" data-export="csv">CSV</button>');
      $toolbar.html(parts.join(''));
    }

    function isFilterActive(chip) {
      for (var i = 0; i < filters.length; i++) {
        if (filters[i].key === chip.key && filters[i].op === chip.op && filters[i].value === chip.value) {
          return true;
        }
      }
      return false;
    }

    // ---- full repaint ----
    function repaint() {
      recomputeView();
      buildToolbar();
      buildHeader();
      buildBody();
    }

    // ---- event delegation (established ONCE) ----
    $wrap.on('click' + ns, '[data-toggle-col]', function () {
      var key = $(this).attr('data-toggle-col');
      var i = visibleCols.indexOf(key);
      if (i === -1) visibleCols.push(key); else visibleCols.splice(i, 1);
      visibleCols = projectVisibleKeys(visibleCols, columns);
      repaint();
      fire(opts.onVisibleChange, visibleCols.slice());
    });

    $wrap.on('click' + ns, '[data-filter-id]', function () {
      var fid = $(this).attr('data-filter-id');
      var chip = chipByFid(columns, fid);
      if (!chip) return;
      if (isFilterActive(chip)) {
        filters = filters.filter(function (f) {
          return !(f.key === chip.key && f.op === chip.op && f.value === chip.value);
        });
      } else {
        filters.push({ key: chip.key, op: chip.op, value: chip.value });
      }
      repaint();
      fire(opts.onFilterChange, filters.slice());
    });

    $wrap.on('click' + ns, 'thead th[data-sortable]', function () {
      var key = $(this).attr('data-col');
      sort = toggleSortKey(sort, key, !!(win.event && win.event.shiftKey));
      repaint();
      fire(opts.onSortChange, sort.slice());
    });
    // Capture shiftKey reliably via the jQuery event.
    $wrap.on('click' + ns, 'thead th[data-sortable]', null, function () {});

    $wrap.on('click' + ns, '[data-export]', function () {
      var kind = $(this).attr('data-export');
      var text = kind === 'csv'
        ? buildCSV(viewRows, visibleDescriptors())
        : buildBBCode(viewRows, visibleDescriptors(), { title: opts.title });
      var ok = copyText(text, win);
      maybeToast(ok ? (kind.toUpperCase() + ' copied') : 'Copy failed', ok ? 'success' : 'error');
    });

    // rAF-throttled virtual scroll repaint of just the tbody slice.
    var rafPending = false;
    $viewport.on('scroll' + ns, function () {
      if (viewRows.length <= VIRTUAL_THRESHOLD || rafPending) return;
      rafPending = true;
      var raf = win.requestAnimationFrame || function (cb) { return win.setTimeout(cb, 16); };
      raf(function () { rafPending = false; buildBody(); });
    });

    function visibleDescriptors() {
      var out = [];
      for (var i = 0; i < visibleCols.length; i++) {
        var c = colByKey(columns, visibleCols[i]);
        if (c) out.push(c);
      }
      return out;
    }

    function fire(cb, payload) {
      if (typeof cb === 'function') {
        try { cb(payload); } catch (e) { /* host callback errors never break the table */ }
      }
    }

    // Initial paint.
    repaint();

    return {
      element: $wrap[0],
      update: function (newModel) {
        allRows = Array.isArray(newModel) ? newModel.slice() : [];
        repaint();
      },
      setSort: function (newSort) { sort = Array.isArray(newSort) ? newSort.slice() : []; repaint(); },
      setFilters: function (newFilters) { filters = Array.isArray(newFilters) ? newFilters.slice() : []; repaint(); },
      setVisible: function (newVisible) { visibleCols = projectVisibleKeys(newVisible, columns); repaint(); },
      getViewRows: function () { return viewRows.slice(); },
      exportBBCode: function () { return buildBBCode(viewRows, visibleDescriptors(), { title: opts.title }); },
      exportCSV: function () { return buildCSV(viewRows, visibleDescriptors()); },
      destroy: function () { $wrap.off(ns); $viewport.off(ns); $wrap.remove(); }
    };
  }

  // ---- DOM-layer small helpers ----

  function projectVisibleKeys(visibleColumns, columns) {
    var byKey = columnsByKey(columns);
    var out = [];
    var keys;
    if (Array.isArray(visibleColumns) && visibleColumns.length) {
      keys = visibleColumns;
    } else {
      keys = [];
      for (var i = 0; i < columns.length; i++) {
        if (columns[i] && columns[i].defaultVisible !== false) keys.push(columns[i].key);
      }
    }
    for (var k = 0; k < keys.length; k++) {
      if (byKey[keys[k]] && out.indexOf(keys[k]) === -1) out.push(keys[k]);
    }
    return out;
  }

  function colByKey(columns, key) {
    if (!Array.isArray(columns)) return null;
    for (var i = 0; i < columns.length; i++) {
      if (columns[i] && columns[i].key === key) return columns[i];
    }
    return null;
  }

  function collectChipSpecs(columns) {
    var out = [];
    if (!Array.isArray(columns)) return out;
    for (var i = 0; i < columns.length; i++) {
      var col = columns[i];
      if (!col || !Array.isArray(col.thresholds)) continue;
      for (var t = 0; t < col.thresholds.length; t++) {
        var th = col.thresholds[t] || {};
        out.push({
          key: col.key, op: th.op, value: th.value,
          label: th.label || (col.label + ' ' + th.op + ' ' + th.value)
        });
      }
    }
    return out;
  }

  function chipByFid(columns, fid) {
    var specs = collectChipSpecs(columns);
    for (var i = 0; i < specs.length; i++) {
      if ((specs[i].key + '|' + specs[i].op + '|' + specs[i].value) === fid) return specs[i];
    }
    return null;
  }

  // ============================================================
  // PUBLIC API + node-compat tail
  // ============================================================

  var Table = {
    pure: PURE,
    render: render,
    // expose the inline DOM helpers for sibling reuse (browser-only by usage).
    escapeHtml: escapeHtml,
    copyText: copyText
  };

  // Attach browser surface only-if-absent (idempotent).
  TWTools.Table = TWTools.Table || Table;

  // Node-compat tail — inert in-browser (typeof module === 'undefined').
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Table;
  }

})(
  typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this),
  typeof jQuery !== 'undefined' ? jQuery : undefined
);
