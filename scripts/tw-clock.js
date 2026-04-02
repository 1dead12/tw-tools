;(function(window, $) {
  'use strict';

  // ============================================================
  // TW MS CLOCK v3.0.0
  // ============================================================
  // Millisecond-precision server clock + countdown timers.
  // Uses TWTools.UI.createCard() with tabs: Clock | Timers | Settings.
  // 60fps clock display via requestAnimationFrame.
  //
  // REQUIRES: window.TWTools (tw-core.js + tw-ui.js)
  // ============================================================

  var TWTools = window.TWTools;
  if (!TWTools || !TWTools.UI) {
    alert('[MS Clock] Error: TWTools core library (tw-core.js + tw-ui.js) not loaded.');
    return;
  }

  var VERSION = '3.0.0';
  var ID_PREFIX = 'twc-';
  var STORAGE_PREFIX = 'twc_';

  // ============================================================
  // SETTINGS
  // ============================================================

  var Settings = {
    /** @type {boolean} Whether to patch the game's #serverTime element to show ms. */
    patchGameClock: false,

    /** @type {number} Font size for the time display (px). */
    fontSize: 36,

    /** @type {number} Alert volume (0.0 to 1.0). */
    alertVolume: 0.7,

    /** @type {number} Auto-cleanup interval in minutes. */
    cleanupMinutes: 5,

    load: function() {
      this.patchGameClock = TWTools.Storage.get(STORAGE_PREFIX + 'patchClock') || false;
      this.fontSize = TWTools.Storage.get(STORAGE_PREFIX + 'fontSize') || 36;
      this.alertVolume = TWTools.Storage.get(STORAGE_PREFIX + 'alertVolume');
      if (this.alertVolume === null || this.alertVolume === undefined) this.alertVolume = 0.7;
      this.cleanupMinutes = TWTools.Storage.get(STORAGE_PREFIX + 'cleanupMin') || 5;
    },

    save: function() {
      TWTools.Storage.set(STORAGE_PREFIX + 'patchClock', this.patchGameClock);
      TWTools.Storage.set(STORAGE_PREFIX + 'fontSize', this.fontSize);
      TWTools.Storage.set(STORAGE_PREFIX + 'alertVolume', this.alertVolume);
      TWTools.Storage.set(STORAGE_PREFIX + 'cleanupMin', this.cleanupMinutes);
    }
  };

  // ============================================================
  // AUDIO: INLINE BASE64 BEEP (no external dependency)
  // ============================================================

  /**
   * Generate a simple beep tone as base64 WAV data URI.
   * 0.5s 660Hz sine wave with fade-out, 8-bit mono 8000Hz.
   * @type {string}
   */
  var BEEP_DATA_URI = (function() {
    var sampleRate = 8000;
    var duration = 0.5;
    var freq = 660;
    var numSamples = Math.floor(sampleRate * duration);
    var dataSize = numSamples;
    var fileSize = 44 + dataSize;

    var buf = new ArrayBuffer(fileSize);
    var view = new DataView(buf);

    // RIFF header
    writeStr(view, 0, 'RIFF');
    view.setUint32(4, fileSize - 8, true);
    writeStr(view, 8, 'WAVE');

    // fmt chunk
    writeStr(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);

    // data chunk
    writeStr(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    for (var i = 0; i < numSamples; i++) {
      var t = i / sampleRate;
      var sample = Math.sin(2 * Math.PI * freq * t);
      var fadeStart = numSamples * 0.6;
      if (i > fadeStart) {
        sample *= 1 - ((i - fadeStart) / (numSamples - fadeStart));
      }
      view.setUint8(44 + i, Math.floor(128 + sample * 96));
    }

    var bytes = new Uint8Array(buf);
    var binary = '';
    for (var j = 0; j < bytes.length; j++) {
      binary += String.fromCharCode(bytes[j]);
    }
    return 'data:audio/wav;base64,' + btoa(binary);

    function writeStr(v, offset, str) {
      for (var k = 0; k < str.length; k++) {
        v.setUint8(offset + k, str.charCodeAt(k));
      }
    }
  })();

  /**
   * Play the notification beep sound at the configured volume.
   */
  function playBeep() {
    try {
      var audio = new Audio(BEEP_DATA_URI);
      audio.volume = Settings.alertVolume;
      audio.play();
    } catch (e) {
      // Audio not available — silent fail
    }
  }

  // ============================================================
  // COLOR PALETTE (for timers)
  // ============================================================

  var COLORS = {
    green:  { bg: '#e8f5e0', border: '#4a7a1e', text: '#2a6a0a', bar: '#4a7a1e' },
    yellow: { bg: '#fff8d0', border: '#b8960a', text: '#806800', bar: '#cc9900' },
    red:    { bg: '#fde8e8', border: '#cc2020', text: '#8a1010', bar: '#cc2020' },
    blue:   { bg: '#e8f0ff', border: '#2060cc', text: '#0a4090', bar: '#2060cc' }
  };

  // ============================================================
  // TIMER DATA MODEL
  // ============================================================

  /**
   * @typedef {Object} Timer
   * @property {string} id - Unique timer ID.
   * @property {string} label - User-visible label text.
   * @property {string} mode - "countdown" or "target".
   * @property {number} targetTimeAbsMs - Absolute target time in ms (Date.now() epoch).
   * @property {boolean} soundEnabled - Whether to play sound when done.
   * @property {string} color - Color category: "green", "yellow", "red", "blue".
   * @property {boolean} done - Whether the timer has completed.
   * @property {number} doneAt - Timestamp (Date.now()) when the timer completed.
   */

  /** @type {Array.<Timer>} Active timer list. */
  var timers = [];

  /** @type {number} Counter for generating unique timer IDs. */
  var timerCounter = 0;

  // ============================================================
  // APPLICATION STATE
  // ============================================================

  /** @type {?Object} Card controller reference. */
  var card = null;

  /** @type {?number} requestAnimationFrame ID for the clock. */
  var rafId = null;

  /** @type {?number} Timer update interval ID (50ms). */
  var timerInterval = null;

  /** @type {boolean} Whether the add-timer form is visible. */
  var formVisible = false;

  // ============================================================
  // PERSISTENCE (backward compatible with tw-reminder storage keys)
  // ============================================================

  var TIMER_STORAGE_PREFIX = 'twr_';

  /**
   * Save timers to localStorage.
   */
  function saveTimers() {
    TWTools.Storage.set(TIMER_STORAGE_PREFIX + 'timers', timers);
    TWTools.Storage.set(TIMER_STORAGE_PREFIX + 'counter', timerCounter);
  }

  /**
   * Load timers from localStorage. Filters out fully expired entries.
   */
  function loadTimers() {
    var saved = TWTools.Storage.get(TIMER_STORAGE_PREFIX + 'timers');
    var savedCounter = TWTools.Storage.get(TIMER_STORAGE_PREFIX + 'counter');
    timerCounter = savedCounter || 0;

    var cleanupMs = (Settings.cleanupMinutes || 5) * 60 * 1000;

    if (saved && Array.isArray(saved)) {
      var now = Date.now();
      timers = [];
      for (var i = 0; i < saved.length; i++) {
        var t = saved[i];
        if (t.done && t.doneAt > 0 && (now - t.doneAt) > cleanupMs) {
          continue;
        }
        timers.push(t);
      }
      sortTimers();
    }
  }

  // ============================================================
  // TIMER OPERATIONS
  // ============================================================

  /**
   * Sort timers by remaining time (soonest first), done timers at the end.
   */
  function sortTimers() {
    var now = Date.now();
    timers.sort(function(a, b) {
      if (a.done && !b.done) return 1;
      if (!a.done && b.done) return -1;
      return a.targetTimeAbsMs - b.targetTimeAbsMs;
    });
  }

  /**
   * Remove a timer by ID.
   * @param {string} timerId - Timer ID to remove.
   */
  function removeTimer(timerId) {
    for (var i = 0; i < timers.length; i++) {
      if (timers[i].id === timerId) {
        timers.splice(i, 1);
        break;
      }
    }
    saveTimers();
    renderTimerList();
    updateTimerStatus();
  }

  /**
   * Format remaining ms as readable countdown.
   * @param {number} ms - Remaining milliseconds.
   * @returns {string} Formatted string.
   */
  function formatRemaining(ms) {
    if (ms <= 0) return 'DONE';
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    var tenths = Math.floor((ms % 1000) / 100);

    if (h > 0) {
      return h + ':' + TWTools.pad2(m) + ':' + TWTools.pad2(s);
    }
    if (m > 0) {
      return m + ':' + TWTools.pad2(s) + '.' + tenths;
    }
    return s + '.' + tenths + 's';
  }

  // ============================================================
  // STYLES
  // ============================================================

  /**
   * Inject clock and timer specific CSS styles.
   */
  function injectStyles() {
    if (document.getElementById(ID_PREFIX + 'styles')) return;

    var css = [
      // Clock display
      '.' + ID_PREFIX + 'time-display {',
      '  font-family: "Courier New", monospace;',
      '  font-weight: bold;',
      '  color: #3e2e14;',
      '  letter-spacing: 2px;',
      '  text-align: center;',
      '  padding: 16px 12px;',
      '  line-height: 1.2;',
      '}',

      // Timer item card
      '.' + ID_PREFIX + 'timer-item {',
      '  border: 1px solid #c0a060;',
      '  border-radius: 3px;',
      '  padding: 6px 8px;',
      '  margin-bottom: 4px;',
      '  position: relative;',
      '  transition: background-color 0.3s;',
      '}',

      // Progress bar container
      '.' + ID_PREFIX + 'progress-wrap {',
      '  height: 6px;',
      '  background: #e0d4a8;',
      '  border-radius: 3px;',
      '  margin-top: 4px;',
      '  overflow: hidden;',
      '}',

      // Progress bar fill
      '.' + ID_PREFIX + 'progress-bar {',
      '  height: 100%;',
      '  border-radius: 3px;',
      '  transition: width 0.1s linear;',
      '}',

      // Delete button
      '.' + ID_PREFIX + 'delete-btn {',
      '  position: absolute;',
      '  top: 4px;',
      '  right: 6px;',
      '  cursor: pointer;',
      '  color: #a05050;',
      '  font-weight: bold;',
      '  font-size: 12px;',
      '  line-height: 1;',
      '}',
      '.' + ID_PREFIX + 'delete-btn:hover {',
      '  color: #cc0000;',
      '}',

      // Done state flash
      '.' + ID_PREFIX + 'timer-done {',
      '  animation: ' + ID_PREFIX + 'flash 0.5s ease-in-out 3;',
      '}',
      '@keyframes ' + ID_PREFIX + 'flash {',
      '  0%, 100% { opacity: 1; }',
      '  50% { opacity: 0.4; }',
      '}',

      // Timer countdown text
      '.' + ID_PREFIX + 'countdown {',
      '  font-family: monospace;',
      '  font-size: 14px;',
      '  font-weight: bold;',
      '}',

      // Timer label
      '.' + ID_PREFIX + 'label {',
      '  font-size: 11px;',
      '  font-weight: bold;',
      '  margin-bottom: 2px;',
      '  padding-right: 16px;',
      '  word-break: break-word;',
      '}',

      // Inline form
      '.' + ID_PREFIX + 'form {',
      '  border: 1px solid #c0a060;',
      '  background: #f4e4bc;',
      '  padding: 6px;',
      '  margin-bottom: 6px;',
      '  border-radius: 3px;',
      '}',
      '.' + ID_PREFIX + 'form label {',
      '  display: block;',
      '  font-size: 10px;',
      '  margin-bottom: 3px;',
      '}',
      '.' + ID_PREFIX + 'form input[type="text"],',
      '.' + ID_PREFIX + 'form input[type="number"],',
      '.' + ID_PREFIX + 'form select {',
      '  font-size: 11px;',
      '  margin-bottom: 4px;',
      '}',

      // Color swatches
      '.' + ID_PREFIX + 'color-swatch {',
      '  display: inline-block;',
      '  width: 18px;',
      '  height: 18px;',
      '  border: 2px solid transparent;',
      '  border-radius: 3px;',
      '  cursor: pointer;',
      '  margin-right: 4px;',
      '  vertical-align: middle;',
      '}',
      '.' + ID_PREFIX + 'color-swatch.selected {',
      '  border-color: #3e2e14;',
      '}',

      // Add button
      '.' + ID_PREFIX + 'add-btn {',
      '  display: block;',
      '  width: 100%;',
      '  text-align: center;',
      '  padding: 4px;',
      '  font-size: 11px;',
      '  cursor: pointer;',
      '  background: #e8d8a8;',
      '  border: 1px solid #c0a060;',
      '  border-radius: 3px;',
      '  color: #3e2e14;',
      '}',
      '.' + ID_PREFIX + 'add-btn:hover {',
      '  background: #dac48c;',
      '}',

      // Settings section
      '.' + ID_PREFIX + 'settings-row {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 6px;',
      '  margin-bottom: 8px;',
      '  font-size: 11px;',
      '}',
      '.' + ID_PREFIX + 'settings-row label {',
      '  min-width: 120px;',
      '}',
      '.' + ID_PREFIX + 'settings-row input[type="range"] {',
      '  flex: 1;',
      '}',
      '.' + ID_PREFIX + 'settings-row .value-display {',
      '  min-width: 40px;',
      '  text-align: right;',
      '  font-family: monospace;',
      '}',

      // Settings button
      '.' + ID_PREFIX + 'test-btn {',
      '  padding: 3px 10px;',
      '  font-size: 10px;',
      '  cursor: pointer;',
      '  background: #e8d8a8;',
      '  border: 1px solid #c0a060;',
      '  border-radius: 3px;',
      '  color: #3e2e14;',
      '}',
      '.' + ID_PREFIX + 'test-btn:hover {',
      '  background: #dac48c;',
      '}'
    ].join('\n');

    var style = document.createElement('style');
    style.id = ID_PREFIX + 'styles';
    style.type = 'text/css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ============================================================
  // UI CREATION
  // ============================================================

  /**
   * Create the main card UI with Clock, Timers, and Settings tabs.
   */
  function createUI() {
    card = TWTools.UI.createCard({
      id: ID_PREFIX + 'main',
      title: 'MS Clock',
      version: VERSION,
      width: 320,
      height: 420,
      minWidth: 260,
      minHeight: 200,
      tabs: [
        { id: 'clock', label: 'Clock' },
        { id: 'timers', label: 'Timers' },
        { id: 'settings', label: 'Settings' }
      ],
      onTabChange: function(tabId) {
        if (tabId === 'clock') {
          renderClockTab();
        } else if (tabId === 'timers') {
          renderTimersTab();
        } else if (tabId === 'settings') {
          renderSettingsTab();
        }
      },
      onClose: function() {
        destroy();
      }
    });

    // Render initial tab (Clock)
    renderClockTab();
  }

  // ============================================================
  // CLOCK TAB
  // ============================================================

  /**
   * Render the Clock tab content.
   */
  function renderClockTab() {
    if (!card) return;
    var $panel = card.getTabContent('clock');
    $panel.html(
      '<div class="' + ID_PREFIX + 'time-display" id="' + ID_PREFIX + 'time" ' +
        'style="font-size:' + Settings.fontSize + 'px;">' +
        '--:--:--.---' +
      '</div>'
    );
  }

  // ============================================================
  // 60fps CLOCK ANIMATION (runs continuously across all tabs)
  // ============================================================

  /**
   * Start the 60fps animation loop for the clock display.
   * Updates both the Clock tab (if visible) and patches the game clock if enabled.
   */
  function startClockAnimation() {
    function tick() {
      var nowMs = TWTools.TimeSync.now();
      var h = Math.floor(nowMs / 3600000) % 24;
      var m = Math.floor((nowMs % 3600000) / 60000);
      var s = Math.floor((nowMs % 60000) / 1000);
      var ms = Math.floor(nowMs % 1000);

      var timeStr = TWTools.pad2(h) + ':' + TWTools.pad2(m) + ':' + TWTools.pad2(s) + '.' + TWTools.pad3(ms);

      // Update the clock tab display (only exists when Clock tab is active)
      var timeEl = document.getElementById(ID_PREFIX + 'time');
      if (timeEl) {
        timeEl.textContent = timeStr;
      }

      // Optionally patch the game's #serverTime element
      if (Settings.patchGameClock) {
        patchGameClock(h, m, s, ms);
      }

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
  }

  /**
   * Stop the clock animation loop.
   */
  function stopClockAnimation() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  /**
   * Patch the game's #serverTime element to show milliseconds.
   * @param {number} h - Hours.
   * @param {number} m - Minutes.
   * @param {number} s - Seconds.
   * @param {number} ms - Milliseconds.
   */
  function patchGameClock(h, m, s, ms) {
    var el = document.getElementById('serverTime');
    if (!el) return;

    if (!el._twcOriginal) {
      el._twcOriginal = el.textContent;
      el._twcPatched = true;
    }

    el.textContent = TWTools.pad2(h) + ':' + TWTools.pad2(m) + ':' + TWTools.pad2(s) + '.' + TWTools.pad3(ms);
  }

  /**
   * Restore the game's #serverTime element to its original state.
   */
  function restoreGameClock() {
    var el = document.getElementById('serverTime');
    if (el && el._twcPatched) {
      // Restore original text content before our patch
      if (el._twcOriginal) {
        el.textContent = el._twcOriginal;
      }
      el._twcPatched = false;
      delete el._twcOriginal;
    }
  }

  // ============================================================
  // TIMERS TAB
  // ============================================================

  /**
   * Render the Timers tab content.
   */
  function renderTimersTab() {
    if (!card) return;
    var $panel = card.getTabContent('timers');

    var html = [
      // Add timer button
      '<div class="' + ID_PREFIX + 'add-btn" id="' + ID_PREFIX + 'toggle-form">',
      '  + Add Timer',
      '</div>',

      // Inline add-timer form (hidden by default)
      '<div class="' + ID_PREFIX + 'form" id="' + ID_PREFIX + 'form" style="display:none;">',

      '  <label>Label:',
      '    <input type="text" id="' + ID_PREFIX + 'input-label" ',
      '      placeholder="e.g. Snipe on 408|510" style="width:100%;" />',
      '  </label>',

      '  <label>Mode:',
      '    <select id="' + ID_PREFIX + 'input-mode" style="width:100%;">',
      '      <option value="countdown">Countdown (duration)</option>',
      '      <option value="target">Target time (date + time)</option>',
      '    </select>',
      '  </label>',

      // Countdown mode fields
      '  <div id="' + ID_PREFIX + 'mode-countdown">',
      '    <label>Duration (HH:MM:SS or +MM:SS):',
      '      <input type="text" id="' + ID_PREFIX + 'input-duration" ',
      '        placeholder="01:30:00" style="width:100%;font-family:monospace;" />',
      '    </label>',
      '  </div>',

      // Target time mode fields
      '  <div id="' + ID_PREFIX + 'mode-target" style="display:none;">',
      '    <label>Date:',
      '      <select id="' + ID_PREFIX + 'input-day" style="width:100%;">',
      '        <option value="today">Today</option>',
      '        <option value="tomorrow">Tomorrow</option>',
      '      </select>',
      '    </label>',
      '    <label>Time (HH:MM:SS:mmm):',
      '      <input type="text" id="' + ID_PREFIX + 'input-time" ',
      '        placeholder="21:30:00:000" style="width:100%;font-family:monospace;" />',
      '    </label>',
      '  </div>',

      // Sound toggle
      '  <label style="margin-top:2px;">',
      '    <input type="checkbox" id="' + ID_PREFIX + 'input-sound" checked /> Sound alert',
      '  </label>',

      // Color picker
      '  <div style="margin:4px 0;">',
      '    <span style="font-size:10px;">Color: </span>',
      '    <span class="' + ID_PREFIX + 'color-swatch selected" data-color="green" ',
      '      style="background:#4a7a1e;"></span>',
      '    <span class="' + ID_PREFIX + 'color-swatch" data-color="yellow" ',
      '      style="background:#cc9900;"></span>',
      '    <span class="' + ID_PREFIX + 'color-swatch" data-color="red" ',
      '      style="background:#cc2020;"></span>',
      '    <span class="' + ID_PREFIX + 'color-swatch" data-color="blue" ',
      '      style="background:#2060cc;"></span>',
      '  </div>',

      // Form actions
      '  <div style="margin-top:4px;">',
      '    <button class="btn" id="' + ID_PREFIX + 'btn-create" style="font-size:10px;">Create</button>',
      '    <button class="btn" id="' + ID_PREFIX + 'btn-cancel" style="font-size:10px;margin-left:4px;">Cancel</button>',
      '  </div>',

      '</div>',

      // Timer list container
      '<div id="' + ID_PREFIX + 'timer-list" style="margin-top:6px;"></div>'
    ].join('\n');

    $panel.html(html);
    formVisible = false;

    // Bind form events (delegated on the panel)
    bindTimerFormEvents($panel);
    renderTimerList();
    updateTimerStatus();
  }

  /**
   * Bind all timer form event handlers.
   * @param {jQuery} $panel - Timers tab panel element.
   */
  function bindTimerFormEvents($panel) {
    // Unbind previous to avoid duplicates on re-render
    $panel.off('.twcTimers');

    // Toggle form visibility
    $panel.on('click.twcTimers', '#' + ID_PREFIX + 'toggle-form', function() {
      formVisible = !formVisible;
      $('#' + ID_PREFIX + 'form').toggle(formVisible);
      $(this).text(formVisible ? '- Hide Form' : '+ Add Timer');
    });

    // Mode switching
    $panel.on('change.twcTimers', '#' + ID_PREFIX + 'input-mode', function() {
      var mode = $(this).val();
      $('#' + ID_PREFIX + 'mode-countdown').toggle(mode === 'countdown');
      $('#' + ID_PREFIX + 'mode-target').toggle(mode === 'target');
    });

    // Color swatch selection
    $panel.on('click.twcTimers', '.' + ID_PREFIX + 'color-swatch', function() {
      $panel.find('.' + ID_PREFIX + 'color-swatch').removeClass('selected');
      $(this).addClass('selected');
    });

    // Create timer
    $panel.on('click.twcTimers', '#' + ID_PREFIX + 'btn-create', onCreateTimer);

    // Cancel form
    $panel.on('click.twcTimers', '#' + ID_PREFIX + 'btn-cancel', function() {
      formVisible = false;
      $('#' + ID_PREFIX + 'form').hide();
      $('#' + ID_PREFIX + 'toggle-form').text('+ Add Timer');
    });

    // Delete timer (delegated)
    $panel.on('click.twcTimers', '.' + ID_PREFIX + 'delete-btn', function() {
      var timerId = $(this).attr('data-timer-id');
      removeTimer(timerId);
    });
  }

  /**
   * Handle creating a new timer from the form inputs.
   */
  function onCreateTimer() {
    var label = ($('#' + ID_PREFIX + 'input-label').val() || '').trim();
    if (!label) {
      TWTools.UI.toast('Enter a timer label', 'error');
      return;
    }

    var mode = $('#' + ID_PREFIX + 'input-mode').val();
    var soundEnabled = $('#' + ID_PREFIX + 'input-sound').is(':checked');
    var color = $('.' + ID_PREFIX + 'color-swatch.selected').attr('data-color') || 'green';
    var targetTimeAbsMs;

    if (mode === 'countdown') {
      var durationStr = ($('#' + ID_PREFIX + 'input-duration').val() || '').trim();
      var durationMs = TWTools.parseTimeToMs(durationStr);
      if (isNaN(durationMs) || durationMs <= 0) {
        TWTools.UI.toast('Invalid duration (use HH:MM:SS)', 'error');
        return;
      }
      targetTimeAbsMs = Date.now() + durationMs;
    } else {
      var day = $('#' + ID_PREFIX + 'input-day').val();
      var timeStr = ($('#' + ID_PREFIX + 'input-time').val() || '').trim();
      var timeMs = TWTools.parseTimeToMs(timeStr);
      if (isNaN(timeMs)) {
        TWTools.UI.toast('Invalid time (use HH:MM:SS or HH:MM:SS:mmm)', 'error');
        return;
      }

      var serverNow = TWTools.TimeSync.now();
      var realNow = Date.now();
      var midnightAbsMs = realNow - serverNow;

      targetTimeAbsMs = midnightAbsMs + timeMs;
      if (day === 'tomorrow') {
        targetTimeAbsMs += 86400000;
      }

      if (targetTimeAbsMs < realNow && day === 'today') {
        targetTimeAbsMs += 86400000;
      }
    }

    var timer = {
      id: ID_PREFIX + 'timer-' + (++timerCounter),
      label: label,
      mode: mode,
      targetTimeAbsMs: targetTimeAbsMs,
      soundEnabled: soundEnabled,
      color: color,
      done: false,
      doneAt: 0
    };

    timers.push(timer);
    sortTimers();
    saveTimers();
    renderTimerList();
    updateTimerStatus();

    // Clear form
    $('#' + ID_PREFIX + 'input-label').val('');
    $('#' + ID_PREFIX + 'input-duration').val('');
    $('#' + ID_PREFIX + 'input-time').val('');

    TWTools.UI.toast('Timer created: ' + label, 'success');
  }

  /**
   * Render the full timer list in the Timers tab.
   */
  function renderTimerList() {
    var $list = $('#' + ID_PREFIX + 'timer-list');
    if ($list.length === 0) return;

    $list.empty();

    if (timers.length === 0) {
      $list.html(
        '<div style="color:#7a6840;font-size:10px;text-align:center;padding:12px;">' +
        'No timers. Click "+ Add Timer" to create one.</div>'
      );
      return;
    }

    for (var i = 0; i < timers.length; i++) {
      var timer = timers[i];
      var colorSet = COLORS[timer.color] || COLORS.green;

      var $item = $(
        '<div class="' + ID_PREFIX + 'timer-item' + (timer.done ? ' ' + ID_PREFIX + 'timer-done' : '') + '" ' +
        'id="' + timer.id + '" ' +
        'style="background:' + colorSet.bg + ';border-color:' + colorSet.border + ';">' +
        '<span class="' + ID_PREFIX + 'delete-btn" data-timer-id="' + timer.id + '" title="Delete">&times;</span>' +
        '<div class="' + ID_PREFIX + 'label" style="color:' + colorSet.text + ';">' +
          escapeHtml(timer.label) +
          (timer.soundEnabled ? ' <span style="font-size:9px;" title="Sound ON">&#128264;</span>' : '') +
        '</div>' +
        '<div class="' + ID_PREFIX + 'countdown" data-timer-id="' + timer.id + '" ' +
          'style="color:' + colorSet.text + ';">' +
          (timer.done ? 'DONE' : '...') +
        '</div>' +
        '<div class="' + ID_PREFIX + 'progress-wrap">' +
          '<div class="' + ID_PREFIX + 'progress-bar" data-timer-id="' + timer.id + '" ' +
            'style="background:' + colorSet.bar + ';width:100%;"></div>' +
        '</div>' +
        '</div>'
      );

      $list.append($item);
    }
  }

  /**
   * Update all timer countdowns and progress bars.
   * Called every 50ms from the timer update loop.
   */
  function updateTimerDisplays() {
    var now = Date.now();
    var needsRerender = false;
    var cleanupMs = (Settings.cleanupMinutes || 5) * 60 * 1000;

    for (var i = 0; i < timers.length; i++) {
      var timer = timers[i];
      var remaining = timer.targetTimeAbsMs - now;

      var $countdown = $('[data-timer-id="' + timer.id + '"].' + ID_PREFIX + 'countdown');
      var $progressBar = $('[data-timer-id="' + timer.id + '"].' + ID_PREFIX + 'progress-bar');
      var $item = $('#' + timer.id);

      if (remaining <= 0 && !timer.done) {
        // Timer completed
        timer.done = true;
        timer.doneAt = now;
        if ($countdown.length > 0) {
          $countdown.text('DONE');
          $progressBar.css('width', '0%');
          $item.addClass(ID_PREFIX + 'timer-done');
        }

        // Play sound
        if (timer.soundEnabled) {
          playBeep();
          setTimeout(playBeep, 500);
        }

        TWTools.UI.toast('Timer done: ' + timer.label, 'warning');
        saveTimers();
        needsRerender = true;
      } else if (!timer.done && $countdown.length > 0) {
        // Active timer — update countdown
        $countdown.text(formatRemaining(remaining));

        var maxBar = 3600000;
        var pct = Math.min(100, Math.max(0, (remaining / maxBar) * 100));
        $progressBar.css('width', pct + '%');
      }

      // Auto-cleanup
      if (timer.done && timer.doneAt > 0 && (now - timer.doneAt) > cleanupMs) {
        timers.splice(i, 1);
        i--;
        saveTimers();
        needsRerender = true;
      }
    }

    if (needsRerender) {
      sortTimers();
      renderTimerList();
      updateTimerStatus();
    }
  }

  /**
   * Update the card footer status with timer counts.
   */
  function updateTimerStatus() {
    if (!card) return;
    var active = 0;
    var done = 0;
    for (var i = 0; i < timers.length; i++) {
      if (timers[i].done) {
        done++;
      } else {
        active++;
      }
    }
    card.setStatus('Timers: ' + active + ' active, ' + done + ' done');
  }

  // ============================================================
  // INCOMING ATTACK HOOK
  // ============================================================

  /**
   * Hook into incoming attack displays to allow quick timer creation.
   */
  function hookIncomingAttacks() {
    $(document).on('click', '.command_hover_details .relative_time, ' +
      '#commands_incomings .timer, ' +
      'td .arrival_time', function(e) {
      var text = $(this).text().trim();
      var parsed = TWTools.parseArrivalTime(text);
      if (parsed === null) return;

      var serverNow = TWTools.TimeSync.now();
      var realNow = Date.now();
      var midnightAbsMs = realNow - serverNow;
      var targetAbsMs = midnightAbsMs + parsed;

      if (targetAbsMs < realNow) return;

      var label = 'Incoming: ' + text;
      var timer = {
        id: ID_PREFIX + 'timer-' + (++timerCounter),
        label: label,
        mode: 'target',
        targetTimeAbsMs: targetAbsMs,
        soundEnabled: true,
        color: 'red',
        done: false,
        doneAt: 0
      };

      timers.push(timer);
      sortTimers();
      saveTimers();
      renderTimerList();
      updateTimerStatus();

      TWTools.UI.toast('Timer created from arrival: ' + text, 'success');
      e.stopPropagation();
    });
  }

  // ============================================================
  // SETTINGS TAB
  // ============================================================

  /**
   * Render the Settings tab content.
   */
  function renderSettingsTab() {
    if (!card) return;
    var $panel = card.getTabContent('settings');

    var html = [
      '<div style="padding:6px;">',

      // Font size
      '  <div class="' + ID_PREFIX + 'settings-row">',
      '    <label>Clock font size:</label>',
      '    <input type="range" id="' + ID_PREFIX + 'set-fontsize" min="18" max="60" value="' + Settings.fontSize + '">',
      '    <span class="value-display" id="' + ID_PREFIX + 'set-fontsize-val">' + Settings.fontSize + 'px</span>',
      '  </div>',

      // Patch game clock
      '  <div class="' + ID_PREFIX + 'settings-row">',
      '    <label>',
      '      <input type="checkbox" id="' + ID_PREFIX + 'set-patch"' +
                (Settings.patchGameClock ? ' checked' : '') + '> ',
      '      Patch game clock (show ms)',
      '    </label>',
      '  </div>',

      // Alert volume
      '  <div class="' + ID_PREFIX + 'settings-row">',
      '    <label>Alert volume:</label>',
      '    <input type="range" id="' + ID_PREFIX + 'set-volume" min="0" max="100" value="' + Math.round(Settings.alertVolume * 100) + '">',
      '    <span class="value-display" id="' + ID_PREFIX + 'set-volume-val">' + Math.round(Settings.alertVolume * 100) + '%</span>',
      '  </div>',

      // Sound test button
      '  <div class="' + ID_PREFIX + 'settings-row">',
      '    <label></label>',
      '    <button class="' + ID_PREFIX + 'test-btn" id="' + ID_PREFIX + 'set-test-sound">Test Sound</button>',
      '  </div>',

      // Auto-cleanup interval
      '  <div class="' + ID_PREFIX + 'settings-row">',
      '    <label>Auto-cleanup (min):</label>',
      '    <input type="range" id="' + ID_PREFIX + 'set-cleanup" min="1" max="30" value="' + Settings.cleanupMinutes + '">',
      '    <span class="value-display" id="' + ID_PREFIX + 'set-cleanup-val">' + Settings.cleanupMinutes + 'm</span>',
      '  </div>',

      '</div>'
    ].join('\n');

    $panel.html(html);
    bindSettingsEvents($panel);
  }

  /**
   * Bind settings tab event handlers.
   * @param {jQuery} $panel - Settings tab panel element.
   */
  function bindSettingsEvents($panel) {
    $panel.off('.twcSettings');

    // Font size slider
    $panel.on('input.twcSettings', '#' + ID_PREFIX + 'set-fontsize', function() {
      var size = parseInt(this.value, 10);
      Settings.fontSize = size;
      $('#' + ID_PREFIX + 'set-fontsize-val').text(size + 'px');
      // Update clock display if it exists
      var timeEl = document.getElementById(ID_PREFIX + 'time');
      if (timeEl) {
        timeEl.style.fontSize = size + 'px';
      }
      Settings.save();
    });

    // Patch game clock checkbox
    $panel.on('change.twcSettings', '#' + ID_PREFIX + 'set-patch', function() {
      Settings.patchGameClock = this.checked;
      Settings.save();
      if (!Settings.patchGameClock) {
        restoreGameClock();
      }
    });

    // Alert volume slider
    $panel.on('input.twcSettings', '#' + ID_PREFIX + 'set-volume', function() {
      var vol = parseInt(this.value, 10);
      Settings.alertVolume = vol / 100;
      $('#' + ID_PREFIX + 'set-volume-val').text(vol + '%');
      Settings.save();
    });

    // Sound test button
    $panel.on('click.twcSettings', '#' + ID_PREFIX + 'set-test-sound', function() {
      playBeep();
    });

    // Auto-cleanup interval
    $panel.on('input.twcSettings', '#' + ID_PREFIX + 'set-cleanup', function() {
      var mins = parseInt(this.value, 10);
      Settings.cleanupMinutes = mins;
      $('#' + ID_PREFIX + 'set-cleanup-val').text(mins + 'm');
      Settings.save();
    });
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

  // ============================================================
  // LIFECYCLE
  // ============================================================

  /**
   * Start the timer update loop (50ms interval).
   */
  function startTimerUpdates() {
    timerInterval = setInterval(function() {
      updateTimerDisplays();
    }, 50);
  }

  /**
   * Stop the timer update loop.
   */
  function stopTimerUpdates() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  /**
   * Destroy the entire tool: stop animations, destroy card.
   */
  function destroy() {
    stopClockAnimation();
    stopTimerUpdates();
    restoreGameClock();
    if (card) {
      card.destroy();
      card = null;
    }
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  function init() {
    TWTools.TimeSync.init();
    Settings.load();
    loadTimers();
    injectStyles();
    createUI();
    startClockAnimation();
    startTimerUpdates();
    hookIncomingAttacks();
    TWTools.UI.toast('MS Clock v' + VERSION + ' loaded (' + timers.length + ' timers)', 'success');
  }

  // Auto-run on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, typeof jQuery !== 'undefined' ? jQuery : null);
