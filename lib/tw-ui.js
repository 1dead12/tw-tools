;(function(window, $) {
  'use strict';

  var TWTools = window.TWTools;
  if (!TWTools) {
    throw new Error('tw-ui.js requires tw-core.js to be loaded first (window.TWTools missing)');
  }

  // ============================================================
  // CSS INJECTION
  // ============================================================

  var STYLE_ID = 'twt-ui-styles';

  /**
   * Inject shared CSS for all TWTools UI components.
   * Only injects once — checks for existing <style id="twt-ui-styles">.
   * @private
   */
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    var css = [
      // ---- Card Container ----
      '.twt-card {',
      '  position: fixed;',
      '  z-index: 12000;',
      '  border: 1px solid #804000;',
      '  border-radius: 3px;',
      '  box-shadow: 2px 2px 8px rgba(0,0,0,0.4);',
      '  font-family: Verdana, Arial, sans-serif;',
      '  font-size: 11px;',
      '  color: #3e2e14;',
      '  background: #f4e4bc;',
      '  display: flex;',
      '  flex-direction: column;',
      '  overflow: hidden;',
      '}',

      // ---- Header (draggable) ----
      '.twt-card-header {',
      '  background: linear-gradient(to bottom, #dac48c, #c1a264);',
      '  border-bottom: 1px solid #804000;',
      '  padding: 4px 8px;',
      '  cursor: move;',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 6px;',
      '  user-select: none;',
      '  -webkit-user-select: none;',
      '  min-height: 24px;',
      '  flex-shrink: 0;',
      '}',
      '.twt-card-title {',
      '  font-weight: bold;',
      '  font-size: 12px;',
      '  color: #3e2e14;',
      '  white-space: nowrap;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '}',
      '.twt-card-version {',
      '  font-size: 9px;',
      '  color: #7a6840;',
      '  white-space: nowrap;',
      '}',
      '.twt-card-time {',
      '  font-size: 10px;',
      '  color: #5a4a2a;',
      '  font-family: monospace;',
      '  margin-left: auto;',
      '  white-space: nowrap;',
      '}',
      '.twt-card-minimize, .twt-card-close {',
      '  cursor: pointer;',
      '  font-size: 14px;',
      '  color: #5a4020;',
      '  padding: 0 3px;',
      '  line-height: 1;',
      '  font-weight: bold;',
      '}',
      '.twt-card-minimize:hover, .twt-card-close:hover {',
      '  color: #a02020;',
      '}',

      // ---- Tabs ----
      '.twt-card-tabs {',
      '  display: flex;',
      '  background: #e8d8a8;',
      '  border-bottom: 1px solid #c0a060;',
      '  flex-shrink: 0;',
      '  overflow-x: auto;',
      '}',
      '.twt-card-tabs:empty {',
      '  display: none;',
      '}',
      '.twt-card-tab {',
      '  padding: 4px 10px;',
      '  cursor: pointer;',
      '  font-size: 10px;',
      '  color: #5a4a2a;',
      '  border-right: 1px solid #c0a060;',
      '  white-space: nowrap;',
      '  background: transparent;',
      '}',
      '.twt-card-tab:hover {',
      '  background: #f0e0b0;',
      '}',
      '.twt-card-tab.active {',
      '  background: #f4e4bc;',
      '  font-weight: bold;',
      '  color: #3e2e14;',
      '  border-bottom: 2px solid #804000;',
      '}',

      // ---- Body (scrollable) ----
      '.twt-card-body {',
      '  flex: 1;',
      '  overflow-y: auto;',
      '  overflow-x: hidden;',
      '  padding: 6px;',
      '  background: #fff8e8;',
      '}',
      '.twt-card-body .twt-tab-panel {',
      '  display: none;',
      '}',
      '.twt-card-body .twt-tab-panel.active {',
      '  display: block;',
      '}',

      // ---- Footer ----
      '.twt-card-footer {',
      '  background: #e8d8a8;',
      '  border-top: 1px solid #c0a060;',
      '  padding: 3px 8px;',
      '  font-size: 9px;',
      '  color: #7a6840;',
      '  flex-shrink: 0;',
      '  white-space: nowrap;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '}',

      // ---- Minimized state ----
      '.twt-card.minimized .twt-card-tabs,',
      '.twt-card.minimized .twt-card-body,',
      '.twt-card.minimized .twt-card-footer {',
      '  display: none;',
      '}',

      // ---- Resize handle ----
      '.twt-card-resize {',
      '  position: absolute;',
      '  right: 0;',
      '  bottom: 0;',
      '  width: 14px;',
      '  height: 14px;',
      '  cursor: se-resize;',
      '  background: linear-gradient(135deg, transparent 50%, #c0a060 50%);',
      '  border-radius: 0 0 2px 0;',
      '}',

      // ---- TW-native styling helpers ----
      // Tables inside cards use TW's .vis class, but we add padding adjustments
      '.twt-card-body table.vis {',
      '  width: 100%;',
      '  font-size: 11px;',
      '}',
      '.twt-card-body table.vis th {',
      '  padding: 2px 4px;',
      '}',
      '.twt-card-body table.vis td {',
      '  padding: 2px 4px;',
      '}',

      // Buttons inside cards
      '.twt-card-body .btn {',
      '  font-size: 10px;',
      '}',

      // ---- MsBar Canvas ----
      '.twt-msbar-wrap {',
      '  position: relative;',
      '  border: 1px solid #c0a060;',
      '  border-radius: 2px;',
      '  overflow: hidden;',
      '  background: #f4e4bc;',
      '}',

      // ---- Toast (fallback) ----
      '.twt-toast {',
      '  position: fixed;',
      '  top: 80px;',
      '  right: 20px;',
      '  z-index: 15000;',
      '  padding: 8px 16px;',
      '  border-radius: 3px;',
      '  font-family: Verdana, Arial, sans-serif;',
      '  font-size: 11px;',
      '  color: #fff;',
      '  box-shadow: 2px 2px 6px rgba(0,0,0,0.3);',
      '  opacity: 0;',
      '  transition: opacity 0.3s ease;',
      '  pointer-events: none;',
      '}',
      '.twt-toast.visible { opacity: 1; }',
      '.twt-toast.success { background: #4a7a1e; border: 1px solid #3a5a10; }',
      '.twt-toast.warning { background: #a06800; border: 1px solid #806000; }',
      '.twt-toast.error { background: #8a2020; border: 1px solid #6a1010; }'
    ].join('\n');

    var styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    styleEl.type = 'text/css';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }

  // ============================================================
  // CARD WIDGET
  // ============================================================

  /** @private {number} Counter for generating unique card IDs. */
  var cardCounter = 0;

  /**
   * Create a floating card widget using TW's native visual style.
   *
   * @param {Object} options - Card configuration.
   * @param {string} options.id - Unique card identifier.
   * @param {string} options.title - Card title text.
   * @param {string} [options.version] - Version string displayed in header.
   * @param {Array.<{id: string, label: string}>} [options.tabs] - Tab definitions.
   * @param {number} [options.width=420] - Initial width in pixels.
   * @param {number} [options.height=500] - Initial height in pixels.
   * @param {number} [options.minWidth=300] - Minimum resize width.
   * @param {number} [options.minHeight=200] - Minimum resize height.
   * @param {number} [options.zIndex=12000] - CSS z-index.
   * @param {function} [options.onClose] - Callback when card is closed.
   * @param {function(string)} [options.onTabChange] - Callback when tab changes.
   * @returns {Object} Card controller with methods: setTab, getTabContent, minimize, maximize, destroy, setStatus, setTitle, element.
   */
  function createCard(options) {
    injectStyles();

    var id = options.id || ('card_' + (++cardCounter));
    var tabs = options.tabs || [];
    var width = options.width || 420;
    var height = options.height || 500;
    var minWidth = options.minWidth || 300;
    var minHeight = options.minHeight || 200;
    var zIndex = options.zIndex || 12000;

    // Restore saved position/size from localStorage
    var savedPos = TWTools.Storage.get('card_pos_' + id);

    // Build DOM structure
    var $card = $(
      '<div class="twt-card" id="twt-' + id + '">' +
        '<div class="twt-card-header">' +
          '<span class="twt-card-title"></span>' +
          '<span class="twt-card-version"></span>' +
          '<span class="twt-card-time"></span>' +
          '<span class="twt-card-minimize" title="Minimize">&#9472;</span>' +
          '<span class="twt-card-close" title="Close">&#10005;</span>' +
        '</div>' +
        '<div class="twt-card-tabs"></div>' +
        '<div class="twt-card-body"></div>' +
        '<div class="twt-card-footer"></div>' +
        '<div class="twt-card-resize"></div>' +
      '</div>'
    );

    var $header = $card.find('.twt-card-header');
    var $title = $card.find('.twt-card-title');
    var $version = $card.find('.twt-card-version');
    var $timeDisplay = $card.find('.twt-card-time');
    var $minimizeBtn = $card.find('.twt-card-minimize');
    var $closeBtn = $card.find('.twt-card-close');
    var $tabBar = $card.find('.twt-card-tabs');
    var $body = $card.find('.twt-card-body');
    var $footer = $card.find('.twt-card-footer');
    var $resize = $card.find('.twt-card-resize');

    // Set initial content
    $title.text(options.title || 'TWTools');
    if (options.version) {
      $version.text('v' + options.version);
    }

    // Build tabs
    var tabPanels = {};
    for (var i = 0; i < tabs.length; i++) {
      var tab = tabs[i];
      var $tabBtn = $('<div class="twt-card-tab" data-tab="' + tab.id + '">' + tab.label + '</div>');
      $tabBar.append($tabBtn);

      var $panel = $('<div class="twt-tab-panel" data-tab="' + tab.id + '"></div>');
      $body.append($panel);
      tabPanels[tab.id] = $panel;
    }

    // Apply size and position
    var posLeft = savedPos ? savedPos.left : Math.max(10, (window.innerWidth - width) / 2);
    var posTop = savedPos ? savedPos.top : Math.max(10, (window.innerHeight - height) / 2);
    var curWidth = savedPos ? savedPos.width : width;
    var curHeight = savedPos ? savedPos.height : height;

    $card.css({
      left: posLeft + 'px',
      top: posTop + 'px',
      width: curWidth + 'px',
      height: curHeight + 'px',
      zIndex: zIndex
    });

    // Append to body
    $('body').append($card);

    // Activate first tab
    var activeTab = tabs.length > 0 ? tabs[0].id : null;
    if (activeTab) {
      setTabActive(activeTab);
    }

    // ---- State ----
    var isMinimized = false;
    var timeInterval = null;
    var destroyed = false;

    // ---- Tab switching ----
    function setTabActive(tabId) {
      activeTab = tabId;
      $tabBar.find('.twt-card-tab').removeClass('active');
      $tabBar.find('.twt-card-tab[data-tab="' + tabId + '"]').addClass('active');
      $body.find('.twt-tab-panel').removeClass('active');
      $body.find('.twt-tab-panel[data-tab="' + tabId + '"]').addClass('active');
    }

    $tabBar.on('click', '.twt-card-tab', function() {
      var tabId = $(this).attr('data-tab');
      setTabActive(tabId);
      if (options.onTabChange) {
        options.onTabChange(tabId);
      }
    });

    // ---- Save position ----
    function savePosition() {
      var pos = $card.position();
      TWTools.Storage.set('card_pos_' + id, {
        left: pos.left,
        top: pos.top,
        width: $card.outerWidth(),
        height: $card.outerHeight()
      });
    }

    // ---- Dragging ----
    var isDragging = false;
    var dragOffsetX = 0;
    var dragOffsetY = 0;

    $header.on('mousedown', function(e) {
      // Don't drag when clicking controls
      if ($(e.target).hasClass('twt-card-minimize') ||
          $(e.target).hasClass('twt-card-close')) {
        return;
      }
      isDragging = true;
      dragOffsetX = e.clientX - $card.position().left;
      dragOffsetY = e.clientY - $card.position().top;
      e.preventDefault();
    });

    $(document).on('mousemove.twtcard_' + id, function(e) {
      if (!isDragging) return;
      var newLeft = e.clientX - dragOffsetX;
      var newTop = e.clientY - dragOffsetY;
      // Keep card within viewport bounds
      newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - 50));
      newTop = Math.max(0, Math.min(newTop, window.innerHeight - 30));
      $card.css({ left: newLeft + 'px', top: newTop + 'px' });
    });

    $(document).on('mouseup.twtcard_' + id, function() {
      if (isDragging) {
        isDragging = false;
        savePosition();
      }
    });

    // ---- Resizing ----
    var isResizing = false;
    var resizeStartX = 0;
    var resizeStartY = 0;
    var resizeStartW = 0;
    var resizeStartH = 0;

    $resize.on('mousedown', function(e) {
      isResizing = true;
      resizeStartX = e.clientX;
      resizeStartY = e.clientY;
      resizeStartW = $card.outerWidth();
      resizeStartH = $card.outerHeight();
      e.preventDefault();
      e.stopPropagation();
    });

    $(document).on('mousemove.twtresize_' + id, function(e) {
      if (!isResizing) return;
      var newW = resizeStartW + (e.clientX - resizeStartX);
      var newH = resizeStartH + (e.clientY - resizeStartY);
      newW = Math.max(minWidth, newW);
      newH = Math.max(minHeight, newH);
      $card.css({ width: newW + 'px', height: newH + 'px' });
    });

    $(document).on('mouseup.twtresize_' + id, function() {
      if (isResizing) {
        isResizing = false;
        savePosition();
      }
    });

    // ---- Minimize / Close ----
    $minimizeBtn.on('click', function() {
      if (isMinimized) {
        doMaximize();
      } else {
        doMinimize();
      }
    });

    $closeBtn.on('click', function() {
      doDestroy();
      if (options.onClose) {
        options.onClose();
      }
    });

    function doMinimize() {
      isMinimized = true;
      $card.addClass('minimized');
      $minimizeBtn.html('&#9633;'); // restore icon
      $minimizeBtn.attr('title', 'Maximize');
    }

    function doMaximize() {
      isMinimized = false;
      $card.removeClass('minimized');
      $minimizeBtn.html('&#9472;'); // minimize icon
      $minimizeBtn.attr('title', 'Minimize');
    }

    // ---- Live server time in header ----
    function updateHeaderTime() {
      if (destroyed) return;
      if (TWTools.TimeSync && TWTools.TimeSync.now) {
        var nowMs = TWTools.TimeSync.now();
        $timeDisplay.text(TWTools.formatTime(nowMs));
      }
    }

    timeInterval = setInterval(updateHeaderTime, 50); // Update ~20fps
    updateHeaderTime();

    // ---- Destroy ----
    function doDestroy() {
      destroyed = true;
      if (timeInterval) {
        clearInterval(timeInterval);
        timeInterval = null;
      }
      $(document).off('.twtcard_' + id);
      $(document).off('.twtresize_' + id);
      $card.remove();
    }

    // ---- Public controller ----
    return {
      /** @type {jQuery} The card jQuery element. */
      element: $card,

      /**
       * Switch to a specific tab by ID.
       * @param {string} tabId - Tab identifier.
       */
      setTab: function(tabId) {
        setTabActive(tabId);
      },

      /**
       * Get a tab's content panel as a jQuery element.
       * @param {string} tabId - Tab identifier.
       * @returns {jQuery} Tab content panel.
       */
      getTabContent: function(tabId) {
        return tabPanels[tabId] || $();
      },

      /**
       * Minimize the card to just the header bar.
       */
      minimize: doMinimize,

      /**
       * Maximize (restore) the card to full size.
       */
      maximize: doMaximize,

      /**
       * Destroy the card and clean up all event listeners.
       */
      destroy: doDestroy,

      /**
       * Set footer status text.
       * @param {string} text - Status text.
       */
      setStatus: function(text) {
        $footer.text(text);
      },

      /**
       * Update card title text.
       * @param {string} text - New title.
       */
      setTitle: function(text) {
        $title.text(text);
      }
    };
  }

  // ============================================================
  // MILLISECOND PRECISION BAR (Canvas)
  // ============================================================

  /**
   * Create a canvas-based millisecond precision bar.
   * 60fps needle sweep showing current ms position with safe window overlay.
   *
   * @param {Object} [options] - Configuration.
   * @param {number} [options.width=400] - Canvas width in pixels.
   * @param {number} [options.height=48] - Canvas height in pixels.
   * @param {number} [options.safeMin=0] - Safe window start (0-999).
   * @param {number} [options.safeMax=999] - Safe window end (0-999).
   * @param {boolean} [options.crossesSecond=false] - Whether safe window wraps around 999→0.
   * @returns {Object} Controller: {element, update(currentMs), setSafeWindow(min, max, crosses), destroy()}.
   */
  function createMsBar(options) {
    injectStyles();

    options = options || {};
    var canvasWidth = options.width || 400;
    var canvasHeight = options.height || 48;
    var safeMin = typeof options.safeMin === 'number' ? options.safeMin : 0;
    var safeMax = typeof options.safeMax === 'number' ? options.safeMax : 999;
    var crossesSecond = !!options.crossesSecond;

    var $wrap = $('<div class="twt-msbar-wrap"></div>');
    var canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    $wrap.append(canvas);

    var ctx = canvas.getContext('2d');
    var animFrame = null;
    var destroyed = false;
    var currentMs = 0;

    // TW-themed colors
    var COL_BG = '#f4e4bc';
    var COL_NEEDLE = '#804000';
    var COL_SAFE = 'rgba(0,128,0,0.3)';
    var COL_DANGER = 'rgba(200,0,0,0.2)';
    var COL_TICK = '#c0a060';
    var COL_TICK_MAJOR = '#804000';
    var COL_TEXT = '#5a4020';

    /**
     * Draw the bar with current state.
     * @private
     */
    function draw() {
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      // Background
      ctx.fillStyle = COL_BG;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // Draw danger zone (full bar)
      ctx.fillStyle = COL_DANGER;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // Draw safe window
      ctx.fillStyle = COL_SAFE;
      if (crossesSecond) {
        // Wraps around: draw two segments [safeMin..999] and [0..safeMax]
        var x1 = (safeMin / 1000) * canvasWidth;
        var w1 = canvasWidth - x1;
        ctx.fillRect(x1, 0, w1, canvasHeight);

        var w2 = ((safeMax + 1) / 1000) * canvasWidth;
        ctx.fillRect(0, 0, w2, canvasHeight);
      } else {
        var x = (safeMin / 1000) * canvasWidth;
        var w = ((safeMax - safeMin + 1) / 1000) * canvasWidth;
        ctx.fillRect(x, 0, w, canvasHeight);
      }

      // Tick marks every 100ms (major) and 50ms (minor)
      for (var ms = 0; ms <= 1000; ms += 50) {
        var tx = (ms / 1000) * canvasWidth;
        var isMajor = (ms % 100 === 0);
        ctx.beginPath();
        ctx.strokeStyle = isMajor ? COL_TICK_MAJOR : COL_TICK;
        ctx.lineWidth = isMajor ? 1.5 : 0.5;
        var tickH = isMajor ? 12 : 6;
        ctx.moveTo(tx, canvasHeight);
        ctx.lineTo(tx, canvasHeight - tickH);
        ctx.stroke();

        // Labels on major ticks
        if (isMajor && ms < 1000) {
          ctx.fillStyle = COL_TEXT;
          ctx.font = '8px Verdana, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('' + ms, tx, canvasHeight - 14);
        }
      }

      // Needle (current ms position)
      var needleX = (currentMs / 1000) * canvasWidth;
      ctx.beginPath();
      ctx.strokeStyle = COL_NEEDLE;
      ctx.lineWidth = 2.5;
      ctx.moveTo(needleX, 0);
      ctx.lineTo(needleX, canvasHeight);
      ctx.stroke();

      // Needle head (small triangle at top)
      ctx.fillStyle = COL_NEEDLE;
      ctx.beginPath();
      ctx.moveTo(needleX, 0);
      ctx.lineTo(needleX - 4, 6);
      ctx.lineTo(needleX + 4, 6);
      ctx.closePath();
      ctx.fill();

      // Current ms text near needle
      ctx.fillStyle = COL_NEEDLE;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      var labelY = 18;
      ctx.fillText(TWTools.pad3(Math.floor(currentMs)), needleX, labelY);
    }

    /**
     * Animation loop using requestAnimationFrame.
     * Auto-reads from TimeSync if no manual update is being called.
     * @private
     */
    function animLoop() {
      if (destroyed) return;
      draw();
      animFrame = requestAnimationFrame(animLoop);
    }

    // Start animation
    animFrame = requestAnimationFrame(animLoop);

    return {
      /** @type {jQuery} The bar wrapper element. */
      element: $wrap,

      /**
       * Update the needle position.
       * @param {number} ms - Current millisecond (0-999).
       */
      update: function(ms) {
        currentMs = ms % 1000;
      },

      /**
       * Update the safe window boundaries.
       * @param {number} min - Safe window start (0-999).
       * @param {number} max - Safe window end (0-999).
       * @param {boolean} crosses - Whether window wraps around 999→0.
       */
      setSafeWindow: function(min, max, crosses) {
        safeMin = min;
        safeMax = max;
        crossesSecond = !!crosses;
      },

      /**
       * Destroy the bar and stop animation.
       */
      destroy: function() {
        destroyed = true;
        if (animFrame) {
          cancelAnimationFrame(animFrame);
          animFrame = null;
        }
        $wrap.remove();
      }
    };
  }

  // ============================================================
  // TOAST NOTIFICATIONS
  // ============================================================

  /**
   * Show a quick notification toast.
   * Uses TW's native UI.SuccessMessage / UI.ErrorMessage if available,
   * otherwise falls back to a custom toast.
   *
   * @param {string} message - Notification text.
   * @param {string} [type='success'] - Toast type: 'success', 'warning', or 'error'.
   */
  function toast(message, type) {
    type = type || 'success';

    // Try TW's native notification system first
    if (typeof UI !== 'undefined') {
      if (type === 'success' && typeof UI.SuccessMessage === 'function') {
        UI.SuccessMessage(message);
        return;
      }
      if (type === 'error' && typeof UI.ErrorMessage === 'function') {
        UI.ErrorMessage(message);
        return;
      }
      // Warning — TW has no native warning, use success with prefix
      if (type === 'warning' && typeof UI.SuccessMessage === 'function') {
        UI.SuccessMessage('\u26A0 ' + message);
        return;
      }
    }

    // Fallback: custom toast
    injectStyles();
    var $toast = $('<div class="twt-toast ' + type + '"></div>');
    $toast.text(message);
    $('body').append($toast);

    // Trigger fade-in
    setTimeout(function() {
      $toast.addClass('visible');
    }, 10);

    // Auto-remove after 3 seconds
    setTimeout(function() {
      $toast.removeClass('visible');
      setTimeout(function() {
        $toast.remove();
      }, 400);
    }, 3000);
  }

  // ============================================================
  // PUBLIC API — extend window.TWTools.UI
  // ============================================================

  TWTools.UI = {
    createCard: createCard,
    createMsBar: createMsBar,
    toast: toast
  };

})(window, jQuery);
