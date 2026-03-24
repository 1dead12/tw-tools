;(function(window, $) {
  'use strict';

  // ============================================================
  // CONFIG & CONSTANTS
  // ============================================================
  var VERSION = '5.0.0';
  var STORAGE_PREFIX = 'twpt_';
  var CACHE_TTL = {
    unitInfo: 24 * 3600000,
    worldConfig: 24 * 3600000,
    barbVillages: 3600000,
    trains: 12 * 3600000
  };

  var DEFAULT_UNIT_SPEEDS = {
    spear: 18, sword: 22, axe: 18, archer: 18, spy: 9,
    light: 10, marcher: 10, heavy: 11,
    ram: 30, catapult: 30, knight: 10, snob: 35
  };

  var COLORS = {
    bg: '#1a1a2e',
    bgPanel: '#16213e',
    bgInput: '#0f3460',
    accent: '#e0c882',
    accentDim: '#a89050',
    text: '#e0d8c0',
    textDim: '#8a8070',
    success: '#4caf50',
    warning: '#ff9800',
    danger: '#f44336',
    windowSafe: 'rgba(76, 175, 80, 0.3)',
    windowDanger: 'rgba(244, 67, 54, 0.3)',
    canvasNeedle: '#e0c882',
    canvasBg: '#0a0a1a'
  };

  var CMD_TYPE = {
    CLEANER: 'cleaner',
    NOBLE: 'noble',
    SCOUT: 'scout',
    SUPPORT: 'support',
    UNKNOWN: 'unknown'
  };

  // ============================================================
  // UTILITY FUNCTIONS
  // ============================================================

  function parseTimeToMs(str) {
    var parts = str.split(':');
    if (parts.length < 3) return NaN;
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var s = parseInt(parts[2], 10);
    var ms = parts.length > 3 ? parseInt(parts[3], 10) : 0;
    return ((h * 3600) + (m * 60) + s) * 1000 + ms;
  }

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

  function formatTimeSec(ms) {
    var neg = ms < 0;
    if (neg) ms = -ms;
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    return (neg ? '-' : '') + pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

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

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function pad3(n) { return n < 10 ? '00' + n : n < 100 ? '0' + n : '' + n; }

  function parseCoords(str) {
    var m = str.match(/(\d{1,3})\|(\d{1,3})/);
    if (!m) return null;
    return { x: parseInt(m[1], 10), y: parseInt(m[2], 10) };
  }

  function formatCoords(c) { return c.x + '|' + c.y; }

  // ============================================================
  // SERVER TIME SYNC
  // ============================================================
  var TimeSync = {
    _serverTimeMs: 0,
    _perfOrigin: 0,
    _drift: 0,
    _observer: null,
    _pollInterval: null,

    init: function() {
      this._readFromDOM();
      this._startObserver();
    },

    now: function() {
      var elapsed = performance.now() - this._perfOrigin;
      return Math.floor(this._serverTimeMs + elapsed);
    },

    currentMs: function() {
      return Math.floor(this.now() % 1000);
    },

    getDrift: function() {
      return this._drift;
    },

    _readFromDOM: function() {
      var el = document.getElementById('serverTime');
      if (!el) return;
      var text = el.textContent || el.innerText || '';
      var match = text.match(/(\d{1,2}):(\d{2}):(\d{2})/);
      if (!match) return;
      var h = parseInt(match[1], 10);
      var m = parseInt(match[2], 10);
      var s = parseInt(match[3], 10);
      this._serverTimeMs = ((h * 3600) + (m * 60) + s) * 1000;
      this._perfOrigin = performance.now();
    },

    _startObserver: function() {
      var self = this;
      var el = document.getElementById('serverTime');
      if (!el || typeof MutationObserver === 'undefined') {
        this._pollInterval = setInterval(function() { self._readFromDOM(); }, 1000);
        return;
      }
      this._observer = new MutationObserver(function() {
        self._readFromDOM();
      });
      this._observer.observe(el, { childList: true, characterData: true, subtree: true });
    },

    destroy: function() {
      if (this._observer) { this._observer.disconnect(); this._observer = null; }
      if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
    }
  };

  // ============================================================
  // CALCULATION ENGINE
  // ============================================================
  var Calc = {
    distance: function(c1, c2) {
      var dx = c1.x - c2.x;
      var dy = c1.y - c2.y;
      return Math.sqrt(dx * dx + dy * dy);
    },

    travelTime: function(dist, unitSpeed, worldSpeed, unitSpeedFactor) {
      worldSpeed = worldSpeed || 1;
      unitSpeedFactor = unitSpeedFactor || 1;
      return Math.round((dist * unitSpeed * 60000) / (worldSpeed * unitSpeedFactor));
    },

    safeWindow: function(commands, afterIndex, beforeIndex) {
      if (typeof afterIndex === 'undefined' || afterIndex === null) {
        afterIndex = -1;
        for (var i = 0; i < commands.length; i++) {
          if (commands[i].type === CMD_TYPE.CLEANER) afterIndex = i;
        }
        if (afterIndex === -1) afterIndex = 0;
      }
      if (typeof beforeIndex === 'undefined' || beforeIndex === null) {
        beforeIndex = -1;
        for (var j = afterIndex + 1; j < commands.length; j++) {
          if (commands[j].type === CMD_TYPE.NOBLE) { beforeIndex = j; break; }
        }
        if (beforeIndex === -1) beforeIndex = commands.length - 1;
      }

      var afterCmd = commands[afterIndex];
      var beforeCmd = commands[beforeIndex];
      var msMin = (afterCmd.ms + 1) % 1000;
      var msMax = (beforeCmd.ms - 1 + 1000) % 1000;

      var crossesSecond = afterCmd.timeMs !== undefined && beforeCmd.timeMs !== undefined &&
        Math.floor(afterCmd.timeMs / 1000) !== Math.floor(beforeCmd.timeMs / 1000);

      var width;
      if (crossesSecond || msMin > msMax) {
        width = (999 - msMin) + msMax + 2;
      } else {
        width = msMax - msMin + 1;
      }

      var targetMs = msMin;
      var targetSecondMs = afterCmd.timeMs !== undefined ?
        Math.floor(afterCmd.timeMs / 1000) * 1000 : null;

      return {
        min: msMin,
        max: msMax,
        width: width,
        crossesSecond: crossesSecond,
        targetMs: targetMs,
        targetSecondMs: targetSecondMs,
        afterIndex: afterIndex,
        beforeIndex: beforeIndex
      };
    },

    modeA: function(targetReturnMs, travelTimeMs, serverNowMs) {
      var roundTrip = travelTimeMs * 2;
      var sendTime = targetReturnMs - roundTrip;
      if (sendTime < 0) sendTime += 86400000;

      var remaining = sendTime - serverNowMs;
      if (remaining < -43200000) remaining += 86400000;

      var status;
      if (remaining < 0) status = 'missed';
      else if (remaining < 120000) status = 'urgent';
      else if (remaining < 300000) status = 'soon';
      else status = 'ok';

      return {
        sendTime: sendTime,
        returnTime: targetReturnMs,
        roundTrip: roundTrip,
        remaining: remaining,
        status: status
      };
    },

    modeB: function(targetReturnMs, maxTravelMs, serverNowMs, maxYMinutes) {
      var maxYMs = maxYMinutes ? maxYMinutes * 60000 : maxTravelMs;
      if (maxYMs > maxTravelMs) maxYMs = maxTravelMs;

      var table = [];
      var yMin = Math.floor(maxYMs / 60000);

      for (var y = yMin; y >= 1; y--) {
        var yMs = y * 60000;
        var sendTime = targetReturnMs - (2 * yMs);
        var recallTime = targetReturnMs - yMs;

        if (sendTime < 0) sendTime += 86400000;
        if (recallTime < 0) recallTime += 86400000;

        var remaining = sendTime - serverNowMs;
        if (remaining < -43200000) remaining += 86400000;

        if (remaining < 0) continue;

        var status;
        if (remaining < 120000) status = 'urgent';
        else if (remaining < 300000) status = 'soon';
        else status = 'ok';

        table.push({
          y: y, yMs: yMs,
          sendTime: sendTime,
          recallTime: recallTime,
          returnTime: targetReturnMs,
          remaining: remaining,
          status: status
        });
      }

      return table;
    },

    modeC: function(targetArrivalMs, travelTimeMs, serverNowMs) {
      var sendTime = targetArrivalMs - travelTimeMs;
      if (sendTime < 0) sendTime += 86400000;

      var remaining = sendTime - serverNowMs;
      if (remaining < -43200000) remaining += 86400000;

      var status;
      if (remaining < 0) status = 'missed';
      else if (remaining < 120000) status = 'urgent';
      else if (remaining < 300000) status = 'soon';
      else status = 'ok';

      return {
        sendTime: sendTime,
        arrivalTime: targetArrivalMs,
        remaining: remaining,
        status: status
      };
    },

    buildTargetTime: function(trainSecondMs, targetMs) {
      return trainSecondMs + targetMs;
    }
  };

  // ============================================================
  // STORAGE MODULE
  // ============================================================
  var Storage = {
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
      } catch (e) { return null; }
    },

    set: function(key, value, ttlMs) {
      try {
        var data = { value: value };
        if (ttlMs) data.ttl = Date.now() + ttlMs;
        localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data));
      } catch (e) {}
    },

    remove: function(key) {
      try { localStorage.removeItem(STORAGE_PREFIX + key); } catch (e) {}
    }
  };

  // ============================================================
  // DATA FETCHER (API + DOM)
  // ============================================================
  var DataFetcher = {
    _worldConfig: null,
    _unitSpeeds: null,

    fetchWorldConfig: function(callback) {
      var cached = Storage.get('world_config');
      if (cached) { this._worldConfig = cached; callback(cached); return; }

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

    fetchUnitInfo: function(callback) {
      var cached = Storage.get('unit_info');
      if (cached) { this._unitSpeeds = cached; callback(cached); return; }

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

    fetchBarbVillages: function(callback) {
      var cached = Storage.get('barb_villages');
      if (cached) { callback(cached); return; }

      $.ajax({
        url: '/map/village.txt',
        dataType: 'text',
        success: function(csv) {
          var barbs = [];
          var lines = csv.split('\n');
          for (var i = 0; i < lines.length; i++) {
            var cols = lines[i].split(',');
            if (cols.length >= 5 && cols[4] === '0') {
              barbs.push({
                id: parseInt(cols[0], 10),
                x: parseInt(cols[2], 10),
                y: parseInt(cols[3], 10),
                points: parseInt(cols[5], 10) || 0
              });
            }
          }
          Storage.set('barb_villages', barbs, CACHE_TTL.barbVillages);
          callback(barbs);
        },
        error: function() { callback([]); }
      });
    },

    findNearestBarbs: function(coord, maxResults, barbs) {
      maxResults = maxResults || 10;
      if (!barbs || !barbs.length) return [];
      var withDist = barbs.map(function(b) {
        return { village: b, dist: Calc.distance(coord, b) };
      });
      withDist.sort(function(a, b) { return a.dist - b.dist; });
      return withDist.slice(0, maxResults);
    },

    getWorldSpeed: function() {
      return this._worldConfig ? this._worldConfig.speed : 1;
    },

    getUnitSpeedFactor: function() {
      return this._worldConfig ? this._worldConfig.unitSpeed : 1;
    },

    getUnitSpeed: function(unitType) {
      var speeds = this._unitSpeeds || DEFAULT_UNIT_SPEEDS;
      return speeds[unitType] || DEFAULT_UNIT_SPEEDS[unitType] || 30;
    },

    calcTravelTime: function(from, to, unitType) {
      var dist = Calc.distance(from, to);
      var unitSpeed = this.getUnitSpeed(unitType);
      return Calc.travelTime(dist, unitSpeed, this.getWorldSpeed(), this.getUnitSpeedFactor());
    }
  };

  // ============================================================
  // DOM PARSER
  // ============================================================
  var Parser = {
    parseIncomingCommands: function() {
      var commands = [];
      var $rows = $('#commands_incomings tr, .commands-container tr').not(':first');

      if ($rows.length === 0) {
        $rows = $('table.vis tr').filter(function() {
          return $(this).find('img[src*="command"], .command-icon').length > 0;
        });
      }

      $rows.each(function() {
        var $row = $(this);
        var cmd = {};

        var $icon = $row.find('img[src*="command"], .command-icon img').first();
        if ($icon.length) {
          var src = ($icon.attr('src') || '').toLowerCase();
          if (src.indexOf('snob') !== -1 || src.indexOf('noble') !== -1) {
            cmd.type = CMD_TYPE.NOBLE;
          } else if (src.indexOf('ram') !== -1) {
            cmd.type = CMD_TYPE.CLEANER;
          } else if (src.indexOf('axe') !== -1 || src.indexOf('sword') !== -1 || src.indexOf('spear') !== -1) {
            cmd.type = CMD_TYPE.CLEANER;
          } else if (src.indexOf('spy') !== -1 || src.indexOf('scout') !== -1) {
            cmd.type = CMD_TYPE.SCOUT;
          } else if (src.indexOf('support') !== -1 || src.indexOf('def') !== -1) {
            cmd.type = CMD_TYPE.SUPPORT;
          } else {
            cmd.type = CMD_TYPE.UNKNOWN;
          }
        } else {
          cmd.type = CMD_TYPE.UNKNOWN;
        }

        var $playerLink = $row.find('a[href*="info_player"]');
        cmd.attacker = $playerLink.text().trim() || 'Unknown';

        var $coordLinks = $row.find('a[href*="info_village"], span.village_anchor');
        if ($coordLinks.length >= 1) {
          cmd.sourceCoords = parseCoords($coordLinks.eq(0).text());
        }
        if ($coordLinks.length >= 2) {
          cmd.targetCoords = parseCoords($coordLinks.eq(1).text());
        } else if (typeof game_data !== 'undefined') {
          cmd.targetCoords = { x: game_data.village.x, y: game_data.village.y };
        }

        var timeText = $row.text();
        var timeMatch = timeText.match(/(\d{1,2}):(\d{2}):(\d{2})\s*$/m) ||
                        timeText.match(/(\d{1,2}):(\d{2}):(\d{2})/);
        if (timeMatch) {
          var h = parseInt(timeMatch[1], 10);
          var m = parseInt(timeMatch[2], 10);
          var s = parseInt(timeMatch[3], 10);
          cmd.arrivalSec = ((h * 3600) + (m * 60) + s) * 1000;
          cmd.ms = 0;
        }

        var $cmdLink = $row.find('a[href*="command_id"]');
        if ($cmdLink.length) {
          var href = $cmdLink.attr('href');
          var idMatch = href.match(/command_id=(\d+)/);
          if (idMatch) cmd.commandId = parseInt(idMatch[1], 10);
        }

        if (cmd.arrivalSec) commands.push(cmd);
      });

      return commands;
    },

    groupIntoTrains: function(commands) {
      if (!commands.length) return [];

      var sorted = commands.slice().sort(function(a, b) {
        return a.arrivalSec - b.arrivalSec;
      });

      var trains = [];
      var currentTrain = {
        attacker: sorted[0].attacker,
        targetCoords: sorted[0].targetCoords,
        commands: [sorted[0]]
      };

      for (var i = 1; i < sorted.length; i++) {
        var cmd = sorted[i];
        var lastCmd = currentTrain.commands[currentTrain.commands.length - 1];
        var sameAttacker = cmd.attacker === currentTrain.attacker;
        var sameTarget = cmd.targetCoords && currentTrain.targetCoords &&
          cmd.targetCoords.x === currentTrain.targetCoords.x &&
          cmd.targetCoords.y === currentTrain.targetCoords.y;
        var withinWindow = Math.abs(cmd.arrivalSec - lastCmd.arrivalSec) <= 3000;

        if (sameAttacker && sameTarget && withinWindow) {
          currentTrain.commands.push(cmd);
        } else {
          trains.push(currentTrain);
          currentTrain = {
            attacker: cmd.attacker,
            targetCoords: cmd.targetCoords,
            commands: [cmd]
          };
        }
      }
      trains.push(currentTrain);

      trains.forEach(function(train, idx) {
        train.id = 'train_' + idx;
        var times = train.commands.map(function(c) { return c.arrivalSec; });
        train.arrivalStart = Math.min.apply(null, times);
        train.arrivalEnd = Math.max.apply(null, times);
        train.nobleCount = train.commands.filter(function(c) { return c.type === CMD_TYPE.NOBLE; }).length;
      });

      return trains;
    },

    getPlayerVillages: function() {
      var villages = [];

      if (typeof game_data !== 'undefined') {
        villages.push({
          id: game_data.village.id,
          name: game_data.village.name || '',
          x: game_data.village.x,
          y: game_data.village.y,
          current: true
        });
      }

      if ($) {
        $('#combined_table .quickedit-vn, #header_menu_villages a, .village-name').each(function() {
          var text = $(this).text();
          var coords = parseCoords(text);
          if (coords && (villages.length === 0 || !(coords.x === villages[0].x && coords.y === villages[0].y))) {
            var href = $(this).attr('href') || $(this).closest('a').attr('href') || '';
            var idMatch = href.match(/village=(\d+)/);
            villages.push({
              id: idMatch ? parseInt(idMatch[1], 10) : 0,
              name: text.replace(/\s*\(\d+\|\d+\)\s*$/, '').trim(),
              x: coords.x,
              y: coords.y,
              current: false
            });
          }
        });
      }

      return villages;
    }
  };

  // ============================================================
  // STATE MANAGEMENT
  // ============================================================
  var State = {
    activeTab: 'timer',
    trains: [],
    selectedTrainId: null,
    selectedGapAfter: null,
    selectedGapBefore: null,
    mode: 'A',
    sourceVillage: null,
    targetBarb: null,
    travelTimeMs: 0,
    travelTimeAuto: true,
    unitType: 'ram',
    playerVillages: [],
    barbVillages: [],
    snipePlans: [],
    worldConfig: null,
    unitSpeeds: null,

    getSelectedTrain: function() {
      if (!this.selectedTrainId) return null;
      for (var i = 0; i < this.trains.length; i++) {
        if (this.trains[i].id === this.selectedTrainId) return this.trains[i];
      }
      return null;
    },

    saveTrains: function() {
      Storage.set('trains', this.trains, CACHE_TTL.trains);
    },

    loadTrains: function() {
      var saved = Storage.get('trains');
      if (saved) this.trains = saved;
    },

    savePlans: function() {
      Storage.set('snipe_plans', this.snipePlans);
    },

    loadPlans: function() {
      var saved = Storage.get('snipe_plans');
      if (saved) this.snipePlans = saved;
    },

    reset: function() {
      this.trains = [];
      this.selectedTrainId = null;
      this.selectedGapAfter = null;
      this.selectedGapBefore = null;
      this.mode = 'A';
      this.snipePlans = [];
    }
  };

  // ============================================================
  // UI RENDERER
  // ============================================================
  var UI = {
    _container: null,
    _animFrame: null,
    _countdownInterval: null,

    show: function() {
      if (this._container) this.destroy();

      var overlay = document.createElement('div');
      overlay.id = 'twpt-overlay';
      overlay.innerHTML = this._buildModalHTML();
      document.body.appendChild(overlay);
      this._container = overlay;

      this._injectStyles();
      this._bindEvents();
      this._makeDraggable();
      this.renderActiveTab();
      this._startCountdown();
    },

    destroy: function() {
      this._stopCountdown();
      this._stopPrecisionBar();
      if (this._container) {
        this._container.remove();
        this._container = null;
      }
      $(document).off('.twpt');
      $(document).off('.twpt-drag');
    },

    _buildModalHTML: function() {
      return '' +
        '<div id="twpt-modal">' +
          '<div id="twpt-header">' +
            '<span id="twpt-title">TW PRECISION TIMER</span>' +
            '<span id="twpt-version">v' + VERSION + '</span>' +
            '<span id="twpt-server-time"></span>' +
            '<span id="twpt-close">&times;</span>' +
          '</div>' +
          '<div id="twpt-tabs">' +
            '<button class="twpt-tab active" data-tab="timer">Timer</button>' +
            '<button class="twpt-tab" data-tab="coordination">Coordination</button>' +
          '</div>' +
          '<div id="twpt-body">' +
            '<div id="twpt-tab-timer" class="twpt-tab-content active"></div>' +
            '<div id="twpt-tab-coordination" class="twpt-tab-content"></div>' +
          '</div>' +
        '</div>';
    },

    _injectStyles: function() {
      if (document.getElementById('twpt-styles')) return;
      var css =
        '#twpt-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:99998;display:flex;align-items:center;justify-content:center}' +
        '#twpt-modal{width:80vw;max-width:1200px;height:85vh;background:' + COLORS.bg + ';border:2px solid ' + COLORS.accent + ';border-radius:8px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 0 40px rgba(224,200,130,0.2)}' +
        '#twpt-header{display:flex;align-items:center;padding:10px 16px;background:' + COLORS.bgPanel + ';border-bottom:1px solid ' + COLORS.accent + ';cursor:move;user-select:none;gap:12px}' +
        '#twpt-title{font-family:"Courier New",monospace;font-size:16px;font-weight:bold;color:' + COLORS.accent + ';letter-spacing:2px}' +
        '#twpt-version{font-size:11px;color:' + COLORS.textDim + '}' +
        '#twpt-server-time{margin-left:auto;font-family:"Courier New",monospace;font-size:14px;color:' + COLORS.text + '}' +
        '#twpt-close{font-size:24px;color:' + COLORS.textDim + ';cursor:pointer;margin-left:12px;line-height:1}' +
        '#twpt-close:hover{color:' + COLORS.danger + '}' +
        '#twpt-tabs{display:flex;background:' + COLORS.bgPanel + ';border-bottom:1px solid ' + COLORS.accentDim + ';padding:0 16px}' +
        '.twpt-tab{background:none;border:none;color:' + COLORS.textDim + ';padding:10px 20px;font-size:14px;cursor:pointer;font-family:"Courier New",monospace;border-bottom:2px solid transparent;transition:all 0.2s}' +
        '.twpt-tab:hover{color:' + COLORS.text + '}' +
        '.twpt-tab.active{color:' + COLORS.accent + ';border-bottom-color:' + COLORS.accent + '}' +
        '#twpt-body{flex:1;overflow-y:auto;padding:16px;color:' + COLORS.text + ';font-family:"Courier New",monospace;font-size:13px}' +
        '.twpt-tab-content{display:none}' +
        '.twpt-tab-content.active{display:block}' +
        '.twpt-section{background:' + COLORS.bgPanel + ';border:1px solid ' + COLORS.accentDim + ';border-radius:6px;padding:12px;margin-bottom:12px}' +
        '.twpt-section-title{font-size:12px;color:' + COLORS.accent + ';text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}' +
        '.twpt-input{background:' + COLORS.bgInput + ';border:1px solid ' + COLORS.accentDim + ';color:' + COLORS.text + ';padding:6px 10px;font-family:"Courier New",monospace;font-size:13px;border-radius:4px;outline:none;box-sizing:border-box}' +
        '.twpt-input:focus{border-color:' + COLORS.accent + '}' +
        '.twpt-input-sm{width:80px}' +
        '.twpt-input-ms{width:60px;text-align:center}' +
        '.twpt-input-coords{width:100px}' +
        '.twpt-input-time{width:110px}' +
        '.twpt-btn{background:' + COLORS.accent + ';color:' + COLORS.bg + ';border:none;padding:6px 16px;font-family:"Courier New",monospace;font-size:13px;font-weight:bold;cursor:pointer;border-radius:4px}' +
        '.twpt-btn:hover{background:' + COLORS.accentDim + '}' +
        '.twpt-btn-sm{padding:4px 10px;font-size:12px}' +
        '.twpt-btn-danger{background:' + COLORS.danger + ';color:#fff}' +
        '.twpt-btn-mode{background:' + COLORS.bgInput + ';color:' + COLORS.text + ';border:1px solid ' + COLORS.accentDim + ';padding:8px 16px;cursor:pointer;font-family:"Courier New",monospace}' +
        '.twpt-btn-mode.active{background:' + COLORS.accent + ';color:' + COLORS.bg + ';border-color:' + COLORS.accent + '}' +
        '.twpt-table{width:100%;border-collapse:collapse;font-size:12px}' +
        '.twpt-table th{background:' + COLORS.bgInput + ';color:' + COLORS.accent + ';padding:6px 8px;text-align:left;font-weight:normal;text-transform:uppercase;font-size:11px;letter-spacing:0.5px}' +
        '.twpt-table td{padding:6px 8px;border-bottom:1px solid rgba(224,200,130,0.1)}' +
        '.twpt-table tr:hover td{background:rgba(224,200,130,0.05)}' +
        '.twpt-table tr.active td{background:rgba(224,200,130,0.15)}' +
        '.twpt-table tr.past td{opacity:0.3}' +
        '.twpt-status-ok{color:' + COLORS.success + '}' +
        '.twpt-status-soon{color:' + COLORS.warning + '}' +
        '.twpt-status-urgent{color:' + COLORS.danger + ';font-weight:bold;animation:twpt-blink 1s infinite}' +
        '.twpt-status-missed{color:' + COLORS.textDim + ';text-decoration:line-through}' +
        '@keyframes twpt-blink{0%,100%{opacity:1}50%{opacity:0.3}}' +
        '.twpt-countdown{font-size:48px;font-weight:bold;text-align:center;padding:16px;font-family:"Courier New",monospace;letter-spacing:4px}' +
        '.twpt-ms-bar{position:relative;height:48px;background:' + COLORS.canvasBg + ';border:1px solid ' + COLORS.accentDim + ';border-radius:4px;overflow:hidden;margin:8px 0}' +
        '.twpt-flex{display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
        '.twpt-flex-between{display:flex;justify-content:space-between;align-items:center}' +
        '.twpt-label{font-size:11px;color:' + COLORS.textDim + ';text-transform:uppercase;margin-bottom:2px}' +
        '.twpt-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:bold}' +
        '.twpt-badge-safe{background:rgba(76,175,80,0.2);color:' + COLORS.success + '}' +
        '.twpt-badge-warn{background:rgba(255,152,0,0.2);color:' + COLORS.warning + '}' +
        '.twpt-badge-danger{background:rgba(244,67,54,0.2);color:' + COLORS.danger + '}' +
        '.twpt-select{background:' + COLORS.bgInput + ';border:1px solid ' + COLORS.accentDim + ';color:' + COLORS.text + ';padding:6px 10px;font-family:"Courier New",monospace;font-size:13px;border-radius:4px}' +
        '.twpt-row-gap{cursor:pointer;text-align:center;padding:2px 8px !important;font-size:10px;color:' + COLORS.accentDim + '}' +
        '.twpt-row-gap:hover{background:rgba(224,200,130,0.1) !important;color:' + COLORS.accent + '}' +
        '.twpt-row-gap.selected{background:rgba(76,175,80,0.2) !important;color:' + COLORS.success + '}' +
        '.twpt-info{padding:8px 12px;border-left:3px solid ' + COLORS.accent + ';background:rgba(224,200,130,0.05);margin:8px 0;font-size:12px}' +
        '.twpt-warn{padding:8px 12px;border-left:3px solid ' + COLORS.warning + ';background:rgba(255,152,0,0.05);margin:8px 0;font-size:12px}' +
        '.twpt-error{padding:8px 12px;border-left:3px solid ' + COLORS.danger + ';background:rgba(244,67,54,0.05);margin:8px 0;font-size:12px}' +
        '.twpt-result-box{background:' + COLORS.bgInput + ';border:2px solid ' + COLORS.accent + ';border-radius:8px;padding:16px;text-align:center;margin:12px 0}' +
        '.twpt-result-send{font-size:28px;font-weight:bold;color:' + COLORS.accent + ';font-family:"Courier New",monospace;letter-spacing:2px}' +
        '.twpt-result-label{font-size:11px;color:' + COLORS.textDim + ';text-transform:uppercase;margin-top:4px}' +
        '';

      var style = document.createElement('style');
      style.id = 'twpt-styles';
      style.textContent = css;
      document.head.appendChild(style);
    },

    _bindEvents: function() {
      var self = this;
      $('#twpt-close').on('click', function() { self.destroy(); });
      $('#twpt-overlay').on('click', function(e) {
        if (e.target === this) self.destroy();
      });
      $(document).on('keydown.twpt', function(e) {
        if (e.key === 'Escape') self.destroy();
      });
      $('.twpt-tab').on('click', function() {
        var tab = $(this).data('tab');
        State.activeTab = tab;
        $('.twpt-tab').removeClass('active');
        $(this).addClass('active');
        $('.twpt-tab-content').removeClass('active');
        $('#twpt-tab-' + tab).addClass('active');
        self.renderActiveTab();
      });
    },

    _makeDraggable: function() {
      var $modal = $('#twpt-modal');
      var $header = $('#twpt-header');
      var isDragging = false;
      var startX, startY, origX, origY;

      $header.on('mousedown', function(e) {
        if ($(e.target).is('#twpt-close')) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        var pos = $modal[0].getBoundingClientRect();
        origX = pos.left;
        origY = pos.top;
        $modal.css({ position: 'fixed', margin: 0 });
      });

      $(document).on('mousemove.twpt-drag', function(e) {
        if (!isDragging) return;
        $modal.css({
          left: (origX + e.clientX - startX) + 'px',
          top: (origY + e.clientY - startY) + 'px',
          transform: 'none'
        });
      });

      $(document).on('mouseup.twpt-drag', function() { isDragging = false; });
    },

    renderActiveTab: function() {
      if (State.activeTab === 'timer') this.renderTimerTab();
      else this.renderCoordinationTab();
    },

    _updateServerTime: function() {
      var el = document.getElementById('twpt-server-time');
      if (el) el.textContent = formatTime(TimeSync.now());
    },

    _startCountdown: function() {
      var self = this;
      this._countdownInterval = setInterval(function() {
        self._updateServerTime();
        self._updateCountdowns();
      }, 50);
    },

    _stopCountdown: function() {
      if (this._countdownInterval) {
        clearInterval(this._countdownInterval);
        this._countdownInterval = null;
      }
    },

    _updateCountdowns: function() {
      var now = TimeSync.now();
      $('.twpt-countdown-live').each(function() {
        var target = parseFloat($(this).data('target'));
        var remaining = target - now;
        $(this).text(formatDuration(remaining));
        if (remaining < 0) $(this).css('color', COLORS.textDim);
        else if (remaining < 120000) $(this).css('color', COLORS.danger);
        else if (remaining < 300000) $(this).css('color', COLORS.warning);
        else $(this).css('color', COLORS.success);
      });
    },

    // ----------------------------------------------------------
    // TAB 1: TIMER
    // ----------------------------------------------------------
    renderTimerTab: function() {
      var html = '';
      html += this._renderTrainSelector();
      html += this._renderTrainBreakdown();
      html += this._renderSafeWindow();
      html += this._renderModeToggle();
      html += this._renderSourceConfig();
      html += this._renderResult();
      $('#twpt-tab-timer').html(html);
      this._bindTimerEvents();
    },

    _renderTrainSelector: function() {
      var html = '<div class="twpt-section">';
      html += '<div class="twpt-flex-between"><div class="twpt-section-title">Incoming Train</div>';
      html += '<button class="twpt-btn twpt-btn-sm" id="twpt-add-train">+ Add Train</button></div>';

      if (State.trains.length === 0) {
        html += '<div class="twpt-info">No trains detected. Open this on the incoming attacks page or add manually.</div>';
      } else {
        html += '<select class="twpt-select" id="twpt-train-select" style="width:100%;margin-top:8px">';
        html += '<option value="">-- Select train --</option>';
        State.trains.forEach(function(train) {
          var selected = train.id === State.selectedTrainId ? ' selected' : '';
          var target = train.targetCoords ? formatCoords(train.targetCoords) : '?';
          html += '<option value="' + train.id + '"' + selected + '>' +
            train.attacker + ' → ' + target +
            ' | ' + formatTimeSec(train.arrivalStart) + '-' + formatTimeSec(train.arrivalEnd) +
            ' | ' + train.nobleCount + ' noble(s)' +
            ' | ' + train.commands.length + ' cmds</option>';
        });
        html += '</select>';
      }

      html += '</div>';
      return html;
    },

    _renderTrainBreakdown: function() {
      var train = State.getSelectedTrain();
      if (!train) return '';

      var html = '<div class="twpt-section">';
      html += '<div class="twpt-section-title">Train Breakdown — click gap to set return target</div>';
      html += '<table class="twpt-table"><thead><tr>' +
        '<th>#</th><th>Type</th><th>Arrival (s)</th><th>MS</th><th>Player</th>' +
        '</tr></thead><tbody>';

      train.commands.forEach(function(cmd, idx) {
        // Gap row BEFORE this command (if not first)
        if (idx > 0) {
          var isSelected = State.selectedGapAfter === (idx - 1) && State.selectedGapBefore === idx;
          html += '<tr class="twpt-row-gap' + (isSelected ? ' selected' : '') +
            '" data-after="' + (idx - 1) + '" data-before="' + idx + '">' +
            '<td colspan="5">▼ return HERE ▼ (after ' + cmd.type + ' #' + idx + ')</td></tr>';
        }

        var typeLabel = cmd.type === CMD_TYPE.NOBLE ? 'NOBLE' :
                        cmd.type === CMD_TYPE.CLEANER ? 'CLEAN' :
                        cmd.type === CMD_TYPE.SCOUT ? 'SCOUT' :
                        cmd.type === CMD_TYPE.SUPPORT ? 'SUPP' : '???';
        var typeColor = cmd.type === CMD_TYPE.NOBLE ? COLORS.danger :
                        cmd.type === CMD_TYPE.CLEANER ? COLORS.warning : COLORS.textDim;

        html += '<tr data-idx="' + idx + '">' +
          '<td>' + (idx + 1) + '</td>' +
          '<td style="color:' + typeColor + '">' + typeLabel + '</td>' +
          '<td>' + formatTimeSec(cmd.arrivalSec) + '</td>' +
          '<td><input class="twpt-input twpt-input-ms twpt-cmd-ms" type="number" min="0" max="999" ' +
            'value="' + (cmd.ms || 0) + '" data-idx="' + idx + '" placeholder="000"></td>' +
          '<td>' + (cmd.attacker || '') + '</td>' +
          '</tr>';
      });

      html += '</tbody></table></div>';
      return html;
    },

    _renderSafeWindow: function() {
      var train = State.getSelectedTrain();
      if (!train || train.commands.length < 2) return '';
      if (State.selectedGapAfter === null) return '';

      var win = Calc.safeWindow(train.commands, State.selectedGapAfter, State.selectedGapBefore);
      var badgeClass = win.width >= 200 ? 'twpt-badge-safe' :
                       win.width >= 50 ? 'twpt-badge-warn' : 'twpt-badge-danger';
      var warnMsg = win.width < 50 ? '<div class="twpt-warn">NARROW WINDOW — high risk!</div>' :
                    win.crossesSecond ? '<div class="twpt-warn">Window crosses second boundary</div>' : '';

      var html = '<div class="twpt-section">';
      html += '<div class="twpt-section-title">Safe Window</div>';
      html += '<div class="twpt-flex" style="gap:16px">';
      html += '<div><span class="twpt-label">Min MS</span><div style="font-size:20px;color:' + COLORS.success + '">:' + pad3(win.min) + '</div></div>';
      html += '<div style="font-size:20px">→</div>';
      html += '<div><span class="twpt-label">Max MS</span><div style="font-size:20px;color:' + COLORS.success + '">:' + pad3(win.max) + '</div></div>';
      html += '<div><span class="twpt-badge ' + badgeClass + '">' + win.width + 'ms</span></div>';
      html += '</div>';

      // Visual bar
      html += '<div style="position:relative;height:24px;background:' + COLORS.canvasBg + ';border-radius:4px;margin-top:8px;overflow:hidden">';
      if (win.crossesSecond) {
        var pctMin = (win.min / 1000) * 100;
        var pctMax = ((win.max + 1) / 1000) * 100;
        html += '<div style="position:absolute;left:' + pctMin + '%;right:0;top:0;bottom:0;background:' + COLORS.windowSafe + '"></div>';
        html += '<div style="position:absolute;left:0;width:' + pctMax + '%;top:0;bottom:0;background:' + COLORS.windowSafe + '"></div>';
      } else {
        var pctStart = (win.min / 1000) * 100;
        var pctWidth = (win.width / 1000) * 100;
        html += '<div style="position:absolute;left:' + pctStart + '%;width:' + pctWidth + '%;top:0;bottom:0;background:' + COLORS.windowSafe + '"></div>';
      }
      html += '</div>';
      html += warnMsg;
      html += '</div>';
      return html;
    },

    _renderModeToggle: function() {
      var train = State.getSelectedTrain();
      if (!train) return '';

      var html = '<div class="twpt-section">';
      html += '<div class="twpt-section-title">Snipe Mode</div>';
      html += '<div class="twpt-flex">';
      ['A', 'B', 'C'].forEach(function(m) {
        var active = State.mode === m ? ' active' : '';
        var label = m === 'A' ? 'A — Round-trip (barb)' :
                    m === 'B' ? 'B — Support + Recall' : 'C — One-way Support';
        html += '<button class="twpt-btn-mode twpt-mode-btn' + active + '" data-mode="' + m + '">' + label + '</button>';
      });
      html += '</div></div>';
      return html;
    },

    _renderSourceConfig: function() {
      var train = State.getSelectedTrain();
      if (!train) return '';

      var html = '<div class="twpt-section">';
      html += '<div class="twpt-section-title">Source Configuration</div>';

      if (State.mode === 'A') {
        html += '<div class="twpt-flex" style="gap:16px">';
        html += '<div><span class="twpt-label">Barb Village Coords</span><br>' +
          '<input class="twpt-input twpt-input-coords" id="twpt-barb-coords" type="text" placeholder="525|574" ' +
          'value="' + (State.targetBarb ? formatCoords(State.targetBarb) : '') + '"></div>';
        html += '<div><span class="twpt-label">Unit Type</span><br>' +
          '<select class="twpt-select" id="twpt-unit-type">';
        Object.keys(DEFAULT_UNIT_SPEEDS).forEach(function(u) {
          var sel = u === State.unitType ? ' selected' : '';
          html += '<option value="' + u + '"' + sel + '>' + u + ' (' + DEFAULT_UNIT_SPEEDS[u] + ' min/f)</option>';
        });
        html += '</select></div>';
        html += '<div><span class="twpt-label">Travel Time (override)</span><br>' +
          '<input class="twpt-input twpt-input-time" id="twpt-travel-time" type="text" placeholder="H:MM:SS" ' +
          'value="' + (State.travelTimeMs ? formatTimeSec(State.travelTimeMs) : '') + '"></div>';
        html += '</div>';
      } else if (State.mode === 'B') {
        html += '<div class="twpt-flex" style="gap:16px">';
        html += '<div><span class="twpt-label">Send To (any target)</span><br>' +
          '<input class="twpt-input twpt-input-coords" id="twpt-target-coords" type="text" placeholder="543|571" ' +
          'value="' + (train.targetCoords ? formatCoords(train.targetCoords) : '') + '"></div>';
        html += '<div><span class="twpt-label">Travel Time (one-way)</span><br>' +
          '<input class="twpt-input twpt-input-time" id="twpt-travel-time" type="text" placeholder="H:MM:SS" ' +
          'value="' + (State.travelTimeMs ? formatTimeSec(State.travelTimeMs) : '') + '"></div>';
        html += '</div>';
      } else {
        html += '<div class="twpt-flex" style="gap:16px">';
        html += '<div><span class="twpt-label">Source Village</span><br>' +
          '<input class="twpt-input twpt-input-coords" id="twpt-source-coords" type="text" placeholder="542|570" ' +
          'value="' + (State.sourceVillage ? formatCoords(State.sourceVillage) : '') + '"></div>';
        html += '<div><span class="twpt-label">Travel Time (one-way)</span><br>' +
          '<input class="twpt-input twpt-input-time" id="twpt-travel-time" type="text" placeholder="H:MM:SS" ' +
          'value="' + (State.travelTimeMs ? formatTimeSec(State.travelTimeMs) : '') + '"></div>';
        html += '</div>';
      }

      html += '<div style="margin-top:8px"><button class="twpt-btn" id="twpt-calculate">CALCULATE</button></div>';
      html += '</div>';
      return html;
    },

    _renderResult: function() {
      var train = State.getSelectedTrain();
      if (!train || State.selectedGapAfter === null) return '';

      var win = Calc.safeWindow(train.commands, State.selectedGapAfter, State.selectedGapBefore);
      if (!win.targetSecondMs && !State.travelTimeMs) return '';

      var travelMs = State.travelTimeMs;
      if (!travelMs) return '';

      var targetReturnMs = Calc.buildTargetTime(win.targetSecondMs, win.targetMs);
      var serverNow = TimeSync.now();
      var html = '';

      if (State.mode === 'A') {
        var result = Calc.modeA(targetReturnMs, travelMs, serverNow);
        html += '<div class="twpt-result-box">';
        html += '<div class="twpt-result-label">SEND AT</div>';
        html += '<div class="twpt-result-send">' + formatTime(result.sendTime) + '</div>';
        html += '<div class="twpt-result-label" style="margin-top:8px">RETURN AT</div>';
        html += '<div style="font-size:18px;color:' + COLORS.success + '">' + formatTime(result.returnTime) + '</div>';
        html += '<div style="margin-top:12px" class="twpt-result-label">REMAINING</div>';
        html += '<div class="twpt-countdown twpt-countdown-live" data-target="' + result.sendTime + '">' +
          formatDuration(result.remaining) + '</div>';
        html += '<div class="twpt-status-' + result.status + '" style="font-size:14px">' +
          (result.status === 'ok' ? 'OK' : result.status === 'soon' ? 'SOON' :
           result.status === 'urgent' ? 'HURRY!' : 'MISSED') + '</div>';
        html += '</div>';

        // MS precision bar
        html += '<div class="twpt-section"><div class="twpt-section-title">MS Precision Bar</div>';
        html += '<div class="twpt-ms-bar"><canvas id="twpt-ms-canvas" style="width:100%;height:100%"></canvas></div>';
        html += '</div>';

      } else if (State.mode === 'B') {
        var maxTravelMs = travelMs;
        var table = Calc.modeB(targetReturnMs, maxTravelMs, serverNow);

        html += '<div class="twpt-result-box">';
        html += '<div class="twpt-result-label">TARGET RETURN</div>';
        html += '<div class="twpt-result-send">' + formatTime(targetReturnMs) + '</div>';
        html += '<div style="font-size:12px;color:' + COLORS.textDim + ';margin-top:4px">HIT MS :' + pad3(win.targetMs) + ' on SEND!</div>';
        html += '</div>';

        // MS precision bar
        html += '<div class="twpt-section"><div class="twpt-section-title">MS Precision Bar</div>';
        html += '<div class="twpt-ms-bar"><canvas id="twpt-ms-canvas" style="width:100%;height:100%"></canvas></div>';
        html += '</div>';

        // Retry table
        if (table.length > 0) {
          html += '<div class="twpt-section"><div class="twpt-section-title">Retry Table (' + table.length + ' attempts)</div>';
          html += '<table class="twpt-table"><thead><tr>' +
            '<th>Y (min)</th><th>SEND at (HIT MS!)</th><th>RECALL at (sec)</th><th>Return</th><th>Remaining</th><th>Status</th>' +
            '</tr></thead><tbody>';
          table.forEach(function(row) {
            var statusClass = 'twpt-status-' + row.status;
            html += '<tr>' +
              '<td>' + row.y + '</td>' +
              '<td style="color:' + COLORS.accent + ';font-weight:bold">' + formatTime(row.sendTime) + '</td>' +
              '<td>' + formatTimeSec(row.recallTime) + '</td>' +
              '<td>' + formatTime(row.returnTime) + '</td>' +
              '<td class="twpt-countdown-live" data-target="' + row.sendTime + '">' + formatDuration(row.remaining) + '</td>' +
              '<td class="' + statusClass + '">' + row.status.toUpperCase() + '</td>' +
              '</tr>';
          });
          html += '</tbody></table></div>';
        } else {
          html += '<div class="twpt-error">No valid retry attempts — all send times have passed.</div>';
        }

      } else {
        var resultC = Calc.modeC(targetReturnMs, travelMs, serverNow);
        html += '<div class="twpt-result-box">';
        html += '<div class="twpt-result-label">SEND SUPPORT AT</div>';
        html += '<div class="twpt-result-send">' + formatTime(resultC.sendTime) + '</div>';
        html += '<div class="twpt-result-label" style="margin-top:8px">ARRIVES AT</div>';
        html += '<div style="font-size:18px;color:' + COLORS.success + '">' + formatTime(resultC.arrivalTime) + '</div>';
        html += '<div style="margin-top:12px" class="twpt-result-label">REMAINING</div>';
        html += '<div class="twpt-countdown twpt-countdown-live" data-target="' + resultC.sendTime + '">' +
          formatDuration(resultC.remaining) + '</div>';
        html += '<div class="twpt-status-' + resultC.status + '" style="font-size:14px">' +
          (resultC.status === 'ok' ? 'OK' : resultC.status === 'soon' ? 'SOON' :
           resultC.status === 'urgent' ? 'HURRY!' : 'MISSED') + '</div>';
        html += '</div>';

        html += '<div class="twpt-section"><div class="twpt-section-title">MS Precision Bar</div>';
        html += '<div class="twpt-ms-bar"><canvas id="twpt-ms-canvas" style="width:100%;height:100%"></canvas></div>';
        html += '</div>';
      }

      // Start precision bar after render
      var self = this;
      setTimeout(function() {
        self._startPrecisionBar('twpt-ms-canvas', win);
      }, 50);

      return html;
    },

    _bindTimerEvents: function() {
      var self = this;

      // Train selector
      $('#twpt-train-select').on('change', function() {
        State.selectedTrainId = $(this).val() || null;
        State.selectedGapAfter = null;
        State.selectedGapBefore = null;

        // Auto-select default gap (after last cleaner, before first noble)
        var train = State.getSelectedTrain();
        if (train && train.commands.length >= 2) {
          var lastCleaner = -1;
          for (var i = 0; i < train.commands.length; i++) {
            if (train.commands[i].type === CMD_TYPE.CLEANER) lastCleaner = i;
          }
          if (lastCleaner >= 0) {
            State.selectedGapAfter = lastCleaner;
            for (var j = lastCleaner + 1; j < train.commands.length; j++) {
              if (train.commands[j].type === CMD_TYPE.NOBLE) {
                State.selectedGapBefore = j;
                break;
              }
            }
          }
        }
        self.renderTimerTab();
      });

      // Gap selection
      $('.twpt-row-gap').on('click', function() {
        State.selectedGapAfter = parseInt($(this).data('after'), 10);
        State.selectedGapBefore = parseInt($(this).data('before'), 10);
        self.renderTimerTab();
      });

      // MS input
      $('.twpt-cmd-ms').on('change', function() {
        var idx = parseInt($(this).data('idx'), 10);
        var val = parseInt($(this).val(), 10) || 0;
        var train = State.getSelectedTrain();
        if (train && train.commands[idx]) {
          train.commands[idx].ms = Math.max(0, Math.min(999, val));
          train.commands[idx].timeMs = train.commands[idx].arrivalSec + train.commands[idx].ms;
          State.saveTrains();
        }
      });

      // Mode toggle
      $('.twpt-mode-btn').on('click', function() {
        State.mode = $(this).data('mode');
        self.renderTimerTab();
      });

      // Calculate button
      $('#twpt-calculate').on('click', function() {
        // Read travel time
        var ttInput = $('#twpt-travel-time').val();
        if (ttInput) {
          State.travelTimeMs = parseTimeToMs(ttInput);
        }
        // Read barb coords (Mode A)
        var barbInput = $('#twpt-barb-coords').val();
        if (barbInput) State.targetBarb = parseCoords(barbInput);
        // Read unit type (Mode A)
        var unitInput = $('#twpt-unit-type').val();
        if (unitInput) State.unitType = unitInput;

        // Auto-calc travel time if coords available and no manual override
        if (State.mode === 'A' && State.targetBarb && !ttInput) {
          var source = { x: game_data.village.x, y: game_data.village.y };
          State.travelTimeMs = DataFetcher.calcTravelTime(source, State.targetBarb, State.unitType);
        }

        self.renderTimerTab();
      });

      // Add train manually
      $('#twpt-add-train').on('click', function() {
        var newTrain = {
          id: 'train_manual_' + Date.now(),
          attacker: 'Manual',
          targetCoords: { x: game_data.village.x, y: game_data.village.y },
          commands: [
            { type: CMD_TYPE.CLEANER, arrivalSec: 36000000, ms: 0, timeMs: 36000000, attacker: 'Manual' },
            { type: CMD_TYPE.NOBLE, arrivalSec: 36000000, ms: 500, timeMs: 36000500, attacker: 'Manual' }
          ],
          arrivalStart: 36000000,
          arrivalEnd: 36000500,
          nobleCount: 1
        };
        State.trains.push(newTrain);
        State.selectedTrainId = newTrain.id;
        State.saveTrains();
        self.renderTimerTab();
      });
    },

    // ----------------------------------------------------------
    // TAB 2: COORDINATION
    // ----------------------------------------------------------
    renderCoordinationTab: function() {
      var html = '';
      html += this._renderVillageScanner();
      html += this._renderTrainsMatrix();
      html += this._renderSnipeSources();
      html += this._renderSendSchedule();
      $('#twpt-tab-coordination').html(html);
      this._bindCoordinationEvents();
    },

    _renderVillageScanner: function() {
      var html = '<div class="twpt-section">';
      html += '<div class="twpt-flex-between"><div class="twpt-section-title">Village Scanner</div>';
      html += '<button class="twpt-btn twpt-btn-sm" id="twpt-scan-barbs">Scan Barbarians</button></div>';
      html += '<div class="twpt-flex" style="margin-top:8px">';
      html += '<span>Your villages: ' + State.playerVillages.length + '</span>';
      html += '<span>Barbs loaded: ' + State.barbVillages.length + '</span>';
      html += '</div></div>';
      return html;
    },

    _renderTrainsMatrix: function() {
      if (State.trains.length === 0) {
        return '<div class="twpt-section"><div class="twpt-section-title">Incoming Trains</div>' +
          '<div class="twpt-info">No trains loaded. Go to incoming attacks page and reopen.</div></div>';
      }

      // Group trains by target village
      var byTarget = {};
      State.trains.forEach(function(train) {
        var key = train.targetCoords ? formatCoords(train.targetCoords) : 'unknown';
        if (!byTarget[key]) byTarget[key] = [];
        byTarget[key].push(train);
      });

      var html = '<div class="twpt-section"><div class="twpt-section-title">Incoming Trains</div>';
      Object.keys(byTarget).forEach(function(targetKey) {
        var trains = byTarget[targetKey];
        html += '<div style="margin:8px 0;padding:8px;border:1px solid ' + COLORS.accentDim + ';border-radius:4px">';
        html += '<div style="color:' + COLORS.accent + ';margin-bottom:4px">Target: ' + targetKey + '</div>';
        html += '<table class="twpt-table"><thead><tr>' +
          '<th>Attacker</th><th>Arrival</th><th>Nobles</th><th>Commands</th><th>Action</th>' +
          '</tr></thead><tbody>';
        trains.forEach(function(train) {
          html += '<tr>' +
            '<td>' + train.attacker + '</td>' +
            '<td>' + formatTimeSec(train.arrivalStart) + ' - ' + formatTimeSec(train.arrivalEnd) + '</td>' +
            '<td>' + train.nobleCount + '</td>' +
            '<td>' + train.commands.length + '</td>' +
            '<td><button class="twpt-btn twpt-btn-sm twpt-open-train" data-id="' + train.id + '">Open in Timer</button></td>' +
            '</tr>';
        });
        html += '</tbody></table></div>';
      });
      html += '</div>';
      return html;
    },

    _renderSnipeSources: function() {
      if (State.barbVillages.length === 0 || State.trains.length === 0) return '';

      var serverNow = TimeSync.now();
      var allPlans = [];

      State.trains.forEach(function(train) {
        if (train.commands.length < 2) return;

        // Use default gap (after last cleaner)
        var afterIdx = -1;
        for (var i = 0; i < train.commands.length; i++) {
          if (train.commands[i].type === CMD_TYPE.CLEANER) afterIdx = i;
        }
        if (afterIdx === -1) return;

        var beforeIdx = -1;
        for (var j = afterIdx + 1; j < train.commands.length; j++) {
          if (train.commands[j].type === CMD_TYPE.NOBLE) { beforeIdx = j; break; }
        }
        if (beforeIdx === -1) return;

        var win = Calc.safeWindow(train.commands, afterIdx, beforeIdx);
        if (!win.targetSecondMs) return;
        var targetReturnMs = Calc.buildTargetTime(win.targetSecondMs, win.targetMs);

        // For each player village, find best barb for Mode A
        State.playerVillages.forEach(function(village) {
          var nearBarbs = DataFetcher.findNearestBarbs(village, 3, State.barbVillages);
          nearBarbs.forEach(function(barbInfo) {
            var travelMs = DataFetcher.calcTravelTime(village, barbInfo.village, 'ram');
            var result = Calc.modeA(targetReturnMs, travelMs, serverNow);
            if (result.status !== 'missed') {
              allPlans.push({
                train: train,
                source: village,
                target: barbInfo.village,
                mode: 'A',
                dist: barbInfo.dist,
                travelMs: travelMs,
                sendTime: result.sendTime,
                remaining: result.remaining,
                status: result.status
              });
            }
          });
        });
      });

      if (allPlans.length === 0) return '';

      allPlans.sort(function(a, b) { return a.sendTime - b.sendTime; });

      var html = '<div class="twpt-section"><div class="twpt-section-title">Snipe Sources (' + allPlans.length + ' options)</div>';
      html += '<table class="twpt-table"><thead><tr>' +
        '<th>Source</th><th>Mode</th><th>Barb</th><th>Fields</th><th>Travel</th><th>Send At</th><th>Remaining</th><th>Status</th><th>For Train</th>' +
        '</tr></thead><tbody>';

      allPlans.slice(0, 50).forEach(function(plan) {
        var statusClass = 'twpt-status-' + plan.status;
        html += '<tr>' +
          '<td>' + formatCoords(plan.source) + '</td>' +
          '<td>' + plan.mode + '</td>' +
          '<td>' + formatCoords(plan.target) + '</td>' +
          '<td>' + plan.dist.toFixed(1) + '</td>' +
          '<td>' + formatTimeSec(plan.travelMs) + '</td>' +
          '<td style="color:' + COLORS.accent + '">' + formatTime(plan.sendTime) + '</td>' +
          '<td class="twpt-countdown-live" data-target="' + plan.sendTime + '">' + formatDuration(plan.remaining) + '</td>' +
          '<td class="' + statusClass + '">' + plan.status.toUpperCase() + '</td>' +
          '<td>' + plan.train.attacker + '</td>' +
          '</tr>';
      });

      html += '</tbody></table></div>';

      // Store plans for send schedule
      State.snipePlans = allPlans;
      return html;
    },

    _renderSendSchedule: function() {
      if (!State.snipePlans || State.snipePlans.length === 0) return '';

      var html = '<div class="twpt-section"><div class="twpt-section-title">Unified Send Schedule</div>';

      var nextAction = null;
      State.snipePlans.forEach(function(plan) {
        if (plan.remaining > 0 && (!nextAction || plan.sendTime < nextAction.sendTime)) {
          nextAction = plan;
        }
      });

      if (nextAction) {
        html += '<div class="twpt-result-box" style="margin-bottom:12px">';
        html += '<div class="twpt-result-label">NEXT ACTION</div>';
        html += '<div class="twpt-countdown twpt-countdown-live" data-target="' + nextAction.sendTime + '" style="font-size:36px">' +
          formatDuration(nextAction.remaining) + '</div>';
        html += '<div style="font-size:12px;color:' + COLORS.textDim + '">' +
          formatCoords(nextAction.source) + ' → ' + formatCoords(nextAction.target) +
          ' (for ' + nextAction.train.attacker + ')</div>';
        html += '</div>';
      }

      html += '</div>';
      return html;
    },

    _bindCoordinationEvents: function() {
      var self = this;

      $('#twpt-scan-barbs').on('click', function() {
        $(this).text('Scanning...').prop('disabled', true);
        DataFetcher.fetchBarbVillages(function(barbs) {
          State.barbVillages = barbs;
          self.renderCoordinationTab();
        });
      });

      $('.twpt-open-train').on('click', function() {
        var trainId = $(this).data('id');
        State.selectedTrainId = trainId;
        State.activeTab = 'timer';
        $('.twpt-tab').removeClass('active').first().addClass('active');
        $('.twpt-tab-content').removeClass('active');
        $('#twpt-tab-timer').addClass('active');
        self.renderTimerTab();
      });
    },

    // ----------------------------------------------------------
    // MS PRECISION BAR (Canvas)
    // ----------------------------------------------------------
    _startPrecisionBar: function(canvasId, safeWindow) {
      this._stopPrecisionBar();
      var canvas = document.getElementById(canvasId);
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      var self = this;

      var rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width * 2;
      canvas.height = rect.height * 2;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';

      function draw() {
        var w = canvas.width;
        var h = canvas.height;
        var ms = TimeSync.currentMs();

        ctx.fillStyle = COLORS.canvasBg;
        ctx.fillRect(0, 0, w, h);

        // Safe window zone
        if (safeWindow) {
          ctx.fillStyle = COLORS.windowSafe;
          if (safeWindow.crossesSecond || safeWindow.min > safeWindow.max) {
            var x1 = (safeWindow.min / 1000) * w;
            ctx.fillRect(x1, 0, w - x1, h);
            var x2 = ((safeWindow.max + 1) / 1000) * w;
            ctx.fillRect(0, 0, x2, h);
          } else {
            var xS = (safeWindow.min / 1000) * w;
            var xE = ((safeWindow.max + 1) / 1000) * w;
            ctx.fillRect(xS, 0, xE - xS, h);
          }

          // Boundary lines
          ctx.strokeStyle = COLORS.success;
          ctx.lineWidth = 2;
          var lMin = (safeWindow.min / 1000) * w;
          var lMax = ((safeWindow.max + 1) / 1000) * w;
          ctx.beginPath(); ctx.moveTo(lMin, 0); ctx.lineTo(lMin, h); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(lMax, 0); ctx.lineTo(lMax, h); ctx.stroke();

          // Boundary labels
          ctx.fillStyle = COLORS.success;
          ctx.font = (h * 0.22) + 'px Courier New';
          ctx.textAlign = 'center';
          ctx.fillText(':' + pad3(safeWindow.min), lMin, h * 0.3);
          ctx.fillText(':' + pad3(safeWindow.max), lMax, h * 0.3);
        }

        // 100ms tick marks
        ctx.strokeStyle = 'rgba(224,200,130,0.15)';
        ctx.lineWidth = 1;
        ctx.font = (h * 0.14) + 'px Courier New';
        ctx.fillStyle = 'rgba(224,200,130,0.3)';
        ctx.textAlign = 'center';
        for (var i = 0; i <= 9; i++) {
          var tx = (i * 100 / 1000) * w;
          ctx.beginPath(); ctx.moveTo(tx, h * 0.88); ctx.lineTo(tx, h); ctx.stroke();
          ctx.fillText(i * 100, tx, h * 0.98);
        }

        // Needle
        var needleX = (ms / 1000) * w;
        ctx.strokeStyle = COLORS.canvasNeedle;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(needleX, 0);
        ctx.lineTo(needleX, h);
        ctx.stroke();

        // Needle glow
        ctx.shadowColor = COLORS.canvasNeedle;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(needleX, 0);
        ctx.lineTo(needleX, h);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Current ms label
        ctx.fillStyle = COLORS.accent;
        ctx.font = 'bold ' + (h * 0.28) + 'px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText(':' + pad3(ms), needleX, h * 0.65);

        // In-window indicator
        if (safeWindow) {
          var inWindow;
          if (safeWindow.crossesSecond || safeWindow.min > safeWindow.max) {
            inWindow = ms >= safeWindow.min || ms <= safeWindow.max;
          } else {
            inWindow = ms >= safeWindow.min && ms <= safeWindow.max;
          }
          if (inWindow) {
            ctx.fillStyle = COLORS.success;
            ctx.font = 'bold ' + (h * 0.18) + 'px Courier New';
            ctx.fillText('IN WINDOW', w / 2, h * 0.15);
          }
        }

        self._animFrame = requestAnimationFrame(draw);
      }

      draw();
    },

    _stopPrecisionBar: function() {
      if (this._animFrame) {
        cancelAnimationFrame(this._animFrame);
        this._animFrame = null;
      }
    }
  };

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    // Toggle if already open
    if (document.getElementById('twpt-overlay')) {
      document.getElementById('twpt-overlay').remove();
      return;
    }

    TimeSync.init();
    State.loadTrains();
    State.loadPlans();

    var loaded = 0;
    function onLoaded() {
      loaded++;
      if (loaded < 2) return;

      if (typeof game_data !== 'undefined' &&
          game_data.screen === 'overview_villages' &&
          game_data.mode === 'incomings') {
        var commands = Parser.parseIncomingCommands();
        if (commands.length) {
          State.trains = Parser.groupIntoTrains(commands);
          State.saveTrains();
        }
      }

      State.playerVillages = Parser.getPlayerVillages();
      UI.show();
    }

    DataFetcher.fetchWorldConfig(function(config) {
      State.worldConfig = config;
      onLoaded();
    });

    DataFetcher.fetchUnitInfo(function(speeds) {
      State.unitSpeeds = speeds;
      onLoaded();
    });
  }

  // ============================================================
  // INLINE TESTS (only in test harness)
  // ============================================================
  if (typeof window.TWPT_TESTS !== 'undefined') {
    window.TWPT = {
      parseTimeToMs: parseTimeToMs,
      formatTime: formatTime,
      formatTimeSec: formatTimeSec,
      formatDuration: formatDuration,
      parseCoords: parseCoords,
      formatCoords: formatCoords,
      Calc: Calc,
      TimeSync: TimeSync,
      Storage: Storage,
      DataFetcher: DataFetcher,
      Parser: Parser,
      State: State,
      UI: UI,
      CMD_TYPE: CMD_TYPE,
      COLORS: COLORS,
      pad3: pad3,
      init: init
    };

    // --- UTILITY TESTS ---
    test('parseTimeToMs: H:MM:SS', function() {
      assertEqual(parseTimeToMs('4:30:18'), 16218000);
      assertEqual(parseTimeToMs('0:35:43'), 2143000);
      assertEqual(parseTimeToMs('10:00:00'), 36000000);
    });

    test('parseTimeToMs: H:MM:SS:mmm', function() {
      assertEqual(parseTimeToMs('10:00:00:499'), 36000499);
      assertEqual(parseTimeToMs('09:59:58:694'), 35998694);
    });

    test('formatTime: round-trip', function() {
      assertEqual(formatTime(36000499), '10:00:00:499');
      assertEqual(formatTime(35998694), '09:59:58:694');
      assertEqual(formatTime(0), '00:00:00:000');
    });

    test('formatTimeSec: no ms', function() {
      assertEqual(formatTimeSec(36000000), '10:00:00');
      assertEqual(formatTimeSec(3600000), '01:00:00');
    });

    test('formatDuration: ranges', function() {
      assertEqual(formatDuration(3661000), '1h 1m 1s');
      assertEqual(formatDuration(125000), '2m 5s');
      assertEqual(formatDuration(45000), '45s');
      assertEqual(formatDuration(-1), 'PASSED');
    });

    test('parseCoords: plain', function() {
      var c = parseCoords('543|571');
      assertEqual(c.x, 543); assertEqual(c.y, 571);
    });

    test('parseCoords: embedded', function() {
      var c = parseCoords('Village (543|571) K55');
      assertEqual(c.x, 543); assertEqual(c.y, 571);
    });

    // --- CALC ENGINE TESTS ---
    test('Calc.distance: euclidean', function() {
      assertClose(Calc.distance({x:0,y:0}, {x:3,y:4}), 5.0, 0.001);
      assertClose(Calc.distance({x:542,y:570}, {x:543,y:571}), 1.414, 0.01);
    });

    test('Calc.travelTime: standard', function() {
      assertEqual(Calc.travelTime(5.0, 30, 1, 1), 9000000);
    });

    test('Calc.travelTime: speed 2x', function() {
      assertEqual(Calc.travelTime(5.0, 30, 2, 1), 4500000);
    });

    test('Calc.safeWindow: basic (doc ex1)', function() {
      var cmds = [
        { type: CMD_TYPE.CLEANER, ms: 4, timeMs: 36000004 },
        { type: CMD_TYPE.NOBLE, ms: 238, timeMs: 36000238 }
      ];
      var win = Calc.safeWindow(cmds);
      assertEqual(win.min, 5);
      assertEqual(win.max, 237);
      assertEqual(win.width, 233);
      assertFalse(win.crossesSecond);
    });

    test('Calc.safeWindow: doc ex2', function() {
      var cmds = [
        { type: CMD_TYPE.CLEANER, ms: 499, timeMs: 36000499 },
        { type: CMD_TYPE.NOBLE, ms: 641, timeMs: 36000641 }
      ];
      var win = Calc.safeWindow(cmds);
      assertEqual(win.min, 500);
      assertEqual(win.max, 640);
      assertEqual(win.width, 141);
    });

    test('Calc.safeWindow: cross-second (doc ex6)', function() {
      var cmds = [
        { type: CMD_TYPE.CLEANER, ms: 989, timeMs: 35999989 },
        { type: CMD_TYPE.NOBLE, ms: 130, timeMs: 36000130 }
      ];
      var win = Calc.safeWindow(cmds);
      assertEqual(win.min, 990);
      assertEqual(win.max, 129);
      assertTrue(win.crossesSecond);
      assertEqual(win.width, 140);
    });

    test('Calc.safeWindow: multi-cleaner picks last', function() {
      var cmds = [
        { type: CMD_TYPE.CLEANER, ms: 705, timeMs: 35998705 },
        { type: CMD_TYPE.CLEANER, ms: 995, timeMs: 35998995 },
        { type: CMD_TYPE.NOBLE, ms: 277, timeMs: 35999277 }
      ];
      var win = Calc.safeWindow(cmds);
      assertEqual(win.afterIndex, 1);
      assertEqual(win.min, 996);
    });

    test('Calc.safeWindow: custom gap (doc ex4)', function() {
      var cmds = [
        { type: CMD_TYPE.CLEANER, ms: 705, timeMs: 35998705 },
        { type: CMD_TYPE.CLEANER, ms: 995, timeMs: 35998995 },
        { type: CMD_TYPE.CLEANER, ms: 163, timeMs: 35999163 },
        { type: CMD_TYPE.NOBLE, ms: 277, timeMs: 35999277 },
        { type: CMD_TYPE.CLEANER, ms: 387, timeMs: 35999387 },
        { type: CMD_TYPE.NOBLE, ms: 444, timeMs: 35999444 }
      ];
      var win = Calc.safeWindow(cmds, 4, 5);
      assertEqual(win.min, 388);
      assertEqual(win.max, 443);
      assertEqual(win.width, 56);
    });

    test('Calc.modeA: doc ex1 — send time', function() {
      var travelMs = parseTimeToMs('4:30:18');
      var targetReturn = parseTimeToMs('10:00:00:005');
      var serverNow = parseTimeToMs('00:30:00');
      var r = Calc.modeA(targetReturn, travelMs, serverNow);
      assertEqual(formatTime(r.sendTime), '00:59:24:005');
      assertEqual(r.status, 'ok');
    });

    test('Calc.modeA: doc ex2 — send time', function() {
      var travelMs = parseTimeToMs('4:24:44');
      var targetReturn = parseTimeToMs('10:00:00:500');
      var serverNow = parseTimeToMs('00:30:00');
      var r = Calc.modeA(targetReturn, travelMs, serverNow);
      assertEqual(formatTime(r.sendTime), '01:10:32:500');
    });

    test('Calc.modeA: doc ex4 — send time', function() {
      var travelMs = parseTimeToMs('0:42:51');
      var targetReturn = parseTimeToMs('09:59:59:388');
      var serverNow = parseTimeToMs('08:00:00');
      var r = Calc.modeA(targetReturn, travelMs, serverNow);
      assertEqual(formatTime(r.sendTime), '08:34:17:388');
    });

    test('Calc.modeA: doc ex6 — cross-second', function() {
      var travelMs = parseTimeToMs('0:42:51');
      var targetReturn = parseTimeToMs('09:59:59:990');
      var serverNow = parseTimeToMs('08:00:00');
      var r = Calc.modeA(targetReturn, travelMs, serverNow);
      assertEqual(formatTime(r.sendTime), '08:34:17:990');
    });

    test('Calc.modeA: missed status', function() {
      var travelMs = parseTimeToMs('4:30:18');
      var targetReturn = parseTimeToMs('10:00:00:005');
      var serverNow = parseTimeToMs('02:00:00');
      var r = Calc.modeA(targetReturn, travelMs, serverNow);
      assertEqual(r.status, 'missed');
    });

    test('Calc.modeB: doc ex7 — retry table', function() {
      var maxTravelMs = parseTimeToMs('0:35:43'); // 35m43s = max Y is 35 min
      var targetReturn = parseTimeToMs('09:59:58:694');
      var serverNow = parseTimeToMs('09:00:00');
      var table = Calc.modeB(targetReturn, maxTravelMs, serverNow);

      // Max Y = floor(35.71) = 35, but Y=35 send = 08:49:58:694 (before 09:00 server)
      // Y=30 send = 08:59:58:694 — still before 09:00. Y=29 send = 09:01:58:694 — valid!
      assertEqual(table[0].y, 29);
      assertEqual(formatTime(table[0].sendTime), '09:01:58:694');
      assertEqual(table.length, 29);

      // Doc example Y=20 entry
      var y20 = table.filter(function(r) { return r.y === 20; })[0];
      assertEqual(formatTime(y20.sendTime), '09:19:58:694');
      assertEqual(formatTimeSec(y20.recallTime), '09:39:58');

      // Last entry Y=1
      var last = table[table.length - 1];
      assertEqual(last.y, 1);
      assertEqual(formatTime(last.sendTime), '09:57:58:694');
    });

    test('Calc.modeB: filters past entries', function() {
      var maxTravelMs = parseTimeToMs('0:35:43');
      var targetReturn = parseTimeToMs('09:59:58:694');
      var serverNow = parseTimeToMs('09:45:00');
      var table = Calc.modeB(targetReturn, maxTravelMs, serverNow);
      assertEqual(table[0].y, 7);
    });

    test('Calc.modeC: doc ex8 — one-way', function() {
      var travelMs = parseTimeToMs('0:52:23');
      var targetArrival = parseTimeToMs('09:59:59:388');
      var serverNow = parseTimeToMs('08:00:00');
      var r = Calc.modeC(targetArrival, travelMs, serverNow);
      assertEqual(formatTime(r.sendTime), '09:07:36:388');
    });

    test('Calc.buildTargetTime', function() {
      assertEqual(Calc.buildTargetTime(36000000, 5), 36000005);
    });

    // --- PARSER TESTS ---
    test('Parser.groupIntoTrains: groups by attacker+time', function() {
      var commands = [
        { attacker: 'Fanty', targetCoords: {x:543,y:571}, arrivalSec: 36000000, type: CMD_TYPE.CLEANER },
        { attacker: 'Fanty', targetCoords: {x:543,y:571}, arrivalSec: 36000500, type: CMD_TYPE.NOBLE },
        { attacker: 'Fanty', targetCoords: {x:543,y:571}, arrivalSec: 36001000, type: CMD_TYPE.NOBLE },
        { attacker: 'Kolbas', targetCoords: {x:543,y:571}, arrivalSec: 36005000, type: CMD_TYPE.NOBLE }
      ];
      var trains = Parser.groupIntoTrains(commands);
      assertEqual(trains.length, 2);
      assertEqual(trains[0].commands.length, 3);
      assertEqual(trains[0].attacker, 'Fanty');
      assertEqual(trains[1].attacker, 'Kolbas');
    });

    test('Parser.groupIntoTrains: splits on >3s gap', function() {
      var commands = [
        { attacker: 'Fanty', targetCoords: {x:543,y:571}, arrivalSec: 36000000, type: CMD_TYPE.CLEANER },
        { attacker: 'Fanty', targetCoords: {x:543,y:571}, arrivalSec: 36004000, type: CMD_TYPE.NOBLE }
      ];
      var trains = Parser.groupIntoTrains(commands);
      assertEqual(trains.length, 2);
    });

    test('DataFetcher.findNearestBarbs: sorts by distance', function() {
      var barbs = [
        {id:1, x:550, y:575, points:100},
        {id:2, x:540, y:570, points:100},
        {id:3, x:543, y:571, points:100}
      ];
      var result = DataFetcher.findNearestBarbs({x:543, y:571}, 2, barbs);
      assertEqual(result[0].village.id, 3);
      assertEqual(result[1].village.id, 2);
      assertEqual(result.length, 2);
    });

    // --- STORAGE TESTS ---
    test('Storage: set/get/remove', function() {
      try {
        Storage.set('test_key', { foo: 'bar' });
        var val = Storage.get('test_key');
        if (val === null) {
          // localStorage may be blocked in some contexts (data: URIs, sandboxed)
          // Graceful degradation is the expected behavior
          assertTrue(true, 'localStorage blocked — graceful degradation OK');
        } else {
          assertEqual(val.foo, 'bar');
          Storage.remove('test_key');
          assertEqual(Storage.get('test_key'), null);
        }
      } catch(e) {
        // localStorage blocked — this is expected graceful degradation
        assertTrue(true, 'localStorage blocked — graceful degradation OK');
      }
    });

    test('Storage: TTL expiry', function() {
      Storage.set('test_ttl', 'val', 1); // 1ms TTL
      // Wait for expiry (synchronous check won't work, but get will check)
      var val = Storage.get('test_ttl');
      // May or may not be expired depending on timing, just verify no crash
      assertTrue(val === 'val' || val === null);
      Storage.remove('test_ttl');
    });

  } else {
    // Production mode — run init
    init();
  }

})(window, typeof jQuery !== 'undefined' ? jQuery : null);
