;(function(window, $) {
  'use strict';

  // ============================================================
  // TW REMINDER v1.0.0
  // ============================================================
  // Custom countdown timers with optional sound notifications.
  // Compact floating card with persistent storage.
  //
  // REQUIRES: window.TWTools (tw-core.js + tw-ui.js)
  // ============================================================

  var TWTools = window.TWTools;
  if (!TWTools || !TWTools.UI) {
    throw new Error('tw-reminder.js requires tw-core.js and tw-ui.js');
  }

  var VERSION = '1.0.0';
  var ID_PREFIX = 'twr-';
  var STORAGE_PREFIX = 'twr_';

  /** @type {number} Auto-cleanup expired timers after this many ms. */
  var CLEANUP_AFTER_MS = 5 * 60 * 1000; // 5 minutes

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
    view.setUint32(16, 16, true);         // chunk size
    view.setUint16(20, 1, true);          // PCM format
    view.setUint16(22, 1, true);          // mono
    view.setUint32(24, sampleRate, true); // sample rate
    view.setUint32(28, sampleRate, true); // byte rate
    view.setUint16(32, 1, true);          // block align
    view.setUint16(34, 8, true);          // bits per sample

    // data chunk
    writeStr(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    for (var i = 0; i < numSamples; i++) {
      var t = i / sampleRate;
      var sample = Math.sin(2 * Math.PI * freq * t);
      // Fade out last 40% for a cleaner sound
      var fadeStart = numSamples * 0.6;
      if (i > fadeStart) {
        sample *= 1 - ((i - fadeStart) / (numSamples - fadeStart));
      }
      view.setUint8(44 + i, Math.floor(128 + sample * 96));
    }

    // Convert to base64
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
   * Play the notification beep sound.
   */
  function playBeep() {
    try {
      var audio = new Audio(BEEP_DATA_URI);
      audio.volume = 0.7;
      audio.play();
    } catch (e) {
      // Audio not available — silent fail
    }
  }

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

  /** @type {?Object} Card controller reference. */
  var card = null;

  /** @type {?number} Main update interval ID. */
  var updateInterval = null;

  /** @type {boolean} Whether the add-timer form is visible. */
  var formVisible = false;

  // ============================================================
  // COLOR PALETTE
  // ============================================================

  var COLORS = {
    green:  { bg: '#e8f5e0', border: '#4a7a1e', text: '#2a6a0a', bar: '#4a7a1e' },
    yellow: { bg: '#fff8d0', border: '#b8960a', text: '#806800', bar: '#cc9900' },
    red:    { bg: '#fde8e8', border: '#cc2020', text: '#8a1010', bar: '#cc2020' },
    blue:   { bg: '#e8f0ff', border: '#2060cc', text: '#0a4090', bar: '#2060cc' }
  };

  // ============================================================
  // INITIALIZATION
  // ============================================================

  /**
   * Initialize the Reminder tool.
   * Loads persisted timers and creates the UI.
   */
  function init() {
    // Initialize TimeSync for accurate server time
    TWTools.TimeSync.init();

    loadTimers();
    injectCustomStyles();
    createUI();
    startUpdates();
    hookIncomingAttacks();
    TWTools.UI.toast('Reminders loaded (' + timers.length + ' active)', 'success');
  }

  /**
   * Inject additional CSS specific to the reminder tool.
   */
  function injectCustomStyles() {
    if (document.getElementById(ID_PREFIX + 'styles')) return;

    var css = [
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
      '}'
    ].join('\n');

    var styleEl = document.createElement('style');
    styleEl.id = ID_PREFIX + 'styles';
    styleEl.type = 'text/css';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }

  // ============================================================
  // UI CREATION
  // ============================================================

  /**
   * Create the reminder card UI (single panel, no tabs).
   */
  function createUI() {
    card = TWTools.UI.createCard({
      id: ID_PREFIX + 'main',
      title: 'Reminders',
      version: VERSION,
      tabs: [],
      width: 300,
      height: 400,
      minWidth: 240,
      minHeight: 200,
      onClose: function() {
        destroy();
      }
    });

    // Build content directly in the body (no tabs)
    var $body = card.element.find('.twt-card-body');

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
      '    <label>Duration (HH:MM:SS):',
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

    $body.html(html);

    // Bind events
    bindFormEvents($body);
    renderTimerList();
    updateStatus();
  }

  /**
   * Bind all form-related event handlers.
   * @param {jQuery} $body - Card body element.
   */
  function bindFormEvents($body) {
    // Toggle form visibility
    $body.on('click', '#' + ID_PREFIX + 'toggle-form', function() {
      formVisible = !formVisible;
      $('#' + ID_PREFIX + 'form').toggle(formVisible);
      $(this).text(formVisible ? '- Hide Form' : '+ Add Timer');
    });

    // Mode switching
    $body.on('change', '#' + ID_PREFIX + 'input-mode', function() {
      var mode = $(this).val();
      $('#' + ID_PREFIX + 'mode-countdown').toggle(mode === 'countdown');
      $('#' + ID_PREFIX + 'mode-target').toggle(mode === 'target');
    });

    // Color swatch selection
    $body.on('click', '.' + ID_PREFIX + 'color-swatch', function() {
      $body.find('.' + ID_PREFIX + 'color-swatch').removeClass('selected');
      $(this).addClass('selected');
    });

    // Create timer
    $body.on('click', '#' + ID_PREFIX + 'btn-create', onCreateTimer);

    // Cancel form
    $body.on('click', '#' + ID_PREFIX + 'btn-cancel', function() {
      formVisible = false;
      $('#' + ID_PREFIX + 'form').hide();
      $('#' + ID_PREFIX + 'toggle-form').text('+ Add Timer');
    });

    // Delete timer (delegated)
    $body.on('click', '.' + ID_PREFIX + 'delete-btn', function() {
      var timerId = $(this).attr('data-timer-id');
      removeTimer(timerId);
    });
  }

  // ============================================================
  // TIMER CRUD
  // ============================================================

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
      // Target = now + duration (absolute time)
      targetTimeAbsMs = Date.now() + durationMs;
    } else {
      // Target time mode
      var day = $('#' + ID_PREFIX + 'input-day').val();
      var timeStr = ($('#' + ID_PREFIX + 'input-time').val() || '').trim();
      var timeMs = TWTools.parseTimeToMs(timeStr);
      if (isNaN(timeMs)) {
        TWTools.UI.toast('Invalid time (use HH:MM:SS or HH:MM:SS:mmm)', 'error');
        return;
      }

      // Convert server time to absolute Date.now() epoch
      // We use TimeSync.now() (ms since midnight) and correlate with Date.now()
      var serverNow = TWTools.TimeSync.now();
      var realNow = Date.now();
      // Offset between real clock and server-midnight-based time
      var midnightAbsMs = realNow - serverNow;

      targetTimeAbsMs = midnightAbsMs + timeMs;
      if (day === 'tomorrow') {
        targetTimeAbsMs += 86400000;
      }

      // If target is in the past (earlier today), assume tomorrow
      if (targetTimeAbsMs < realNow && day === 'today') {
        targetTimeAbsMs += 86400000;
      }
    }

    var timer = {
      id: ID_PREFIX + (++timerCounter),
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
    updateStatus();

    // Clear form
    $('#' + ID_PREFIX + 'input-label').val('');
    $('#' + ID_PREFIX + 'input-duration').val('');
    $('#' + ID_PREFIX + 'input-time').val('');

    TWTools.UI.toast('Timer created: ' + label, 'success');
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
    updateStatus();
  }

  /**
   * Sort timers by remaining time (soonest first), done timers at the end.
   */
  function sortTimers() {
    var now = Date.now();
    timers.sort(function(a, b) {
      // Done timers go to the bottom
      if (a.done && !b.done) return 1;
      if (!a.done && b.done) return -1;
      // Among active: soonest first
      var remA = a.targetTimeAbsMs - now;
      var remB = b.targetTimeAbsMs - now;
      return remA - remB;
    });
  }

  // ============================================================
  // TIMER RENDERING
  // ============================================================

  /**
   * Render the full timer list.
   */
  function renderTimerList() {
    var $list = $('#' + ID_PREFIX + 'timer-list');
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
   * Called every 50ms from the main update loop.
   */
  function updateTimerDisplays() {
    var now = Date.now();
    var needsRerender = false;

    for (var i = 0; i < timers.length; i++) {
      var timer = timers[i];
      var remaining = timer.targetTimeAbsMs - now;

      var $countdown = $('[data-timer-id="' + timer.id + '"].' + ID_PREFIX + 'countdown');
      var $progressBar = $('[data-timer-id="' + timer.id + '"].' + ID_PREFIX + 'progress-bar');
      var $item = $('#' + timer.id);

      if ($countdown.length === 0) continue;

      if (remaining <= 0 && !timer.done) {
        // Timer completed
        timer.done = true;
        timer.doneAt = now;
        $countdown.text('DONE');
        $progressBar.css('width', '0%');
        $item.addClass(ID_PREFIX + 'timer-done');

        // Play sound
        if (timer.soundEnabled) {
          playBeep();
          // Play a second beep after 500ms for emphasis
          setTimeout(playBeep, 500);
        }

        TWTools.UI.toast('Timer done: ' + timer.label, 'warning');
        saveTimers();
        needsRerender = true;
      } else if (!timer.done) {
        // Active timer — update countdown
        $countdown.text(formatRemaining(remaining));

        // Update progress bar (estimate based on total duration)
        // We store creation time implicitly as: original duration = targetTime - creationTime
        // Since we don't store creation time, estimate progress from remaining vs a max of 24h
        // Better: calculate percentage remaining using a simple approach
        var totalEstimate = Math.max(remaining, 1000); // at minimum 1s
        // Use a simulated total: we show the bar shrinking proportionally
        // For countdown mode, remaining / original. For simplicity, just show remaining time ratio to 1h max
        var maxBar = 3600000; // 1 hour reference
        var pct = Math.min(100, Math.max(0, (remaining / maxBar) * 100));
        $progressBar.css('width', pct + '%');
      }

      // Auto-cleanup: remove expired timers after CLEANUP_AFTER_MS
      if (timer.done && timer.doneAt > 0 && (now - timer.doneAt) > CLEANUP_AFTER_MS) {
        timers.splice(i, 1);
        i--;
        saveTimers();
        needsRerender = true;
      }
    }

    if (needsRerender) {
      sortTimers();
      renderTimerList();
      updateStatus();
    }
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

  /**
   * Update the card footer status text.
   */
  function updateStatus() {
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
    card.setStatus('Active: ' + active + ' | Done: ' + done);
  }

  // ============================================================
  // INCOMING ATTACK HOOK
  // ============================================================

  /**
   * Hook into incoming attack displays to allow quick timer creation.
   * Adds click handlers to elements with arrival times in the game UI.
   * Scans for .command-data-date, #commands_incomings .arrival_time, etc.
   */
  function hookIncomingAttacks() {
    // Hook into the TW arrival time elements when they appear
    // Use event delegation on body for dynamically loaded content
    $(document).on('click', '.command_hover_details .relative_time, ' +
      '#commands_incomings .timer, ' +
      'td .arrival_time', function(e) {
      var text = $(this).text().trim();
      var parsed = TWTools.parseArrivalTime(text);
      if (parsed === null) return;

      // Convert server-time ms since midnight to absolute time
      var serverNow = TWTools.TimeSync.now();
      var realNow = Date.now();
      var midnightAbsMs = realNow - serverNow;
      var targetAbsMs = midnightAbsMs + parsed;

      // If the target is in the past, skip
      if (targetAbsMs < realNow) return;

      // Create timer automatically
      var label = 'Incoming: ' + text;
      var timer = {
        id: ID_PREFIX + (++timerCounter),
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
      updateStatus();

      TWTools.UI.toast('Timer created from arrival: ' + text, 'success');
      e.stopPropagation();
    });
  }

  // ============================================================
  // PERSISTENCE
  // ============================================================

  /**
   * Save timers to localStorage.
   */
  function saveTimers() {
    TWTools.Storage.set(STORAGE_PREFIX + 'timers', timers);
    TWTools.Storage.set(STORAGE_PREFIX + 'counter', timerCounter);
  }

  /**
   * Load timers from localStorage. Filters out fully expired entries.
   */
  function loadTimers() {
    var saved = TWTools.Storage.get(STORAGE_PREFIX + 'timers');
    var savedCounter = TWTools.Storage.get(STORAGE_PREFIX + 'counter');
    timerCounter = savedCounter || 0;

    if (saved && Array.isArray(saved)) {
      var now = Date.now();
      timers = [];
      for (var i = 0; i < saved.length; i++) {
        var t = saved[i];
        // Skip timers that are done and past the cleanup window
        if (t.done && t.doneAt > 0 && (now - t.doneAt) > CLEANUP_AFTER_MS) {
          continue;
        }
        timers.push(t);
      }
      sortTimers();
    }
  }

  // ============================================================
  // MAIN UPDATE LOOP
  // ============================================================

  /**
   * Start the main update loop (50ms interval for smooth countdowns).
   */
  function startUpdates() {
    updateInterval = setInterval(function() {
      updateTimerDisplays();
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

  // ============================================================
  // CLEANUP
  // ============================================================

  /**
   * Destroy the reminder: stop updates, destroy card.
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

  $(document).ready(function() {
    init();
  });

})(window, jQuery);
