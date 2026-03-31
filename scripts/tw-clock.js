;(function(window, $) {
  'use strict';

  // ============================================================
  // TW MS CLOCK v2.0.0
  // ============================================================
  // Minimal floating card showing millisecond-precision server time.
  // Uses TWTools.TimeSync for accurate interpolation between
  // server clock updates. Updates at 60fps via requestAnimationFrame.
  //
  // REQUIRES: window.TWTools (tw-core.js)
  // ============================================================

  var VERSION = '2.0.0';
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

    /** @type {{x: number, y: number}} Card position on screen. */
    position: { x: -1, y: -1 },

    load: function() {
      this.patchGameClock = TWTools.Storage.get(STORAGE_PREFIX + 'patchClock') || false;
      this.fontSize = TWTools.Storage.get(STORAGE_PREFIX + 'fontSize') || 36;
      this.position = TWTools.Storage.get(STORAGE_PREFIX + 'position') || { x: -1, y: -1 };
    },

    save: function() {
      TWTools.Storage.set(STORAGE_PREFIX + 'patchClock', this.patchGameClock);
      TWTools.Storage.set(STORAGE_PREFIX + 'fontSize', this.fontSize);
      TWTools.Storage.set(STORAGE_PREFIX + 'position', this.position);
    }
  };

  // ============================================================
  // CLOCK RENDERER
  // ============================================================

  var Clock = {
    /** @private {?number} requestAnimationFrame ID. */
    _rafId: null,

    /** @private {?HTMLElement} The clock container element. */
    _container: null,

    /** @private {?HTMLElement} The time display element. */
    _timeEl: null,

    /** @private {?HTMLElement} Settings panel element. */
    _settingsEl: null,

    /** @private {boolean} Whether settings panel is visible. */
    _settingsOpen: false,

    /**
     * Show the clock card.
     */
    show: function() {
      if (this._container) this.destroy();

      Settings.load();

      // Build the floating card
      this._buildCard();
      injectStyles();
      this._startAnimation();
    },

    /**
     * Destroy the clock card and clean up.
     */
    destroy: function() {
      this._stopAnimation();
      this._restoreGameClock();
      if (this._container) {
        this._container.remove();
        this._container = null;
        this._timeEl = null;
        this._settingsEl = null;
      }
    },

    /**
     * Build the floating clock card DOM.
     * @private
     */
    _buildCard: function() {
      var card = document.createElement('div');
      card.id = ID_PREFIX + 'card';

      // Calculate initial position
      var posX = Settings.position.x >= 0 ? Settings.position.x : (window.innerWidth - 270);
      var posY = Settings.position.y >= 0 ? Settings.position.y : 10;

      card.style.cssText = 'position:fixed;z-index:99990;' +
        'left:' + posX + 'px;top:' + posY + 'px;' +
        'width:250px;background:#1a1a2e;border:1px solid #e0c882;border-radius:6px;' +
        'box-shadow:0 2px 12px rgba(0,0,0,0.5);overflow:hidden;user-select:none;';

      // Header bar (draggable)
      var header = document.createElement('div');
      header.id = ID_PREFIX + 'header';
      header.style.cssText = 'display:flex;align-items:center;padding:4px 8px;' +
        'background:#16213e;border-bottom:1px solid #e0c882;cursor:move;';

      var title = document.createElement('span');
      title.style.cssText = 'font-family:"Courier New",monospace;font-size:10px;' +
        'color:#a89050;letter-spacing:1px;text-transform:uppercase;';
      title.textContent = 'MS Clock v' + VERSION;

      var spacer = document.createElement('span');
      spacer.style.cssText = 'flex:1;';

      // Settings gear button
      var gearBtn = document.createElement('span');
      gearBtn.id = ID_PREFIX + 'gear';
      gearBtn.style.cssText = 'cursor:pointer;color:#8a8070;font-size:14px;margin-right:6px;';
      gearBtn.textContent = '\u2699';
      gearBtn.title = 'Settings';

      // Close button
      var closeBtn = document.createElement('span');
      closeBtn.id = ID_PREFIX + 'close';
      closeBtn.style.cssText = 'cursor:pointer;color:#8a8070;font-size:16px;line-height:1;';
      closeBtn.textContent = '\u00D7';
      closeBtn.title = 'Close';

      header.appendChild(title);
      header.appendChild(spacer);
      header.appendChild(gearBtn);
      header.appendChild(closeBtn);

      // Time display body
      var body = document.createElement('div');
      body.id = ID_PREFIX + 'body';
      body.style.cssText = 'text-align:center;padding:8px 12px;';

      var timeDisplay = document.createElement('div');
      timeDisplay.id = ID_PREFIX + 'time';
      timeDisplay.style.cssText = 'font-family:"Courier New",monospace;font-weight:bold;' +
        'color:#e0c882;letter-spacing:2px;font-size:' + Settings.fontSize + 'px;line-height:1.2;';
      timeDisplay.textContent = '--:--:--.---';
      this._timeEl = timeDisplay;

      body.appendChild(timeDisplay);

      // Settings panel (hidden by default)
      var settingsPanel = document.createElement('div');
      settingsPanel.id = ID_PREFIX + 'settings';
      settingsPanel.style.cssText = 'display:none;padding:8px 12px;border-top:1px solid #333;' +
        'background:#16213e;font-family:"Courier New",monospace;font-size:11px;color:#e0d8c0;';

      settingsPanel.innerHTML =
        '<div style="margin-bottom:6px;">' +
          '<label style="cursor:pointer;">' +
            '<input type="checkbox" id="' + ID_PREFIX + 'patch-cb"' +
            (Settings.patchGameClock ? ' checked' : '') + '> ' +
            'Show ms in game clock' +
          '</label>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;">' +
          '<label>Font size:</label>' +
          '<input type="range" id="' + ID_PREFIX + 'font-range" min="18" max="60" value="' + Settings.fontSize + '" ' +
          'style="flex:1;accent-color:#e0c882;">' +
          '<span id="' + ID_PREFIX + 'font-val">' + Settings.fontSize + 'px</span>' +
        '</div>';

      this._settingsEl = settingsPanel;

      card.appendChild(header);
      card.appendChild(body);
      card.appendChild(settingsPanel);

      document.body.appendChild(card);
      this._container = card;

      // Bind events
      this._bindEvents();
    },

    /**
     * Bind card events (close, drag, settings).
     * @private
     */
    _bindEvents: function() {
      var self = this;
      var card = this._container;

      // Close button
      document.getElementById(ID_PREFIX + 'close').addEventListener('click', function() {
        self.destroy();
      });

      // Settings gear toggle
      document.getElementById(ID_PREFIX + 'gear').addEventListener('click', function() {
        self._settingsOpen = !self._settingsOpen;
        self._settingsEl.style.display = self._settingsOpen ? 'block' : 'none';
      });

      // Patch game clock checkbox
      document.getElementById(ID_PREFIX + 'patch-cb').addEventListener('change', function() {
        Settings.patchGameClock = this.checked;
        Settings.save();
        if (!Settings.patchGameClock) {
          self._restoreGameClock();
        }
      });

      // Font size slider
      document.getElementById(ID_PREFIX + 'font-range').addEventListener('input', function() {
        var size = parseInt(this.value, 10);
        Settings.fontSize = size;
        document.getElementById(ID_PREFIX + 'font-val').textContent = size + 'px';
        self._timeEl.style.fontSize = size + 'px';
        Settings.save();
      });

      // Dragging
      var isDragging = false;
      var startX = 0, startY = 0, origX = 0, origY = 0;

      var headerEl = document.getElementById(ID_PREFIX + 'header');
      headerEl.addEventListener('mousedown', function(e) {
        // Don't drag when clicking buttons
        if (e.target.id === ID_PREFIX + 'close' || e.target.id === ID_PREFIX + 'gear') return;

        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        var rect = card.getBoundingClientRect();
        origX = rect.left;
        origY = rect.top;
        e.preventDefault();
      });

      document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        var newX = origX + e.clientX - startX;
        var newY = origY + e.clientY - startY;

        // Clamp to viewport
        newX = Math.max(0, Math.min(newX, window.innerWidth - 100));
        newY = Math.max(0, Math.min(newY, window.innerHeight - 40));

        card.style.left = newX + 'px';
        card.style.top = newY + 'px';
      });

      document.addEventListener('mouseup', function() {
        if (isDragging) {
          isDragging = false;
          // Save position
          var rect = card.getBoundingClientRect();
          Settings.position = { x: Math.round(rect.left), y: Math.round(rect.top) };
          Settings.save();
        }
      });
    },

    /**
     * Start the 60fps animation loop.
     * @private
     */
    _startAnimation: function() {
      var self = this;

      var tick = function() {
        if (!self._timeEl) return;

        var nowMs = TWTools.TimeSync.now();
        var h = Math.floor(nowMs / 3600000) % 24;
        var m = Math.floor((nowMs % 3600000) / 60000);
        var s = Math.floor((nowMs % 60000) / 1000);
        var ms = Math.floor(nowMs % 1000);

        // Format: HH:MM:SS.mmm
        var timeStr = TWTools.pad2(h) + ':' + TWTools.pad2(m) + ':' + TWTools.pad2(s) + '.' + TWTools.pad3(ms);
        self._timeEl.textContent = timeStr;

        // Optionally patch the game's #serverTime element
        if (Settings.patchGameClock) {
          self._patchGameClock(h, m, s, ms);
        }

        self._rafId = requestAnimationFrame(tick);
      };

      this._rafId = requestAnimationFrame(tick);
    },

    /**
     * Stop the animation loop.
     * @private
     */
    _stopAnimation: function() {
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
    },

    /**
     * Patch the game's #serverTime element to show milliseconds.
     * @private
     * @param {number} h - Hours.
     * @param {number} m - Minutes.
     * @param {number} s - Seconds.
     * @param {number} ms - Milliseconds.
     */
    _patchGameClock: function(h, m, s, ms) {
      var el = document.getElementById('serverTime');
      if (!el) return;

      // Store original updater on first patch
      if (!el._twcOriginal) {
        el._twcOriginal = el.textContent;
        el._twcPatched = true;
      }

      el.textContent = TWTools.pad2(h) + ':' + TWTools.pad2(m) + ':' + TWTools.pad2(s) + '.' + TWTools.pad3(ms);
    },

    /**
     * Restore the game's #serverTime element to its original state.
     * @private
     */
    _restoreGameClock: function() {
      var el = document.getElementById('serverTime');
      if (el && el._twcPatched) {
        // The game will update it on next tick anyway, just mark as unpatched
        el._twcPatched = false;
        delete el._twcOriginal;
      }
    }
  };

  // ============================================================
  // STYLES
  // ============================================================

  /**
   * Inject clock-specific CSS styles.
   */
  function injectStyles() {
    if (document.getElementById(ID_PREFIX + 'styles')) return;

    var css =
      '#' + ID_PREFIX + 'card *{box-sizing:border-box;}' +
      '#' + ID_PREFIX + 'close:hover{color:#f44336 !important;}' +
      '#' + ID_PREFIX + 'gear:hover{color:#e0c882 !important;}' +
      '';

    var style = document.createElement('style');
    style.id = ID_PREFIX + 'styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  function init() {
    // Verify TWTools is loaded
    if (typeof window.TWTools === 'undefined') {
      alert('[MS Clock] Error: TWTools core library not loaded.');
      return;
    }

    // Initialize TimeSync if not already
    TWTools.TimeSync.init();

    injectStyles();
    Clock.show();
  }

  // Auto-run on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, typeof jQuery !== 'undefined' ? jQuery : null);
