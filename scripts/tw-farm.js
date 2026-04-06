/**
 * TW Farm v1.0.0
 * Light Cavalry farming assistant with collision avoidance and template selection.
 *
 * Features:
 * - Farm tab: scan sources, plan optimal LC farm runs, execute via Farm Assistant API
 * - Settings tab: group filter, max distance, cooldown, min LC, template preferences
 * - Collision avoidance: skips targets with existing attacks within cooldown window
 * - Queue system with 200ms delay between requests to avoid rate limiting
 * - NEVER auto-sends without explicit user action
 *
 * @version 1.0.0
 * @requires jQuery, TribalWars game environment, window.TWTools (tw-core.js, tw-ui.js)
 */
;(function(window, $) {
  'use strict';

  // ============================================================
  // GUARD: TWTools must be loaded
  // ============================================================

  if (!window.TWTools || !window.TWTools.UI) {
    throw new Error('tw-farm.js requires tw-core.js and tw-ui.js (window.TWTools.UI missing)');
  }

  var TWTools = window.TWTools;

  // ============================================================
  // CONFIG & CONSTANTS
  // ============================================================

  var VERSION = '1.0.0';
  var ID_PREFIX = 'twf-';
  var STORAGE_PREFIX = 'twf_';

  /** Cache TTL for scan data (5 minutes) */
  var CACHE_TTL = 5 * 60 * 1000;

  /** Minimum delay between AJAX requests to avoid rate limiting */
  var REQUEST_DELAY = 200;

  /** LC speed in minutes per field (base, before world/unit speed modifiers) */
  var LC_SPEED = 10;

  /** LC carry capacity per unit */
  var LC_CARRY = 80;

  /** Default template IDs — overridden by real IDs from Accountmanager.farm.templates */
  var TEMPLATE_A = 0;
  var TEMPLATE_B = 1;

  /** Real template IDs read from game (set during farm target parsing) */
  var realTemplateA = null;
  var realTemplateB = null;

  /** Loot status colors from Farm Assistant reports */
  var LOOT_STATUS = {
    GREEN: 'green',    // Full haul
    YELLOW: 'yellow',  // Partial haul
    RED: 'red',        // Losses or empty
    UNKNOWN: 'unknown' // No report
  };

  /** Default settings */
  var DEFAULT_SETTINGS = {
    groupId: '0',
    maxDistance: 20,
    cooldownMinutes: 5,
    minLC: 5,
    useBForMaxLoot: true,
    includeNewBarbs: false
  };

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

  // ============================================================
  // SETTINGS
  // ============================================================

  /** @type {Object} Current settings */
  var settings = {};

  /**
   * Load settings from localStorage, merging with defaults.
   */
  function loadSettings() {
    var saved = Store.get('settings', null);
    settings = $.extend(true, {}, DEFAULT_SETTINGS, saved || {});
  }

  /**
   * Save current settings to localStorage.
   */
  function saveSettings() {
    Store.set('settings', settings);
  }

  // ============================================================
  // DATA STRUCTURES
  // ============================================================

  /**
   * @typedef {Object} SourceVillage
   * @property {number} id - Village ID.
   * @property {string} name - Village name.
   * @property {string} coords - Village coordinates "x|y".
   * @property {{x: number, y: number}} coordsParsed - Parsed coordinates.
   * @property {number} lcAvailable - Available LC count.
   * @property {number} lcTotal - Total LC in village (home).
   * @property {number} targetsInRange - Number of farm targets within max distance.
   * @property {string} status - Current status text.
   */

  /**
   * @typedef {Object} FarmTarget
   * @property {number} id - Village ID.
   * @property {string} coords - Coordinates "x|y".
   * @property {{x: number, y: number}} coordsParsed - Parsed coordinates.
   * @property {string} playerName - Owner name (empty for barbs).
   * @property {string} lootStatus - Report status (green/yellow/red/unknown).
   * @property {boolean} maxLoot - Whether the target returned max loot last time.
   * @property {number} wallLevel - Estimated wall level.
   * @property {number} distance - Distance from source (populated during planning).
   */

  /**
   * @typedef {Object} OutgoingAttack
   * @property {string} targetCoords - Target coordinates.
   * @property {number} arrivalMs - Arrival time in ms since midnight.
   * @property {number} sourceId - Source village ID.
   */

  /**
   * @typedef {Object} FarmPlanEntry
   * @property {number} sourceId - Source village ID.
   * @property {string} sourceName - Source village name.
   * @property {string} sourceCoords - Source coordinates.
   * @property {number} targetId - Target village ID.
   * @property {string} targetCoords - Target coordinates.
   * @property {number} distance - Distance in fields.
   * @property {number} templateId - Template to use (0=A, 1=B).
   * @property {string} templateLabel - Template label (A/B).
   * @property {number} travelTimeMs - Estimated travel time in ms.
   * @property {string} estArrival - Estimated arrival time string.
   */

  /** @type {SourceVillage[]} Scanned source villages */
  var sourceVillages = [];

  /** @type {FarmTarget[]} Farm targets from Farm Assistant */
  var farmTargets = [];

  /** @type {OutgoingAttack[]} Outgoing attacks for collision avoidance */
  var outgoingAttacks = [];

  /** @type {FarmPlanEntry[]} Current farm plan */
  var farmPlan = [];

  /** @type {Array.<{id: string, name: string}>} Available village groups */
  var availableGroups = [{ id: '0', name: 'All villages' }];

  /** @type {boolean} Whether a scan/fetch is in progress */
  var isScanning = false;

  /** @type {boolean} Whether farming is in progress */
  var isFarming = false;

  /** @type {boolean} Whether farming should be cancelled */
  var farmCancelled = false;

  /** @type {string} CSRF token for Farm Assistant */
  var csrfToken = '';

  /** @type {string} Send units link template from Farm Assistant page */
  var sendUnitsLink = '';

  /** @type {Object} Card controller reference */
  var card = null;

  // ============================================================
  // FORMAT HELPERS
  // ============================================================

  /**
   * Format a number with dot-separated thousands.
   * @param {number} n - Number to format.
   * @returns {string} Formatted string.
   */
  function formatNum(n) {
    if (typeof n !== 'number' || isNaN(n)) return '0';
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  /**
   * Parse an integer from text, stripping non-numeric characters.
   * @param {string} text - Text containing a number.
   * @returns {number} Parsed integer or 0.
   */
  function parseIntSafe(text) {
    if (!text) return 0;
    var cleaned = text.replace(/\./g, '').replace(/[^\d-]/g, '');
    return parseInt(cleaned, 10) || 0;
  }

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
   * Format distance to 1 decimal place.
   * @param {number} d - Distance.
   * @returns {string} Formatted distance.
   */
  function formatDist(d) {
    return d.toFixed(1);
  }

  /**
   * Format milliseconds as travel time string "Xh Ym" or "Ym Zs".
   * @param {number} ms - Duration in milliseconds.
   * @returns {string} Formatted duration.
   */
  function formatTravelTime(ms) {
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
  }

  /**
   * Format ms since midnight to "HH:MM:SS".
   * @param {number} ms - Milliseconds since midnight.
   * @returns {string} Formatted time.
   */
  function formatTimeShort(ms) {
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600) % 24;
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    return TWTools.pad2(h) + ':' + TWTools.pad2(m) + ':' + TWTools.pad2(s);
  }

  // ============================================================
  // DATA FETCHING — SOURCE VILLAGES
  // ============================================================

  /**
   * Fetch source villages with LC counts from the combined overview.
   * Parses village ID, name, coords, and LC troop count.
   * @param {function(SourceVillage[])} callback - Called with source village data.
   * @param {function(string)} statusCb - Status update callback.
   */
  function fetchSourceVillages(callback, statusCb) {
    var groupParam = (settings.groupId && settings.groupId !== '0')
      ? '&group=' + settings.groupId : '';
    var allVillages = [];
    var page = 0;

    if (statusCb) statusCb('Fetching source villages...');

    function fetchPage() {
      var villageId = TWTools.getVillageId();
      var url = '/game.php?village=' + villageId + '&screen=overview_villages&mode=units&type=own_home' +
        groupParam + '&page=' + page;

      $.ajax({
        url: url,
        dataType: 'html',
        timeout: 15000,
        success: function(html) {
          var result = parseSourceVillages(html);
          allVillages = allVillages.concat(result.villages);

          if (statusCb) {
            statusCb('Loaded page ' + (page + 1) + ' (' + allVillages.length + ' villages)...');
          }

          if (result.hasNextPage) {
            page++;
            setTimeout(fetchPage, REQUEST_DELAY);
          } else {
            // Filter to villages with LC >= minLC
            var filtered = [];
            for (var i = 0; i < allVillages.length; i++) {
              if (allVillages[i].lcAvailable >= settings.minLC) {
                filtered.push(allVillages[i]);
              }
            }
            callback(filtered);
          }
        },
        error: function() {
          if (statusCb) statusCb('Error fetching source villages.');
          callback([]);
        }
      });
    }

    fetchPage();
  }

  /**
   * Parse source village data from the troop overview HTML.
   * @param {string} html - Raw HTML of the overview page.
   * @returns {{villages: SourceVillage[], hasNextPage: boolean}} Parsed data.
   */
  function parseSourceVillages(html) {
    var $page = $('<div/>').html(html);
    var villages = [];

    var $table = $page.find('#units_table, table.vis.overview_table');
    if ($table.length === 0) {
      $table = $page.find('table.vis').filter(function() {
        return $(this).find('tr').length > 2;
      }).first();
    }

    if ($table.length === 0) {
      return { villages: [], hasNextPage: false };
    }

    // Parse header to find LC column index
    var lcColIndex = -1;
    var headerCells = $table.find('tr:first th, thead th');
    headerCells.each(function(idx) {
      var $th = $(this);
      // LC column has the light cavalry icon or text
      var $img = $th.find('img[src*="unit_light"]');
      if ($img.length > 0) {
        lcColIndex = idx;
        return false;
      }
      var text = $.trim($th.text()).toLowerCase();
      if (text === 'light' || text === 'lc' || text === 'lk') {
        lcColIndex = idx;
        return false;
      }
    });

    // Parse village rows
    $table.find('tbody tr, tr').not(':first').each(function() {
      var $row = $(this);
      var $cells = $row.find('td');
      if ($cells.length < 3) return;

      // Find village link with coordinates
      var $villageLink = $();
      $row.find('a[href*="village="]').each(function() {
        var text = $.trim($(this).text());
        if (text.match(/\(\d{1,3}\|\d{1,3}\)/)) {
          $villageLink = $(this);
          return false;
        }
      });

      if ($villageLink.length === 0) return;

      var villageHref = $villageLink.attr('href') || '';
      var villageIdMatch = villageHref.match(/village=(\d+)/);
      if (!villageIdMatch) return;

      var villageId = parseInt(villageIdMatch[1], 10);
      var linkText = $.trim($villageLink.text());
      var coordsMatch = linkText.match(/\((\d{1,3}\|\d{1,3})\)/);
      var coords = coordsMatch ? coordsMatch[1] : '';
      var name = linkText.replace(/\s*\(\d{1,3}\|\d{1,3}\)\s*K?\d*\s*$/, '').trim();

      // Parse LC count
      var lcCount = 0;
      if (lcColIndex >= 0 && lcColIndex < $cells.length) {
        lcCount = parseIntSafe($cells.eq(lcColIndex).text());
      }

      var parsed = TWTools.parseCoords(coords);
      if (!parsed) return;

      villages.push({
        id: villageId,
        name: name || ('Village ' + coords),
        coords: coords,
        coordsParsed: parsed,
        lcAvailable: lcCount,
        lcTotal: lcCount,
        targetsInRange: 0,
        status: 'ready'
      });
    });

    // Check pagination
    var hasNextPage = false;
    $page.find('a.paged-nav-item, a[href*="page="]').each(function() {
      var href = $(this).attr('href') || '';
      var text = $.trim($(this).text());
      if (text === '>>' || text === '>' || text.indexOf('next') !== -1 ||
          text.indexOf('Next') !== -1 || text.indexOf('Dopredu') !== -1) {
        hasNextPage = true;
        return false;
      }
    });

    return { villages: villages, hasNextPage: hasNextPage };
  }

  // ============================================================
  // DATA FETCHING — OUTGOING ATTACKS
  // ============================================================

  /**
   * Fetch outgoing attack commands for collision avoidance.
   * @param {function(OutgoingAttack[])} callback - Called with attack data.
   * @param {function(string)} statusCb - Status update callback.
   */
  function fetchOutgoingAttacks(callback, statusCb) {
    if (statusCb) statusCb('Fetching outgoing attacks...');

    var attacks = [];
    var page = 0;

    function fetchPage() {
      var villageId = TWTools.getVillageId();
      var url = '/game.php?village=' + villageId + '&screen=overview_villages&mode=commands&type=attack&page=' + page;

      $.ajax({
        url: url,
        dataType: 'html',
        timeout: 15000,
        success: function(html) {
          var result = parseOutgoingAttacks(html);
          attacks = attacks.concat(result.attacks);

          if (result.hasNextPage) {
            page++;
            setTimeout(fetchPage, REQUEST_DELAY);
          } else {
            callback(attacks);
          }
        },
        error: function() {
          if (statusCb) statusCb('Error fetching commands (continuing without collision data).');
          callback([]);
        }
      });
    }

    fetchPage();
  }

  /**
   * Parse outgoing attack commands from the commands overview HTML.
   * @param {string} html - Raw HTML.
   * @returns {{attacks: OutgoingAttack[], hasNextPage: boolean}} Parsed data.
   */
  function parseOutgoingAttacks(html) {
    var $page = $('<div/>').html(html);
    var attacks = [];

    var $table = $page.find('#commands_table, table.vis.overview_table');
    if ($table.length === 0) {
      $table = $page.find('table.vis').filter(function() {
        return $(this).find('tr').length > 2;
      }).first();
    }

    if ($table.length === 0) {
      return { attacks: [], hasNextPage: false };
    }

    $table.find('tbody tr, tr').not(':first').each(function() {
      var $row = $(this);
      var $cells = $row.find('td');
      if ($cells.length < 3) return;

      // Look for target village link with coords
      var targetCoords = '';
      var sourceId = 0;
      var arrivalText = '';

      // Command rows typically have: [icon] [source] [target] [arrival]
      $row.find('a[href*="village="]').each(function() {
        var text = $.trim($(this).text());
        var coordMatch = text.match(/\((\d{1,3}\|\d{1,3})\)/);
        if (coordMatch) {
          // The last village link with coords is usually the target
          targetCoords = coordMatch[1];
        }
      });

      // Look for source village ID
      var $sourceLink = $row.find('a[href*="village="]').first();
      if ($sourceLink.length > 0) {
        var srcHref = $sourceLink.attr('href') || '';
        var srcMatch = srcHref.match(/village=(\d+)/);
        if (srcMatch) sourceId = parseInt(srcMatch[1], 10);
      }

      // Look for arrival time — typically last cell or cell with time pattern
      $cells.each(function() {
        var cellText = $.trim($(this).text());
        if (cellText.match(/\d{1,2}:\d{2}:\d{2}/)) {
          arrivalText = cellText;
        }
      });

      if (targetCoords && arrivalText) {
        var arrivalMs = TWTools.parseArrivalTime(arrivalText);
        if (arrivalMs !== null) {
          attacks.push({
            targetCoords: targetCoords,
            arrivalMs: arrivalMs,
            sourceId: sourceId
          });
        }
      }
    });

    // Check pagination
    var hasNextPage = false;
    $page.find('a.paged-nav-item, a[href*="page="]').each(function() {
      var text = $.trim($(this).text());
      if (text === '>>' || text === '>' || text.indexOf('next') !== -1 ||
          text.indexOf('Next') !== -1 || text.indexOf('Dopredu') !== -1) {
        hasNextPage = true;
        return false;
      }
    });

    return { attacks: attacks, hasNextPage: hasNextPage };
  }

  // ============================================================
  // DATA FETCHING — FARM TARGETS
  // ============================================================

  /**
   * Fetch farm targets from the Farm Assistant (am_farm) pages.
   * Handles pagination via Farm_page parameter.
   * Also extracts CSRF token and send_units_link.
   * @param {function(FarmTarget[])} callback - Called with farm target data.
   * @param {function(string)} statusCb - Status update callback.
   */
  function fetchFarmTargets(callback, statusCb) {
    if (statusCb) statusCb('Fetching farm targets...');

    var targets = [];
    var page = 0;

    function fetchPage() {
      var villageId = TWTools.getVillageId();
      var url = '/game.php?village=' + villageId + '&screen=am_farm&Farm_page=' + page;

      $.ajax({
        url: url,
        dataType: 'html',
        timeout: 15000,
        success: function(html) {
          var result = parseFarmTargets(html);
          targets = targets.concat(result.targets);

          // Extract CSRF and send link from first page
          if (page === 0) {
            if (result.csrf) csrfToken = result.csrf;
            if (result.sendLink) sendUnitsLink = result.sendLink;
          }

          if (statusCb) {
            statusCb('Farm targets: loaded page ' + (page + 1) + ' (' + targets.length + ' targets)...');
          }

          if (result.hasNextPage) {
            page++;
            setTimeout(fetchPage, REQUEST_DELAY);
          } else {
            callback(targets);
          }
        },
        error: function() {
          if (statusCb) statusCb('Error fetching farm targets.');
          callback([]);
        }
      });
    }

    fetchPage();
  }

  /**
   * Parse farm targets from the Farm Assistant HTML page.
   * @param {string} html - Raw HTML.
   * @returns {{targets: FarmTarget[], hasNextPage: boolean, csrf: string, sendLink: string}}
   */
  function parseFarmTargets(html) {
    var $page = $('<div/>').html(html);
    var targets = [];
    var csrf = '';
    var sendLink = '';

    // Extract CSRF token
    // game_data.csrf is available globally, but also look for it in the page
    if (typeof game_data !== 'undefined' && game_data.csrf) {
      csrf = game_data.csrf;
    }
    // Fallback: look for h= parameter in farm action URLs
    var $formAction = $page.find('form[action*="am_farm"]');
    if ($formAction.length > 0) {
      var action = $formAction.attr('action') || '';
      var hMatch = action.match(/[&?]h=([a-f0-9]+)/);
      if (hMatch) csrf = hMatch[1];
    }

    // Also extract from any link with am_farm and h=
    $page.find('a[href*="am_farm"][href*="h="]').first().each(function() {
      var href = $(this).attr('href') || '';
      var hMatch = href.match(/[&?]h=([a-f0-9]+)/);
      if (hMatch && !csrf) csrf = hMatch[1];
    });

    // Extract real template IDs from Accountmanager.farm (the A/B buttons use these IDs)
    try {
      if (typeof Accountmanager !== 'undefined' && Accountmanager.farm &&
          Accountmanager.farm.templates) {
        var farmData = Accountmanager.farm;
        if (farmData.templates.a && farmData.templates.a.id !== undefined) {
          realTemplateA = farmData.templates.a.id;
        }
        if (farmData.templates.b && farmData.templates.b.id !== undefined) {
          realTemplateB = farmData.templates.b.id;
        }
      }
    } catch (e) {
      // Accountmanager may not be fully initialized
    }

    // Extract template IDs from am_farm HTML.
    // The A/B farm buttons use: onclick="return Accountmanager.farm.sendUnits(this, TARGET_ID, TEMPLATE_ID)"
    // Template A buttons have class "farm_icon_a", Template B have "farm_icon_b".
    // We just need ONE of each to get the template IDs.
    if (realTemplateA === null) {
      var htmlStr0 = typeof html === 'string' ? html : '';
      // Match: farm_icon_a" ... sendUnits(this, NNNN, TEMPLATE_A_ID)
      var tmplMatchA = htmlStr0.match(/farm_icon_a[^>]*sendUnits\(\s*this\s*,\s*\d+\s*,\s*(\d+)\s*\)/);
      if (tmplMatchA) realTemplateA = parseInt(tmplMatchA[1], 10);
      // Also try templates['t_NNNN'] from script blocks
      if (realTemplateA === null) {
        var tmplStoreA = htmlStr0.match(/templates\['t_(\d+)'\]/);
        if (tmplStoreA) realTemplateA = parseInt(tmplStoreA[1], 10);
      }
    }
    if (realTemplateB === null) {
      var htmlStr0b = typeof html === 'string' ? html : '';
      var tmplMatchB = htmlStr0b.match(/farm_icon_b[^>]*sendUnits\(\s*this\s*,\s*\d+\s*,\s*(\d+)\s*\)/);
      if (tmplMatchB) realTemplateB = parseInt(tmplMatchB[1], 10);
    }

    // Try to get send_units_link from TW's global Accountmanager object (most reliable)
    if (typeof Accountmanager !== 'undefined' && Accountmanager.send_units_link) {
      sendLink = Accountmanager.send_units_link;
    }

    // Extract send_units_link from inline script blocks in the AJAX-fetched HTML
    // Pattern: Accountmanager.send_units_link = '/game.php?village=...&ajaxaction=farm&json=1&h=...';
    if (!sendLink) {
      var htmlStr = typeof html === 'string' ? html : '';
      var sendLinkMatch = htmlStr.match(/Accountmanager\.send_units_link\s*=\s*'([^']+)'/);
      if (!sendLinkMatch) sendLinkMatch = htmlStr.match(/send_units_link\s*[=:]\s*['"]([^'"]+)['"]/);
      if (sendLinkMatch) sendLink = sendLinkMatch[1];
    }

    // Parse the #plunder_list table
    var $plunderTable = $page.find('#plunder_list');
    if ($plunderTable.length === 0) {
      $plunderTable = $page.find('table.vis').filter(function() {
        return $(this).find('.farm_icon, .farm_icon_a, .farm_icon_b, [class*="farm_icon"]').length > 0 ||
               $(this).find('a[href*="am_farm"]').length > 0;
      }).first();
    }

    if ($plunderTable.length > 0) {
      $plunderTable.find('tr[id], tr.row_a, tr.row_b, tbody tr').each(function() {
        var $row = $(this);
        var $cells = $row.find('td');
        if ($cells.length < 3) return;

        // Extract target village ID from the row or links
        var targetId = 0;
        var targetCoords = '';
        var playerName = '';
        var lootStatus = LOOT_STATUS.UNKNOWN;
        var maxLoot = false;
        var wallLevel = 0;

        // Row ID often contains village_id: "farm_row_XXXXX"
        var rowId = $row.attr('id') || '';
        var rowIdMatch = rowId.match(/(\d+)/);
        if (rowIdMatch) {
          targetId = parseInt(rowIdMatch[1], 10);
        }

        // Look for village link with coords
        $row.find('a[href*="info_village"]').each(function() {
          var text = $.trim($(this).text());
          var coordMatch = text.match(/(\d{1,3}\|\d{1,3})/);
          if (coordMatch) targetCoords = coordMatch[1];
          // Extract village ID from href
          if (!targetId) {
            var href = $(this).attr('href') || '';
            var vMatch = href.match(/id=(\d+)/);
            if (vMatch) targetId = parseInt(vMatch[1], 10);
          }
        });

        // Also try coord text in cells
        if (!targetCoords) {
          $cells.each(function() {
            var text = $.trim($(this).text());
            var coordMatch = text.match(/(\d{1,3}\|\d{1,3})/);
            if (coordMatch && !targetCoords) {
              targetCoords = coordMatch[1];
            }
          });
        }

        // Player name — usually in a cell after coords
        $row.find('a[href*="info_player"]').each(function() {
          playerName = $.trim($(this).text());
        });

        // Loot status — based on report icon color
        var $reportIcon = $row.find('img[src*="dots"], img[src*="report"]');
        if ($reportIcon.length > 0) {
          var src = $reportIcon.attr('src') || '';
          if (src.indexOf('green') !== -1) {
            lootStatus = LOOT_STATUS.GREEN;
          } else if (src.indexOf('yellow') !== -1) {
            lootStatus = LOOT_STATUS.YELLOW;
          } else if (src.indexOf('red') !== -1) {
            lootStatus = LOOT_STATUS.RED;
          }
        }

        // Also check for CSS class-based status
        var $statusCell = $row.find('.report-status, [class*="dot"]');
        if ($statusCell.length > 0) {
          var cls = $statusCell.attr('class') || '';
          if (cls.indexOf('green') !== -1) lootStatus = LOOT_STATUS.GREEN;
          else if (cls.indexOf('yellow') !== -1) lootStatus = LOOT_STATUS.YELLOW;
          else if (cls.indexOf('red') !== -1) lootStatus = LOOT_STATUS.RED;
        }

        // Max loot flag — full haul indicator
        var $fullHaul = $row.find('img[src*="max_loot"], img[src*="haul"]');
        if ($fullHaul.length > 0) {
          maxLoot = true;
        }

        // Wall level — sometimes shown in a cell
        $cells.each(function() {
          var text = $.trim($(this).text());
          // Wall level is usually a small number in its own cell
          if (text.match(/^\d{1,2}$/) && !text.match(/\|/)) {
            var candidate = parseInt(text, 10);
            if (candidate <= 20 && candidate >= 0) {
              wallLevel = candidate;
            }
          }
        });

        if (targetCoords) {
          var parsed = TWTools.parseCoords(targetCoords);
          if (parsed) {
            targets.push({
              id: targetId,
              coords: targetCoords,
              coordsParsed: parsed,
              playerName: playerName,
              lootStatus: lootStatus,
              maxLoot: maxLoot,
              wallLevel: wallLevel,
              distance: 0
            });
          }
        }
      });
    }

    // Check pagination — Farm Assistant uses Farm_page
    var hasNextPage = false;
    $page.find('a[href*="Farm_page"]').each(function() {
      var text = $.trim($(this).text());
      if (text === '>>' || text === '>' || text.indexOf('next') !== -1 ||
          text.indexOf('Next') !== -1 || text.indexOf('Dopredu') !== -1 ||
          text === String(parseInt(text, 10)) && parseInt(text, 10) > 0) {
        // Check if this points to a higher page number
        var href = $(this).attr('href') || '';
        var pageMatch = href.match(/Farm_page=(\d+)/);
        if (pageMatch) {
          var linkedPage = parseInt(pageMatch[1], 10);
          // Pages are 0-indexed internally
          hasNextPage = true;
        }
      }
    });

    // More reliable: check if the "next" navigation arrow exists
    $page.find('.paged-nav-item').each(function() {
      var text = $.trim($(this).text());
      if (text === '>' || text === '>>') {
        hasNextPage = true;
        return false;
      }
    });

    return {
      targets: targets,
      hasNextPage: hasNextPage,
      csrf: csrf,
      sendLink: sendLink
    };
  }

  // ============================================================
  // SCANNING — PARALLEL DATA COLLECTION
  // ============================================================

  /**
   * Run the full scan: fetch sources, attacks, and farm targets in parallel.
   * @param {function()} callback - Called when all data is ready.
   * @param {function(string)} statusCb - Status update callback.
   */
  function runScan(callback, statusCb) {
    if (isScanning) {
      TWTools.UI.toast('Scan already in progress...', 'warning');
      return;
    }

    isScanning = true;
    var completed = 0;
    var total = 3;

    // Ensure we have CSRF token from game_data
    if (typeof game_data !== 'undefined' && game_data.csrf) {
      csrfToken = game_data.csrf;
    }

    function checkDone() {
      completed++;
      if (statusCb) {
        statusCb('Scanning... (' + completed + '/' + total + ' complete)');
      }
      if (completed >= total) {
        isScanning = false;
        // Count targets in range for each source
        updateTargetsInRange();
        if (statusCb) {
          statusCb('Scan complete: ' + sourceVillages.length + ' sources, ' +
            farmTargets.length + ' targets, ' + outgoingAttacks.length + ' outgoing attacks.');
        }
        callback();
      }
    }

    // Fetch all three data sources in parallel
    fetchSourceVillages(function(villages) {
      sourceVillages = villages;
      checkDone();
    }, statusCb);

    fetchOutgoingAttacks(function(attacks) {
      outgoingAttacks = attacks;
      checkDone();
    }, statusCb);

    fetchFarmTargets(function(targets) {
      farmTargets = targets;
      checkDone();
    }, statusCb);
  }

  /**
   * Update targetsInRange count for each source village.
   */
  function updateTargetsInRange() {
    for (var i = 0; i < sourceVillages.length; i++) {
      var src = sourceVillages[i];
      var count = 0;
      for (var j = 0; j < farmTargets.length; j++) {
        var dist = TWTools.distance(src.coordsParsed, farmTargets[j].coordsParsed);
        if (dist <= settings.maxDistance) count++;
      }
      src.targetsInRange = count;
    }
  }

  // ============================================================
  // PLANNING ENGINE
  // ============================================================

  /**
   * Check if a target has a collision (existing attack arriving within cooldown).
   * @param {string} targetCoords - Target coordinates.
   * @param {number} estimatedArrivalMs - Estimated arrival of new attack (ms since midnight).
   * @returns {boolean} True if collision detected.
   */
  function hasCollision(targetCoords, estimatedArrivalMs) {
    var cooldownMs = settings.cooldownMinutes * 60 * 1000;

    for (var i = 0; i < outgoingAttacks.length; i++) {
      var atk = outgoingAttacks[i];
      if (atk.targetCoords !== targetCoords) continue;

      var diff = Math.abs(atk.arrivalMs - estimatedArrivalMs);
      if (diff < cooldownMs) return true;
    }

    return false;
  }

  /**
   * Build the farm plan based on scanned data.
   * For each source village, sort targets by distance and assign templates.
   * @param {function(string)} statusCb - Status update callback.
   * @returns {FarmPlanEntry[]} The generated plan.
   */
  function buildPlan(statusCb) {
    farmPlan = [];

    if (sourceVillages.length === 0) {
      if (statusCb) statusCb('No source villages. Run scan first.');
      return farmPlan;
    }

    if (farmTargets.length === 0) {
      if (statusCb) statusCb('No farm targets. Check Farm Assistant settings.');
      return farmPlan;
    }

    if (realTemplateA === null) {
      if (statusCb) statusCb('No Farm Assistant templates configured! Go to Farm Assistant and set up Template A/B first.');
      TWTools.UI.toast('Farm Assistant templates not configured! Open Farm Assistant (am_farm) and set up Template A first.', 'error');
      return farmPlan;
    }

    // Get world speed info for travel time calculation
    var worldSpeed = 1;
    var unitSpeedFactor = 1;
    if (TWTools.DataFetcher._worldConfig) {
      worldSpeed = TWTools.DataFetcher._worldConfig.speed || 1;
      unitSpeedFactor = TWTools.DataFetcher._worldConfig.unitSpeed || 1;
    }

    // Track which targets have been assigned (for collision with newly planned attacks)
    var plannedArrivals = {}; // targetCoords -> [arrivalMs, ...]

    // Build a copy of LC availability to track usage
    var lcPool = {};
    for (var si = 0; si < sourceVillages.length; si++) {
      lcPool[sourceVillages[si].id] = sourceVillages[si].lcAvailable;
    }

    var nowMs = TWTools.TimeSync.now();

    for (var i = 0; i < sourceVillages.length; i++) {
      var src = sourceVillages[i];

      // Sort targets by distance from this source
      var targetsByDist = [];
      for (var j = 0; j < farmTargets.length; j++) {
        var tgt = farmTargets[j];
        var dist = TWTools.distance(src.coordsParsed, tgt.coordsParsed);
        if (dist <= settings.maxDistance) {
          targetsByDist.push({
            target: tgt,
            distance: dist
          });
        }
      }

      targetsByDist.sort(function(a, b) {
        return a.distance - b.distance;
      });

      // Assign targets while LC is available
      for (var k = 0; k < targetsByDist.length; k++) {
        if (lcPool[src.id] < settings.minLC) break;

        var entry = targetsByDist[k];
        var target = entry.target;
        var distance = entry.distance;

        // Calculate travel time
        var travelMs = TWTools.travelTime(distance, LC_SPEED, worldSpeed, unitSpeedFactor);
        var estimatedArrival = nowMs + travelMs;

        // Check collision with existing attacks
        if (hasCollision(target.coords, estimatedArrival)) continue;

        // Check collision with already-planned attacks in this batch
        var plannedForTarget = plannedArrivals[target.coords] || [];
        var cooldownMs = settings.cooldownMinutes * 60 * 1000;
        var selfCollision = false;
        for (var p = 0; p < plannedForTarget.length; p++) {
          if (Math.abs(plannedForTarget[p] - estimatedArrival) < cooldownMs) {
            selfCollision = true;
            break;
          }
        }
        if (selfCollision) continue;

        // Select template — use real IDs from Accountmanager if available
        var templateId = realTemplateA !== null ? realTemplateA : TEMPLATE_A;
        var templateLabel = 'A';
        if (settings.useBForMaxLoot && target.maxLoot) {
          templateId = realTemplateB !== null ? realTemplateB : TEMPLATE_B;
          templateLabel = 'B';
        }

        // Add to plan
        farmPlan.push({
          sourceId: src.id,
          sourceName: src.name,
          sourceCoords: src.coords,
          targetId: target.id,
          targetCoords: target.coords,
          distance: distance,
          templateId: templateId,
          templateLabel: templateLabel,
          travelTimeMs: travelMs,
          estArrival: formatTimeShort(estimatedArrival)
        });

        // Track this planned arrival
        if (!plannedArrivals[target.coords]) {
          plannedArrivals[target.coords] = [];
        }
        plannedArrivals[target.coords].push(estimatedArrival);

        // Deduct LC (template uses some LC — approximate as minLC per attack)
        lcPool[src.id] -= settings.minLC;
      }
    }

    if (statusCb) {
      statusCb('Plan ready: ' + farmPlan.length + ' attacks across ' + sourceVillages.length + ' villages.');
    }

    return farmPlan;
  }

  // ============================================================
  // EXECUTION — SEND FARM ATTACKS
  // ============================================================

  /**
   * Execute the farm plan by sending attacks via Farm Assistant API.
   * Uses a queue with REQUEST_DELAY between requests.
   * @param {function(number, number)} progressCb - Called with (sent, total) after each request.
   * @param {function(number, number)} doneCb - Called with (sent, failed) when complete.
   */
  function executePlan(progressCb, doneCb) {
    if (farmPlan.length === 0) {
      TWTools.UI.toast('No attacks in plan.', 'warning');
      if (doneCb) doneCb(0, 0);
      return;
    }

    isFarming = true;
    farmCancelled = false;

    var sent = 0;
    var failed = 0;
    var idx = 0;
    var total = farmPlan.length;

    // Ensure CSRF token
    if (!csrfToken && typeof game_data !== 'undefined') {
      csrfToken = game_data.csrf || '';
    }

    function sendNext() {
      if (farmCancelled) {
        isFarming = false;
        TWTools.UI.toast('Farming cancelled. Sent: ' + sent + ', Remaining: ' + (total - idx), 'warning');
        if (doneCb) doneCb(sent, failed);
        return;
      }

      if (idx >= total) {
        isFarming = false;
        TWTools.UI.toast('Farming complete! Sent: ' + sent + ', Failed: ' + failed, 'success');
        if (doneCb) doneCb(sent, failed);
        return;
      }

      var entry = farmPlan[idx];
      idx++;

      // Send farm attack via the Farm Assistant endpoint.
      // Real URL format from game: /game.php?village={source}&screen=am_farm&mode=farm&ajaxaction=farm&json=1&h={csrf}
      // POST data: {target: villageId, template_id: templateId, source: sourceVillageId}
      var csrf = csrfToken || (typeof game_data !== 'undefined' ? game_data.csrf : '');
      var url = sendUnitsLink
        ? sendUnitsLink.replace(/village=\d+/, 'village=' + entry.sourceId)
        : '/game.php?village=' + entry.sourceId +
          '&screen=am_farm&mode=farm&ajaxaction=farm&json=1&h=' + encodeURIComponent(csrf);

      $.ajax({
        url: url,
        type: 'POST',
        data: {
          target: entry.targetId,
          template_id: entry.templateId,
          source: entry.sourceId
        },
        timeout: 10000,
        success: function(response) {
          // TW returns HTML or JSON — any 200 response means the attack was queued
          sent++;
          if (progressCb) progressCb(idx, total);
          setTimeout(sendNext, REQUEST_DELAY);
        },
        error: function(xhr) {
          failed++;
          if (progressCb) progressCb(idx, total);
          setTimeout(sendNext, REQUEST_DELAY);
        }
      });
    }

    sendNext();
  }

  /**
   * Cancel an in-progress farming execution.
   */
  function cancelFarming() {
    farmCancelled = true;
  }

  // ============================================================
  // UI — FARM TAB
  // ============================================================

  /**
   * Render the farm tab content.
   * @param {jQuery} $panel - Tab panel jQuery element.
   */
  function renderFarmTab($panel) {
    $panel.off('.twfbtn .twfscan .twfplan .twffarm');
    $panel.empty();

    // Build group selector dropdown
    var groupSelectHtml = '<label style="font-size:10px;margin-left:4px;">Group: ' +
      '<select id="' + ID_PREFIX + 'group-id" style="font-size:10px;">';
    for (var gi = 0; gi < availableGroups.length; gi++) {
      groupSelectHtml += '<option value="' + availableGroups[gi].id + '"' +
        (settings.groupId === availableGroups[gi].id ? ' selected' : '') + '>' +
        escapeHtml(availableGroups[gi].name) + '</option>';
    }
    groupSelectHtml += '</select></label>';

    // Top toolbar
    var html = '<div style="margin-bottom:6px;">' +
      groupSelectHtml + ' ' +
      '<button class="btn" id="' + ID_PREFIX + 'scan-btn" style="font-size:10px;font-weight:bold;">Scan</button> ' +
      '<button class="btn" id="' + ID_PREFIX + 'plan-btn" style="font-size:10px;"' +
        (sourceVillages.length === 0 ? ' disabled' : '') + '>Plan</button> ' +
      '<button class="btn" id="' + ID_PREFIX + 'farm-btn" style="font-size:10px;font-weight:bold;color:#2e7d32;"' +
        (farmPlan.length === 0 ? ' disabled' : '') + '>Farm All (' + farmPlan.length + ')</button> ' +
      '<button class="btn" id="' + ID_PREFIX + 'cancel-btn" style="font-size:10px;color:#cc0000;display:none;">Cancel</button>' +
      '</div>';

    // Progress bar (hidden initially)
    html += '<div id="' + ID_PREFIX + 'progress-wrap" style="display:none;margin-bottom:6px;">' +
      '<div style="background:#e8d8a8;border:1px solid #c0a060;border-radius:2px;height:16px;position:relative;">' +
        '<div id="' + ID_PREFIX + 'progress-bar" style="background:linear-gradient(to bottom,#6a9c2a,#4a7a1e);' +
          'height:100%;width:0%;border-radius:2px;transition:width 0.2s;"></div>' +
        '<span id="' + ID_PREFIX + 'progress-text" style="position:absolute;top:0;left:0;right:0;' +
          'text-align:center;font-size:9px;line-height:16px;color:#3e2e14;">0 / 0</span>' +
      '</div>' +
    '</div>';

    // Status line
    html += '<div id="' + ID_PREFIX + 'status" style="margin-bottom:6px;font-size:10px;color:#7a6840;">' +
      (sourceVillages.length > 0
        ? 'Scanned: ' + sourceVillages.length + ' sources, ' + farmTargets.length + ' targets.'
        : 'Click "Scan" to load villages and farm targets.') +
    '</div>';

    // Source villages table (if scanned)
    if (sourceVillages.length > 0) {
      html += '<div style="margin-bottom:8px;">' +
        '<b style="font-size:10px;">Source Villages (' + sourceVillages.length + ')</b>' +
        '<table class="vis" style="width:100%;table-layout:auto;margin-top:2px;">' +
        '<thead><tr>' +
          '<th style="font-size:10px;">Village</th>' +
          '<th style="font-size:10px;text-align:right;">LC Available</th>' +
          '<th style="font-size:10px;text-align:right;">Targets</th>' +
          '<th style="font-size:10px;text-align:center;">Status</th>' +
        '</tr></thead><tbody>';

      for (var si = 0; si < sourceVillages.length; si++) {
        var src = sourceVillages[si];
        var rowClass = si % 2 === 0 ? 'row_a' : 'row_b';
        var lcColor = src.lcAvailable >= 20 ? '#2e7d32' : (src.lcAvailable >= settings.minLC ? '#a06800' : '#cc0000');
        html += '<tr class="' + rowClass + '">' +
          '<td style="font-size:10px;">' + escapeHtml(src.name) + ' <span style="color:#7a6840;">(' + src.coords + ')</span></td>' +
          '<td style="font-size:10px;text-align:right;color:' + lcColor + ';font-weight:bold;">' + formatNum(src.lcAvailable) + '</td>' +
          '<td style="font-size:10px;text-align:right;">' + src.targetsInRange + '</td>' +
          '<td style="font-size:10px;text-align:center;color:#7a6840;">' + escapeHtml(src.status) + '</td>' +
        '</tr>';
      }

      html += '</tbody></table></div>';
    }

    // Farm plan preview (if planned)
    if (farmPlan.length > 0) {
      html += '<div style="margin-bottom:8px;">' +
        '<b style="font-size:10px;">Farm Plan (' + farmPlan.length + ' attacks)</b>' +
        '<div style="max-height:250px;overflow-y:auto;margin-top:2px;">' +
        '<table class="vis" style="width:100%;table-layout:auto;">' +
        '<thead><tr>' +
          '<th style="font-size:10px;">Source</th>' +
          '<th style="font-size:10px;">Target</th>' +
          '<th style="font-size:10px;text-align:right;">Dist</th>' +
          '<th style="font-size:10px;text-align:center;">Tmpl</th>' +
          '<th style="font-size:10px;text-align:right;">Travel</th>' +
          '<th style="font-size:10px;text-align:right;">Est. Arrival</th>' +
        '</tr></thead><tbody>';

      for (var pi = 0; pi < farmPlan.length; pi++) {
        var plan = farmPlan[pi];
        var planRowClass = pi % 2 === 0 ? 'row_a' : 'row_b';
        html += '<tr class="' + planRowClass + '">' +
          '<td style="font-size:9px;">' + escapeHtml(plan.sourceName) + ' <span style="color:#7a6840;">(' + plan.sourceCoords + ')</span></td>' +
          '<td style="font-size:9px;color:#7a6840;">(' + plan.targetCoords + ')</td>' +
          '<td style="font-size:9px;text-align:right;">' + formatDist(plan.distance) + '</td>' +
          '<td style="font-size:9px;text-align:center;font-weight:bold;">' + plan.templateLabel + '</td>' +
          '<td style="font-size:9px;text-align:right;">' + formatTravelTime(plan.travelTimeMs) + '</td>' +
          '<td style="font-size:9px;text-align:right;font-family:monospace;">' + plan.estArrival + '</td>' +
        '</tr>';
      }

      html += '</tbody></table></div></div>';

      // Summary
      var totalLC = 0;
      for (var pj = 0; pj < farmPlan.length; pj++) {
        totalLC += settings.minLC;
      }
      var estLoot = farmPlan.length * settings.minLC * LC_CARRY;
      html += '<div style="padding:4px;background:#f0e0b0;border:1px solid #c0a060;border-radius:2px;font-size:10px;margin-bottom:6px;">' +
        '<b>Summary:</b> ' + farmPlan.length + ' attacks, ~' + formatNum(totalLC) + ' LC used, ~' + formatNum(estLoot) + ' max loot capacity' +
      '</div>';
    }

    // Results area (hidden initially)
    html += '<div id="' + ID_PREFIX + 'results" style="display:none;margin-top:6px;"></div>';

    $panel.html(html);

    // ---- Event Bindings ----

    // Group change
    $panel.on('change.twfbtn', '#' + ID_PREFIX + 'group-id', function() {
      settings.groupId = $(this).val();
      saveSettings();
      // Reset data when group changes
      sourceVillages = [];
      farmTargets = [];
      farmPlan = [];
      renderFarmTab($panel);
    });

    // Scan button
    $panel.on('click.twfscan', '#' + ID_PREFIX + 'scan-btn', function() {
      var $btn = $(this);
      $btn.prop('disabled', true).text('Scanning...');

      // Also fetch world config for travel time accuracy
      TWTools.DataFetcher.fetchWorldConfig(function() {
        runScan(function() {
          renderFarmTab($panel);
        }, function(status) {
          $panel.find('#' + ID_PREFIX + 'status').text(status);
          if (card) card.setStatus(status);
        });
      });
    });

    // Plan button
    $panel.on('click.twfplan', '#' + ID_PREFIX + 'plan-btn', function() {
      if (sourceVillages.length === 0) {
        TWTools.UI.toast('Run scan first.', 'warning');
        return;
      }

      buildPlan(function(status) {
        $panel.find('#' + ID_PREFIX + 'status').text(status);
        if (card) card.setStatus(status);
      });

      renderFarmTab($panel);
    });

    // Farm All button
    $panel.on('click.twffarm', '#' + ID_PREFIX + 'farm-btn', function() {
      if (farmPlan.length === 0) {
        TWTools.UI.toast('No attacks planned.', 'warning');
        return;
      }

      if (isFarming) {
        TWTools.UI.toast('Farming already in progress.', 'warning');
        return;
      }

      // Show confirmation
      var confirmMsg = 'Send ' + farmPlan.length + ' farm attacks?';
      if (!window.confirm(confirmMsg)) return;

      // Show progress bar and cancel button
      $panel.find('#' + ID_PREFIX + 'progress-wrap').show();
      $panel.find('#' + ID_PREFIX + 'cancel-btn').show();
      $panel.find('#' + ID_PREFIX + 'farm-btn').prop('disabled', true);
      $panel.find('#' + ID_PREFIX + 'scan-btn').prop('disabled', true);
      $panel.find('#' + ID_PREFIX + 'plan-btn').prop('disabled', true);

      executePlan(
        // Progress callback
        function(current, total) {
          var pct = Math.round((current / total) * 100);
          $panel.find('#' + ID_PREFIX + 'progress-bar').css('width', pct + '%');
          $panel.find('#' + ID_PREFIX + 'progress-text').text(current + ' / ' + total);
          if (card) card.setStatus('Farming: ' + current + '/' + total + ' (' + pct + '%)');
        },
        // Done callback
        function(sent, failed) {
          $panel.find('#' + ID_PREFIX + 'cancel-btn').hide();
          $panel.find('#' + ID_PREFIX + 'scan-btn').prop('disabled', false);

          // Show results
          var resultHtml = '<div style="padding:6px;background:#f0e0b0;border:1px solid #c0a060;border-radius:2px;">' +
            '<b>Farming Results</b><br/>' +
            '<span style="color:#2e7d32;font-weight:bold;">Sent: ' + sent + '</span>';
          if (failed > 0) {
            resultHtml += ' &nbsp;|&nbsp; <span style="color:#cc0000;font-weight:bold;">Failed: ' + failed + '</span>';
          }
          resultHtml += '<br/><span style="font-size:9px;color:#7a6840;">Estimated max loot: ~' +
            formatNum(sent * settings.minLC * LC_CARRY) + ' resources</span>' +
          '</div>';
          $panel.find('#' + ID_PREFIX + 'results').html(resultHtml).show();

          // Reset plan
          farmPlan = [];
          if (card) card.setStatus('Done. Sent: ' + sent + ', Failed: ' + failed);
        }
      );
    });

    // Cancel button
    $panel.on('click.twffarm', '#' + ID_PREFIX + 'cancel-btn', function() {
      cancelFarming();
      $(this).prop('disabled', true).text('Cancelling...');
    });
  }

  // ============================================================
  // UI — SETTINGS TAB
  // ============================================================

  /**
   * Render the settings tab content.
   * @param {jQuery} $panel - Tab panel jQuery element.
   */
  function renderSettingsTab($panel) {
    $panel.off('.twfset');
    $panel.empty();

    // Build group selector
    var groupSelectHtml = '<select id="' + ID_PREFIX + 'set-group" style="font-size:10px;width:150px;">';
    for (var gi = 0; gi < availableGroups.length; gi++) {
      groupSelectHtml += '<option value="' + availableGroups[gi].id + '"' +
        (settings.groupId === availableGroups[gi].id ? ' selected' : '') + '>' +
        escapeHtml(availableGroups[gi].name) + '</option>';
    }
    groupSelectHtml += '</select>';

    var html = '<div style="padding:4px;">' +

      // Group
      '<div style="margin-bottom:8px;">' +
        '<label style="font-size:10px;">Village Group: ' + groupSelectHtml + '</label>' +
        '<div style="font-size:9px;color:#7a6840;margin-top:2px;">Only farm from villages in this group.</div>' +
      '</div>' +

      // Max distance
      '<div style="margin-bottom:8px;">' +
        '<label style="font-size:10px;">Max Distance (fields): ' +
        '<input type="number" id="' + ID_PREFIX + 'set-dist" value="' + settings.maxDistance +
          '" style="width:50px;font-size:10px;" min="1" max="100" step="1">' +
        '</label>' +
        '<div style="font-size:9px;color:#7a6840;margin-top:2px;">Skip targets farther than this distance.</div>' +
      '</div>' +

      // Cooldown
      '<div style="margin-bottom:8px;">' +
        '<label style="font-size:10px;">Cooldown (minutes): ' +
        '<input type="number" id="' + ID_PREFIX + 'set-cooldown" value="' + settings.cooldownMinutes +
          '" style="width:50px;font-size:10px;" min="0" max="60" step="1">' +
        '</label>' +
        '<div style="font-size:9px;color:#7a6840;margin-top:2px;">Skip targets with existing attacks arriving within this window.</div>' +
      '</div>' +

      // Min LC
      '<div style="margin-bottom:8px;">' +
        '<label style="font-size:10px;">Min LC per village: ' +
        '<input type="number" id="' + ID_PREFIX + 'set-minlc" value="' + settings.minLC +
          '" style="width:50px;font-size:10px;" min="1" max="500" step="1">' +
        '</label>' +
        '<div style="font-size:9px;color:#7a6840;margin-top:2px;">Skip villages with fewer LC. Also used as LC-per-attack estimate.</div>' +
      '</div>' +

      // Use B template
      '<div style="margin-bottom:8px;">' +
        '<label style="font-size:10px;">' +
        '<input type="checkbox" id="' + ID_PREFIX + 'set-useb"' +
          (settings.useBForMaxLoot ? ' checked' : '') + '> ' +
        'Use Template B when max loot' +
        '</label>' +
        '<div style="font-size:9px;color:#7a6840;margin-top:2px;">Send Template B (heavier) to targets that returned max loot.</div>' +
      '</div>' +

      // Include new barbs
      '<div style="margin-bottom:8px;">' +
        '<label style="font-size:10px;">' +
        '<input type="checkbox" id="' + ID_PREFIX + 'set-barbs"' +
          (settings.includeNewBarbs ? ' checked' : '') + '> ' +
        'Include new barb villages' +
        '</label>' +
        '<div style="font-size:9px;color:#7a6840;margin-top:2px;">' +
          'Discover barb villages from map data not yet on your Farm Assistant list. (Experimental)' +
        '</div>' +
      '</div>' +

      // Save button
      '<div style="margin-top:12px;">' +
        '<button class="btn" id="' + ID_PREFIX + 'save-settings" style="font-weight:bold;">Save Settings</button> ' +
        '<button class="btn" id="' + ID_PREFIX + 'clear-cache" style="font-size:9px;">Clear Cache</button>' +
      '</div>' +

      // Info box
      '<div style="margin-top:12px;padding:4px;background:#f0e0b0;border:1px solid #c0a060;border-radius:2px;font-size:9px;color:#7a6840;">' +
        'TW Farm v' + VERSION + '<br/>' +
        'LC Speed: ' + LC_SPEED + ' min/field (base) | LC Carry: ' + LC_CARRY + ' per unit<br/>' +
        'Farm data cached for 5 minutes. Use "Scan" to refresh.' +
      '</div>' +

    '</div>';

    $panel.html(html);

    // Bind save
    $panel.on('click.twfset', '#' + ID_PREFIX + 'save-settings', function() {
      settings.groupId = $panel.find('#' + ID_PREFIX + 'set-group').val();
      settings.maxDistance = parseInt($panel.find('#' + ID_PREFIX + 'set-dist').val(), 10) || 20;
      settings.cooldownMinutes = parseInt($panel.find('#' + ID_PREFIX + 'set-cooldown').val(), 10) || 5;
      settings.minLC = parseInt($panel.find('#' + ID_PREFIX + 'set-minlc').val(), 10) || 5;
      settings.useBForMaxLoot = $panel.find('#' + ID_PREFIX + 'set-useb').is(':checked');
      settings.includeNewBarbs = $panel.find('#' + ID_PREFIX + 'set-barbs').is(':checked');
      saveSettings();

      // Update targets in range with new distance
      updateTargetsInRange();

      TWTools.UI.toast('Settings saved', 'success');
    });

    // Bind clear cache
    $panel.on('click.twfset', '#' + ID_PREFIX + 'clear-cache', function() {
      sourceVillages = [];
      farmTargets = [];
      outgoingAttacks = [];
      farmPlan = [];
      TWTools.UI.toast('Cache cleared', 'success');
    });
  }

  // ============================================================
  // MAIN CARD INITIALIZATION
  // ============================================================

  /**
   * Initialize the TW Farm card widget.
   */
  function init() {
    loadSettings();

    // Fetch available village groups in background
    TWTools.DataFetcher.fetchGroups(function(groups) {
      availableGroups = groups;
      // Validate saved group ID still exists
      var found = false;
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].id === settings.groupId) { found = true; break; }
      }
      if (!found) {
        settings.groupId = '0';
        saveSettings();
      }
      // Re-render group dropdowns if card is showing
      var $groupSelect = $('#' + ID_PREFIX + 'group-id');
      if ($groupSelect.length > 0) {
        $groupSelect.empty();
        for (var j = 0; j < availableGroups.length; j++) {
          $groupSelect.append(
            $('<option/>').val(availableGroups[j].id).text(availableGroups[j].name)
          );
        }
        $groupSelect.val(settings.groupId);
      }
    });

    // Pre-fetch world config for travel time calculations
    TWTools.DataFetcher.fetchWorldConfig(function() {
      // World config loaded — travel time calculations will be accurate
    });

    card = TWTools.UI.createCard({
      id: ID_PREFIX + 'main',
      title: 'TW Farm',
      version: VERSION,
      width: 680,
      height: 520,
      minWidth: 500,
      minHeight: 300,
      tabs: [
        { id: 'farm', label: 'Farm' },
        { id: 'settings', label: 'Settings' }
      ],
      onTabChange: function(tabId) {
        if (tabId === 'farm') {
          renderFarmTab(card.getTabContent('farm'));
        } else if (tabId === 'settings') {
          renderSettingsTab(card.getTabContent('settings'));
        }
      },
      onClose: function() {
        if (isFarming) {
          cancelFarming();
        }
        card = null;
        TWTools.UI.toast('TW Farm closed', 'success');
      }
    });

    // Initial render — farm tab
    renderFarmTab(card.getTabContent('farm'));

    // Settings tab — render immediately for lazy access
    renderSettingsTab(card.getTabContent('settings'));
  }

  // ============================================================
  // AUTO-START
  // ============================================================

  $(function() {
    if (!TWTools.getPlayerId()) {
      return; // Not logged in or not in game
    }

    init();
    TWTools.UI.toast('TW Farm v' + VERSION + ' loaded', 'success');
  });

})(window, jQuery);
