;(function(window, $) {
  'use strict';

  // ============================================================
  // CONFIG & CONSTANTS
  // ============================================================

  var STORAGE_PREFIX = 'twt_';

  var CACHE_TTL = {
    worldConfig: 24 * 3600000,   // 24h
    unitInfo: 24 * 3600000,      // 24h
    barbVillages: 3600000,       // 1h
    allVillages: 3600000         // 1h
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
   * Format milliseconds since midnight to "HH:MM:SS:mmm" (with ms).
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
      pad2(h) + ':' + pad2(m) + ':' + pad2(s) + ':' + pad3(millis);
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
        self._readFromDOM();
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
          var villages = [];
          var lines = csv.split('\n');
          for (var i = 0; i < lines.length; i++) {
            var cols = lines[i].split(',');
            if (cols.length >= 6) {
              villages.push({
                id: parseInt(cols[0], 10),
                name: decodeURIComponent((cols[1] || '').replace(/\+/g, ' ')),
                x: parseInt(cols[2], 10),
                y: parseInt(cols[3], 10),
                owner: parseInt(cols[4], 10) || 0,
                points: parseInt(cols[5], 10) || 0
              });
            }
          }
          self._allVillages = villages;
          Storage.set('all_villages', villages, CACHE_TTL.allVillages);
          callback(villages);
        },
        error: function() {
          callback([]);
        }
      });
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

})(window, jQuery);
