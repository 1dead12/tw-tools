/**
 * TW Troop Overview v1.0.0
 * Military unit summary across all villages with troop aggregation and command overview.
 *
 * Features:
 * - Troops tab: fetches combined overview, shows per-village unit counts with totals
 * - Commands tab: shows outgoing/incoming commands with filters
 * - Settings tab: archer toggle, nuke threshold, export format
 * - BBCode and CSV export
 * - NEVER auto-sends anything
 *
 * @version 1.1.0
 * @requires jQuery, TribalWars game environment, window.TWTools (tw-core.js, tw-ui.js)
 */
;(function(window, $) {
  'use strict';

  // ============================================================
  // GUARD: TWTools must be loaded
  // ============================================================

  if (!window.TWTools || !window.TWTools.UI) {
    throw new Error('tw-overview.js requires tw-core.js and tw-ui.js (window.TWTools.UI missing)');
  }

  var TWTools = window.TWTools;

  // ============================================================
  // CONFIG & CONSTANTS
  // ============================================================

  var VERSION = '1.1.0';
  var ID_PREFIX = 'two-';
  var STORAGE_PREFIX = 'two_';

  /** Cache TTL for troop data (5 minutes) */
  var CACHE_TTL = 5 * 60 * 1000;

  /** Minimum delay between AJAX requests to avoid rate limiting */
  var REQUEST_DELAY = 200;

  /**
   * All unit types in standard TW display order.
   * Archer units (archer, marcher) are conditionally displayed.
   * @type {string[]}
   */
  var ALL_UNITS = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];

  /** Units without archers */
  var UNITS_NO_ARCHERS = ['spear', 'sword', 'axe', 'spy', 'light', 'heavy', 'ram', 'catapult', 'knight', 'snob'];

  /** Offensive units for power calculation */
  var OFFENSIVE_UNITS = ['axe', 'light', 'ram', 'catapult'];

  /** Defensive units for power calculation */
  var DEFENSIVE_UNITS = ['spear', 'sword', 'heavy'];

  /** Offensive archer units */
  var OFFENSIVE_ARCHER_UNITS = ['marcher'];

  /** Defensive archer units */
  var DEFENSIVE_ARCHER_UNITS = ['archer'];

  /**
   * Offensive attack values per unit (used for power estimation).
   * @type {Object.<string, number>}
   */
  var ATTACK_VALUES = {
    spear: 10, sword: 25, axe: 40, archer: 15,
    spy: 0, light: 130, marcher: 120, heavy: 150,
    ram: 2, catapult: 100, knight: 150, snob: 30
  };

  /**
   * General defense values per unit (infantry).
   * @type {Object.<string, number>}
   */
  var DEF_VALUES = {
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

  /**
   * Available troop overview view types.
   * Each entry maps a value (used in the URL type= param) to a display label.
   * @type {Array.<{value: string, label: string}>}
   */
  var VIEW_TYPES = [
    { value: 'own_home', label: 'Own (home)', urlType: 'own_home' },
    { value: 'own_all', label: 'Own (all)', urlType: 'complete' },
    { value: 'in_village', label: 'In village', urlType: 'there' },
    { value: 'outside', label: 'Outside', urlType: 'away', urlExtra: '&filter_villages=1' },
    { value: 'in_transit', label: 'In transit', urlType: 'moving', urlExtra: '&filter_villages=1' }
  ];

  /** Default settings */
  var DEFAULT_SETTINGS = {
    includeArchers: false,
    nukeThreshold: 5000,
    autoRefreshInterval: 0,
    exportFormat: 'bbcode'
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

    // Load persisted view type and group
    var savedView = Store.get('view_type', 'own_home');
    currentViewType = savedView || 'own_home';
    var savedGroup = Store.get('group_id', '0');
    currentGroupId = savedGroup || '0';
  }

  /**
   * Save current settings to localStorage.
   */
  function saveSettings() {
    Store.set('settings', settings);
  }

  /**
   * Get the active list of unit types based on archer setting.
   * @returns {string[]} Active unit type list.
   */
  function getActiveUnits() {
    return settings.includeArchers ? ALL_UNITS : UNITS_NO_ARCHERS;
  }

  /**
   * Get the display label for the currently selected view type.
   * @returns {string} View type label.
   */
  function getViewLabel() {
    for (var i = 0; i < VIEW_TYPES.length; i++) {
      if (VIEW_TYPES[i].value === currentViewType) {
        return VIEW_TYPES[i].label;
      }
    }
    return 'Own (home)';
  }

  /**
   * Get the URL type parameter for the currently selected view.
   * Maps our internal view names to the game's actual URL type values.
   * @returns {string} URL type parameter string (may include &filter_villages=1).
   */
  function getViewUrlParam() {
    for (var i = 0; i < VIEW_TYPES.length; i++) {
      if (VIEW_TYPES[i].value === currentViewType) {
        return VIEW_TYPES[i].urlType + (VIEW_TYPES[i].urlExtra || '');
      }
    }
    return 'own_home';
  }

  /**
   * Get the display label for the currently selected group.
   * @returns {string} Group label.
   */
  function getGroupLabel() {
    for (var i = 0; i < availableGroups.length; i++) {
      if (availableGroups[i].id === currentGroupId) {
        return availableGroups[i].name;
      }
    }
    return 'All villages';
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

  /** @type {VillageTroops[]} All fetched troop data */
  var troopData = [];

  /** @type {CommandInfo[]} All fetched command data */
  var commandData = [];

  /** @type {boolean} Whether a fetch is in progress */
  var isFetching = false;

  // ============================================================
  // DATA FETCHING — TROOPS
  // ============================================================

  /**
   * Fetch troop data from the combined overview page.
   * Handles pagination for players with many villages.
   * @param {function(VillageTroops[])} callback - Called with troop data array.
   * @param {function(string)} statusCb - Status update callback.
   */
  function fetchTroopData(callback, statusCb) {
    // Cache key includes view type AND group so combinations are cached independently
    var cacheKey = 'troop_data_' + currentViewType + '_g' + currentGroupId;

    // Check cache first
    var cached = Store.getCache(cacheKey);
    if (cached && cached.length > 0) {
      troopData = cached;
      callback(cached);
      return;
    }

    if (isFetching) {
      TWTools.UI.toast('Fetch already in progress...', 'warning');
      return;
    }

    isFetching = true;
    if (statusCb) statusCb('Fetching troop overview (' + getViewLabel() + ')...');

    var allTroops = [];
    var page = 0;
    var viewType = currentViewType;
    var urlTypeParam = getViewUrlParam();

    /**
     * Fetch a single page of the units overview.
     * @private
     */
    function fetchPage() {
      var groupParam = (currentGroupId && currentGroupId !== '0') ? '&group=' + currentGroupId : '';
      var url = '/game.php?screen=overview_villages&mode=units&type=' + urlTypeParam + groupParam + '&page=' + page;

      $.ajax({
        url: url,
        dataType: 'html',
        timeout: 15000,
        success: function(html) {
          var result = parseCombinedOverview(html, page, urlTypeParam);
          allTroops = allTroops.concat(result.villages);

          if (statusCb) {
            statusCb('Loaded page ' + (page + 1) + ' (' + allTroops.length + ' villages)...');
          }

          // Check if there are more pages
          if (result.hasNextPage) {
            page++;
            setTimeout(fetchPage, REQUEST_DELAY);
          } else {
            // Done fetching all pages
            isFetching = false;
            troopData = allTroops;
            Store.setCache(cacheKey, allTroops, CACHE_TTL);
            callback(allTroops);
          }
        },
        error: function() {
          isFetching = false;
          if (statusCb) statusCb('Error fetching troop data.');
          callback(allTroops);
        }
      });
    }

    fetchPage();
  }

  /**
   * Parse the combined overview page to extract troop counts per village.
   * @param {string} html - Raw HTML of the combined overview page.
   * @param {number} [page=0] - Current page index (0-based), used for safety limit.
   * @returns {{villages: VillageTroops[], hasNextPage: boolean}} Parsed data.
   */
  function parseCombinedOverview(html, page, urlTypeParam) {
    var $page = $('<div/>').html(html);
    var villages = [];

    // The combined overview has a table with class "vis" containing troop data
    // Each row represents a village with unit columns
    var $table = $page.find('#combined_table, table.vis.overview_table');
    if ($table.length === 0) {
      // Fallback: find any large vis table
      $table = $page.find('table.vis').filter(function() {
        return $(this).find('tr').length > 2;
      }).first();
    }

    if ($table.length === 0) {
      return { villages: [], hasNextPage: false };
    }

    // Parse header to identify unit columns
    var unitColumns = parseUnitHeaders($table);

    // Parse data rows from the units overview table.
    // Table structure per village:
    //   - For single-row views (own_home, there, away, moving):
    //     Row has: [village_name+coords] [label] [spear] [sword] ... [Akcia]
    //   - For multi-row view (complete/all):
    //     Parent row: [village_name+coords] [vlastné] [counts...] [Príkazy]
    //     Sub-rows:   [v dedine] [counts...] [Vojenské jednotky]
    //                 [vonku] [counts...]
    //                 [na ceste] [counts...] [Príkazy]
    //                 [celkovo] [counts...] [Vojenské jednotky]
    //     For "complete" view, we want the "celkovo" (total) row.
    var villageMap = {};
    var isCompleteView = (urlTypeParam === 'complete');
    var currentVillageId = 0;
    var currentVillageName = '';
    var currentCoords = '';

    $table.find('tbody tr, tr').not(':first').each(function() {
      var $row = $(this);
      var $cells = $row.find('td');

      if ($cells.length < 3) return; // Skip non-data rows

      // Check if this row has a village name link (= parent village row).
      // Village name links contain coordinates like "(463|595)" in their text.
      // Action links ("Príkazy", "Vojenské jednotky") also match a[href*="village="]
      // but do NOT contain coordinates — so we must distinguish them.
      var $villageLink = $();
      $row.find('a[href*="village="]').each(function() {
        var text = $.trim($(this).text());
        if (text.match(/\(\d{1,3}\|\d{1,3}\)/)) {
          $villageLink = $(this);
          return false; // break
        }
      });
      if ($villageLink.length > 0) {
        var villageHref = $villageLink.attr('href') || '';
        var villageIdMatch = villageHref.match(/village=(\d+)/);
        if (villageIdMatch) {
          currentVillageId = parseInt(villageIdMatch[1], 10);
          var linkText = $.trim($villageLink.text());
          var coordsMatch = linkText.match(/\((\d{1,3}\|\d{1,3})\)/);
          currentCoords = coordsMatch ? coordsMatch[1] : '';
          currentVillageName = linkText.replace(/\s*\(\d{1,3}\|\d{1,3}\)\s*K?\d*\s*$/, '').trim();
        }
      }

      if (currentVillageId === 0) return; // No village context yet

      // Detect the row label (column 1): vlastné, v dedine, vonku, na ceste, celkovo
      var labelCell = $.trim($cells.eq(1).text()).toLowerCase().replace(/\s+/g, ' ');
      // For rows without village link, column 0 IS the label
      if ($villageLink.length === 0) {
        labelCell = $.trim($cells.eq(0).text()).toLowerCase().replace(/\s+/g, ' ');
      }

      // For "complete" view: skip all rows EXCEPT "celkovo" / "total" row
      // Use includes() for robustness against extra whitespace or formatting
      if (isCompleteView) {
        var isTotalRow = (labelCell.indexOf('celkovo') !== -1 ||
                          labelCell.indexOf('total') !== -1 ||
                          labelCell.indexOf('gesamt') !== -1 ||
                          labelCell.indexOf('łącznie') !== -1);
        if (!isTotalRow) return;
      }

      // Determine which cells hold unit data
      // If row has village link: units start at the column indices from parseUnitHeaders
      // If sub-row (no village link): cells are shifted left by 1 (no village name column)
      var hasLink = $villageLink.length > 0;
      var units = {};
      var total = 0;

      for (var unitType in unitColumns) {
        if (unitColumns.hasOwnProperty(unitType)) {
          var colIndex = unitColumns[unitType];
          // Sub-rows without village link have 1 fewer column (no village name cell)
          var adjustedIndex = hasLink ? colIndex : colIndex - 1;
          var cellText = $cells.eq(adjustedIndex).text();
          var count = parseIntSafe(cellText);
          units[unitType] = count;
          // Only count recognized units in the total (skip militia and other specials)
          if (ALL_UNITS.indexOf(unitType) !== -1) {
            total += count;
          }
        }
      }

      // Store (don't aggregate — each view gives exactly 1 correct row per village)
      villageMap[currentVillageId] = {
        id: currentVillageId,
        name: currentVillageName || ('Village ' + currentCoords),
        coords: currentCoords,
        units: units,
        total: total
      };
    });

    // Convert map to array and compute derived fields
    for (var vid in villageMap) {
      if (!villageMap.hasOwnProperty(vid)) continue;
      var v = villageMap[vid];

      var offensiveCount = (v.units.axe || 0) + (v.units.light || 0);
      if (settings.includeArchers) {
        offensiveCount += (v.units.marcher || 0);
      }
      var isNuke = offensiveCount >= settings.nukeThreshold;
      var hasNoble = (v.units.snob || 0) > 0;

      villages.push({
        id: v.id,
        name: v.name,
        coords: v.coords,
        units: v.units,
        total: v.total,
        isNuke: isNuke,
        hasNoble: hasNoble
      });
    }

    // Default: no more pages
    var hasNextPage = false;

    // Check if pagination exists
    var $navItems = $page.find('.paged-nav-item');
    if ($navItems.length > 1) {
      // Find current selected page
      var $current = $navItems.filter('.selected, .active');
      if ($current.length > 0) {
        hasNextPage = $current.next('.paged-nav-item').length > 0;
      } else {
        // No selected item found — check if there are page links beyond page 0
        hasNextPage = $page.find('a.paged-nav-item[href*="page="]').length > 0;
      }
    }

    // Safety limit: stop after 100 pages max (1000 villages) to prevent runaway
    if (page >= 100) {
      hasNextPage = false;
    }

    return { villages: villages, hasNextPage: hasNextPage };
  }

  /**
   * Parse table headers to identify which column index maps to which unit type.
   * TW uses unit icon images in the header: <img src="...unit/unit_spear.png">
   * @param {jQuery} $table - The overview table.
   * @returns {Object.<string, number>} Map of unit type to column index.
   */
  function parseUnitHeaders($table) {
    var columns = {};
    var $headerCells = $table.find('tr:first th, thead th');

    $headerCells.each(function(index) {
      var $th = $(this);
      // Look for unit image in header
      var $img = $th.find('img[src*="unit_"]');
      if ($img.length > 0) {
        var src = $img.attr('src') || '';
        var unitMatch = src.match(/unit_(\w+)/);
        if (unitMatch) {
          var unitType = unitMatch[1];
          columns[unitType] = index;
        }
      }

      // Also check for class-based unit identification
      var className = $th.attr('class') || '';
      var classMatch = className.match(/unit-type-(\w+)/);
      if (classMatch && !columns[classMatch[1]]) {
        columns[classMatch[1]] = index;
      }
    });

    return columns;
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
        Store.setCache('command_data', commands, CACHE_TTL);
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
  // CALCULATIONS
  // ============================================================

  /**
   * Calculate aggregate totals for all troop types.
   * @param {VillageTroops[]} data - Troop data array.
   * @returns {Object.<string, number>} Total counts per unit type.
   */
  function calculateTroopTotals(data) {
    var totals = {};
    var units = getActiveUnits();
    var i, j;

    for (i = 0; i < units.length; i++) {
      totals[units[i]] = 0;
    }
    totals.total = 0;

    for (i = 0; i < data.length; i++) {
      for (j = 0; j < units.length; j++) {
        var u = units[j];
        totals[u] += data[i].units[u] || 0;
      }
      totals.total += data[i].total || 0;
    }

    return totals;
  }

  /**
   * Calculate army summary statistics.
   * @param {VillageTroops[]} data - Troop data array.
   * @returns {Object} Summary: offPower, defPower, nukeCount, nobleTrains.
   */
  function calculateArmySummary(data) {
    var summary = {
      offPower: 0,
      defPower: 0,
      nukeCount: 0,
      nobleTrains: 0
    };

    var offUnits = OFFENSIVE_UNITS.concat(settings.includeArchers ? OFFENSIVE_ARCHER_UNITS : []);
    var defUnits = DEFENSIVE_UNITS.concat(settings.includeArchers ? DEFENSIVE_ARCHER_UNITS : []);

    for (var i = 0; i < data.length; i++) {
      var v = data[i];
      var j;

      // Calculate offensive power
      for (j = 0; j < offUnits.length; j++) {
        var offUnit = offUnits[j];
        summary.offPower += (v.units[offUnit] || 0) * (ATTACK_VALUES[offUnit] || 0);
      }

      // Calculate defensive power
      for (j = 0; j < defUnits.length; j++) {
        var defUnit = defUnits[j];
        summary.defPower += (v.units[defUnit] || 0) * (DEF_VALUES[defUnit] || 0);
      }

      // Count nukes
      if (v.isNuke) {
        summary.nukeCount++;
      }

      // Count noble trains
      if (v.hasNoble) {
        summary.nobleTrains++;
      }
    }

    return summary;
  }

  // ============================================================
  // SORTING
  // ============================================================

  /** @type {string} Current troop sort column */
  var troopSortColumn = 'name';

  /** @type {boolean} Current troop sort direction */
  var troopSortAsc = true;

  /**
   * Sort troop data by column.
   * @param {VillageTroops[]} data - Data to sort.
   * @param {string} column - Column key (unit type or 'name', 'total').
   * @param {boolean} asc - Ascending if true.
   * @returns {VillageTroops[]} Sorted copy.
   */
  function sortTroopData(data, column, asc) {
    var sorted = data.slice();
    sorted.sort(function(a, b) {
      var va, vb;
      if (column === 'name') {
        va = a.name.toLowerCase();
        vb = b.name.toLowerCase();
        return asc ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      if (column === 'total') {
        va = a.total || 0;
        vb = b.total || 0;
      } else {
        va = a.units[column] || 0;
        vb = b.units[column] || 0;
      }
      return asc ? (va - vb) : (vb - va);
    });
    return sorted;
  }

  /**
   * Handle sort click for troop table.
   * @param {string} column - Column key.
   */
  function handleTroopSort(column) {
    if (troopSortColumn === column) {
      troopSortAsc = !troopSortAsc;
    } else {
      troopSortColumn = column;
      troopSortAsc = true;
    }
  }

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
   * Get short display name for a unit type.
   * @param {string} unit - Unit type.
   * @returns {string} Short abbreviation.
   */
  function unitShortName(unit) {
    var names = {
      spear: 'Spear', sword: 'Sword', axe: 'Axe', archer: 'Arch',
      spy: 'Spy', light: 'LC', marcher: 'MA', heavy: 'HC',
      ram: 'Ram', catapult: 'Cat', knight: 'Pala', snob: 'Noble'
    };
    return names[unit] || unit;
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
  // UI — TROOPS TAB
  // ============================================================

  /**
   * Render the troops tab content.
   * @param {jQuery} $panel - Tab panel jQuery element.
   * @param {VillageTroops[]} data - Troop data.
   */
  function renderTroops($panel, data) {
    $panel.empty();

    // Build view selector dropdown HTML (reused in both states)
    var viewSelectHtml = '<label style="font-size:10px;margin-left:8px;">View: ' +
      '<select id="' + ID_PREFIX + 'view-type" style="font-size:10px;">';
    for (var vi = 0; vi < VIEW_TYPES.length; vi++) {
      viewSelectHtml += '<option value="' + VIEW_TYPES[vi].value + '"' +
        (currentViewType === VIEW_TYPES[vi].value ? ' selected' : '') + '>' +
        VIEW_TYPES[vi].label + '</option>';
    }
    viewSelectHtml += '</select></label>';

    // Build group selector dropdown HTML
    var groupSelectHtml = '<label style="font-size:10px;margin-left:6px;">Group: ' +
      '<select id="' + ID_PREFIX + 'group-id" style="font-size:10px;">';
    for (var gi = 0; gi < availableGroups.length; gi++) {
      groupSelectHtml += '<option value="' + availableGroups[gi].id + '"' +
        (currentGroupId === availableGroups[gi].id ? ' selected' : '') + '>' +
        escapeHtml(availableGroups[gi].name) + '</option>';
    }
    groupSelectHtml += '</select></label>';

    /**
     * Bind the view selector change event.
     * Clears cache for the old view type, updates currentViewType, persists, and re-fetches.
     * @param {jQuery} $container - Panel containing the selector.
     * @private
     */
    function bindViewSelector($container) {
      $container.on('change', '#' + ID_PREFIX + 'view-type', function() {
        currentViewType = $(this).val();
        Store.set('view_type', currentViewType);
        troopData = [];
        fetchTroopDataWithUI($container, true);
      });
      $container.on('change', '#' + ID_PREFIX + 'group-id', function() {
        currentGroupId = $(this).val();
        Store.set('group_id', currentGroupId);
        troopData = [];
        fetchTroopDataWithUI($container, true);
      });
    }

    if (!data || data.length === 0) {
      $panel.html(
        '<div style="padding:8px;">' +
        '<button class="btn" id="' + ID_PREFIX + 'fetch-troops" style="margin-bottom:8px;">Fetch Troops</button> ' +
        '<button class="btn" id="' + ID_PREFIX + 'refresh-troops" style="margin-bottom:8px;">Force Refresh</button>' +
        viewSelectHtml + groupSelectHtml +
        '<p style="color:#7a6840;">No troop data. Click "Fetch Troops" to load.</p>' +
        '</div>'
      );

      // Bind fetch buttons
      $panel.on('click', '#' + ID_PREFIX + 'fetch-troops', function() {
        fetchTroopDataWithUI($panel, false);
      });
      $panel.on('click', '#' + ID_PREFIX + 'refresh-troops', function() {
        fetchTroopDataWithUI($panel, true);
      });
      bindViewSelector($panel);
      return;
    }

    var units = getActiveUnits();
    var sorted = sortTroopData(data, troopSortColumn, troopSortAsc);
    var totals = calculateTroopTotals(data);
    var summary = calculateArmySummary(data);

    // Sort arrow helper
    var arrow = function(col) {
      if (troopSortColumn === col) return troopSortAsc ? ' \u25B2' : ' \u25BC';
      return '';
    };

    // Toolbar
    var html = '<div style="margin-bottom:4px;">' +
      '<button class="btn" id="' + ID_PREFIX + 'fetch-troops" style="font-size:9px;">Refresh</button> ' +
      viewSelectHtml + groupSelectHtml + ' ' +
      '<button class="btn" id="' + ID_PREFIX + 'export-bbcode" style="font-size:9px;">BBCode</button> ' +
      '<button class="btn" id="' + ID_PREFIX + 'export-csv" style="font-size:9px;">CSV</button>' +
      '</div>';

    // Army summary box
    html += '<div style="margin-bottom:6px;padding:4px;background:#f0e0b0;border:1px solid #c0a060;border-radius:2px;">' +
      '<b>Army Summary</b> <span style="font-size:9px;color:#7a6840;">(' + escapeHtml(getViewLabel()) +
        (currentGroupId !== '0' ? ' / ' + escapeHtml(getGroupLabel()) : '') + ')</span><br/>' +
      'Offensive Power: <span style="color:#cc0000;font-weight:bold;">' + formatNum(summary.offPower) + '</span> &nbsp;|&nbsp; ' +
      'Defensive Power: <span style="color:#2e7d32;font-weight:bold;">' + formatNum(summary.defPower) + '</span><br/>' +
      'Nukes (' + settings.nukeThreshold + '+ off): <span style="font-weight:bold;">' + summary.nukeCount + '</span> &nbsp;|&nbsp; ' +
      'Noble Trains: <span style="font-weight:bold;' + (summary.nobleTrains > 0 ? 'color:#804000;' : '') + '">' + summary.nobleTrains + '</span>' +
      '</div>';

    // Troop table
    html += '<table class="vis" style="width:100%;table-layout:auto;">' +
      '<thead><tr>' +
      '<th class="' + ID_PREFIX + 'sort" data-col="name" style="cursor:pointer;white-space:nowrap;">Village' + arrow('name') + '</th>';

    for (var h = 0; h < units.length; h++) {
      html += '<th class="' + ID_PREFIX + 'sort" data-col="' + units[h] + '" style="cursor:pointer;text-align:right;white-space:nowrap;font-size:10px;">' +
        unitShortName(units[h]) + arrow(units[h]) + '</th>';
    }

    html += '<th class="' + ID_PREFIX + 'sort" data-col="total" style="cursor:pointer;text-align:right;white-space:nowrap;">Total' + arrow('total') + '</th>' +
      '</tr></thead><tbody>';

    for (var i = 0; i < sorted.length; i++) {
      var v = sorted[i];
      var rowStyle = '';
      if (v.isNuke) rowStyle = 'font-weight:bold;';
      if (v.hasNoble) rowStyle += 'background:#fff0d0;';

      html += '<tr style="' + rowStyle + '">' +
        '<td><a href="/game.php?village=' + v.id + '&screen=overview" target="_blank">' + escapeHtml(v.name) + '</a>' +
          (v.coords ? ' <span style="font-size:9px;color:#888;">(' + v.coords + ')</span>' : '') +
          (v.isNuke ? ' <span style="color:#cc0000;font-size:9px;" title="Nuke village">\u2694</span>' : '') +
          (v.hasNoble ? ' <span style="color:#804000;font-size:9px;" title="Has noble">\u265A</span>' : '') +
        '</td>';

      for (var u = 0; u < units.length; u++) {
        var count = v.units[units[u]] || 0;
        var cellStyle = count > 0 ? '' : 'color:#ccc;';
        html += '<td style="text-align:right;font-size:10px;' + cellStyle + '">' + (count > 0 ? formatNum(count) : '-') + '</td>';
      }

      html += '<td style="text-align:right;font-weight:bold;">' + formatNum(v.total) + '</td>';
      html += '</tr>';
    }

    // Totals row
    html += '</tbody><tfoot><tr style="background:#e8d8a8;font-weight:bold;">' +
      '<td>Total (' + data.length + ' villages)</td>';

    for (var t = 0; t < units.length; t++) {
      html += '<td style="text-align:right;font-size:10px;">' + formatNum(totals[units[t]] || 0) + '</td>';
    }

    html += '<td style="text-align:right;">' + formatNum(totals.total || 0) + '</td>';
    html += '</tr></tfoot></table>';

    $panel.html(html);

    // Bind sort clicks
    $panel.find('.' + ID_PREFIX + 'sort').on('click', function() {
      var col = $(this).data('col');
      handleTroopSort(col);
      renderTroops($panel, data);
    });

    // Bind refresh
    $panel.on('click', '#' + ID_PREFIX + 'fetch-troops', function() {
      fetchTroopDataWithUI($panel, true);
    });

    // Bind exports
    $panel.on('click', '#' + ID_PREFIX + 'export-bbcode', function() {
      exportBBCode(data);
    });
    $panel.on('click', '#' + ID_PREFIX + 'export-csv', function() {
      exportCSV(data);
    });

    // Bind view selector
    bindViewSelector($panel);
  }

  /**
   * Fetch troop data with UI progress feedback.
   * @param {jQuery} $panel - Tab panel.
   * @param {boolean} force - Force refresh (ignore cache).
   */
  function fetchTroopDataWithUI($panel, force) {
    if (force) {
      TWTools.Storage.remove(STORAGE_PREFIX + 'troop_data_' + currentViewType + '_g' + currentGroupId);
      troopData = [];
    }

    $panel.html('<div style="padding:8px;"><p style="color:#7a6840;">Fetching troop data...</p></div>');

    fetchTroopData(function(data) {
      troopData = data;
      renderTroops($panel, data);
      if (data.length > 0) {
        TWTools.UI.toast('Loaded troops from ' + data.length + ' villages', 'success');
      }
    }, function(status) {
      $panel.find('p').text(status);
    });
  }

  // ============================================================
  // UI — COMMANDS TAB
  // ============================================================

  /** @type {string} Current command filter */
  var cmdFilter = 'all';

  /**
   * Render the commands tab content.
   * @param {jQuery} $panel - Tab panel jQuery element.
   * @param {CommandInfo[]} data - Command data.
   */
  function renderCommands($panel, data) {
    $panel.empty();

    // Toolbar with filters
    var html = '<div style="margin-bottom:6px;">' +
      '<button class="btn" id="' + ID_PREFIX + 'fetch-cmds" style="font-size:9px;">Fetch Commands</button> ' +
      '<button class="btn" id="' + ID_PREFIX + 'refresh-cmds" style="font-size:9px;">Force Refresh</button>' +
      '</div>';

    if (!data || data.length === 0) {
      html += '<p style="padding:4px;color:#7a6840;">No command data. Click "Fetch Commands" to load.</p>';
      $panel.html(html);

      $panel.on('click', '#' + ID_PREFIX + 'fetch-cmds', function() {
        fetchCommandDataWithUI($panel, false);
      });
      $panel.on('click', '#' + ID_PREFIX + 'refresh-cmds', function() {
        fetchCommandDataWithUI($panel, true);
      });
      return;
    }

    // Filter buttons
    html += '<div style="margin-bottom:4px;">' +
      '<b>Filter:</b> ' +
      '<button class="btn ' + ID_PREFIX + 'cmd-filter' + (cmdFilter === 'all' ? ' selected' : '') + '" data-filter="all" style="font-size:9px;">All (' + data.length + ')</button> ';

    var attackCount = 0, supportCount = 0, returnCount = 0;
    for (var c = 0; c < data.length; c++) {
      if (data[c].type === CMD_TYPE.ATTACK) attackCount++;
      else if (data[c].type === CMD_TYPE.SUPPORT) supportCount++;
      else if (data[c].type === CMD_TYPE.RETURN) returnCount++;
    }

    html += '<button class="btn ' + ID_PREFIX + 'cmd-filter' + (cmdFilter === CMD_TYPE.ATTACK ? ' selected' : '') +
      '" data-filter="' + CMD_TYPE.ATTACK + '" style="font-size:9px;color:#cc0000;">Attacks (' + attackCount + ')</button> ';
    html += '<button class="btn ' + ID_PREFIX + 'cmd-filter' + (cmdFilter === CMD_TYPE.SUPPORT ? ' selected' : '') +
      '" data-filter="' + CMD_TYPE.SUPPORT + '" style="font-size:9px;color:#2e7d32;">Support (' + supportCount + ')</button> ';
    html += '<button class="btn ' + ID_PREFIX + 'cmd-filter' + (cmdFilter === CMD_TYPE.RETURN ? ' selected' : '') +
      '" data-filter="' + CMD_TYPE.RETURN + '" style="font-size:9px;color:#0066cc;">Return (' + returnCount + ')</button>';
    html += '</div>';

    // Filter data
    var filtered = data;
    if (cmdFilter !== 'all') {
      filtered = [];
      for (var f = 0; f < data.length; f++) {
        if (data[f].type === cmdFilter) {
          filtered.push(data[f]);
        }
      }
    }

    // Commands table
    html += '<table class="vis" style="width:100%;">' +
      '<thead><tr>' +
      '<th style="width:60px;">Type</th>' +
      '<th>Source</th>' +
      '<th>Target</th>' +
      '<th>Arrival</th>' +
      '<th>Units</th>' +
      '</tr></thead><tbody>';

    if (filtered.length === 0) {
      html += '<tr><td colspan="5" style="text-align:center;color:#888;">No commands matching filter.</td></tr>';
    }

    for (var i = 0; i < filtered.length; i++) {
      var cmd = filtered[i];
      html += '<tr>' +
        '<td style="color:' + cmdTypeColor(cmd.type) + ';font-weight:bold;font-size:10px;">' + cmdTypeName(cmd.type) + '</td>' +
        '<td style="font-size:10px;">' + escapeHtml(cmd.sourceName) +
          (cmd.sourceCoords ? ' <span style="color:#888;">(' + cmd.sourceCoords + ')</span>' : '') + '</td>' +
        '<td style="font-size:10px;">' + escapeHtml(cmd.targetName) +
          (cmd.targetCoords ? ' <span style="color:#888;">(' + cmd.targetCoords + ')</span>' : '') + '</td>' +
        '<td style="font-size:10px;font-family:monospace;">' + escapeHtml(cmd.arrival) + '</td>' +
        '<td style="font-size:9px;color:#555;">' + escapeHtml(cmd.units || '-') + '</td>' +
        '</tr>';
    }

    html += '</tbody></table>';

    // Support summary: aggregate incoming support by source player
    if (supportCount > 0) {
      html += '<div style="margin-top:8px;padding:4px;background:#f0e0b0;border:1px solid #c0a060;border-radius:2px;">' +
        '<b>Support Overview</b> — ' + supportCount + ' support commands' +
        '</div>';
    }

    $panel.html(html);

    // Bind filter clicks
    $panel.find('.' + ID_PREFIX + 'cmd-filter').on('click', function() {
      cmdFilter = $(this).data('filter');
      renderCommands($panel, data);
    });

    // Bind fetch/refresh
    $panel.on('click', '#' + ID_PREFIX + 'fetch-cmds', function() {
      fetchCommandDataWithUI($panel, false);
    });
    $panel.on('click', '#' + ID_PREFIX + 'refresh-cmds', function() {
      fetchCommandDataWithUI($panel, true);
    });
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
  // UI — SETTINGS TAB
  // ============================================================

  /**
   * Render the settings tab content.
   * @param {jQuery} $panel - Tab panel jQuery element.
   */
  function renderSettings($panel) {
    $panel.empty();

    var html = '<div style="padding:4px;">' +
      '<h4 style="margin:0 0 8px;color:#3e2e14;">Settings</h4>' +

      // Include archers
      '<div style="margin-bottom:6px;">' +
        '<label><input type="checkbox" id="' + ID_PREFIX + 'set-archers"' +
          (settings.includeArchers ? ' checked' : '') + '> Include archer units (archer, mounted archer)</label>' +
      '</div>' +

      // Nuke threshold
      '<div style="margin-bottom:6px;">' +
        '<label>Nuke threshold (min off troops): ' +
        '<input type="number" id="' + ID_PREFIX + 'set-nuke" value="' + settings.nukeThreshold +
          '" style="width:60px;font-size:10px;" min="1000" max="50000" step="500">' +
        '</label>' +
      '</div>' +

      // Export format
      '<div style="margin-bottom:6px;">' +
        '<label>Export format: ' +
        '<select id="' + ID_PREFIX + 'set-export" style="font-size:10px;">' +
        '<option value="bbcode"' + (settings.exportFormat === 'bbcode' ? ' selected' : '') + '>BBCode</option>' +
        '<option value="csv"' + (settings.exportFormat === 'csv' ? ' selected' : '') + '>CSV</option>' +
        '</select></label>' +
      '</div>' +

      // Auto-refresh
      '<div style="margin-bottom:6px;">' +
        '<label>Auto-refresh interval (seconds, 0=off): ' +
        '<input type="number" id="' + ID_PREFIX + 'set-refresh" value="' + settings.autoRefreshInterval +
          '" style="width:60px;font-size:10px;" min="0" max="3600" step="30">' +
        '</label>' +
      '</div>' +

      // Actions
      '<div style="margin-top:12px;">' +
        '<button class="btn" id="' + ID_PREFIX + 'save-settings" style="font-weight:bold;">Save Settings</button> ' +
        '<button class="btn" id="' + ID_PREFIX + 'clear-cache" style="font-size:9px;">Clear Cache</button>' +
      '</div>' +

      // Info
      '<div style="margin-top:12px;padding:4px;background:#f0e0b0;border:1px solid #c0a060;border-radius:2px;font-size:9px;color:#7a6840;">' +
        'Troop Overview v' + VERSION + '<br/>' +
        'Data is cached for 5 minutes.<br/>' +
        'Use "Force Refresh" buttons to fetch fresh data.' +
      '</div>' +

      '</div>';

    $panel.html(html);

    // Bind save
    $panel.on('click', '#' + ID_PREFIX + 'save-settings', function() {
      settings.includeArchers = $panel.find('#' + ID_PREFIX + 'set-archers').is(':checked');
      settings.nukeThreshold = parseInt($panel.find('#' + ID_PREFIX + 'set-nuke').val(), 10) || 5000;
      settings.exportFormat = $panel.find('#' + ID_PREFIX + 'set-export').val();
      settings.autoRefreshInterval = parseInt($panel.find('#' + ID_PREFIX + 'set-refresh').val(), 10) || 0;
      saveSettings();

      // Recalculate nuke status for existing data
      recalculateNukeStatus();

      TWTools.UI.toast('Settings saved', 'success');
    });

    // Bind clear cache
    $panel.on('click', '#' + ID_PREFIX + 'clear-cache', function() {
      // Clear all view type caches
      for (var ci = 0; ci < VIEW_TYPES.length; ci++) {
        TWTools.Storage.remove(STORAGE_PREFIX + 'troop_data_' + VIEW_TYPES[ci].value);
      }
      TWTools.Storage.remove(STORAGE_PREFIX + 'command_data');
      troopData = [];
      commandData = [];
      TWTools.UI.toast('Cache cleared', 'success');
    });
  }

  /**
   * Recalculate isNuke status for all villages based on current settings.
   */
  function recalculateNukeStatus() {
    for (var i = 0; i < troopData.length; i++) {
      var v = troopData[i];
      var offCount = (v.units.axe || 0) + (v.units.light || 0);
      if (settings.includeArchers) {
        offCount += (v.units.marcher || 0);
      }
      v.isNuke = offCount >= settings.nukeThreshold;
    }
  }

  // ============================================================
  // EXPORT FUNCTIONS
  // ============================================================

  /**
   * Export troop data as BBCode and copy to clipboard.
   * @param {VillageTroops[]} data - Troop data.
   */
  function exportBBCode(data) {
    if (!data || data.length === 0) {
      TWTools.UI.toast('No data to export', 'warning');
      return;
    }

    var units = getActiveUnits();
    var totals = calculateTroopTotals(data);
    var summary = calculateArmySummary(data);

    var bb = '[b]Troop Overview[/b] (' + data.length + ' villages, ' + getViewLabel() + ')\n\n';

    // Summary
    bb += '[b]Army Summary:[/b]\n';
    bb += 'Offensive Power: ' + formatNum(summary.offPower) + '\n';
    bb += 'Defensive Power: ' + formatNum(summary.defPower) + '\n';
    bb += 'Nukes: ' + summary.nukeCount + ' | Noble Trains: ' + summary.nobleTrains + '\n\n';

    // Table — TW BBCode format:
    //   [**]Header1[||]Header2[||]Header3[/**]
    //   [*]Cell1[|]Cell2[|]Cell3[/*]
    bb += '[table]\n';

    // Header row
    var headerCells = ['Village'];
    for (var h = 0; h < units.length; h++) {
      headerCells.push(unitShortName(units[h]));
    }
    headerCells.push('Total');
    bb += '[**]' + headerCells.join('[||]') + '[/**]\n';

    // Data rows — replace 0 with "-" for readability
    for (var i = 0; i < data.length; i++) {
      var v = data[i];
      var rowCells = [v.name + ' (' + v.coords + ')'];
      for (var u = 0; u < units.length; u++) {
        var count = v.units[units[u]] || 0;
        rowCells.push(count > 0 ? String(count) : '-');
      }
      rowCells.push(String(v.total));
      bb += '[*]' + rowCells.join('[|]') + '[/*]\n';
    }

    // Totals row
    var totalCells = ['[b]TOTAL[/b]'];
    for (var t = 0; t < units.length; t++) {
      totalCells.push('[b]' + formatNum(totals[units[t]] || 0) + '[/b]');
    }
    totalCells.push('[b]' + formatNum(totals.total || 0) + '[/b]');
    bb += '[*]' + totalCells.join('[|]') + '[/*]\n';

    bb += '[/table]';

    copyToClipboard(bb);
    TWTools.UI.toast('BBCode copied to clipboard', 'success');
  }

  /**
   * Export troop data as CSV and copy to clipboard.
   * @param {VillageTroops[]} data - Troop data.
   */
  function exportCSV(data) {
    if (!data || data.length === 0) {
      TWTools.UI.toast('No data to export', 'warning');
      return;
    }

    var units = getActiveUnits();
    var totals = calculateTroopTotals(data);

    // Header
    var csv = 'Village,Coords';
    for (var h = 0; h < units.length; h++) {
      csv += ',' + unitShortName(units[h]);
    }
    csv += ',Total\n';

    // Data rows
    for (var i = 0; i < data.length; i++) {
      var v = data[i];
      csv += '"' + v.name.replace(/"/g, '""') + '",' + v.coords;
      for (var u = 0; u < units.length; u++) {
        csv += ',' + (v.units[units[u]] || 0);
      }
      csv += ',' + v.total + '\n';
    }

    // Totals
    csv += 'TOTAL,';
    for (var t = 0; t < units.length; t++) {
      csv += ',' + (totals[units[t]] || 0);
    }
    csv += ',' + (totals.total || 0) + '\n';

    copyToClipboard(csv);
    TWTools.UI.toast('CSV copied to clipboard', 'success');
  }

  /**
   * Copy text to clipboard using modern API with fallback.
   * @param {string} text - Text to copy.
   */
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function() {
        fallbackCopyToClipboard(text);
      });
    } else {
      fallbackCopyToClipboard(text);
    }
  }

  /**
   * Fallback clipboard copy using a temporary textarea.
   * @param {string} text - Text to copy.
   */
  function fallbackCopyToClipboard(text) {
    var $textarea = $('<textarea/>')
      .val(text)
      .css({ position: 'fixed', opacity: 0, left: '-9999px' })
      .appendTo('body');

    $textarea[0].select();

    try {
      document.execCommand('copy');
    } catch (e) {
      TWTools.UI.toast('Failed to copy. Please copy manually.', 'error');
    }

    $textarea.remove();
  }

  // ============================================================
  // MAIN CARD INITIALIZATION
  // ============================================================

  /**
   * Initialize the Troop Overview card widget.
   */
  function init() {
    loadSettings();

    // Fetch available village groups in background (populates dropdown)
    TWTools.DataFetcher.fetchGroups(function(groups) {
      availableGroups = groups;
      // Validate saved group ID still exists
      var found = false;
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].id === currentGroupId) { found = true; break; }
      }
      if (!found) currentGroupId = '0';
      // Re-render group dropdown if card is already showing
      var $groupSelect = $('#' + ID_PREFIX + 'group-id');
      if ($groupSelect.length > 0) {
        $groupSelect.empty();
        for (var j = 0; j < availableGroups.length; j++) {
          $groupSelect.append(
            $('<option/>').val(availableGroups[j].id).text(availableGroups[j].name)
          );
        }
        $groupSelect.val(currentGroupId);
      }
    });

    var card = TWTools.UI.createCard({
      id: ID_PREFIX + 'main',
      title: 'Troop Overview',
      version: VERSION,
      width: 750,
      height: 520,
      minWidth: 550,
      minHeight: 300,
      tabs: [
        { id: 'troops', label: 'Troops' },
        { id: 'commands', label: 'Commands' },
        { id: 'settings', label: 'Settings' }
      ],
      onTabChange: function(tabId) {
        if (tabId === 'troops') {
          renderTroops(card.getTabContent('troops'), troopData);
        } else if (tabId === 'commands') {
          renderCommands(card.getTabContent('commands'), commandData);
        } else if (tabId === 'settings') {
          renderSettings(card.getTabContent('settings'));
        }
      },
      onClose: function() {
        if (autoRefreshTimer) {
          clearInterval(autoRefreshTimer);
          autoRefreshTimer = null;
        }
        TWTools.UI.toast('Troop Overview closed', 'success');
      }
    });

    // Initial render — troops tab
    var $troopsPanel = card.getTabContent('troops');

    // Try to load cached data for current view type
    var cachedTroops = Store.getCache('troop_data_' + currentViewType + '_g' + currentGroupId);
    if (cachedTroops && cachedTroops.length > 0) {
      troopData = cachedTroops;
      // Recalculate nuke status with current settings
      recalculateNukeStatus();
      renderTroops($troopsPanel, troopData);
      card.setStatus(troopData.length + ' villages loaded from cache.');
    } else {
      renderTroops($troopsPanel, []);
      card.setStatus('Ready. Click "Fetch Troops" to load.');
    }

    // Settings tab — render immediately for lazy access
    renderSettings(card.getTabContent('settings'));

    // Set up auto-refresh if configured
    setupAutoRefresh(card);
  }

  /** @type {?number} Auto-refresh timer ID */
  var autoRefreshTimer = null;

  /**
   * Set up auto-refresh interval based on settings.
   * @param {Object} card - Card controller.
   */
  function setupAutoRefresh(card) {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }

    if (settings.autoRefreshInterval > 0) {
      autoRefreshTimer = setInterval(function() {
        // Clear caches and re-fetch
        TWTools.Storage.remove(STORAGE_PREFIX + 'troop_data_' + currentViewType);
        TWTools.Storage.remove(STORAGE_PREFIX + 'command_data');

        fetchTroopData(function(data) {
          troopData = data;
          recalculateNukeStatus();
          // Re-render if troops tab is visible
          var $panel = card.getTabContent('troops');
          if ($panel.is(':visible')) {
            renderTroops($panel, data);
          }
          card.setStatus('Auto-refreshed: ' + data.length + ' villages.');
        }, null);

        fetchCommandData(function(data) {
          commandData = data;
          var $panel = card.getTabContent('commands');
          if ($panel.is(':visible')) {
            renderCommands($panel, data);
          }
        }, null);

      }, settings.autoRefreshInterval * 1000);
    }
  }

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
