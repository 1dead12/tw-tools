;(function(window, $) {
  'use strict';

  // ============================================================
  // MOBILE SUPPORT
  // ============================================================
  // TW's mobile layout (body.mds) is a compact but fully functional game view.
  // All screens work (am_farm, overview_villages, scavenge, map, etc.).
  // We inject responsive CSS to make floating TWTools cards fit mobile screens.

  var IS_MOBILE = (typeof document !== 'undefined' && document.body &&
    document.body.classList.contains('mds'));

  (function mobileSupport() {
    if (typeof document === 'undefined') return;
    if (!IS_MOBILE) return;

    // Inject mobile-responsive CSS for TWTools cards
    var css = document.createElement('style');
    css.id = 'twt-mobile-css';
    css.textContent =
      '.twt-card { ' +
        'position: relative !important; ' +
        'width: 100% !important; ' +
        'max-width: 100vw !important; ' +
        'left: 0 !important; ' +
        'top: auto !important; ' +
        'margin: 4px 0 !important; ' +
        'box-sizing: border-box !important; ' +
        'font-size: 11px !important; ' +
      '} ' +
      '.twt-card-header { padding: 4px 8px !important; } ' +
      '.twt-card-body { padding: 4px !important; max-height: 70vh; overflow-y: auto; } ' +
      '.twt-card table { font-size: 10px !important; } ' +
      '.twt-card input, .twt-card select { font-size: 12px !important; max-width: 120px; } ' +
      '.twt-card .btn { font-size: 11px !important; padding: 4px 8px !important; } ' +
      // Snipe tabs wrap on mobile
      '.tws-tab { font-size: 10px !important; padding: 3px 6px !important; } ' +
      // Dialog popup responsive
      '#popup_box_TWFarm { width: 90vw !important; max-width: 340px !important; } ';
    document.head.appendChild(css);
  })();

  // ============================================================
  // CONFIG & CONSTANTS
  // ============================================================

  var STORAGE_PREFIX = 'twt_';

  var CACHE_TTL = {
    worldConfig: 24 * 3600000,   // 24h
    unitInfo: 24 * 3600000,      // 24h
    barbVillages: 3600000,       // 1h
    allVillages: 3600000,        // 1h
    players: 3600000,            // 1h
    tribes: 3600000,             // 1h
    buildingInfo: 24 * 3600000   // 24h (static caps)
  };

  /**
   * Default unit speeds in minutes per field.
   * Used as fallback when /interface.php?func=get_unit_info is unavailable.
   * @type {Object.<string, number>}
   */
  var DEFAULT_UNIT_SPEEDS = {
    spear: 18, sword: 22, axe: 18, archer: 18, spy: 9,
    light: 10, marcher: 10, heavy: 11,
    ram: 30, catapult: 30, knight: 10, snob: 35
  };

  /**
   * Multi-language "today" words for date parsing.
   * Covers: SK, CZ, EN, DE, PL, NL, TR, IT, FR, ES, RU, SL.
   * @type {string[]}
   */
  var DATE_WORDS_TODAY = [
    'dnes', 'today', 'heute', 'dzisiaj', 'vandaag', 'idag',
    'bugün', 'oggi', "aujourd", 'hoy', 'сегодня', 'danes'
  ];

  /**
   * Multi-language "tomorrow" words for date parsing.
   * @type {string[]}
   */
  var DATE_WORDS_TOMORROW = [
    'zajtra', 'tomorrow', 'morgen', 'jutro', 'zítra',
    'yarın', 'domani', 'demain', 'mañana', 'завтра', 'jutri'
  ];

  /**
   * Combined date word arrays for external access.
   * @type {{today: string[], tomorrow: string[]}}
   */
  var DATE_WORDS = {
    today: DATE_WORDS_TODAY,
    tomorrow: DATE_WORDS_TOMORROW
  };

  // ============================================================
  // UTILITY FUNCTIONS
  // ============================================================

  /**
   * Zero-pad a number to 2 digits.
   * @param {number} n - Number to pad.
   * @returns {string} Padded string.
   */
  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  /**
   * Zero-pad a number to 3 digits.
   * @param {number} n - Number to pad.
   * @returns {string} Padded string.
   */
  function pad3(n) {
    return n < 10 ? '00' + n : n < 100 ? '0' + n : '' + n;
  }

  /**
   * Parse coordinate string "123|456" into {x, y} object.
   * @param {string} str - Coordinate string.
   * @returns {?{x: number, y: number}} Parsed coords or null.
   */
  function parseCoords(str) {
    var m = (str || '').match(/(\d{1,3})\|(\d{1,3})/);
    if (!m) return null;
    return { x: parseInt(m[1], 10), y: parseInt(m[2], 10) };
  }

  /**
   * Format coords object to string "123|456".
   * @param {{x: number, y: number}} c - Coords object.
   * @returns {string} Formatted coordinate string.
   */
  function formatCoords(c) {
    return c.x + '|' + c.y;
  }

  /**
   * Euclidean distance between two coordinate points.
   * @param {{x: number, y: number}} c1 - First coordinate.
   * @param {{x: number, y: number}} c2 - Second coordinate.
   * @returns {number} Distance in fields.
   */
  function distance(c1, c2) {
    var dx = c1.x - c2.x;
    var dy = c1.y - c2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Calculate travel time in milliseconds.
   * Formula: round((dist * unitSpeed * 60000) / (worldSpeed * unitSpeedFactor))
   * @param {number} dist - Distance in fields.
   * @param {number} unitSpeed - Unit speed in minutes per field.
   * @param {number} worldSpeed - World speed multiplier.
   * @param {number} unitSpeedFactor - Unit speed factor multiplier.
   * @returns {number} Travel time in milliseconds.
   */
  function travelTime(dist, unitSpeed, worldSpeed, unitSpeedFactor) {
    worldSpeed = worldSpeed || 1;
    unitSpeedFactor = unitSpeedFactor || 1;
    return Math.round((dist * unitSpeed * 60000) / (worldSpeed * unitSpeedFactor));
  }

  /**
   * Format milliseconds since midnight to "HH:MM:SS.mmm" (with ms).
   * Uses dot separator before milliseconds for clarity.
   * @param {number} ms - Milliseconds since midnight.
   * @returns {string} Formatted time string.
   */
  function formatTime(ms) {
    var neg = ms < 0;
    if (neg) ms = -ms;
    var totalSec = Math.floor(ms / 1000);
    var millis = ms % 1000;
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    return (neg ? '-' : '') +
      pad2(h) + ':' + pad2(m) + ':' + pad2(s) + '.' + pad3(millis);
  }

  /**
   * Format milliseconds since midnight to "HH:MM:SS" (no ms).
   * @param {number} ms - Milliseconds since midnight.
   * @returns {string} Formatted time string.
   */
  function formatTimeSec(ms) {
    var neg = ms < 0;
    if (neg) ms = -ms;
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    return (neg ? '-' : '') + pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  /**
   * Format milliseconds as human-readable duration.
   * Returns "1h 23m 45s", "2m 5s", "45s", or "PASSED" if negative.
   * @param {number} ms - Duration in milliseconds.
   * @returns {string} Human-readable duration.
   */
  function formatDuration(ms) {
    if (ms < 0) return 'PASSED';
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
  }

  /**
   * Parse time string "HH:MM:SS" or "HH:MM:SS:mmm" to ms since midnight.
   * @param {string} str - Time string.
   * @returns {number} Milliseconds since midnight, or NaN if invalid.
   */
  function parseTimeToMs(str) {
    var parts = (str || '').split(':');
    if (parts.length < 3) return NaN;
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var s = parseInt(parts[2], 10);
    var ms = parts.length > 3 ? parseInt(parts[3], 10) : 0;
    return ((h * 3600) + (m * 60) + s) * 1000 + ms;
  }

  /**
   * Parse arrival time text with date awareness.
   * Handles: "dnes 21:19:34:431", "zajtra 08:56:08:000", "21:19:34:431"
   * Supports multi-language date words (today/tomorrow).
   * @param {string} text - Arrival time text from DOM.
   * @returns {?number} Milliseconds since midnight (adds 86400000 for tomorrow), or null.
   */
  function parseArrivalTime(text) {
    text = (text || '').trim().toLowerCase();
    var isTomorrow = false;

    // Check for tomorrow words
    for (var i = 0; i < DATE_WORDS_TOMORROW.length; i++) {
      if (text.indexOf(DATE_WORDS_TOMORROW[i]) !== -1) {
        isTomorrow = true;
        break;
      }
    }

    // Extract HH:MM:SS:mmm
    var match = text.match(/(\d{1,2}):(\d{2}):(\d{2}):(\d{3})/);
    if (!match) {
      // Try without ms
      match = text.match(/(\d{1,2}):(\d{2}):(\d{2})/);
      if (!match) return null;
    }

    var h = parseInt(match[1], 10);
    var m = parseInt(match[2], 10);
    var s = parseInt(match[3], 10);
    var ms = match[4] ? parseInt(match[4], 10) : 0;

    var timeMs = ((h * 3600) + (m * 60) + s) * 1000 + ms;
    if (isTomorrow) timeMs += 86400000;

    return timeMs;
  }

  // ============================================================
  // PURE MAP/DATA PARSERS (string -> data, fail-safe)
  // ============================================================
  // These take the RAW response text of the world .txt / XML endpoints and
  // return plain data. They NEVER throw — bad input yields []/{}/null. They are
  // the single source of truth shared by DataFetcher (browser AJAX) and node:test.

  /**
   * Decode a TW map.txt name field: '+' -> space, then percent-decode.
   * @param {string} raw - Raw URL-encoded name.
   * @returns {string} Decoded display name.
   */
  function decodeMapName(raw) {
    try {
      return decodeURIComponent(String(raw == null ? '' : raw).replace(/\+/g, ' '));
    } catch (e) {
      return String(raw == null ? '' : raw).replace(/\+/g, ' ');
    }
  }

  /**
   * Parse /map/village.txt CSV.
   * Columns: id,name,x,y,owner,points,bonus_id  (col 6 = bonusId, NOT rank;
   * player rank lives in player.txt and is JOINed by owner in buildVillageIndex).
   * @param {string} csv - Raw village.txt body.
   * @returns {Array.<{id:number,name:string,x:number,y:number,owner:number,points:number,bonusId:number}>}
   */
  function parseVillagesTxt(csv) {
    if (!csv || typeof csv !== 'string') return [];
    var out = [];
    var lines = csv.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line) continue;
      var cols = line.split(',');
      if (cols.length < 6) continue;
      var id = parseInt(cols[0], 10);
      if (isNaN(id)) continue;
      out.push({
        id: id,
        name: decodeMapName(cols[1]),
        x: parseInt(cols[2], 10) || 0,
        y: parseInt(cols[3], 10) || 0,
        owner: parseInt(cols[4], 10) || 0,
        points: parseInt(cols[5], 10) || 0,
        bonusId: parseInt(cols[6], 10) || 0
      });
    }
    return out;
  }

  /**
   * Parse /map/player.txt CSV.
   * Columns: id,name,tribe,villages,points,rank.
   * @param {string} csv - Raw player.txt body.
   * @returns {Array.<{id:number,name:string,tribe:number,villages:number,points:number,rank:number}>}
   */
  function parsePlayersTxt(csv) {
    if (!csv || typeof csv !== 'string') return [];
    var out = [];
    var lines = csv.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line) continue;
      var cols = line.split(',');
      if (cols.length < 6) continue;
      var id = parseInt(cols[0], 10);
      if (isNaN(id)) continue;
      out.push({
        id: id,
        name: decodeMapName(cols[1]),
        tribe: parseInt(cols[2], 10) || 0,
        villages: parseInt(cols[3], 10) || 0,
        points: parseInt(cols[4], 10) || 0,
        rank: parseInt(cols[5], 10) || 0
      });
    }
    return out;
  }

  /**
   * Parse /map/ally.txt CSV.
   * Columns: id,name,tag,members,villages,points,all_points,rank.
   * @param {string} csv - Raw ally.txt body.
   * @returns {Array.<Object>} Tribe rows.
   */
  function parseTribesTxt(csv) {
    if (!csv || typeof csv !== 'string') return [];
    var out = [];
    var lines = csv.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line) continue;
      var cols = line.split(',');
      if (cols.length < 8) continue;
      var id = parseInt(cols[0], 10);
      if (isNaN(id)) continue;
      out.push({
        id: id,
        name: decodeMapName(cols[1]),
        tag: decodeMapName(cols[2]),
        members: parseInt(cols[3], 10) || 0,
        villages: parseInt(cols[4], 10) || 0,
        points: parseInt(cols[5], 10) || 0,
        allPoints: parseInt(cols[6], 10) || 0,
        rank: parseInt(cols[7], 10) || 0
      });
    }
    return out;
  }

  /**
   * Parse the get_building_info XML into {buildingName: {prop: number}}.
   * Uses a regex tag scan on the STRING (no DOMParser) so it runs in node.
   * Top-level child of <config> = a building; its leaf nodes become numeric props.
   * @param {string} xml - Raw XML body.
   * @returns {Object.<string, Object.<string, number>>} Building info map.
   */
  function parseBuildingInfoXml(xml) {
    if (!xml || typeof xml !== 'string') return {};
    var result = {};
    // Strip the outer <config>...</config> wrapper if present.
    var body = xml;
    var cfg = xml.match(/<config[^>]*>([\s\S]*)<\/config>/i);
    if (cfg) body = cfg[1];
    // Each top-level building: <name> ... </name>
    var buildingRe = /<([a-z_][\w]*)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    var m;
    while ((m = buildingRe.exec(body))) {
      var name = m[1];
      var inner = m[2];
      var props = {};
      var leafRe = /<([a-z_][\w]*)\b[^>]*>\s*([\s\S]*?)\s*<\/\1>/gi;
      var leaf;
      while ((leaf = leafRe.exec(inner))) {
        var num = parseInt(leaf[2], 10);
        if (!isNaN(num)) props[leaf[1]] = num;
      }
      result[name] = props;
    }
    return result;
  }

  /**
   * Index an array of objects by a key.
   * Unique mode (default): {keyValue: lastObjectWithThatKey}.
   * Group mode (asArray=true): {keyValue: [objects]}.
   * @param {Array} list - Objects to index.
   * @param {string} key - Property name to index by.
   * @param {boolean} [asArray] - Group into arrays instead of last-wins.
   * @returns {Object} Index map ({} on bad input).
   */
  function buildIndexBy(list, key, asArray) {
    if (!Array.isArray(list)) return {};
    var idx = {};
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item || typeof item !== 'object') continue;
      var k = item[key];
      if (k === undefined || k === null) continue;
      if (asArray) {
        if (!idx[k]) idx[k] = [];
        idx[k].push(item);
      } else {
        idx[k] = item;
      }
    }
    return idx;
  }

  /**
   * Continent code for a coordinate: 'K' + floor(y/100) + floor(x/100) (Y-then-X).
   * Byte-identical to the legacy tw-map-tools.js:161 definition.
   * @param {number} x - X coordinate.
   * @param {number} y - Y coordinate.
   * @returns {string} Continent code (e.g. 'K55').
   */
  function getContinent(x, y) {
    return 'K' + Math.floor((y || 0) / 100) + Math.floor((x || 0) / 100);
  }

  // ============================================================
  // SERVER TIME SYNC
  // ============================================================

  /**
   * Server time synchronization using performance.now() interpolation.
   * Reads initial time from #serverTime DOM element, then uses
   * performance.now() for sub-millisecond interpolation between updates.
   * MutationObserver re-syncs whenever the server clock updates.
   */
  var TimeSync = {
    /** @private {number} Server time in ms since midnight at sync point. */
    _serverTimeMs: 0,

    /** @private {number} performance.now() at last sync point. */
    _perfOrigin: 0,

    /** @private {number} Drift between server and local clocks. */
    _drift: 0,

    /** @private {?MutationObserver} DOM observer for #serverTime. */
    _observer: null,

    /** @private {?number} Fallback poll interval ID. */
    _pollInterval: null,

    /** @private {boolean} Whether init has been called. */
    _initialized: false,

    /** @private {number} Retry attempt counter. */
    _retryCount: 0,

    /** @private {number} Max retry attempts for DOM reading. */
    _maxRetries: 10,

    /**
     * Initialize time sync by reading DOM and starting observer.
     * Safe to call multiple times — subsequent calls are no-ops.
     */
    init: function() {
      if (this._initialized) return;
      this._initialized = true;
      this._initWithRetry();
    },

    /**
     * Attempt initialization with retry logic.
     * Tries: 1) game_data Timing API, 2) #serverTime DOM, 3) polling retry.
     * @private
     */
    _initWithRetry: function() {
      // Strategy 1: Use TW's Timing API (most reliable — gives ms-precision timestamp)
      if (this._readFromGameData()) {
        this._startObserver();
        return;
      }

      // Strategy 2: Read from #serverTime DOM element
      if (this._readFromDOM()) {
        this._startObserver();
        return;
      }

      // Strategy 3: Retry with polling (DOM may not be ready yet)
      if (this._retryCount < this._maxRetries) {
        this._retryCount++;
        var self = this;
        setTimeout(function() {
          // Re-attempt strategies 1 and 2
          if (self._readFromGameData() || self._readFromDOM()) {
            self._startObserver();
          } else if (self._retryCount < self._maxRetries) {
            self._initWithRetry();
          } else {
            // All retries exhausted — fall back to local clock
            console.warn('[TWTools.TimeSync] Could not read server time after ' +
              self._maxRetries + ' attempts. Using local clock as fallback.');
            self._useLocalFallback();
            self._startObserver();
          }
        }, 100);
      }
    },

    /**
     * Read server time from TW's Timing global (ms-precision).
     * TW exposes Timing.getCurrentServerTime() which returns a Unix timestamp.
     * @private
     * @returns {boolean} True if successfully read.
     */
    _readFromGameData: function() {
      try {
        // TW has a global Timing object with getCurrentServerTime()
        if (typeof Timing !== 'undefined' && typeof Timing.getCurrentServerTime === 'function') {
          var serverTimestamp = Timing.getCurrentServerTime();
          if (serverTimestamp && serverTimestamp > 0) {
            var serverDate = new Date(serverTimestamp);
            var msSinceMidnight = ((serverDate.getHours() * 3600) +
              (serverDate.getMinutes() * 60) +
              serverDate.getSeconds()) * 1000 + serverDate.getMilliseconds();
            this._serverTimeMs = msSinceMidnight;
            this._perfOrigin = performance.now();
            return true;
          }
        }

        // Alternative: TW stores server time offset in Timing.offset_from_server
        if (typeof Timing !== 'undefined' && typeof Timing.offset_from_server === 'number') {
          var correctedNow = Date.now() + Timing.offset_from_server;
          var d = new Date(correctedNow);
          var ms = ((d.getHours() * 3600) + (d.getMinutes() * 60) + d.getSeconds()) * 1000 + d.getMilliseconds();
          this._serverTimeMs = ms;
          this._perfOrigin = performance.now();
          return true;
        }
      } catch (e) {
        // Silently fail — try next strategy
      }
      return false;
    },

    /**
     * Fall back to local system clock when server time is unavailable.
     * @private
     */
    _useLocalFallback: function() {
      var now = new Date();
      this._serverTimeMs = ((now.getHours() * 3600) + (now.getMinutes() * 60) +
        now.getSeconds()) * 1000 + now.getMilliseconds();
      this._perfOrigin = performance.now();
    },

    /**
     * Get current server time as ms since midnight.
     * Uses performance.now() interpolation for sub-ms accuracy.
     * @returns {number} Milliseconds since midnight.
     */
    now: function() {
      var elapsed = performance.now() - this._perfOrigin;
      return Math.floor(this._serverTimeMs + elapsed);
    },

    /**
     * Get current millisecond component (0-999) of server time.
     * @returns {number} Current millisecond (0-999).
     */
    currentMs: function() {
      return Math.floor(this.now() % 1000);
    },

    /**
     * Get drift between server and local clocks.
     * @returns {number} Drift in ms.
     */
    getDrift: function() {
      return this._drift;
    },

    /**
     * Clean up observer and intervals.
     */
    destroy: function() {
      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }
      if (this._pollInterval) {
        clearInterval(this._pollInterval);
        this._pollInterval = null;
      }
    },

    /**
     * Read server time from DOM element.
     * Tries #serverTime first, then .serverTime class, then span[id*=serverTime].
     * @private
     * @returns {boolean} True if successfully read time from DOM.
     */
    _readFromDOM: function() {
      var el = document.getElementById('serverTime') ||
               document.querySelector('.serverTime') ||
               document.querySelector('span[id*="serverTime"]');
      if (!el) return false;
      var text = el.textContent || el.innerText || '';
      var match = text.match(/(\d{1,2}):(\d{2}):(\d{2})/);
      if (!match) return false;
      var h = parseInt(match[1], 10);
      var m = parseInt(match[2], 10);
      var s = parseInt(match[3], 10);
      var oldMs = this._serverTimeMs;
      this._serverTimeMs = ((h * 3600) + (m * 60) + s) * 1000;
      this._perfOrigin = performance.now();

      // Calculate drift on re-sync
      if (oldMs > 0) {
        var localNow = Date.now();
        var localMidnight = new Date();
        localMidnight.setHours(0, 0, 0, 0);
        var localMsSinceMidnight = localNow - localMidnight.getTime();
        this._drift = this._serverTimeMs - localMsSinceMidnight;
      }
      return true;
    },

    /**
     * Start MutationObserver on #serverTime, with fallback to polling.
     * Also re-syncs from GameData on each poll/observe for accuracy.
     * @private
     */
    _startObserver: function() {
      var self = this;
      var el = document.getElementById('serverTime') ||
               document.querySelector('.serverTime') ||
               document.querySelector('span[id*="serverTime"]');

      if (!el || typeof MutationObserver === 'undefined') {
        // Fallback: poll every second — try GameData first, then DOM
        this._pollInterval = setInterval(function() {
          self._readFromGameData() || self._readFromDOM();
        }, 1000);
        return;
      }

      this._observer = new MutationObserver(function() {
        // Prefer Timing API (ms precision) over DOM text (seconds only)
        self._readFromGameData() || self._readFromDOM();
      });
      this._observer.observe(el, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }
  };

  // ============================================================
  // STORAGE MODULE
  // ============================================================

  /**
   * localStorage wrapper with TTL support.
   * All keys are prefixed with "twt_" to avoid collisions.
   */
  var Storage = {
    /**
     * Get a value from localStorage. Returns null if expired or missing.
     * @param {string} key - Storage key (without prefix).
     * @returns {*} Stored value or null.
     */
    get: function(key) {
      try {
        var raw = localStorage.getItem(STORAGE_PREFIX + key);
        if (!raw) return null;
        var data = JSON.parse(raw);
        if (data.ttl && Date.now() > data.ttl) {
          localStorage.removeItem(STORAGE_PREFIX + key);
          return null;
        }
        return data.value;
      } catch (e) {
        return null;
      }
    },

    /**
     * Set a value in localStorage with optional TTL.
     * @param {string} key - Storage key (without prefix).
     * @param {*} value - Value to store (must be JSON-serializable).
     * @param {number} [ttlMs] - Time-to-live in milliseconds.
     */
    set: function(key, value, ttlMs) {
      try {
        var data = { value: value };
        if (ttlMs) data.ttl = Date.now() + ttlMs;
        localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data));
      } catch (e) {
        // localStorage full or unavailable — silently fail
      }
    },

    /**
     * Remove a value from localStorage.
     * @param {string} key - Storage key (without prefix).
     */
    remove: function(key) {
      try {
        localStorage.removeItem(STORAGE_PREFIX + key);
      } catch (e) {
        // Silently fail
      }
    }
  };

  // ============================================================
  // DATA FETCHER (API + Cached)
  // ============================================================

  /**
   * Cached API fetchers for TW game data.
   * Fetches world config, unit info, and village data with automatic caching.
   */
  var DataFetcher = {
    /** @private {?Object} Cached world config. */
    _worldConfig: null,

    /** @private {?Object} Cached unit speeds. */
    _unitSpeeds: null,

    /** @private {?Array} Cached all villages. */
    _allVillages: null,

    /**
     * Fetch world configuration from /interface.php?func=get_config.
     * Parses speed, unitSpeed, moral, and church settings from XML.
     * Cached for 24 hours.
     * @param {function(Object)} callback - Called with config object.
     */
    fetchWorldConfig: function(callback) {
      var cached = Storage.get('world_config');
      if (cached) {
        this._worldConfig = cached;
        callback(cached);
        return;
      }

      var self = this;
      $.ajax({
        url: '/interface.php?func=get_config',
        dataType: 'xml',
        success: function(xml) {
          var $xml = $(xml);
          var config = {
            speed: parseFloat($xml.find('speed').text()) || 1,
            unitSpeed: parseFloat($xml.find('unit_speed').text()) || 1,
            moral: parseInt($xml.find('moral').text(), 10) || 0,
            church: parseInt($xml.find('church').text(), 10) || 0
          };
          self._worldConfig = config;
          Storage.set('world_config', config, CACHE_TTL.worldConfig);
          callback(config);
        },
        error: function() {
          var fallback = { speed: 1, unitSpeed: 1, moral: 0, church: 0 };
          self._worldConfig = fallback;
          callback(fallback);
        }
      });
    },

    /**
     * Fetch unit info from /interface.php?func=get_unit_info.
     * Parses unit speeds from XML. Cached for 24 hours.
     * Falls back to DEFAULT_UNIT_SPEEDS on error.
     * @param {function(Object)} callback - Called with unit speeds map.
     */
    fetchUnitInfo: function(callback) {
      var cached = Storage.get('unit_info');
      if (cached) {
        this._unitSpeeds = cached;
        callback(cached);
        return;
      }

      var self = this;
      $.ajax({
        url: '/interface.php?func=get_unit_info',
        dataType: 'xml',
        success: function(xml) {
          var speeds = {};
          $(xml).children().each(function() {
            var unitName = this.tagName;
            var speed = parseFloat($(this).find('speed').text());
            if (speed) speeds[unitName] = speed;
          });
          self._unitSpeeds = speeds;
          Storage.set('unit_info', speeds, CACHE_TTL.unitInfo);
          callback(speeds);
        },
        error: function() {
          self._unitSpeeds = DEFAULT_UNIT_SPEEDS;
          callback(DEFAULT_UNIT_SPEEDS);
        }
      });
    },

    /** @private {?Array} Cached village groups. */
    _groups: null,

    /**
     * Fetch village groups available to the current player.
     * Tries 3 sources in order:
     *   1. AJAX fetch of the groups overview page (most reliable)
     *   2. Group links on the current page DOM (mass scavenge style)
     *   3. Group selector dropdown on current page DOM
     * Always includes "All villages" (id=0) as the first entry.
     * Cached for 10 minutes.
     * @param {function(Array.<{id: string, name: string}>)} callback - Called with groups array.
     */
    fetchGroups: function(callback, forceRefresh) {
      // Return cached groups if available (unless force refresh)
      if (!forceRefresh) {
        var cached = Storage.get('village_groups');
        if (cached && cached.length > 0) {
          this._groups = cached;
          callback(cached);
          return;
        }
      }

      var self = this;
      var allGroups = [{ id: '0', name: 'All villages' }];

      // Method 1: Try current page DOM first (instant, no AJAX)
      var domGroups = self._parseGroupsFromDOM();
      if (domGroups.length > 0) {
        allGroups = allGroups.concat(domGroups);
        self._groups = allGroups;
        Storage.set('village_groups', allGroups, 120000); // 2 min
        callback(allGroups);
        return;
      }

      // Method 2: AJAX fetch BOTH static and dynamic group pages
      // The groups page at mode=groups without type= only shows one type.
      // Dynamic groups (auto-filter rules) live at type=dynamic,
      // static groups (manually assigned) live at type=static.
      var villageId = getVillageId();
      var baseUrl = '/game.php?village=' + villageId + '&screen=overview_villages&mode=groups';
      var pending = 2;
      var mergedGroups = [];
      var seen = {};

      function mergeGroups(groups) {
        for (var i = 0; i < groups.length; i++) {
          if (!seen[groups[i].id]) {
            seen[groups[i].id] = true;
            mergedGroups.push(groups[i]);
          }
        }
      }

      function onPageDone() {
        pending--;
        if (pending > 0) return;

        allGroups = allGroups.concat(mergedGroups);
        self._groups = allGroups;
        Storage.set('village_groups', allGroups, 120000); // 2 min
        callback(allGroups);
      }

      function parseGroupsFromHtml(html) {
        var $page = $('<div/>').html(html);
        var groups = [];

        // Parse group links: <a href="...&group=NNN">Group Name</a>
        $page.find('a[href*="group="]').each(function() {
          var href = $(this).attr('href') || '';
          var match = href.match(/group=(\d+)/);
          if (match && match[1] !== '0') {
            var name = $.trim($(this).text()).replace(/^\[|\]$/g, '');
            if (name) {
              var exists = false;
              for (var i = 0; i < groups.length; i++) {
                if (groups[i].id === match[1]) { exists = true; break; }
              }
              if (!exists) groups.push({ id: match[1], name: name });
            }
          }
        });

        // Also try select dropdown in the fetched page
        if (groups.length === 0) {
          $page.find('#group_id option, select[name="group_id"] option').each(function() {
            var val = $(this).val();
            if (val && val !== '0') {
              groups.push({ id: val, name: $.trim($(this).text()) });
            }
          });
        }

        return groups;
      }

      // Fetch static groups
      $.ajax({
        url: baseUrl + '&type=static',
        dataType: 'html',
        timeout: 10000,
        success: function(html) {
          mergeGroups(parseGroupsFromHtml(html));
          onPageDone();
        },
        error: function() { onPageDone(); }
      });

      // Fetch dynamic groups
      $.ajax({
        url: baseUrl + '&type=dynamic',
        dataType: 'html',
        timeout: 10000,
        success: function(html) {
          mergeGroups(parseGroupsFromHtml(html));
          onPageDone();
        },
        error: function() { onPageDone(); }
      });
    },

    /**
     * Parse village groups from the current page DOM (no AJAX).
     * Tries group links, select dropdowns, and data-group-id attributes.
     * @private
     * @returns {Array.<{id: string, name: string}>} Groups found (without "All villages").
     */
    _parseGroupsFromDOM: function() {
      var groups = [];
      var seen = {};

      // Try group links with href containing group=
      $('a[href*="group="]').each(function() {
        var href = $(this).attr('href') || '';
        var match = href.match(/group=(\d+)/);
        if (match && match[1] !== '0' && !seen[match[1]]) {
          var name = $.trim($(this).text()).replace(/^\[|\]$/g, '');
          if (name) {
            seen[match[1]] = true;
            groups.push({ id: match[1], name: name });
          }
        }
      });
      if (groups.length > 0) return groups;

      // Try select dropdown
      var $select = $('#group_id');
      if ($select.length === 0) $select = $('select[name="group_id"]');
      if ($select.length > 0) {
        $select.find('option').each(function() {
          var val = $(this).val();
          if (val && val !== '0' && !seen[val]) {
            seen[val] = true;
            groups.push({ id: val, name: $.trim($(this).text()) });
          }
        });
      }
      if (groups.length > 0) return groups;

      // Try data-group-id attributes
      $('a[data-group-id], [data-group-id]').each(function() {
        var gid = String($(this).data('group-id') || $(this).attr('data-group-id') || '');
        if (gid && gid !== '0' && !seen[gid]) {
          seen[gid] = true;
          groups.push({ id: gid, name: $.trim($(this).text()) });
        }
      });

      return groups;
    },

    /**
     * Fetch barbarian (unowned) villages from /map/village.txt.
     * Parses CSV format, filters where owner=0 (column index 4).
     * Cached for 1 hour.
     * @param {function(Array)} callback - Called with array of barb village objects.
     */
    fetchBarbVillages: function(callback) {
      var cached = Storage.get('barb_villages');
      if (cached) {
        callback(cached);
        return;
      }

      $.ajax({
        url: '/map/village.txt',
        dataType: 'text',
        success: function(csv) {
          var barbs = [];
          var lines = csv.split('\n');
          for (var i = 0; i < lines.length; i++) {
            var cols = lines[i].split(',');
            // CSV format: id, name, x, y, owner_id, points, rank
            if (cols.length >= 6 && cols[4] === '0') {
              barbs.push({
                id: parseInt(cols[0], 10),
                name: decodeURIComponent((cols[1] || '').replace(/\+/g, ' ')),
                x: parseInt(cols[2], 10),
                y: parseInt(cols[3], 10),
                points: parseInt(cols[5], 10) || 0
              });
            }
          }
          Storage.set('barb_villages', barbs, CACHE_TTL.barbVillages);
          callback(barbs);
        },
        error: function() {
          callback([]);
        }
      });
    },

    /**
     * Fetch ALL villages from /map/village.txt.
     * Cached for 1 hour.
     * @param {function(Array)} callback - Called with array of all village objects.
     */
    fetchAllVillages: function(callback) {
      var cached = Storage.get('all_villages');
      if (cached) {
        this._allVillages = cached;
        callback(cached);
        return;
      }

      var self = this;
      $.ajax({
        url: '/map/village.txt',
        dataType: 'text',
        success: function(csv) {
          // Delegate to the pure parser (keeps bonusId from col 6).
          var villages = parseVillagesTxt(csv);
          self._allVillages = villages;
          self._allVillagesById = null;
          self._villagesByOwner = null;
          self._villagesByContinent = null;
          Storage.set('all_villages', villages, CACHE_TTL.allVillages);
          callback(villages);
        },
        error: function() {
          callback([]);
        }
      });
    },

    /** @private {?Object} Lazy id->village index. */
    _allVillagesById: null,

    /** @private {?Object} Lazy owner->[villages] index. */
    _villagesByOwner: null,

    /** @private {?Object} Lazy continent->[villages] index. */
    _villagesByContinent: null,

    /** @private {?Object} Cached players map. */
    _players: null,

    /** @private {?Object} Lazy player id index. */
    _playersById: null,

    /** @private {?Object} Cached tribes map. */
    _tribes: null,

    /** @private {?Object} Lazy tribe id index. */
    _tribesById: null,

    /** @private {?Object} Cached building info caps. */
    _buildingInfo: null,

    /**
     * Get a single village by id from the (already-fetched) all-villages list.
     * Builds the id index lazily. Returns null if not loaded / not found.
     * @param {number} id - Village id.
     * @returns {?Object} Village row or null.
     */
    getVillageById: function(id) {
      if (!this._allVillages) return null;
      if (!this._allVillagesById) {
        this._allVillagesById = buildIndexBy(this._allVillages, 'id');
      }
      return this._allVillagesById[id] || null;
    },

    /**
     * Get all villages owned by a player id.
     * @param {number} owner - Owner (player) id.
     * @returns {Array} Villages (empty if none / not loaded).
     */
    getVillagesByOwner: function(owner) {
      if (!this._allVillages) return [];
      if (!this._villagesByOwner) {
        this._villagesByOwner = buildIndexBy(this._allVillages, 'owner', true);
      }
      return this._villagesByOwner[owner] || [];
    },

    /**
     * Get all villages on a continent (e.g. 'K55').
     * @param {string} continent - Continent code.
     * @returns {Array} Villages (empty if none / not loaded).
     */
    getVillagesByContinent: function(continent) {
      if (!this._allVillages) return [];
      if (!this._villagesByContinent) {
        var byCont = {};
        for (var i = 0; i < this._allVillages.length; i++) {
          var v = this._allVillages[i];
          var c = getContinent(v.x, v.y);
          if (!byCont[c]) byCont[c] = [];
          byCont[c].push(v);
        }
        this._villagesByContinent = byCont;
      }
      return this._villagesByContinent[continent] || [];
    },

    /**
     * Fetch all players from /map/player.txt (id,name,tribe,villages,points,rank).
     * Cached for 1 hour. Errors -> callback([]).
     * @param {function(Array)} callback - Called with players array.
     */
    fetchPlayers: function(callback) {
      var cached = Storage.get('players');
      if (cached) {
        this._players = cached;
        callback(cached);
        return;
      }
      var self = this;
      $.ajax({
        url: '/map/player.txt',
        dataType: 'text',
        success: function(csv) {
          var players = parsePlayersTxt(csv);
          self._players = players;
          self._playersById = null;
          Storage.set('players', players, CACHE_TTL.players);
          callback(players);
        },
        error: function() {
          callback([]);
        }
      });
    },

    /**
     * Get a player by id (lazy index over the fetched players list).
     * @param {number} id - Player id.
     * @returns {?Object} Player row or null.
     */
    getPlayerById: function(id) {
      if (!this._players) return null;
      if (!this._playersById) {
        this._playersById = buildIndexBy(this._players, 'id');
      }
      return this._playersById[id] || null;
    },

    /**
     * Fetch all tribes from /map/ally.txt. Cached for 1 hour. Errors -> callback([]).
     * @param {function(Array)} callback - Called with tribes array.
     */
    fetchTribes: function(callback) {
      var cached = Storage.get('tribes');
      if (cached) {
        this._tribes = cached;
        callback(cached);
        return;
      }
      var self = this;
      $.ajax({
        url: '/map/ally.txt',
        dataType: 'text',
        success: function(csv) {
          var tribes = parseTribesTxt(csv);
          self._tribes = tribes;
          self._tribesById = null;
          Storage.set('tribes', tribes, CACHE_TTL.tribes);
          callback(tribes);
        },
        error: function() {
          callback([]);
        }
      });
    },

    /**
     * Get a tribe by id (lazy index over the fetched tribes list).
     * @param {number} id - Tribe id.
     * @returns {?Object} Tribe row or null.
     */
    getTribeById: function(id) {
      if (!this._tribes) return null;
      if (!this._tribesById) {
        this._tribesById = buildIndexBy(this._tribes, 'id');
      }
      return this._tribesById[id] || null;
    },

    /**
     * Fetch static building caps from get_building_info XML (max_level etc.).
     * NOTE: 24h static caps, NOT the volatile mode=buildings scrape.
     * Errors -> callback({}).
     * @param {function(Object)} callback - Called with the building info map.
     */
    fetchBuildingInfo: function(callback) {
      var cached = Storage.get('building_info');
      if (cached) {
        this._buildingInfo = cached;
        callback(cached);
        return;
      }
      var self = this;
      $.ajax({
        url: '/interface.php?func=get_building_info',
        dataType: 'text',
        success: function(responseText) {
          // Pass the raw STRING through the same code path the unit test exercises.
          var info = parseBuildingInfoXml(responseText);
          self._buildingInfo = info;
          Storage.set('building_info', info, CACHE_TTL.buildingInfo);
          callback(info);
        },
        error: function() {
          callback({});
        }
      });
    },

    /**
     * Build a unified village index JOINing player.txt rank/tribe/points by owner.
     * Pure-ish (no AJAX). byId rows gain {continent, rank, tribe, ownerPoints}.
     * @param {Array} villages - Parsed villages (from parseVillagesTxt).
     * @param {Array|Object} [players] - Players array or pre-built id index.
     * @returns {{byId:Object, byOwner:Object, byContinent:Object}}
     */
    buildVillageIndex: function(villages, players) {
      var byId = {};
      var byOwner = {};
      var byContinent = {};
      if (!Array.isArray(villages)) {
        return { byId: byId, byOwner: byOwner, byContinent: byContinent };
      }
      var playersById = Array.isArray(players)
        ? buildIndexBy(players, 'id')
        : (players && typeof players === 'object' ? players : {});

      for (var i = 0; i < villages.length; i++) {
        var v = villages[i];
        if (!v || typeof v !== 'object') continue;
        var p = playersById[v.owner] || null;
        var row = {
          id: v.id,
          name: v.name,
          x: v.x,
          y: v.y,
          owner: v.owner,
          points: v.points,
          bonusId: v.bonusId,
          continent: getContinent(v.x, v.y),
          rank: p ? p.rank : null,
          tribe: p ? p.tribe : null,
          ownerPoints: p ? p.points : null
        };
        byId[v.id] = row;
        if (!byOwner[v.owner]) byOwner[v.owner] = [];
        byOwner[v.owner].push(row);
        if (!byContinent[row.continent]) byContinent[row.continent] = [];
        byContinent[row.continent].push(row);
      }
      return { byId: byId, byOwner: byOwner, byContinent: byContinent };
    },

    /**
     * Fetch current player's villages from village.txt.
     * Filters by player ID from game_data.
     * @param {function(Array)} callback - Called with player's village array.
     */
    fetchPlayerVillages: function(callback) {
      var playerId = getPlayerId();
      if (!playerId) {
        callback([]);
        return;
      }

      this.fetchAllVillages(function(allVillages) {
        var playerVillages = [];
        for (var i = 0; i < allVillages.length; i++) {
          if (allVillages[i].owner === playerId) {
            playerVillages.push(allVillages[i]);
          }
        }
        callback(playerVillages);
      });
    },

    /**
     * Get world speed multiplier. Returns 1 if not yet fetched.
     * @returns {number} World speed.
     */
    getWorldSpeed: function() {
      return this._worldConfig ? this._worldConfig.speed : 1;
    },

    /**
     * Get unit speed factor multiplier. Returns 1 if not yet fetched.
     * @returns {number} Unit speed factor.
     */
    getUnitSpeedFactor: function() {
      return this._worldConfig ? this._worldConfig.unitSpeed : 1;
    },

    /**
     * Get speed (minutes per field) for a given unit type.
     * Falls back to DEFAULT_UNIT_SPEEDS, then to 30 (ram speed).
     * @param {string} unitType - Unit type name (e.g. 'ram', 'snob').
     * @returns {number} Unit speed in minutes per field.
     */
    getUnitSpeed: function(unitType) {
      var speeds = this._unitSpeeds || DEFAULT_UNIT_SPEEDS;
      return speeds[unitType] || DEFAULT_UNIT_SPEEDS[unitType] || 30;
    },

    /**
     * Calculate travel time between two coordinates for a given unit type.
     * Requires world config to be fetched first for accurate results.
     * @param {{x: number, y: number}} from - Source coordinates.
     * @param {{x: number, y: number}} to - Target coordinates.
     * @param {string} unitType - Unit type name.
     * @returns {number} Travel time in milliseconds.
     */
    calcTravelTime: function(from, to, unitType) {
      var dist = distance(from, to);
      var unitSpd = this.getUnitSpeed(unitType);
      return travelTime(dist, unitSpd, this.getWorldSpeed(), this.getUnitSpeedFactor());
    }
  };

  // ============================================================
  // GAME DATA SHORTCUTS
  // ============================================================

  /**
   * Get current village ID from game_data.
   * @returns {number} Village ID, or 0 if unavailable.
   */
  function getVillageId() {
    if (typeof game_data !== 'undefined' && game_data.village) {
      return parseInt(game_data.village.id, 10) || 0;
    }
    return 0;
  }

  /**
   * Get current player ID from game_data.
   * @returns {number} Player ID, or 0 if unavailable.
   */
  function getPlayerId() {
    if (typeof game_data !== 'undefined' && game_data.player) {
      return parseInt(game_data.player.id, 10) || 0;
    }
    return 0;
  }

  /**
   * Get CSRF token (h parameter) from game_data.
   * @returns {string} CSRF token string, or empty string.
   */
  function getCsrf() {
    if (typeof game_data !== 'undefined') {
      return game_data.csrf || '';
    }
    return '';
  }

  /**
   * Get current player name from game_data.
   * @returns {string} Player name, or empty string.
   */
  function getPlayerName() {
    if (typeof game_data !== 'undefined' && game_data.player) {
      return game_data.player.name || '';
    }
    return '';
  }

  // ============================================================
  // PUBLIC API — window.TWTools
  // ============================================================

  // Reuse existing TWTools if already loaded by another bundled script.
  // This prevents the second script from overwriting TimeSync state
  // (including sync data) that the first script already initialized.
  var existing = window.TWTools || {};
  window.TWTools = existing;

  // Only set properties that don't exist yet — preserve first-loaded state
  if (!existing.version)            existing.version = '1.0.0';
  if (!existing.TimeSync)           existing.TimeSync = TimeSync;
  if (!existing.parseCoords)        existing.parseCoords = parseCoords;
  if (!existing.formatCoords)       existing.formatCoords = formatCoords;
  if (!existing.distance)           existing.distance = distance;
  if (!existing.travelTime)         existing.travelTime = travelTime;
  if (!existing.formatTime)         existing.formatTime = formatTime;
  if (!existing.formatTimeSec)      existing.formatTimeSec = formatTimeSec;
  if (!existing.formatDuration)     existing.formatDuration = formatDuration;
  if (!existing.pad2)               existing.pad2 = pad2;
  if (!existing.pad3)               existing.pad3 = pad3;
  if (!existing.parseTimeToMs)      existing.parseTimeToMs = parseTimeToMs;
  if (!existing.parseArrivalTime)   existing.parseArrivalTime = parseArrivalTime;
  if (!existing.Storage)            existing.Storage = Storage;
  if (!existing.DataFetcher)        existing.DataFetcher = DataFetcher;
  if (!existing.getVillageId)       existing.getVillageId = getVillageId;
  if (!existing.getPlayerId)        existing.getPlayerId = getPlayerId;
  if (!existing.getCsrf)            existing.getCsrf = getCsrf;
  if (!existing.getPlayerName)      existing.getPlayerName = getPlayerName;
  if (!existing.DEFAULT_UNIT_SPEEDS) existing.DEFAULT_UNIT_SPEEDS = DEFAULT_UNIT_SPEEDS;
  if (!existing.DATE_WORDS)         existing.DATE_WORDS = DATE_WORDS;
  if (!existing.parseVillagesTxt)    existing.parseVillagesTxt = parseVillagesTxt;
  if (!existing.parsePlayersTxt)     existing.parsePlayersTxt = parsePlayersTxt;
  if (!existing.parseTribesTxt)      existing.parseTribesTxt = parseTribesTxt;
  if (!existing.parseBuildingInfoXml) existing.parseBuildingInfoXml = parseBuildingInfoXml;
  if (!existing.buildIndexBy)        existing.buildIndexBy = buildIndexBy;
  if (!existing.getContinent)        existing.getContinent = getContinent;

})(window, jQuery);
