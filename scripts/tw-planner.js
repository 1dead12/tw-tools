;(function(window, $) {
  'use strict';

  // ============================================================
  // TW ATTACK PLANNER v2.0.0
  // ============================================================
  // Coordinate timed attacks from multiple villages to single or
  // multiple targets. Calculates launch times, live countdowns,
  // audio alerts, and generates rally point links.
  //
  // REQUIRES: window.TWTools (tw-core.js + tw-ui.js)
  // NEVER auto-sends attacks — only generates links / pre-fills.
  // ============================================================

  var TWTools = window.TWTools;
  if (!TWTools || !TWTools.UI) {
    throw new Error('tw-planner.js requires tw-core.js and tw-ui.js');
  }

  var VERSION = '2.0.0';
  var ID_PREFIX = 'twp-';
  var STORAGE_PREFIX = 'twp_';

  // ============================================================
  // UNIT DISPLAY NAMES
  // ============================================================

  var UNIT_NAMES = {
    spear: 'Spear',
    sword: 'Sword',
    axe:   'Axe',
    archer: 'Archer',
    spy:   'Spy',
    light: 'Light Cavalry',
    marcher: 'Mounted Archer',
    heavy: 'Heavy Cavalry',
    ram:   'Ram',
    catapult: 'Catapult',
    knight: 'Paladin',
    snob:  'Nobleman'
  };

  // ============================================================
  // AUDIO ALERT
  // ============================================================

  /**
   * Simple beep tone encoded as base64 WAV.
   * 0.3s 880Hz sine wave at 8-bit 8000Hz sample rate.
   * @type {string}
   */
  var BEEP_WAV = (function() {
    // Generate a minimal WAV in-memory
    var sampleRate = 8000;
    var duration = 0.3;
    var freq = 880;
    var numSamples = Math.floor(sampleRate * duration);
    var dataSize = numSamples;
    var fileSize = 44 + dataSize;

    var buf = new ArrayBuffer(fileSize);
    var view = new DataView(buf);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, fileSize - 8, true);
    writeString(view, 8, 'WAVE');

    // fmt chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);         // chunk size
    view.setUint16(20, 1, true);          // PCM
    view.setUint16(22, 1, true);          // mono
    view.setUint32(24, sampleRate, true); // sample rate
    view.setUint32(28, sampleRate, true); // byte rate
    view.setUint16(32, 1, true);          // block align
    view.setUint16(34, 8, true);          // bits per sample

    // data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    for (var i = 0; i < numSamples; i++) {
      var t = i / sampleRate;
      var sample = Math.sin(2 * Math.PI * freq * t);
      // Fade out the last 30%
      var fadeStart = numSamples * 0.7;
      if (i > fadeStart) {
        sample *= 1 - ((i - fadeStart) / (numSamples - fadeStart));
      }
      view.setUint8(44 + i, Math.floor(128 + sample * 100));
    }

    // Convert to base64
    var bytes = new Uint8Array(buf);
    var binary = '';
    for (var j = 0; j < bytes.length; j++) {
      binary += String.fromCharCode(bytes[j]);
    }
    return 'data:audio/wav;base64,' + btoa(binary);

    function writeString(view, offset, str) {
      for (var k = 0; k < str.length; k++) {
        view.setUint8(offset + k, str.charCodeAt(k));
      }
    }
  })();

  /**
   * Play the alert beep sound.
   */
  function playBeep() {
    try {
      var audio = new Audio(BEEP_WAV);
      audio.volume = 0.6;
      audio.play();
    } catch (e) {
      // Audio not available — silent fail
    }
  }

  /**
   * Play beep sound repeated N times with a short gap.
   * Uses Settings.alertRepeat for the count.
   */
  function playBeepRepeated() {
    var count = Math.max(1, Math.min(10, Settings.alertRepeat || 3));
    var played = 0;
    function next() {
      if (played >= count) return;
      playBeep();
      played++;
      if (played < count) {
        setTimeout(next, 700); // 700ms gap between beeps
      }
    }
    next();
  }

  // ============================================================
  // SETTINGS
  // ============================================================

  var Settings = {
    /** @type {string} Default slowest unit type. */
    defaultUnit: 'ram',

    /** @type {number} Default spy count for fakes. */
    fakeSpyCount: 1,

    /** @type {number} Default catapult count for fakes. */
    fakeCatCount: 1,

    /** @type {number} Seconds before launch to play alert sound. */
    alertSeconds: 30,

    /** @type {boolean} Whether sound alerts are enabled. */
    soundEnabled: true,

    /** @type {number} How many times the beep repeats on alert (1-10). */
    alertRepeat: 3,

    /** @type {boolean} Auto-sort attack list by launch time. */
    autoSort: true,

    /** @type {number} Max distance filter for fakes (fields). */
    fakeMaxDistance: 50,

    /** @type {number} Default village group ID (0 = all). */
    defaultGroupId: 0,

    /**
     * Load settings from localStorage.
     */
    load: function() {
      var saved = TWTools.Storage.get(STORAGE_PREFIX + 'settings');
      if (saved) {
        this.defaultUnit = saved.defaultUnit || 'ram';
        this.fakeSpyCount = saved.fakeSpyCount || 1;
        this.fakeCatCount = saved.fakeCatCount || 1;
        this.alertSeconds = saved.alertSeconds || 30;
        this.soundEnabled = saved.soundEnabled !== false;
        this.alertRepeat = saved.alertRepeat || 3;
        this.autoSort = saved.autoSort !== false;
        this.fakeMaxDistance = saved.fakeMaxDistance || 50;
        this.defaultGroupId = saved.defaultGroupId || 0;
      }
    },

    /**
     * Save settings to localStorage.
     */
    save: function() {
      TWTools.Storage.set(STORAGE_PREFIX + 'settings', {
        defaultUnit: this.defaultUnit,
        fakeSpyCount: this.fakeSpyCount,
        fakeCatCount: this.fakeCatCount,
        alertSeconds: this.alertSeconds,
        soundEnabled: this.soundEnabled,
        alertRepeat: this.alertRepeat,
        autoSort: this.autoSort,
        fakeMaxDistance: this.fakeMaxDistance,
        defaultGroupId: this.defaultGroupId
      });
    },

    /**
     * Reset all settings to defaults.
     */
    reset: function() {
      this.defaultUnit = 'ram';
      this.fakeSpyCount = 1;
      this.fakeCatCount = 1;
      this.alertSeconds = 30;
      this.soundEnabled = true;
      this.autoSort = true;
      this.fakeMaxDistance = 50;
      this.defaultGroupId = 0;
      this.save();
    }
  };

  // ============================================================
  // STATE
  // ============================================================

  /** @type {Array} Player village list. */
  var playerVillages = [];

  /** @type {Object} World config (speed, unitSpeed). */
  var worldConfig = null;

  /** @type {Object} Unit info map. */
  var unitInfo = null;

  /**
   * Attack plan entry.
   * @typedef {Object} AttackPlan
   * @property {string} id - Unique plan ID.
   * @property {string} targetCoords - Target coordinate string "x|y".
   * @property {number} landingTimeMs - Landing time in ms since midnight.
   * @property {boolean} landingTomorrow - Whether landing is tomorrow.
   * @property {Array.<AttackRow>} attacks - Individual attack rows.
   */

  /**
   * Single attack row within a plan.
   * @typedef {Object} AttackRow
   * @property {Object} source - Source village {id, name, x, y, points}.
   * @property {string} unitType - Slowest unit type.
   * @property {number} distance - Distance in fields.
   * @property {number} travelTimeMs - Travel time in ms.
   * @property {number} launchTimeMs - Launch time in ms since midnight.
   * @property {boolean} launchTomorrow - Whether launch is on a different day.
   * @property {boolean} alerted - Whether audio alert was already played.
   */

  /** @type {Array.<AttackPlan>} All attack plans. */
  var plans = [];

  /** @type {number} Counter for generating unique plan IDs. */
  var planCounter = 0;

  /**
   * Fake plan entry.
   * @typedef {Object} FakeEntry
   * @property {string} targetCoords
   * @property {Object} source - Source village.
   * @property {number} distance
   * @property {number} travelTimeMs
   * @property {number} launchTimeMs
   * @property {string} sendLink
   */

  /** @type {Array.<FakeEntry>} Current fake plan list. */
  var fakeEntries = [];

  /** @type {Object.<number, {total: number, knight: number}>} Troop data per village ID. */
  var villageTroops = {};

  /** @type {Array.<{id: number, name: string}>} Village groups from TW. */
  var villageGroups = [];

  /** @type {Object.<number, Array.<number>>} Map of group ID -> village IDs. */
  var groupVillages = {};

  /** @type {Object.<number, boolean>} Tracks which groups have been fetched. */
  var groupsFetched = {};

  /** @type {?Object} Card controller reference. */
  var card = null;

  /** @type {?number} Main update interval ID. */
  var updateInterval = null;

  // ============================================================
  // INITIALIZATION
  // ============================================================

  /**
   * Initialize the Attack Planner.
   * Loads game data, creates the UI card, and starts live updates.
   */
  function init() {
    // Initialize TimeSync for accurate countdowns
    TWTools.TimeSync.init();

    Settings.load();

    // Load saved plans from storage
    var savedPlans = TWTools.Storage.get(STORAGE_PREFIX + 'plans');
    if (savedPlans && Array.isArray(savedPlans)) {
      plans = savedPlans;
      planCounter = plans.length;
    }

    // Fetch world config and unit info, then create UI
    TWTools.DataFetcher.fetchWorldConfig(function(config) {
      worldConfig = config;
      TWTools.DataFetcher.fetchUnitInfo(function(units) {
        unitInfo = units;
        TWTools.DataFetcher.fetchPlayerVillages(function(villages) {
          playerVillages = villages;
          // Sort villages alphabetically by name
          playerVillages.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
          });
          loadVillageGroups();
          createUI();
          startUpdates();
          TWTools.UI.toast('Attack Planner loaded (' + playerVillages.length + ' villages)', 'success');
        });
      });
    });
  }

  // ============================================================
  // UI CREATION
  // ============================================================

  /**
   * Create the main planner UI card with 3 tabs.
   */
  function createUI() {
    card = TWTools.UI.createCard({
      id: ID_PREFIX + 'main',
      title: 'Attack Planner',
      version: VERSION,
      tabs: [
        { id: 'plan', label: 'Plan' },
        { id: 'fakes', label: 'Fakes' },
        { id: 'settings', label: 'Settings' }
      ],
      width: 720,
      height: 600,
      minWidth: 550,
      minHeight: 400,
      onClose: function() {
        destroy();
      }
    });

    buildPlanTab();
    buildFakesTab();
    buildSettingsTab();

    card.setStatus('Villages: ' + playerVillages.length + ' | Ready');
  }

  // ============================================================
  // VILLAGE GROUPS
  // ============================================================

  /**
   * Load village groups from TW game_data or DOM.
   */
  function loadVillageGroups() {
    villageGroups = [];
    try {
      if (typeof game_data !== 'undefined' && game_data.groups) {
        var groups = game_data.groups;
        for (var gid in groups) {
          if (groups.hasOwnProperty(gid)) {
            var name = typeof groups[gid] === 'string' ? groups[gid] :
              (groups[gid].name || 'Group ' + gid);
            villageGroups.push({ id: parseInt(gid, 10), name: name });
          }
        }
      }
    } catch (e) {}

    // Fallback: try DOM group selector
    if (villageGroups.length === 0) {
      var $select = $('#group_id, select[name="group_id"]');
      if ($select.length > 0) {
        $select.find('option').each(function() {
          var val = parseInt($(this).val(), 10);
          if (val > 0) {
            villageGroups.push({ id: val, name: $(this).text().trim() });
          }
        });
      }
    }

    // Sort groups alphabetically
    villageGroups.sort(function(a, b) {
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Fetch village IDs belonging to a group via overview page.
   * @param {number} groupId - Group ID to fetch.
   * @param {function} callback - Called when done.
   */
  function fetchGroupVillages(groupId, callback) {
    if (groupsFetched[groupId]) {
      callback(groupVillages[groupId] || []);
      return;
    }

    // Check localStorage cache first
    var cacheKey = STORAGE_PREFIX + 'group_' + groupId;
    var cached = TWTools.Storage.get(cacheKey);
    if (cached) {
      groupVillages[groupId] = cached;
      groupsFetched[groupId] = true;
      callback(cached);
      return;
    }

    $.ajax({
      url: '/game.php?screen=overview_villages&mode=combined&group=' + groupId + '&page=-1',
      dataType: 'html',
      success: function(html) {
        var ids = [];
        var $doc = $('<div/>').html(html);
        $doc.find('a[href*="village="]').each(function() {
          var href = $(this).attr('href') || '';
          var match = href.match(/village=(\d+)/);
          if (match) {
            var vid = parseInt(match[1], 10);
            if (ids.indexOf(vid) === -1) {
              ids.push(vid);
            }
          }
        });
        groupVillages[groupId] = ids;
        groupsFetched[groupId] = true;
        TWTools.Storage.set(cacheKey, ids, 600000); // 10 min cache
        callback(ids);
      },
      error: function() {
        groupVillages[groupId] = [];
        groupsFetched[groupId] = true;
        callback([]);
      }
    });
  }

  // ============================================================
  // TROOP DATA
  // ============================================================

  /** @type {boolean} Whether troop fetch is in progress. */
  var troopFetchInProgress = false;

  /**
   * Fetch troop overview data from the combined overview page.
   * Populates villageTroops map with {total, knight} per village ID.
   * @param {function} callback - Called when done.
   */
  function fetchTroopOverview(callback) {
    if (troopFetchInProgress) {
      TWTools.UI.toast('Already fetching army data...', 'warning');
      return;
    }

    // Check cache
    var cached = TWTools.Storage.get(STORAGE_PREFIX + 'troop_data');
    if (cached) {
      villageTroops = cached;
      callback();
      return;
    }

    troopFetchInProgress = true;
    card.setStatus('Fetching army data...');
    var allData = {};
    var page = 0;

    function fetchPage() {
      var url = '/game.php?screen=overview_villages&mode=combined&type=own_home&page=' + page;
      $.ajax({
        url: url,
        dataType: 'html',
        timeout: 15000,
        success: function(html) {
          var result = parseTroopPage(html);
          for (var vid in result.troops) {
            if (result.troops.hasOwnProperty(vid)) {
              allData[vid] = result.troops[vid];
            }
          }
          card.setStatus('Army data: page ' + (page + 1) + ' (' + Object.keys(allData).length + ' villages)...');

          if (result.hasNextPage) {
            page++;
            setTimeout(fetchPage, 200);
          } else {
            troopFetchInProgress = false;
            villageTroops = allData;
            TWTools.Storage.set(STORAGE_PREFIX + 'troop_data', allData, 300000); // 5 min cache
            card.setStatus('Villages: ' + playerVillages.length + ' | Army data loaded');
            callback();
          }
        },
        error: function() {
          troopFetchInProgress = false;
          card.setStatus('Army data fetch failed');
          callback();
        }
      });
    }

    fetchPage();
  }

  /**
   * Parse a combined overview page for troop counts.
   * @param {string} html - Raw HTML page.
   * @returns {{troops: Object, hasNextPage: boolean}}
   */
  function parseTroopPage(html) {
    var $doc = $('<div/>').html(html);
    var troops = {};

    // Find the unit column headers to map indices
    var unitColumns = {};
    var $table = $doc.find('#combined_table, table.vis.overview_table');
    if ($table.length === 0) {
      $table = $doc.find('table.vis').filter(function() {
        return $(this).find('tr').length > 2;
      }).first();
    }

    if ($table.length > 0) {
      // Parse header images to identify unit columns
      $table.find('thead th, tr:first th, tr:first td').each(function(idx) {
        var $img = $(this).find('img');
        if ($img.length > 0) {
          var src = $img.attr('src') || '';
          var unitNames = Object.keys(UNIT_NAMES);
          for (var u = 0; u < unitNames.length; u++) {
            if (src.indexOf('unit_' + unitNames[u]) !== -1) {
              unitColumns[unitNames[u]] = idx;
              break;
            }
          }
        }
      });

      // Parse data rows
      $table.find('tbody tr, tr').not(':first').each(function() {
        var $row = $(this);
        var $cells = $row.find('td');
        if ($cells.length < 3) return;

        var $link = $row.find('a[href*="village="]').first();
        if ($link.length === 0) return;

        var href = $link.attr('href') || '';
        var vidMatch = href.match(/village=(\d+)/);
        if (!vidMatch) return;

        var vid = parseInt(vidMatch[1], 10);
        var total = 0;
        var knightCount = 0;

        for (var unitType in unitColumns) {
          if (unitColumns.hasOwnProperty(unitType)) {
            var cellText = $cells.eq(unitColumns[unitType]).text();
            var count = parseInt(cellText.replace(/[^0-9]/g, ''), 10) || 0;
            total += count;
            if (unitType === 'knight') {
              knightCount = count;
            }
          }
        }

        troops[vid] = { total: total, knight: knightCount };
      });
    }

    // Check for next page link
    var hasNextPage = $doc.find('a.paged-nav-item[href*="page="]').last().length > 0 &&
      $doc.find('a.paged-nav-item').last().text().trim() === '>>';

    return { troops: troops, hasNextPage: hasNextPage };
  }

  // ============================================================
  // PLAN TAB
  // ============================================================

  /**
   * Build the Plan tab content: target input, source village selection,
   * attack results table, and add-target button.
   */
  function buildPlanTab() {
    var $panel = card.getTabContent('plan');

    var html = [
      // New attack form
      '<div id="' + ID_PREFIX + 'new-attack" style="margin-bottom:8px;">',
      '  <div style="margin-bottom:4px;font-weight:bold;">New Attack Target</div>',
      '  <table class="vis" style="width:100%;margin-bottom:6px;">',
      '    <tr>',
      '      <td style="width:90px;">Target coords:</td>',
      '      <td><input type="text" id="' + ID_PREFIX + 'target-coords" ',
      '        placeholder="500|500" style="width:80px;font-size:11px;" /></td>',
      '      <td style="width:70px;">Landing:</td>',
      '      <td>',
      '        <select id="' + ID_PREFIX + 'land-day" style="font-size:11px;">',
      '          <option value="today">Today</option>',
      '          <option value="tomorrow">Tomorrow</option>',
      '        </select>',
      '        <input type="text" id="' + ID_PREFIX + 'land-time" ',
      '          placeholder="HH:MM:SS:mmm" style="width:110px;font-size:11px;font-family:monospace;" />',
      '      </td>',
      '    </tr>',
      '    <tr>',
      '      <td>Unit type:</td>',
      '      <td colspan="3">',
      '        <select id="' + ID_PREFIX + 'unit-type" style="font-size:11px;">',
      buildUnitOptions(),
      '        </select>',
      '      </td>',
      '    </tr>',
      '  </table>',

      // Source village filter
      '  <div style="margin-bottom:4px;">',
      '    <select id="' + ID_PREFIX + 'village-group" style="font-size:11px;">',
      '      <option value="0">All villages</option>',
      buildGroupOptions(),
      '    </select>',
      '    <input type="text" id="' + ID_PREFIX + 'village-filter" ',
      '      placeholder="Filter villages..." style="width:150px;font-size:11px;margin-left:4px;" />',
      '    <label style="margin-left:8px;font-size:10px;">',
      '      <input type="checkbox" id="' + ID_PREFIX + 'select-all" /> Select all',
      '    </label>',
      '    <button class="btn" id="' + ID_PREFIX + 'load-army" ',
      '      style="font-size:9px;margin-left:8px;" title="Fetch army + paladin data from overview">',
      '      Load Army</button>',
      '  </div>',

      // Source village table
      '  <div style="max-height:150px;overflow-y:auto;border:1px solid #c0a060;margin-bottom:6px;">',
      '    <table class="vis" id="' + ID_PREFIX + 'village-table" style="width:100%;">',
      '      <thead>',
      '        <tr><th></th><th>Village</th><th>Coords</th><th>Points</th><th>Army</th><th>Pala</th></tr>',
      '      </thead>',
      '      <tbody>',
      buildVillageRows(),
      '      </tbody>',
      '    </table>',
      '  </div>',

      '  <button class="btn" id="' + ID_PREFIX + 'add-plan" style="font-size:11px;">',
      '    + Add Attack Plan',
      '  </button>',
      '  <button class="btn" id="' + ID_PREFIX + 'export-bbcode" ',
      '    style="font-size:11px;margin-left:6px;">',
      '    Export BBCode',
      '  </button>',
      '  <button class="btn" id="' + ID_PREFIX + 'clear-plans" ',
      '    style="font-size:11px;margin-left:6px;">',
      '    Clear All',
      '  </button>',
      '</div>',

      // Attack list (all plans combined)
      '<div id="' + ID_PREFIX + 'attack-list">',
      '  <div style="font-weight:bold;margin-bottom:4px;">Attack List</div>',
      '  <div id="' + ID_PREFIX + 'plans-container"></div>',
      '</div>'
    ].join('\n');

    $panel.html(html);

    // Set default unit type and village group
    $('#' + ID_PREFIX + 'unit-type').val(Settings.defaultUnit);
    if (Settings.defaultGroupId > 0) {
      $('#' + ID_PREFIX + 'village-group').val(Settings.defaultGroupId);
    }

    // Bind events
    $('#' + ID_PREFIX + 'add-plan').on('click', onAddPlan);
    $('#' + ID_PREFIX + 'export-bbcode').on('click', onExportBBCode);
    $('#' + ID_PREFIX + 'clear-plans').on('click', onClearPlans);
    $('#' + ID_PREFIX + 'select-all').on('change', onSelectAll);
    $('#' + ID_PREFIX + 'village-filter').on('input', onFilterVillages);
    $('#' + ID_PREFIX + 'village-group').on('change', onGroupChange);
    $('#' + ID_PREFIX + 'load-army').on('click', function() {
      fetchTroopOverview(function() {
        // Rebuild village rows with army data
        var $tbody = $('#' + ID_PREFIX + 'village-table tbody');
        $tbody.html(buildVillageRows());
        applyVillageFilters();
        TWTools.UI.toast('Army data loaded for ' + Object.keys(villageTroops).length + ' villages', 'success');
      });
    });

    // Render saved plans
    renderAllPlans();
  }

  /**
   * Build <option> tags for the unit selector dropdown.
   * @returns {string} HTML option tags.
   */
  function buildUnitOptions() {
    var keys = Object.keys(UNIT_NAMES);
    var opts = '';
    for (var i = 0; i < keys.length; i++) {
      opts += '<option value="' + keys[i] + '">' + UNIT_NAMES[keys[i]] +
        ' (' + TWTools.DataFetcher.getUnitSpeed(keys[i]) + ' min/field)</option>';
    }
    return opts;
  }

  /**
   * Build <option> tags for the village group dropdown.
   * @returns {string} HTML option tags.
   */
  function buildGroupOptions() {
    var opts = '';
    for (var i = 0; i < villageGroups.length; i++) {
      var g = villageGroups[i];
      opts += '<option value="' + g.id + '">' + escapeHtml(g.name) + '</option>';
    }
    return opts;
  }

  /**
   * Build village table rows with checkboxes.
   * @returns {string} HTML table rows.
   */
  function buildVillageRows() {
    var rows = '';
    for (var i = 0; i < playerVillages.length; i++) {
      var v = playerVillages[i];
      var coords = v.x + '|' + v.y;
      var troopInfo = villageTroops[v.id];
      var armyText = troopInfo ? String(troopInfo.total) : '-';
      var palaText = troopInfo ? (troopInfo.knight > 0 ? 'Yes' : 'No') : '-';
      var palaColor = troopInfo ? (troopInfo.knight > 0 ? '#2a8a2a' : '#a02020') : '#999';
      rows += '<tr class="' + ID_PREFIX + 'village-row" data-coords="' + coords + '" ' +
        'data-name="' + (v.name || '').toLowerCase() + '" data-village-id="' + v.id + '">' +
        '<td><input type="checkbox" class="' + ID_PREFIX + 'village-cb" ' +
        'data-village-idx="' + i + '" /></td>' +
        '<td style="font-size:10px;">' + escapeHtml(v.name) + '</td>' +
        '<td style="font-family:monospace;font-size:10px;">' + coords + '</td>' +
        '<td style="text-align:right;font-size:10px;">' + (v.points || 0) + '</td>' +
        '<td style="text-align:right;font-size:10px;">' + armyText + '</td>' +
        '<td style="text-align:center;font-size:10px;color:' + palaColor + ';">' + palaText + '</td>' +
        '</tr>';
    }
    return rows;
  }

  /**
   * Handle adding a new attack plan.
   */
  function onAddPlan() {
    var targetStr = $('#' + ID_PREFIX + 'target-coords').val().trim();
    var targetCoords = TWTools.parseCoords(targetStr);
    if (!targetCoords) {
      TWTools.UI.toast('Invalid target coordinates', 'error');
      return;
    }

    var landDay = $('#' + ID_PREFIX + 'land-day').val();
    var landTimeStr = $('#' + ID_PREFIX + 'land-time').val().trim();
    var landingTimeMs = TWTools.parseTimeToMs(landTimeStr);
    if (isNaN(landingTimeMs)) {
      TWTools.UI.toast('Invalid landing time (use HH:MM:SS or HH:MM:SS:mmm)', 'error');
      return;
    }

    var landingTomorrow = (landDay === 'tomorrow');
    if (landingTomorrow) {
      landingTimeMs += 86400000;
    }

    var unitType = $('#' + ID_PREFIX + 'unit-type').val();

    // Collect selected source villages
    var selectedVillages = [];
    $('.' + ID_PREFIX + 'village-cb:checked').each(function() {
      var idx = parseInt($(this).attr('data-village-idx'), 10);
      if (playerVillages[idx]) {
        selectedVillages.push(playerVillages[idx]);
      }
    });

    if (selectedVillages.length === 0) {
      TWTools.UI.toast('Select at least one source village', 'error');
      return;
    }

    // Build attack rows
    var attacks = [];
    for (var i = 0; i < selectedVillages.length; i++) {
      var src = selectedVillages[i];
      var srcCoords = { x: src.x, y: src.y };
      var dist = TWTools.distance(srcCoords, targetCoords);
      var travel = TWTools.DataFetcher.calcTravelTime(srcCoords, targetCoords, unitType);
      var launchMs = landingTimeMs - travel;
      // TW mechanic: ms of send click = ms of arrival. Force launch ms to match landing ms.
      var landingMsComponent = landingTimeMs % 1000;
      var launchMsComponent = ((launchMs % 1000) + 1000) % 1000;
      if (launchMsComponent !== landingMsComponent) {
        launchMs = launchMs - launchMsComponent + landingMsComponent;
      }

      attacks.push({
        source: src,
        unitType: unitType,
        distance: dist,
        travelTimeMs: travel,
        launchTimeMs: launchMs,
        launchTomorrow: launchMs >= 86400000,
        alerted: false
      });
    }

    // Sort by launch time
    attacks.sort(function(a, b) { return a.launchTimeMs - b.launchTimeMs; });

    var plan = {
      id: ID_PREFIX + 'plan-' + (++planCounter),
      targetCoords: targetStr,
      landingTimeMs: landingTimeMs,
      landingTomorrow: landingTomorrow,
      attacks: attacks
    };

    plans.push(plan);
    savePlans();
    renderAllPlans();

    TWTools.UI.toast('Plan added: ' + attacks.length + ' attacks on ' + targetStr, 'success');
  }

  /**
   * Render all attack plans in the plans container.
   */
  function renderAllPlans() {
    var $container = $('#' + ID_PREFIX + 'plans-container');
    $container.empty();

    if (plans.length === 0) {
      $container.html('<div style="color:#7a6840;font-size:10px;padding:4px;">No plans yet. Add a target above.</div>');
      return;
    }

    // Build a combined chronological list if autoSort
    var allAttacks = [];
    for (var p = 0; p < plans.length; p++) {
      var plan = plans[p];
      for (var a = 0; a < plan.attacks.length; a++) {
        allAttacks.push({
          planIdx: p,
          attackIdx: a,
          plan: plan,
          attack: plan.attacks[a]
        });
      }
    }

    if (Settings.autoSort) {
      allAttacks.sort(function(a, b) {
        return a.attack.launchTimeMs - b.attack.launchTimeMs;
      });
    }

    // Render plan headers with delete buttons
    for (var pi = 0; pi < plans.length; pi++) {
      var pl = plans[pi];
      var landDisplay = pl.landingTomorrow ? 'tomorrow ' : '';
      var landTimeDisplay = TWTools.formatTime(pl.landingTimeMs % 86400000);
      $container.append(
        '<div style="background:#e8d8a8;padding:3px 6px;margin:4px 0 2px 0;' +
        'border:1px solid #c0a060;display:flex;justify-content:space-between;align-items:center;">' +
        '<span style="font-weight:bold;font-size:10px;">Target: ' +
        escapeHtml(pl.targetCoords) + ' | Landing: ' +
        '<span class="' + ID_PREFIX + 'edit-landing" data-plan-idx="' + pi + '" ' +
        'style="cursor:pointer;text-decoration:underline;color:#3a6a1a;" title="Click to edit landing time">' +
        landDisplay + landTimeDisplay + '</span></span>' +
        '<span class="' + ID_PREFIX + 'del-plan" data-plan-idx="' + pi + '" ' +
        'style="cursor:pointer;color:#a02020;font-weight:bold;font-size:12px;" title="Delete plan">X</span>' +
        '</div>'
      );
    }

    // Bind plan deletion
    $container.off('click', '.' + ID_PREFIX + 'del-plan');
    $container.on('click', '.' + ID_PREFIX + 'del-plan', function() {
      var idx = parseInt($(this).attr('data-plan-idx'), 10);
      plans.splice(idx, 1);
      savePlans();
      renderAllPlans();
      TWTools.UI.toast('Plan removed', 'warning');
    });

    // Bind single attack deletion
    $container.off('click', '.' + ID_PREFIX + 'del-attack');
    $container.on('click', '.' + ID_PREFIX + 'del-attack', function() {
      var planIdx = parseInt($(this).attr('data-plan'), 10);
      var atkIdx = parseInt($(this).attr('data-atk'), 10);
      if (plans[planIdx]) {
        plans[planIdx].attacks.splice(atkIdx, 1);
        if (plans[planIdx].attacks.length === 0) {
          plans.splice(planIdx, 1);
        }
        savePlans();
        renderAllPlans();
        TWTools.UI.toast('Attack removed', 'warning');
      }
    });

    // Bind landing time editing
    $container.off('click', '.' + ID_PREFIX + 'edit-landing');
    $container.on('click', '.' + ID_PREFIX + 'edit-landing', function() {
      var $span = $(this);
      var idx = parseInt($span.attr('data-plan-idx'), 10);
      var plan = plans[idx];
      if (!plan) return;

      var curTimeStr = TWTools.formatTime(plan.landingTimeMs % 86400000);
      var curDay = plan.landingTomorrow ? 'tomorrow' : 'today';
      $span.replaceWith(
        '<select class="' + ID_PREFIX + 'edit-day" style="font-size:10px;">' +
        '<option value="today"' + (curDay === 'today' ? ' selected' : '') + '>Today</option>' +
        '<option value="tomorrow"' + (curDay === 'tomorrow' ? ' selected' : '') + '>Tomorrow</option>' +
        '</select> ' +
        '<input type="text" class="' + ID_PREFIX + 'edit-time" value="' + curTimeStr + '" ' +
        'style="width:110px;font-size:10px;font-family:monospace;" /> ' +
        '<button class="btn ' + ID_PREFIX + 'save-landing" data-plan-idx="' + idx + '" ' +
        'style="font-size:9px;">Save</button> ' +
        '<button class="btn ' + ID_PREFIX + 'cancel-landing" data-plan-idx="' + idx + '" ' +
        'style="font-size:9px;">Cancel</button>'
      );
    });

    $container.off('click', '.' + ID_PREFIX + 'cancel-landing');
    $container.on('click', '.' + ID_PREFIX + 'cancel-landing', function() {
      renderAllPlans();
    });

    $container.off('click', '.' + ID_PREFIX + 'save-landing');
    $container.on('click', '.' + ID_PREFIX + 'save-landing', function() {
      var idx = parseInt($(this).attr('data-plan-idx'), 10);
      var plan = plans[idx];
      if (!plan) return;

      var $parent = $(this).parent();
      var newDay = $parent.find('.' + ID_PREFIX + 'edit-day').val();
      var newTimeStr = $parent.find('.' + ID_PREFIX + 'edit-time').val().trim();
      var newLandingMs = TWTools.parseTimeToMs(newTimeStr);
      if (isNaN(newLandingMs)) {
        TWTools.UI.toast('Invalid time format (HH:MM:SS:mmm)', 'error');
        return;
      }
      if (newDay === 'tomorrow') {
        newLandingMs += 86400000;
      }

      plan.landingTimeMs = newLandingMs;
      plan.landingTomorrow = (newDay === 'tomorrow');

      var targetCoords = TWTools.parseCoords(plan.targetCoords);
      for (var a = 0; a < plan.attacks.length; a++) {
        var atk = plan.attacks[a];
        var srcCoords = { x: atk.source.x, y: atk.source.y };
        var travel = TWTools.DataFetcher.calcTravelTime(srcCoords, targetCoords, atk.unitType);
        var launchMs = newLandingMs - travel;
        var landMsComp = newLandingMs % 1000;
        var launchMsComp = ((launchMs % 1000) + 1000) % 1000;
        if (launchMsComp !== landMsComp) {
          launchMs = launchMs - launchMsComp + landMsComp;
        }
        atk.travelTimeMs = travel;
        atk.launchTimeMs = launchMs;
        atk.launchTomorrow = launchMs >= 86400000;
        atk.alerted = false;
      }

      plan.attacks.sort(function(a, b) { return a.launchTimeMs - b.launchTimeMs; });
      savePlans();
      renderAllPlans();
      TWTools.UI.toast('Landing time updated, ' + plan.attacks.length + ' attacks recalculated', 'success');
    });

    // Chronological table
    var tableHtml = [
      '<table class="vis" id="' + ID_PREFIX + 'attack-table" style="width:100%;margin-top:4px;">',
      '<thead>',
      '  <tr>',
      '    <th>Target</th>',
      '    <th>Source</th>',
      '    <th>Unit</th>',
      '    <th>Dist</th>',
      '    <th>Travel</th>',
      '    <th>Launch Time</th>',
      '    <th>Countdown</th>',
      '    <th>Status</th>',
      '    <th>Alarm</th>',
      '    <th></th>',
      '    <th></th>',
      '  </tr>',
      '</thead>',
      '<tbody>'
    ];

    for (var i = 0; i < allAttacks.length; i++) {
      var entry = allAttacks[i];
      var atk = entry.attack;
      var pl2 = entry.plan;
      var srcCoords = atk.source.x + '|' + atk.source.y;
      var launchDisplay = TWTools.formatTime(
        atk.launchTimeMs >= 86400000 ? atk.launchTimeMs - 86400000 : Math.max(0, atk.launchTimeMs)
      );
      var launchPrefix = atk.launchTimeMs >= 86400000 ? 'tmw ' :
        (atk.launchTimeMs < 0 ? '(yesterday) ' : '');

      // Rally point link: open rally point with target coords as x/y params
      var targetParts = pl2.targetCoords.split('|');
      var rallyLink = '/game.php?village=' + atk.source.id +
        '&screen=place&x=' + targetParts[0] + '&y=' + targetParts[1];

      var rowId = ID_PREFIX + 'row-' + entry.planIdx + '-' + entry.attackIdx;

      tableHtml.push(
        '<tr id="' + rowId + '" data-plan="' + entry.planIdx + '" data-atk="' + entry.attackIdx + '">' +
        '<td style="font-family:monospace;font-size:10px;">' + escapeHtml(pl2.targetCoords) + '</td>' +
        '<td style="font-size:10px;" title="' + escapeHtml(atk.source.name) + '">' +
          truncate(atk.source.name, 15) + '<br/>' +
          '<span style="font-family:monospace;font-size:9px;color:#7a6840;">' + srcCoords + '</span></td>' +
        '<td style="font-size:10px;">' + (UNIT_NAMES[atk.unitType] || atk.unitType) + '</td>' +
        '<td style="text-align:right;font-size:10px;">' + atk.distance.toFixed(1) + '</td>' +
        '<td style="font-family:monospace;font-size:10px;">' + TWTools.formatDuration(atk.travelTimeMs) + '</td>' +
        '<td style="font-family:monospace;font-size:10px;">' + launchPrefix + launchDisplay + '</td>' +
        '<td class="' + ID_PREFIX + 'countdown" style="font-family:monospace;font-size:10px;font-weight:bold;"></td>' +
        '<td class="' + ID_PREFIX + 'status" style="font-size:10px;font-weight:bold;"></td>' +
        '<td class="' + ID_PREFIX + 'alarm-cell" data-plan="' + entry.planIdx + '" data-atk="' + entry.attackIdx + '" ' +
          'style="font-size:9px;white-space:nowrap;">' +
          getAlarmCellHtml(entry.planIdx, entry.attackIdx, atk.launchTimeMs) +
        '</td>' +
        '<td style="white-space:nowrap;">' +
          '<a href="' + rallyLink + '" target="_blank" ' +
            'style="font-size:9px;text-decoration:none;" title="Open Rally Point">&#9876; Go</a> ' +
          '<span class="' + ID_PREFIX + 'add-reminder" data-plan="' + entry.planIdx +
            '" data-atk="' + entry.attackIdx + '" data-launch="' + atk.launchTimeMs +
            '" data-label="' + escapeHtml(pl2.targetCoords) + ' ← ' + escapeHtml(atk.source.name) +
            '" style="cursor:pointer;font-size:9px;color:#2a6a8a;" title="Set reminder alarm">&#9200;</span>' +
        '</td>' +
        '<td><span class="' + ID_PREFIX + 'del-attack" data-plan="' + entry.planIdx +
          '" data-atk="' + entry.attackIdx + '" ' +
          'style="cursor:pointer;color:#a02020;font-size:11px;" title="Remove attack">X</span></td>' +
        '</tr>'
      );
    }

    tableHtml.push('</tbody></table>');
    $container.append(tableHtml.join(''));

    // Bind reminder buttons (⏰)
    $container.off('click', '.' + ID_PREFIX + 'add-reminder');
    $container.on('click', '.' + ID_PREFIX + 'add-reminder', function() {
      var $btn = $(this);
      var launchMs = parseFloat($btn.attr('data-launch'));
      var label = $btn.attr('data-label');
      showReminderDialog(label, launchMs);
    });

    // Bind delete reminder buttons (× in alarm cells and summary)
    $container.off('click', '.' + ID_PREFIX + 'del-reminder');
    $container.on('click', '.' + ID_PREFIX + 'del-reminder', function() {
      var rid = $(this).attr('data-rid');
      deleteReminder(rid);
      renderAllPlans();
    });

    // Render active reminders summary below the attack table
    renderRemindersSummary($container);
  }

  /**
   * Get HTML for the Alarm cell of an attack row.
   * Shows any active reminders for this attack with countdown.
   * @param {number} planIdx - Plan index.
   * @param {number} atkIdx - Attack index within the plan.
   * @param {number} launchMs - Launch time in ms.
   * @returns {string} HTML for the alarm cell.
   */
  function getAlarmCellHtml(planIdx, atkIdx, launchMs) {
    var reminders = getPlannerReminders();
    var key = 'planner_' + planIdx + '_' + atkIdx;
    var matching = [];
    for (var i = 0; i < reminders.length; i++) {
      var r = reminders[i];
      if (r.id && r.id.indexOf('planner_') === 0 && r.label && r.label.indexOf(planIdx + '_' + atkIdx) !== -1) {
        matching.push(r);
      }
    }
    // Also match by attack label content
    if (matching.length === 0 && plans[planIdx]) {
      var atk = plans[planIdx].attacks[atkIdx];
      if (atk) {
        var srcName = atk.source ? atk.source.name : '';
        for (var j = 0; j < reminders.length; j++) {
          var r2 = reminders[j];
          if (r2.label && r2.label.indexOf(srcName) !== -1 && !r2.done) {
            matching.push(r2);
          }
        }
      }
    }
    if (matching.length === 0) {
      return '<span style="color:#ccc;">—</span>';
    }
    var parts = [];
    for (var k = 0; k < matching.length; k++) {
      var rm = matching[k];
      var remaining = rm.targetTimeAbsMs - Date.now();
      if (rm.done || remaining < -60000) continue;
      var color = remaining <= 0 ? '#cc0000' : (remaining < 30000 ? '#cc8800' : '#2a6a8a');
      parts.push('<span class="' + ID_PREFIX + 'alarm-countdown" data-target="' + rm.targetTimeAbsMs + '" ' +
        'style="color:' + color + ';font-weight:bold;">&#9200; ' +
        (remaining <= 0 ? 'NOW!' : formatCountdown(remaining)) + '</span>' +
        '<span class="' + ID_PREFIX + 'del-reminder" data-rid="' + escapeHtml(rm.id) + '" ' +
        'style="cursor:pointer;color:#a02020;font-size:11px;margin-left:3px;" title="Delete">&times;</span>');
    }
    return parts.length > 0 ? parts.join('<br>') : '<span style="color:#ccc;">—</span>';
  }

  /**
   * Get all planner reminders from shared localStorage.
   * @returns {Array} Array of reminder objects.
   */
  function getPlannerReminders() {
    try {
      var all = JSON.parse(localStorage.getItem('twr_timers') || '[]');
      return all.filter(function(r) { return r.id && r.id.indexOf('planner_') === 0; });
    } catch (e) { return []; }
  }

  /**
   * Render a summary of all active planner reminders below the attack table.
   * @param {jQuery} $container - Container element.
   */
  function renderRemindersSummary($container) {
    // Remove old summary
    $container.find('.' + ID_PREFIX + 'reminders-summary').remove();

    var reminders = getPlannerReminders().filter(function(r) {
      return !r.done && r.targetTimeAbsMs > Date.now() - 60000;
    });

    if (reminders.length === 0) return;

    // Sort by target time (soonest first)
    reminders.sort(function(a, b) { return a.targetTimeAbsMs - b.targetTimeAbsMs; });

    var html = '<div class="' + ID_PREFIX + 'reminders-summary" style="' +
      'margin-top:8px;padding:6px 8px;background:#e8f0e0;border:1px solid #8ab060;border-radius:4px;">' +
      '<div style="font-weight:bold;font-size:10px;color:#3a5a2a;margin-bottom:4px;">&#9200; Active Reminders (' +
      reminders.length + ')</div>';

    for (var i = 0; i < reminders.length; i++) {
      var r = reminders[i];
      var remaining = r.targetTimeAbsMs - Date.now();
      var color = remaining < 30000 ? '#cc0000' : (remaining < 120000 ? '#cc8800' : '#2a6a2a');
      var icon = remaining < 30000 ? '&#128276;' : '&#9200;';

      html += '<div class="' + ID_PREFIX + 'reminder-row" data-rid="' + r.id + '" style="' +
        'display:flex;justify-content:space-between;align-items:center;' +
        'padding:3px 0;border-bottom:1px solid #d0e0c0;font-size:10px;">' +
        '<span style="color:#3a3a0a;flex:1;">' + icon + ' ' + escapeHtml(r.label || 'Reminder') + '</span>' +
        '<span class="' + ID_PREFIX + 'rem-countdown" data-target="' + r.targetTimeAbsMs + '" ' +
          'style="font-family:monospace;font-weight:bold;color:' + color + ';margin:0 8px;">' +
          (remaining <= 0 ? 'ALERT!' : formatCountdown(remaining)) +
        '</span>' +
        '<span class="' + ID_PREFIX + 'del-reminder" data-rid="' + escapeHtml(r.id) + '" ' +
          'style="cursor:pointer;color:#a02020;font-weight:bold;font-size:12px;" title="Delete reminder">&times;</span>' +
        '</div>';
    }

    html += '</div>';
    $container.append(html);

    // Bind delete buttons
    $container.off('click', '.' + ID_PREFIX + 'del-reminder');
    $container.on('click', '.' + ID_PREFIX + 'del-reminder', function() {
      var rid = $(this).attr('data-rid');
      deleteReminder(rid);
      renderAllPlans();
    });
  }

  /**
   * Delete a reminder by ID from shared localStorage.
   * @param {string} reminderId - Reminder ID to remove.
   */
  function deleteReminder(reminderId) {
    try {
      var all = JSON.parse(localStorage.getItem('twr_timers') || '[]');
      var filtered = all.filter(function(r) { return r.id !== reminderId; });
      localStorage.setItem('twr_timers', JSON.stringify(filtered));
      TWTools.UI.toast('Reminder deleted', 'warning');
    } catch (e) {}
  }

  /**
   * Show reminder setup dialog for an attack.
   * Lets user pick how many seconds/minutes before launch to be alerted.
   * @param {string} label - Attack description for the reminder.
   * @param {number} launchMs - Launch time in ms since midnight.
   */
  function showReminderDialog(label, launchMs) {
    // Remove existing dialog
    $('#' + ID_PREFIX + 'reminder-dialog').remove();

    var presets = [
      { label: '10 sec', sec: 10 },
      { label: '30 sec', sec: 30 },
      { label: '1 min', sec: 60 },
      { label: '2 min', sec: 120 },
      { label: '5 min', sec: 300 },
      { label: '10 min', sec: 600 }
    ];

    var html = '<div id="' + ID_PREFIX + 'reminder-dialog" style="' +
      'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
      'background:#f5e6c0;border:2px solid #a08040;border-radius:6px;' +
      'padding:16px;z-index:999999;box-shadow:0 4px 16px rgba(0,0,0,0.3);' +
      'min-width:280px;font-size:12px;color:#3a2a0a;">' +
      '<div style="font-weight:bold;font-size:13px;margin-bottom:8px;">' +
        '&#9200; Set Reminder' +
      '</div>' +
      '<div style="margin-bottom:8px;font-size:11px;color:#6a5a2a;">' +
        'Attack: ' + label +
      '</div>' +
      '<div style="margin-bottom:8px;">Alert me before launch:</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">';

    for (var i = 0; i < presets.length; i++) {
      html += '<button class="' + ID_PREFIX + 'reminder-preset" data-sec="' + presets[i].sec + '" ' +
        'style="padding:6px 12px;background:#d4b87a;border:1px solid #a08040;' +
        'border-radius:3px;cursor:pointer;font-size:11px;color:#3a2a0a;">' +
        presets[i].label + '</button>';
    }

    html += '</div>' +
      '<div style="display:flex;gap:6px;align-items:center;margin-bottom:12px;">' +
        '<span>Custom:</span>' +
        '<input type="number" id="' + ID_PREFIX + 'reminder-custom" value="30" min="1" max="3600" ' +
          'style="width:60px;padding:4px;border:1px solid #a08040;background:#fff;font-size:11px;">' +
        '<select id="' + ID_PREFIX + 'reminder-unit" style="padding:4px;border:1px solid #a08040;font-size:11px;">' +
          '<option value="1">seconds</option>' +
          '<option value="60">minutes</option>' +
        '</select>' +
        '<button id="' + ID_PREFIX + 'reminder-custom-btn" ' +
          'style="padding:4px 10px;background:#4a6b3a;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:11px;">Set</button>' +
      '</div>' +
      '<div style="text-align:right;">' +
        '<button id="' + ID_PREFIX + 'reminder-close" ' +
          'style="padding:4px 12px;background:#888;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:11px;">Cancel</button>' +
      '</div>' +
    '</div>';

    $('body').append(html);

    // Create reminder function
    var createReminder = function(beforeSec) {
      var alertMs = launchMs - (beforeSec * 1000);
      if (alertMs < 0) alertMs += 86400000;

      // Store reminder in shared localStorage for tw-clock to pick up
      var reminders = [];
      try { reminders = JSON.parse(localStorage.getItem('twr_timers') || '[]'); } catch (e) {}

      var nowEpoch = Date.now();
      var serverNow = TWTools.TimeSync.now();
      var diffToLaunch = launchMs - serverNow;
      if (diffToLaunch < 0) diffToLaunch += 86400000;
      var alertEpoch = nowEpoch + diffToLaunch - (beforeSec * 1000);

      reminders.push({
        id: 'planner_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        label: '⚔ ' + label + ' (in ' + beforeSec + 's)',
        mode: 'target',
        targetTimeAbsMs: alertEpoch,
        soundEnabled: true,
        color: beforeSec <= 30 ? 'red' : (beforeSec <= 120 ? 'yellow' : 'green'),
        done: false,
        doneAt: null
      });

      localStorage.setItem('twr_timers', JSON.stringify(reminders));

      $('#' + ID_PREFIX + 'reminder-dialog').remove();

      var beforeLabel = beforeSec >= 60 ? (Math.floor(beforeSec / 60) + 'm ' + (beforeSec % 60) + 's') : (beforeSec + 's');
      TWTools.UI.toast('Reminder set: ' + beforeLabel + ' before launch', 'success');

      // Re-render so the Alarm column and summary update
      renderAllPlans();
    };

    // Preset buttons
    $(document).off('click.' + ID_PREFIX + 'rp').on('click.' + ID_PREFIX + 'rp', '.' + ID_PREFIX + 'reminder-preset', function() {
      createReminder(parseInt($(this).attr('data-sec'), 10));
    });

    // Custom button
    $(document).off('click.' + ID_PREFIX + 'rc').on('click.' + ID_PREFIX + 'rc', '#' + ID_PREFIX + 'reminder-custom-btn', function() {
      var val = parseInt($('#' + ID_PREFIX + 'reminder-custom').val(), 10) || 30;
      var mult = parseInt($('#' + ID_PREFIX + 'reminder-unit').val(), 10) || 1;
      createReminder(val * mult);
    });

    // Close
    $(document).off('click.' + ID_PREFIX + 'rclose').on('click.' + ID_PREFIX + 'rclose', '#' + ID_PREFIX + 'reminder-close', function() {
      $('#' + ID_PREFIX + 'reminder-dialog').remove();
    });
  }

  /**
   * Update countdowns and status badges for all attack rows.
   * Called every 50ms from the main update loop.
   */
  function updatePlanCountdowns() {
    var nowMs = TWTools.TimeSync.now();

    for (var p = 0; p < plans.length; p++) {
      var plan = plans[p];
      for (var a = 0; a < plan.attacks.length; a++) {
        var atk = plan.attacks[a];
        var rowId = '#' + ID_PREFIX + 'row-' + p + '-' + a;
        var $row = $(rowId);
        if ($row.length === 0) continue;

        var remaining = atk.launchTimeMs - nowMs;
        var $countdown = $row.find('.' + ID_PREFIX + 'countdown');
        var $status = $row.find('.' + ID_PREFIX + 'status');

        // Status logic
        var status, color, bgColor;
        if (remaining < 0) {
          status = 'MISSED';
          color = '#999';
          bgColor = '#f0f0f0';
          $countdown.text('PASSED');
        } else if (remaining < 120000) { // <2 min
          status = 'URGENT';
          color = '#cc0000';
          bgColor = remaining < 10000 ? (Math.floor(Date.now() / 500) % 2 === 0 ? '#ffe0e0' : '#fff8e8') : '#ffe0e0';
          $countdown.text(formatCountdown(remaining));
        } else if (remaining < 300000) { // <5 min
          status = 'SOON';
          color = '#cc8800';
          bgColor = '#fff5d0';
          $countdown.text(formatCountdown(remaining));
        } else {
          status = 'OK';
          color = '#2a8a2a';
          bgColor = '';
          $countdown.text(formatCountdown(remaining));
        }

        $status.html('<span style="color:' + color + ';">' + status + '</span>');
        $row.css('background-color', bgColor);

        // Audio alert
        if (Settings.soundEnabled && !atk.alerted && remaining > 0 &&
            remaining <= Settings.alertSeconds * 1000) {
          atk.alerted = true;
          playBeepRepeated();
          TWTools.UI.toast('ALERT: Attack on ' + plan.targetCoords + ' launches in ' +
            Settings.alertSeconds + 's!', 'warning');
        }
      }
    }

    // Update reminder countdowns (alarm column + summary panel)
    updateReminderCountdowns();
  }

  /**
   * Update all visible reminder countdowns in the Alarm column and summary panel.
   * Called every 50ms from the main update loop.
   */
  /** @private Track which reminders already beeped so we don't repeat. */
  var _remindersBeeped = {};

  function updateReminderCountdowns() {
    var now = Date.now();

    // Check reminders for sound alerts (independent of DOM elements)
    if (Settings.soundEnabled) {
      var reminders = getPlannerReminders();
      for (var ri = 0; ri < reminders.length; ri++) {
        var rem = reminders[ri];
        if (rem.done || _remindersBeeped[rem.id]) continue;
        var remRemaining = rem.targetTimeAbsMs - now;
        if (remRemaining <= 0 && remRemaining > -5000) {
          // Reminder just fired — play beep and mark as beeped
          _remindersBeeped[rem.id] = true;
          playBeepRepeated();
          TWTools.UI.toast('REMINDER: ' + (rem.label || 'Attack reminder'), 'warning');

          // Mark as done in localStorage so tw-clock also sees it
          try {
            var all = JSON.parse(localStorage.getItem('twr_timers') || '[]');
            for (var ai = 0; ai < all.length; ai++) {
              if (all[ai].id === rem.id) {
                all[ai].done = true;
                all[ai].doneAt = now;
                break;
              }
            }
            localStorage.setItem('twr_timers', JSON.stringify(all));
          } catch (e) {}
        }
      }
    }

    // Update alarm cells in table rows
    $('.' + ID_PREFIX + 'alarm-countdown').each(function() {
      var $el = $(this);
      var target = parseFloat($el.attr('data-target'));
      var remaining = target - now;
      var color = remaining <= 0 ? '#cc0000' : (remaining < 30000 ? '#cc8800' : '#2a6a8a');
      $el.css('color', color);
      if (remaining <= 0) {
        $el.html('&#128276; NOW!');
        if (Math.floor(now / 400) % 2 === 0) {
          $el.css('visibility', 'visible');
        } else {
          $el.css('visibility', 'hidden');
        }
      } else {
        $el.css('visibility', 'visible');
        $el.html('&#9200; ' + formatCountdown(remaining));
      }
    });

    // Update summary panel countdowns
    $('.' + ID_PREFIX + 'rem-countdown').each(function() {
      var $el = $(this);
      var target = parseFloat($el.attr('data-target'));
      var remaining = target - now;
      var color = remaining <= 0 ? '#cc0000' : (remaining < 30000 ? '#cc8800' : '#2a6a2a');
      $el.css('color', color);
      $el.text(remaining <= 0 ? 'ALERT!' : formatCountdown(remaining));
    });
  }

  /**
   * Format a remaining time in ms as countdown string.
   * @param {number} ms - Remaining milliseconds.
   * @returns {string} Countdown string.
   */
  function formatCountdown(ms) {
    if (ms <= 0) return '0s';
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    var frac = Math.floor((ms % 1000) / 100); // tenths
    if (h > 0) return h + 'h ' + TWTools.pad2(m) + 'm ' + TWTools.pad2(s) + 's';
    if (m > 0) return m + 'm ' + TWTools.pad2(s) + '.' + frac + 's';
    return s + '.' + frac + 's';
  }

  /**
   * Export all plans as BBCode text.
   */
  function onExportBBCode() {
    if (plans.length === 0) {
      TWTools.UI.toast('No plans to export', 'warning');
      return;
    }

    var lines = [];
    lines.push('[b]Attack Plan[/b]');
    lines.push('[i]Generated by TW Attack Planner v' + VERSION + '[/i]');
    lines.push('');

    for (var p = 0; p < plans.length; p++) {
      var plan = plans[p];
      var landDisplay = plan.landingTomorrow ? 'tomorrow ' : '';
      var landTime = TWTools.formatTime(plan.landingTimeMs % 86400000);
      lines.push('[b]Target: [coord]' + plan.targetCoords + '[/coord] | Landing: ' +
        landDisplay + landTime + '[/b]');
      lines.push('[table]');
      lines.push('[**]Source[||]Unit[||]Distance[||]Travel[||]Launch Time[/**]');

      for (var a = 0; a < plan.attacks.length; a++) {
        var atk = plan.attacks[a];
        var srcCoords = atk.source.x + '|' + atk.source.y;
        var launchDisp = TWTools.formatTime(
          atk.launchTimeMs >= 86400000 ? atk.launchTimeMs - 86400000 : Math.max(0, atk.launchTimeMs)
        );
        var launchPfx = atk.launchTimeMs >= 86400000 ? 'tmw ' : '';
        lines.push('[*][coord]' + srcCoords + '[/coord][|]' +
          (UNIT_NAMES[atk.unitType] || atk.unitType) + '[|]' +
          atk.distance.toFixed(1) + '[|]' +
          TWTools.formatDuration(atk.travelTimeMs) + '[|]' +
          launchPfx + launchDisp);
      }
      lines.push('[/table]');
      lines.push('');
    }

    // Copy to clipboard
    var bbcode = lines.join('\n');
    copyToClipboard(bbcode);
    TWTools.UI.toast('BBCode copied to clipboard!', 'success');
  }

  /**
   * Clear all attack plans.
   */
  function onClearPlans() {
    plans = [];
    planCounter = 0;
    savePlans();
    renderAllPlans();
    TWTools.UI.toast('All plans cleared', 'warning');
  }

  /**
   * Toggle select all village checkboxes.
   */
  function onSelectAll() {
    var checked = $('#' + ID_PREFIX + 'select-all').is(':checked');
    // Only select visible (filtered) rows
    $('.' + ID_PREFIX + 'village-row:visible .' + ID_PREFIX + 'village-cb')
      .prop('checked', checked);
  }

  /**
   * Handle group dropdown change — lazy-fetch group membership then filter.
   */
  function onGroupChange() {
    var groupId = parseInt($('#' + ID_PREFIX + 'village-group').val(), 10);
    if (groupId === 0) {
      applyVillageFilters();
      return;
    }
    fetchGroupVillages(groupId, function() {
      applyVillageFilters();
    });
  }

  /**
   * Filter village rows by name/coords text AND selected group.
   */
  function onFilterVillages() {
    applyVillageFilters();
  }

  /**
   * Apply both text and group filters to village rows.
   */
  function applyVillageFilters() {
    var query = ($('#' + ID_PREFIX + 'village-filter').val() || '').toLowerCase();
    var groupId = parseInt($('#' + ID_PREFIX + 'village-group').val(), 10) || 0;
    var groupIds = groupId > 0 ? (groupVillages[groupId] || []) : null;

    $('.' + ID_PREFIX + 'village-row').each(function() {
      var name = $(this).attr('data-name') || '';
      var coords = $(this).attr('data-coords') || '';
      var vid = parseInt($(this).attr('data-village-id'), 10);

      var matchesText = !query || name.indexOf(query) !== -1 || coords.indexOf(query) !== -1;
      var matchesGroup = !groupIds || groupIds.indexOf(vid) !== -1;

      $(this).toggle(matchesText && matchesGroup);
    });
  }

  /**
   * Save plans to localStorage.
   */
  function savePlans() {
    TWTools.Storage.set(STORAGE_PREFIX + 'plans', plans);
  }

  // ============================================================
  // FAKES TAB
  // ============================================================

  /**
   * Build the Fakes tab: target inputs, filters, generation, and results.
   */
  function buildFakesTab() {
    var $panel = card.getTabContent('fakes');

    var html = [
      '<div style="margin-bottom:8px;">',
      '  <div style="font-weight:bold;margin-bottom:4px;">Fake Attack Generator</div>',

      // Target coords input
      '  <table class="vis" style="width:100%;margin-bottom:6px;">',
      '    <tr>',
      '      <td style="width:110px;">Target coords:</td>',
      '      <td><input type="text" id="' + ID_PREFIX + 'fake-targets" ',
      '        placeholder="500|500 501|501 502|502" style="width:100%;font-size:11px;font-family:monospace;" /></td>',
      '    </tr>',
      '    <tr>',
      '      <td>Player name:</td>',
      '      <td><input type="text" id="' + ID_PREFIX + 'fake-player" ',
      '        placeholder="Player name (loads their villages)" style="width:200px;font-size:11px;" />',
      '        <button class="btn" id="' + ID_PREFIX + 'load-player-vills" style="font-size:10px;margin-left:4px;">Load</button>',
      '      </td>',
      '    </tr>',
      '    <tr>',
      '      <td>Coord range:</td>',
      '      <td>',
      '        Min: <input type="text" id="' + ID_PREFIX + 'fake-range-min" placeholder="400|400" ',
      '          style="width:70px;font-size:11px;font-family:monospace;" />',
      '        Max: <input type="text" id="' + ID_PREFIX + 'fake-range-max" placeholder="600|600" ',
      '          style="width:70px;font-size:11px;font-family:monospace;" />',
      '      </td>',
      '    </tr>',
      '    <tr>',
      '      <td>Source group:</td>',
      '      <td><select id="' + ID_PREFIX + 'fake-group" style="font-size:11px;">',
      '        <option value="0">All villages</option>',
      buildGroupOptions(),
      '      </select></td>',
      '    </tr>',
      '    <tr>',
      '      <td>Max distance:</td>',
      '      <td><input type="number" id="' + ID_PREFIX + 'fake-max-dist" value="' + Settings.fakeMaxDistance + '" ',
      '        style="width:60px;font-size:11px;" min="1" max="500" /> fields</td>',
      '    </tr>',
      '    <tr>',
      '      <td>Fake units:</td>',
      '      <td>',
      '        Spy: <input type="number" id="' + ID_PREFIX + 'fake-spy" value="' + Settings.fakeSpyCount + '" ',
      '          style="width:40px;font-size:11px;" min="0" max="999" />',
      '        Cat: <input type="number" id="' + ID_PREFIX + 'fake-cat" value="' + Settings.fakeCatCount + '" ',
      '          style="width:40px;font-size:11px;margin-left:6px;" min="0" max="999" />',
      '      </td>',
      '    </tr>',
      '    <tr>',
      '      <td>Landing time:</td>',
      '      <td>',
      '        <select id="' + ID_PREFIX + 'fake-land-day" style="font-size:11px;">',
      '          <option value="today">Today</option>',
      '          <option value="tomorrow">Tomorrow</option>',
      '        </select>',
      '        <input type="text" id="' + ID_PREFIX + 'fake-land-time" ',
      '          placeholder="HH:MM:SS:mmm (blank = staggered)" ',
      '          style="width:140px;font-size:11px;font-family:monospace;" />',
      '      </td>',
      '    </tr>',
      '  </table>',
      '  <button class="btn" id="' + ID_PREFIX + 'gen-fakes" style="font-size:11px;">',
      '    Generate Fake Plan</button>',
      '  <button class="btn" id="' + ID_PREFIX + 'export-fakes-bbcode" ',
      '    style="font-size:11px;margin-left:6px;">Export BBCode</button>',
      '</div>',

      // Fake results table
      '<div id="' + ID_PREFIX + 'fake-results" style="margin-top:6px;"></div>'
    ].join('\n');

    $panel.html(html);

    // Load saved fakes and render
    loadFakes();
    if (fakeEntries.length > 0) {
      renderFakeResults();
    }

    // Bind events
    $('#' + ID_PREFIX + 'gen-fakes').on('click', function() {
      var fakeGroupId = parseInt($('#' + ID_PREFIX + 'fake-group').val(), 10) || 0;
      if (fakeGroupId > 0 && !groupsFetched[fakeGroupId]) {
        fetchGroupVillages(fakeGroupId, function() {
          onGenerateFakes();
        });
      } else {
        onGenerateFakes();
      }
    });
    $('#' + ID_PREFIX + 'export-fakes-bbcode').on('click', onExportFakesBBCode);
    $('#' + ID_PREFIX + 'load-player-vills').on('click', onLoadPlayerVillages);
  }

  /**
   * Load a player's villages by searching village.txt.
   */
  function onLoadPlayerVillages() {
    var playerName = ($('#' + ID_PREFIX + 'fake-player').val() || '').trim();
    if (!playerName) {
      TWTools.UI.toast('Enter a player name', 'error');
      return;
    }

    TWTools.DataFetcher.fetchAllVillages(function(allVillages) {
      // Search for villages owned by players matching the name
      // We need to look up player ID from village data — player.txt would be better
      // but we can filter by cross-referencing
      var existing = ($('#' + ID_PREFIX + 'fake-targets').val() || '').trim();
      var found = 0;

      // Load player.txt to map name -> id
      $.ajax({
        url: '/map/player.txt',
        dataType: 'text',
        success: function(csv) {
          var playerIds = [];
          var lines = csv.split('\n');
          var searchLower = playerName.toLowerCase();
          for (var i = 0; i < lines.length; i++) {
            var cols = lines[i].split(',');
            if (cols.length >= 2) {
              var pName = decodeURIComponent((cols[1] || '').replace(/\+/g, ' '));
              if (pName.toLowerCase().indexOf(searchLower) !== -1) {
                playerIds.push(parseInt(cols[0], 10));
              }
            }
          }

          if (playerIds.length === 0) {
            TWTools.UI.toast('No player found matching "' + playerName + '"', 'warning');
            return;
          }

          // Find their villages
          var coords = [];
          for (var j = 0; j < allVillages.length; j++) {
            var v = allVillages[j];
            if (playerIds.indexOf(v.owner) !== -1) {
              coords.push(v.x + '|' + v.y);
              found++;
            }
          }

          var newVal = existing ? existing + ' ' + coords.join(' ') : coords.join(' ');
          $('#' + ID_PREFIX + 'fake-targets').val(newVal);
          TWTools.UI.toast('Loaded ' + found + ' villages for player(s)', 'success');
        },
        error: function() {
          TWTools.UI.toast('Failed to load player data', 'error');
        }
      });
    });
  }

  /**
   * Generate fake attack plan: for each target, pick nearest source.
   */
  function onGenerateFakes() {
    var targetsStr = ($('#' + ID_PREFIX + 'fake-targets').val() || '').trim();
    if (!targetsStr) {
      TWTools.UI.toast('Enter target coordinates', 'error');
      return;
    }

    var maxDist = parseInt($('#' + ID_PREFIX + 'fake-max-dist').val(), 10) || Settings.fakeMaxDistance;
    var rangeMinStr = ($('#' + ID_PREFIX + 'fake-range-min').val() || '').trim();
    var rangeMaxStr = ($('#' + ID_PREFIX + 'fake-range-max').val() || '').trim();
    var rangeMin = TWTools.parseCoords(rangeMinStr);
    var rangeMax = TWTools.parseCoords(rangeMaxStr);

    var fakeLandDay = $('#' + ID_PREFIX + 'fake-land-day').val();
    var fakeLandTimeStr = ($('#' + ID_PREFIX + 'fake-land-time').val() || '').trim();
    var fakeLandingMs = null;
    if (fakeLandTimeStr) {
      fakeLandingMs = TWTools.parseTimeToMs(fakeLandTimeStr);
      if (isNaN(fakeLandingMs)) {
        TWTools.UI.toast('Invalid landing time', 'error');
        return;
      }
      if (fakeLandDay === 'tomorrow') {
        fakeLandingMs += 86400000;
      }
    }

    // Parse all target coords from space-separated input
    var coordParts = targetsStr.split(/\s+/);
    var targetList = [];
    for (var i = 0; i < coordParts.length; i++) {
      var tc = TWTools.parseCoords(coordParts[i]);
      if (tc) {
        // Apply coordinate range filter
        if (rangeMin && rangeMax) {
          if (tc.x < rangeMin.x || tc.x > rangeMax.x || tc.y < rangeMin.y || tc.y > rangeMax.y) {
            continue;
          }
        }
        targetList.push(tc);
      }
    }

    if (targetList.length === 0) {
      TWTools.UI.toast('No valid target coordinates found', 'error');
      return;
    }

    // Determine fake unit speed (slowest of spy and catapult if both used)
    var spyCount = parseInt($('#' + ID_PREFIX + 'fake-spy').val(), 10) || 0;
    var catCount = parseInt($('#' + ID_PREFIX + 'fake-cat').val(), 10) || 0;
    var fakeUnitType = 'spy'; // default
    if (catCount > 0) {
      fakeUnitType = 'catapult'; // catapult is slower
    } else if (spyCount > 0) {
      fakeUnitType = 'spy';
    }

    fakeEntries = [];
    var nowMs = TWTools.TimeSync.now();

    // Determine source villages based on group filter
    var fakeGroupId = parseInt($('#' + ID_PREFIX + 'fake-group').val(), 10) || 0;
    var fakeSourceVillages = playerVillages;
    if (fakeGroupId > 0 && groupVillages[fakeGroupId]) {
      var gIds = groupVillages[fakeGroupId];
      fakeSourceVillages = playerVillages.filter(function(v) {
        return gIds.indexOf(v.id) !== -1;
      });
    }

    for (var t = 0; t < targetList.length; t++) {
      var target = targetList[t];
      var targetStr2 = target.x + '|' + target.y;

      // Find nearest source village within max distance
      var bestVillage = null;
      var bestDist = Infinity;

      for (var v = 0; v < fakeSourceVillages.length; v++) {
        var src = fakeSourceVillages[v];
        var srcCoords = { x: src.x, y: src.y };
        var dist = TWTools.distance(srcCoords, target);
        if (dist <= maxDist && dist < bestDist) {
          bestDist = dist;
          bestVillage = src;
        }
      }

      if (!bestVillage) continue;

      var travelMs = TWTools.DataFetcher.calcTravelTime(
        { x: bestVillage.x, y: bestVillage.y }, target, fakeUnitType
      );

      var launchMs;
      if (fakeLandingMs !== null) {
        // Simultaneous arrival
        launchMs = fakeLandingMs - travelMs;
        // TW mechanic: ms of send = ms of arrival. Force launch ms to match landing ms.
        var fLandMs = fakeLandingMs % 1000;
        var fLaunchMs = ((launchMs % 1000) + 1000) % 1000;
        if (fLaunchMs !== fLandMs) {
          launchMs = launchMs - fLaunchMs + fLandMs;
        }
      } else {
        // No landing time specified — calculate for "ASAP" (launch now + 1 min buffer)
        launchMs = nowMs + 60000;
      }

      // Build send link with target coords as x/y params
      var targetParts2 = targetStr2.split('|');
      var sendParams = 'village=' + bestVillage.id + '&screen=place&x=' +
        targetParts2[0] + '&y=' + targetParts2[1];

      var entry = {
        targetCoords: targetStr2,
        source: bestVillage,
        distance: bestDist,
        travelTimeMs: travelMs,
        launchTimeMs: launchMs,
        sendLink: '/game.php?' + sendParams,
        spyCount: spyCount,
        catCount: catCount
      };
      fakeEntries.push(entry);
    }

    // Sort by launch time
    fakeEntries.sort(function(a, b) { return a.launchTimeMs - b.launchTimeMs; });

    saveFakes();
    renderFakeResults();
    TWTools.UI.toast('Generated ' + fakeEntries.length + ' fakes for ' + targetList.length + ' targets', 'success');
  }

  /**
   * Save fake entries to localStorage.
   */
  function saveFakes() {
    TWTools.Storage.set(STORAGE_PREFIX + 'fakes', fakeEntries);
  }

  /**
   * Load saved fakes from localStorage.
   */
  function loadFakes() {
    var saved = TWTools.Storage.get(STORAGE_PREFIX + 'fakes');
    if (saved && Array.isArray(saved)) {
      fakeEntries = saved;
    }
  }

  /**
   * Render fake attack results table.
   */
  function renderFakeResults() {
    var $results = $('#' + ID_PREFIX + 'fake-results');

    if (fakeEntries.length === 0) {
      $results.html('<div style="color:#7a6840;font-size:10px;">No fakes generated.</div>');
      return;
    }

    var html = [
      '<table class="vis" style="width:100%;">',
      '<thead>',
      '  <tr>',
      '    <th>#</th>',
      '    <th>Target</th>',
      '    <th>Source</th>',
      '    <th>Dist</th>',
      '    <th>Travel</th>',
      '    <th>Launch</th>',
      '    <th></th>',
      '  </tr>',
      '</thead>',
      '<tbody>'
    ];

    for (var i = 0; i < fakeEntries.length; i++) {
      var entry = fakeEntries[i];
      var srcCoords = entry.source.x + '|' + entry.source.y;
      var launchDisp = TWTools.formatTime(
        entry.launchTimeMs >= 86400000 ? entry.launchTimeMs - 86400000 : Math.max(0, entry.launchTimeMs)
      );
      var launchPfx = entry.launchTimeMs >= 86400000 ? 'tmw ' : '';

      html.push(
        '<tr>' +
        '<td style="font-size:10px;">' + (i + 1) + '</td>' +
        '<td style="font-family:monospace;font-size:10px;">' + escapeHtml(entry.targetCoords) + '</td>' +
        '<td style="font-size:10px;">' + truncate(entry.source.name, 12) +
          '<br/><span style="font-family:monospace;font-size:9px;color:#7a6840;">' + srcCoords + '</span></td>' +
        '<td style="text-align:right;font-size:10px;">' + entry.distance.toFixed(1) + '</td>' +
        '<td style="font-family:monospace;font-size:10px;">' + TWTools.formatDuration(entry.travelTimeMs) + '</td>' +
        '<td style="font-family:monospace;font-size:10px;">' + launchPfx + launchDisp + '</td>' +
        '<td><a href="' + entry.sendLink + '" target="_blank" ' +
          'style="font-size:9px;text-decoration:none;" title="Open Rally Point">&#9876; Go</a></td>' +
        '</tr>'
      );
    }

    html.push('</tbody></table>');
    html.push('<div style="font-size:9px;color:#7a6840;margin-top:4px;">');
    html.push('Units per fake: ' + (fakeEntries[0].spyCount || 0) + ' spy + ' +
      (fakeEntries[0].catCount || 0) + ' catapult');
    html.push('</div>');
    $results.html(html.join(''));
  }

  /**
   * Export fake plan as BBCode.
   */
  function onExportFakesBBCode() {
    if (fakeEntries.length === 0) {
      TWTools.UI.toast('No fakes to export', 'warning');
      return;
    }

    var lines = [];
    lines.push('[b]Fake Attack Plan[/b]');
    lines.push('[i]Generated by TW Attack Planner v' + VERSION + '[/i]');
    lines.push('Units per fake: ' + (fakeEntries[0].spyCount || 0) + ' spy + ' +
      (fakeEntries[0].catCount || 0) + ' catapult');
    lines.push('');
    lines.push('[table]');
    lines.push('[**]#[||]Target[||]Source[||]Distance[||]Travel[||]Launch[/**]');

    for (var i = 0; i < fakeEntries.length; i++) {
      var entry = fakeEntries[i];
      var srcCoords = entry.source.x + '|' + entry.source.y;
      var launchDisp = TWTools.formatTime(
        entry.launchTimeMs >= 86400000 ? entry.launchTimeMs - 86400000 : Math.max(0, entry.launchTimeMs)
      );
      lines.push('[*]' + (i + 1) + '[|][coord]' + entry.targetCoords + '[/coord][|]' +
        '[coord]' + srcCoords + '[/coord][|]' +
        entry.distance.toFixed(1) + '[|]' +
        TWTools.formatDuration(entry.travelTimeMs) + '[|]' + launchDisp);
    }

    lines.push('[/table]');

    var bbcode = lines.join('\n');
    copyToClipboard(bbcode);
    TWTools.UI.toast('Fake plan BBCode copied to clipboard!', 'success');
  }

  // ============================================================
  // SETTINGS TAB
  // ============================================================

  /**
   * Build the Settings tab: default unit, fake units, alert config.
   */
  function buildSettingsTab() {
    var $panel = card.getTabContent('settings');

    var html = [
      '<div style="padding:4px;">',
      '  <div style="font-weight:bold;margin-bottom:6px;">Planner Settings</div>',
      '  <table class="vis" style="width:100%;">',

      // Default unit
      '    <tr>',
      '      <td style="width:150px;">Default unit type:</td>',
      '      <td><select id="' + ID_PREFIX + 'set-unit" style="font-size:11px;">',
      buildUnitOptions(),
      '      </select></td>',
      '    </tr>',

      // Default fake units
      '    <tr>',
      '      <td>Default fake spies:</td>',
      '      <td><input type="number" id="' + ID_PREFIX + 'set-fake-spy" ',
      '        value="' + Settings.fakeSpyCount + '" style="width:50px;font-size:11px;" min="0" /></td>',
      '    </tr>',
      '    <tr>',
      '      <td>Default fake catapults:</td>',
      '      <td><input type="number" id="' + ID_PREFIX + 'set-fake-cat" ',
      '        value="' + Settings.fakeCatCount + '" style="width:50px;font-size:11px;" min="0" /></td>',
      '    </tr>',

      // Sound alert
      '    <tr>',
      '      <td>Sound alerts:</td>',
      '      <td><label><input type="checkbox" id="' + ID_PREFIX + 'set-sound" ' +
        (Settings.soundEnabled ? 'checked' : '') + ' /> Enabled</label></td>',
      '    </tr>',
      '    <tr>',
      '      <td>Alert before launch:</td>',
      '      <td><input type="number" id="' + ID_PREFIX + 'set-alert-sec" ',
      '        value="' + Settings.alertSeconds + '" style="width:50px;font-size:11px;" min="5" max="300" /> seconds</td>',
      '    </tr>',
      '    <tr>',
      '      <td>Alert sound repeats:</td>',
      '      <td><input type="number" id="' + ID_PREFIX + 'set-alert-repeat" ',
      '        value="' + Settings.alertRepeat + '" style="width:50px;font-size:11px;" min="1" max="10" /> times</td>',
      '    </tr>',

      // Auto sort
      '    <tr>',
      '      <td>Auto-sort by launch time:</td>',
      '      <td><label><input type="checkbox" id="' + ID_PREFIX + 'set-autosort" ' +
        (Settings.autoSort ? 'checked' : '') + ' /> Enabled</label></td>',
      '    </tr>',

      // Max distance for fakes
      '    <tr>',
      '      <td>Default fake max distance:</td>',
      '      <td><input type="number" id="' + ID_PREFIX + 'set-fake-dist" ',
      '        value="' + Settings.fakeMaxDistance + '" style="width:50px;font-size:11px;" min="1" /> fields</td>',
      '    </tr>',

      // Default village group
      '    <tr>',
      '      <td>Default village group:</td>',
      '      <td><select id="' + ID_PREFIX + 'set-group" style="font-size:11px;">',
      '        <option value="0"' + (Settings.defaultGroupId === 0 ? ' selected' : '') + '>All villages</option>',
      buildGroupOptions(),
      '      </select></td>',
      '    </tr>',

      '  </table>',

      '  <div style="margin-top:8px;">',
      '    <button class="btn" id="' + ID_PREFIX + 'save-settings" style="font-size:11px;">',
      '      Save Settings</button>',
      '    <button class="btn" id="' + ID_PREFIX + 'test-sound" style="font-size:11px;margin-left:6px;">',
      '      Test Sound</button>',
      '    <button class="btn" id="' + ID_PREFIX + 'reset-settings" style="font-size:11px;margin-left:6px;color:#a02020;">',
      '      Reset Defaults</button>',
      '  </div>',

      '  <div style="margin-top:12px;border-top:1px solid #c0a060;padding-top:6px;">',
      '    <div style="font-weight:bold;margin-bottom:4px;">World Info</div>',
      '    <table class="vis" style="width:100%;">',
      '      <tr><td>World speed:</td><td>' + TWTools.DataFetcher.getWorldSpeed() + 'x</td></tr>',
      '      <tr><td>Unit speed factor:</td><td>' + TWTools.DataFetcher.getUnitSpeedFactor() + 'x</td></tr>',
      '      <tr><td>Your villages:</td><td>' + playerVillages.length + '</td></tr>',
      '      <tr><td>Player:</td><td>' + escapeHtml(TWTools.getPlayerName()) + '</td></tr>',
      '    </table>',
      '  </div>',
      '</div>'
    ].join('\n');

    $panel.html(html);

    // Set current values
    $('#' + ID_PREFIX + 'set-unit').val(Settings.defaultUnit);
    $('#' + ID_PREFIX + 'set-group').val(Settings.defaultGroupId);

    // Bind events
    $('#' + ID_PREFIX + 'save-settings').on('click', function() {
      Settings.defaultUnit = $('#' + ID_PREFIX + 'set-unit').val();
      Settings.fakeSpyCount = parseInt($('#' + ID_PREFIX + 'set-fake-spy').val(), 10) || 1;
      Settings.fakeCatCount = parseInt($('#' + ID_PREFIX + 'set-fake-cat').val(), 10) || 1;
      Settings.soundEnabled = $('#' + ID_PREFIX + 'set-sound').is(':checked');
      Settings.alertSeconds = parseInt($('#' + ID_PREFIX + 'set-alert-sec').val(), 10) || 30;
      Settings.alertRepeat = Math.max(1, Math.min(10, parseInt($('#' + ID_PREFIX + 'set-alert-repeat').val(), 10) || 3));
      Settings.autoSort = $('#' + ID_PREFIX + 'set-autosort').is(':checked');
      Settings.fakeMaxDistance = parseInt($('#' + ID_PREFIX + 'set-fake-dist').val(), 10) || 50;
      Settings.defaultGroupId = parseInt($('#' + ID_PREFIX + 'set-group').val(), 10) || 0;
      Settings.save();
      TWTools.UI.toast('Settings saved', 'success');
    });

    $('#' + ID_PREFIX + 'test-sound').on('click', function() {
      playBeepRepeated();
    });

    $('#' + ID_PREFIX + 'reset-settings').on('click', function() {
      Settings.reset();
      buildSettingsTab();
      TWTools.UI.toast('Settings reset to defaults', 'warning');
    });
  }

  // ============================================================
  // MAIN UPDATE LOOP
  // ============================================================

  /**
   * Start the main update loop for live countdowns.
   */
  function startUpdates() {
    updateInterval = setInterval(function() {
      updatePlanCountdowns();
    }, 50);
  }

  /**
   * Stop the main update loop.
   */
  function stopUpdates() {
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }
  }

  // ============================================================
  // UTILITIES
  // ============================================================

  /**
   * Escape HTML special characters.
   * @param {string} str - Raw string.
   * @returns {string} Escaped string.
   */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Truncate string to max length with ellipsis.
   * @param {string} str - Input string.
   * @param {number} max - Max length.
   * @returns {string} Truncated string.
   */
  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.substring(0, max) + '...' : str;
  }

  /**
   * Copy text to clipboard using execCommand fallback.
   * @param {string} text - Text to copy.
   */
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
      return;
    }
    // Fallback for older browsers
    var $temp = $('<textarea></textarea>');
    $temp.val(text);
    $('body').append($temp);
    $temp.select();
    try {
      document.execCommand('copy');
    } catch (e) {
      // Silent fail
    }
    $temp.remove();
  }

  // ============================================================
  // CLEANUP
  // ============================================================

  /**
   * Destroy the planner: stop updates, destroy card.
   */
  function destroy() {
    stopUpdates();
    if (card) {
      card.destroy();
      card = null;
    }
  }

  // ============================================================
  // AUTO-INIT
  // ============================================================

  // Initialize when DOM is ready
  $(document).ready(function() {
    init();
  });

})(window, jQuery);
