;(function(window, $) {
  'use strict';

  // ============================================================
  // TW ATTACK PLANNER v1.0.0
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

  var VERSION = '1.0.0';
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

    /** @type {boolean} Auto-sort attack list by launch time. */
    autoSort: true,

    /** @type {number} Max distance filter for fakes (fields). */
    fakeMaxDistance: 50,

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
        this.autoSort = saved.autoSort !== false;
        this.fakeMaxDistance = saved.fakeMaxDistance || 50;
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
        autoSort: this.autoSort,
        fakeMaxDistance: this.fakeMaxDistance
      });
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
      '    <input type="text" id="' + ID_PREFIX + 'village-filter" ',
      '      placeholder="Filter villages..." style="width:200px;font-size:11px;" />',
      '    <label style="margin-left:8px;font-size:10px;">',
      '      <input type="checkbox" id="' + ID_PREFIX + 'select-all" /> Select all',
      '    </label>',
      '  </div>',

      // Source village table
      '  <div style="max-height:150px;overflow-y:auto;border:1px solid #c0a060;margin-bottom:6px;">',
      '    <table class="vis" id="' + ID_PREFIX + 'village-table" style="width:100%;">',
      '      <thead>',
      '        <tr><th></th><th>Village</th><th>Coords</th><th>Points</th></tr>',
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

    // Set default unit type
    $('#' + ID_PREFIX + 'unit-type').val(Settings.defaultUnit);

    // Bind events
    $('#' + ID_PREFIX + 'add-plan').on('click', onAddPlan);
    $('#' + ID_PREFIX + 'export-bbcode').on('click', onExportBBCode);
    $('#' + ID_PREFIX + 'clear-plans').on('click', onClearPlans);
    $('#' + ID_PREFIX + 'select-all').on('change', onSelectAll);
    $('#' + ID_PREFIX + 'village-filter').on('input', onFilterVillages);

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
   * Build village table rows with checkboxes.
   * @returns {string} HTML table rows.
   */
  function buildVillageRows() {
    var rows = '';
    for (var i = 0; i < playerVillages.length; i++) {
      var v = playerVillages[i];
      var coords = v.x + '|' + v.y;
      rows += '<tr class="' + ID_PREFIX + 'village-row" data-coords="' + coords + '" ' +
        'data-name="' + (v.name || '').toLowerCase() + '">' +
        '<td><input type="checkbox" class="' + ID_PREFIX + 'village-cb" ' +
        'data-village-idx="' + i + '" /></td>' +
        '<td style="font-size:10px;">' + escapeHtml(v.name) + '</td>' +
        '<td style="font-family:monospace;font-size:10px;">' + coords + '</td>' +
        '<td style="text-align:right;font-size:10px;">' + (v.points || 0) + '</td>' +
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
        escapeHtml(pl.targetCoords) + ' | Landing: ' + landDisplay + landTimeDisplay + '</span>' +
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
        '<td><a href="' + rallyLink + '" target="_blank" ' +
          'style="font-size:9px;text-decoration:none;" title="Open Rally Point">&#9876; Go</a></td>' +
        '</tr>'
      );
    }

    tableHtml.push('</tbody></table>');
    $container.append(tableHtml.join(''));
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
          playBeep();
          TWTools.UI.toast('ALERT: Attack on ' + plan.targetCoords + ' launches in ' +
            Settings.alertSeconds + 's!', 'warning');
        }
      }
    }
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
   * Filter village rows by name or coords.
   */
  function onFilterVillages() {
    var query = ($('#' + ID_PREFIX + 'village-filter').val() || '').toLowerCase();
    $('.' + ID_PREFIX + 'village-row').each(function() {
      var name = $(this).attr('data-name') || '';
      var coords = $(this).attr('data-coords') || '';
      var match = !query || name.indexOf(query) !== -1 || coords.indexOf(query) !== -1;
      $(this).toggle(match);
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

    // Bind events
    $('#' + ID_PREFIX + 'gen-fakes').on('click', onGenerateFakes);
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

    for (var t = 0; t < targetList.length; t++) {
      var target = targetList[t];
      var targetStr2 = target.x + '|' + target.y;

      // Find nearest source village within max distance
      var bestVillage = null;
      var bestDist = Infinity;

      for (var v = 0; v < playerVillages.length; v++) {
        var src = playerVillages[v];
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

    renderFakeResults();
    TWTools.UI.toast('Generated ' + fakeEntries.length + ' fakes for ' + targetList.length + ' targets', 'success');
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

      '  </table>',

      '  <div style="margin-top:8px;">',
      '    <button class="btn" id="' + ID_PREFIX + 'save-settings" style="font-size:11px;">',
      '      Save Settings</button>',
      '    <button class="btn" id="' + ID_PREFIX + 'test-sound" style="font-size:11px;margin-left:6px;">',
      '      Test Sound</button>',
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

    // Bind events
    $('#' + ID_PREFIX + 'save-settings').on('click', function() {
      Settings.defaultUnit = $('#' + ID_PREFIX + 'set-unit').val();
      Settings.fakeSpyCount = parseInt($('#' + ID_PREFIX + 'set-fake-spy').val(), 10) || 1;
      Settings.fakeCatCount = parseInt($('#' + ID_PREFIX + 'set-fake-cat').val(), 10) || 1;
      Settings.soundEnabled = $('#' + ID_PREFIX + 'set-sound').is(':checked');
      Settings.alertSeconds = parseInt($('#' + ID_PREFIX + 'set-alert-sec').val(), 10) || 30;
      Settings.autoSort = $('#' + ID_PREFIX + 'set-autosort').is(':checked');
      Settings.fakeMaxDistance = parseInt($('#' + ID_PREFIX + 'set-fake-dist').val(), 10) || 50;
      Settings.save();
      TWTools.UI.toast('Settings saved', 'success');
    });

    $('#' + ID_PREFIX + 'test-sound').on('click', function() {
      playBeep();
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
