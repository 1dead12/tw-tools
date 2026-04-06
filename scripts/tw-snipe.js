;(function(window, $) {
  'use strict';

  // ============================================================
  // CONFIG & CONSTANTS
  // ============================================================
  var VERSION = '7.0.0';
  var ID_PREFIX = 'tws-';
  var STORAGE_KEY_PREFIX = 'tws_';
  var CACHE_TTL = {
    trains: 12 * 3600000,
    scanResults: 600000,
    outgoingCommands: 300000
  };

  var TRAIN_GROUP_WINDOW_MS = 30000;

  var DEFAULT_UNIT_SPEEDS = {
    spear: 18, sword: 22, axe: 18, archer: 18, spy: 9,
    light: 10, marcher: 10, heavy: 11,
    ram: 30, catapult: 30, knight: 10, snob: 35
  };

  var ALL_UNIT_TYPES = ['spear', 'sword', 'axe', 'spy', 'light', 'heavy', 'ram', 'catapult', 'knight', 'snob'];

  var UNIT_OPTIONS = [
    {value: 'spear', label: 'Spear (18)', speed: 18},
    {value: 'sword', label: 'Sword (22)', speed: 22},
    {value: 'axe', label: 'Axe (18)', speed: 18},
    {value: 'archer', label: 'Archer (18)', speed: 18},
    {value: 'spy', label: 'Scout (9)', speed: 9},
    {value: 'light', label: 'Light Cav (10)', speed: 10},
    {value: 'marcher', label: 'Mounted Archer (10)', speed: 10},
    {value: 'heavy', label: 'Heavy Cav (11)', speed: 11},
    {value: 'ram', label: 'Ram (30)', speed: 30},
    {value: 'catapult', label: 'Catapult (30)', speed: 30},
    {value: 'knight', label: 'Paladin (10)', speed: 10},
    {value: 'snob', label: 'Noble (35)', speed: 35}
  ];

  var CMD_TYPE = {
    CLEANER: 'cleaner',
    NOBLE: 'noble',
    SCOUT: 'scout',
    SUPPORT: 'support',
    UNKNOWN: 'unknown'
  };

  var COLORS = {
    bg: '#f4e4bc',
    bgPanel: '#ede3c5',
    bgInput: '#fff8e7',
    bgDark: '#dbc88e',
    border: '#b89e5a',
    borderLight: '#d4c08a',
    accent: '#804000',
    accentDim: '#a06800',
    text: '#3e2a00',
    textDim: '#7a6530',
    success: '#2e7d32',
    warning: '#e65100',
    danger: '#c62828',
    info: '#1565c0',
    windowSafe: 'rgba(46, 125, 50, 0.25)',
    windowDanger: 'rgba(198, 40, 40, 0.25)',
    canvasNeedle: '#c62828',
    canvasBg: '#fff8e7',
    canvasSafe: 'rgba(46, 125, 50, 0.15)',
    white: '#ffffff'
  };

  var BADGE_COLORS = {
    cleaner: { bg: '#e8f5e9', fg: '#2e7d32', label: 'CLEAN' },
    noble:   { bg: '#ffebee', fg: '#c62828', label: 'NOBLE' },
    scout:   { bg: '#e3f2fd', fg: '#1565c0', label: 'SCOUT' },
    support: { bg: '#f3e5f5', fg: '#6a1b9a', label: 'SUPP' },
    unknown: { bg: '#f5f5f5', fg: '#616161', label: '???' }
  };

  var TAB_IDS = ['timer', 'scanner', 'return-snipe', 'coordination', 'noble', 'tools'];
  var TAB_LABELS = ['Timer', 'Scanner', 'Return-Snipe', 'Coordination', 'Noble Train', 'Tools'];

  // ============================================================
  // INTERNAL UTILITIES (thin wrappers / format helpers)
  // ============================================================

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function pad3(n) { return n < 10 ? '00' + n : n < 100 ? '0' + n : '' + n; }

  function el(id) { return document.getElementById(ID_PREFIX + id); }
  function $el(id) { return $('#' + ID_PREFIX + id); }

  function formatCoords(c) {
    if (!c) return '?';
    return c.x + '|' + c.y;
  }

  /**
   * Build a full epoch-like ms-since-midnight from a base second and ms offset.
   * If base is from tomorrow (>86400000), keep that offset.
   */
  function buildTargetTime(baseSecondMs, targetMs) {
    return baseSecondMs + targetMs;
  }

  /**
   * Get status label from remaining ms
   */
  function remainingStatus(remaining) {
    if (remaining < 0) return 'missed';
    if (remaining < 120000) return 'urgent';
    if (remaining < 300000) return 'soon';
    if (remaining < 600000) return 'recommended';
    return 'ok';
  }

  /**
   * Create safe window object from commands array
   */
  function calcSafeWindow(commands, afterIndex, beforeIndex) {
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
  }

  /**
   * Mode A: Round-trip to barbarian village
   */
  function calcModeA(targetReturnMs, travelTimeMs, serverNowMs) {
    var roundTrip = travelTimeMs * 2;
    var sendTime = targetReturnMs - roundTrip;
    if (sendTime < 0) sendTime += 86400000;
    var remaining = sendTime - serverNowMs;
    if (remaining < -43200000) remaining += 86400000;
    return {
      sendTime: sendTime,
      returnTime: targetReturnMs,
      roundTrip: roundTrip,
      remaining: remaining,
      status: remainingStatus(remaining)
    };
  }

  /**
   * Mode B: Support + recall retry table
   */
  function calcModeB(targetReturnMs, maxTravelMs, serverNowMs, maxYMinutes) {
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
      table.push({
        y: y, yMs: yMs,
        sendTime: sendTime,
        recallTime: recallTime,
        returnTime: targetReturnMs,
        remaining: remaining,
        status: remainingStatus(remaining)
      });
    }
    return table;
  }

  /**
   * Mode C: One-way support
   */
  function calcModeC(targetArrivalMs, travelTimeMs, serverNowMs) {
    var sendTime = targetArrivalMs - travelTimeMs;
    if (sendTime < 0) sendTime += 86400000;
    var remaining = sendTime - serverNowMs;
    if (remaining < -43200000) remaining += 86400000;
    return {
      sendTime: sendTime,
      arrivalTime: targetArrivalMs,
      remaining: remaining,
      status: remainingStatus(remaining)
    };
  }

  // ============================================================
  // STORAGE (localStorage wrapper with TTL)
  // ============================================================
  var Storage = {
    get: function(key) {
      try {
        var raw = localStorage.getItem(STORAGE_KEY_PREFIX + key);
        if (!raw) return null;
        var data = JSON.parse(raw);
        if (data.ttl && Date.now() > data.ttl) {
          localStorage.removeItem(STORAGE_KEY_PREFIX + key);
          return null;
        }
        return data.value;
      } catch (e) { return null; }
    },
    set: function(key, value, ttlMs) {
      try {
        var data = { value: value };
        if (ttlMs) data.ttl = Date.now() + ttlMs;
        localStorage.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(data));
      } catch (e) {}
    },
    remove: function(key) {
      try { localStorage.removeItem(STORAGE_KEY_PREFIX + key); } catch (e) {}
    }
  };

  // ============================================================
  // INCOMING COMMANDS PARSER (DOM)
  // ============================================================

  var DATE_WORDS_TODAY = ['dnes','today','heute','dzisiaj','vandaag','idag','bugün','oggi','hoy'];
  var DATE_WORDS_TOMORROW = ['zajtra','tomorrow','morgen','jutro','zítra','yarın','domani','demain','mañana'];

  var IncomingParser = {
    isOnIncomingsPage: function() {
      if (typeof game_data === 'undefined') return false;
      return game_data.screen === 'overview_villages' &&
        (game_data.mode === 'incomings' ||
         window.location.href.indexOf('mode=incomings') !== -1);
    },

    parseArrivalTime: function(text) {
      text = (text || '').trim().toLowerCase();
      var isTomorrow = false;
      for (var i = 0; i < DATE_WORDS_TOMORROW.length; i++) {
        if (text.indexOf(DATE_WORDS_TOMORROW[i]) !== -1) { isTomorrow = true; break; }
      }
      // Try TWTools first
      if (window.TWTools && TWTools.parseArrivalTime) {
        var parsed = TWTools.parseArrivalTime(text);
        if (parsed !== null) return parsed;
      }
      // Fallback: extract HH:MM:SS:mmm
      var match = text.match(/(\d{1,2}):(\d{2}):(\d{2}):(\d{3})/);
      if (!match) {
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
    },

    parseIncomingCommands: function() {
      // Prefer TWTools.Commands if available
      if (window.TWTools && TWTools.Commands && TWTools.Commands.parseIncoming) {
        return TWTools.Commands.parseIncoming();
      }
      return this._parseDOMIncoming();
    },

    _parseDOMIncoming: function() {
      var commands = [];
      var $table = null;
      $('table').each(function() {
        var $t = $(this);
        var $ths = $t.find('th');
        var hasCommandHeader = false;
        $ths.each(function() {
          var text = $(this).text().trim().toLowerCase();
          if (text.indexOf('príkaz') !== -1 || text.indexOf('command') !== -1 || text.indexOf('befehl') !== -1) {
            hasCommandHeader = true;
            return false;
          }
        });
        if (hasCommandHeader && $t.find('a[href*="info_command"]').length > 0) {
          $table = $t;
        }
      });
      if (!$table) return commands;

      var colMap = {};
      $table.find('th').each(function(idx) {
        var text = $(this).text().trim().toLowerCase();
        if (text.indexOf('príkaz') !== -1 || text.indexOf('command') !== -1 || text.indexOf('befehl') !== -1) colMap.command = idx;
        else if (text.indexOf('cieľ') !== -1 || text.indexOf('target') !== -1 || text.indexOf('ziel') !== -1) colMap.target = idx;
        else if (text.indexOf('pôvod') !== -1 || text.indexOf('origin') !== -1 || text.indexOf('herkunft') !== -1) colMap.origin = idx;
        else if (text.indexOf('hráč') !== -1 || text.indexOf('player') !== -1 || text.indexOf('spieler') !== -1) colMap.player = idx;
        else if (text.indexOf('vzdialenosť') !== -1 || text.indexOf('distance') !== -1 || text.indexOf('entfernung') !== -1) colMap.distance = idx;
        else if (text.indexOf('čas príchodu') !== -1 || text.indexOf('arrival') !== -1 || text.indexOf('ankunft') !== -1) colMap.arrival = idx;
      });
      if (colMap.command === undefined) colMap.command = 0;
      if (colMap.target === undefined) colMap.target = 1;
      if (colMap.origin === undefined) colMap.origin = 2;
      if (colMap.player === undefined) colMap.player = 3;
      if (colMap.distance === undefined) colMap.distance = 4;
      if (colMap.arrival === undefined) colMap.arrival = 5;

      var self = this;
      $table.find('tbody tr, tr').each(function() {
        var $row = $(this);
        var $cells = $row.find('td');
        if ($cells.length < 6) return;
        var $cmdLink = $cells.eq(colMap.command).find('a[href*="info_command"]');
        if ($cmdLink.length === 0) return;

        var cmd = {};

        // Parse command type from icon (PRIMARY method)
        var $icon = $cells.eq(colMap.command).find('img').first();
        var iconSrc = ($icon.attr('src') || '').toLowerCase();
        cmd.iconSrc = iconSrc;

        if (iconSrc.indexOf('snob') !== -1 || iconSrc.indexOf('noble') !== -1) {
          cmd.type = CMD_TYPE.NOBLE;
          cmd.iconType = 'noble';
        } else if (iconSrc.indexOf('support') !== -1 || iconSrc.indexOf('def') !== -1) {
          cmd.type = CMD_TYPE.SUPPORT;
          cmd.iconType = 'support';
        } else if (iconSrc.indexOf('spy') !== -1 || iconSrc.indexOf('scout') !== -1) {
          cmd.type = CMD_TYPE.SCOUT;
          cmd.iconType = 'scout';
        } else if (iconSrc.indexOf('att_large') !== -1 || iconSrc.indexOf('attack_large') !== -1) {
          cmd.type = CMD_TYPE.UNKNOWN;
          cmd.iconType = 'large_attack';
        } else if (iconSrc.indexOf('attack') !== -1 || iconSrc.indexOf('att_') !== -1 ||
                   iconSrc.indexOf('att.') !== -1) {
          cmd.type = CMD_TYPE.UNKNOWN;
          cmd.iconType = 'attack';
        } else if (iconSrc.indexOf('return') !== -1) {
          cmd.type = CMD_TYPE.SUPPORT;
          cmd.iconType = 'return';
        } else {
          cmd.type = CMD_TYPE.UNKNOWN;
          cmd.iconType = 'unknown';
        }

        // Also check command text for support detection
        var cmdText = $cmdLink.text().trim().toLowerCase();
        if (cmdText.indexOf('posil') !== -1 || cmdText.indexOf('support') !== -1 ||
            cmdText.indexOf('unterstützung') !== -1) {
          cmd.type = CMD_TYPE.SUPPORT;
          if (!cmd.iconType || cmd.iconType === 'unknown') cmd.iconType = 'support';
        }

        // Check for user-applied labels (TW allows manual tagging via right-click on commands)
        var $labelImg = $cells.eq(colMap.command).find('img[src*="command/"]');
        if ($labelImg.length > 1) {
          // If there are multiple command images, the last one may be user label
          var lastImgSrc = ($labelImg.last().attr('src') || '').toLowerCase();
          if (lastImgSrc.indexOf('snob') !== -1) {
            cmd.type = CMD_TYPE.NOBLE;
            cmd.iconType = 'noble';
            cmd.userLabeled = true;
          }
        }

        var cmdHref = $cmdLink.attr('href') || '';
        var idMatch = cmdHref.match(/id=(\d+)/);
        if (idMatch) cmd.commandId = parseInt(idMatch[1], 10);

        // Parse target: extract village name, coords, and ID from link
        var $targetCell = $cells.eq(colMap.target);
        var $targetLink = $targetCell.find('a[href*="info_village"]');
        var targetText = $targetCell.text().trim();
        cmd.targetCoords = TWTools.parseCoords(targetText);
        cmd.targetName = targetText.replace(/\s*\(\d+\|\d+\)\s*K\d+\s*$/, '').trim();
        if ($targetLink.length > 0) {
          var targetHref = $targetLink.attr('href') || '';
          var targetIdMatch = targetHref.match(/id=(\d+)/);
          if (targetIdMatch) cmd.targetVillageId = parseInt(targetIdMatch[1], 10);
          if (!cmd.targetName) cmd.targetName = $targetLink.text().trim().replace(/\s*\(\d+\|\d+\)\s*K\d+\s*$/, '').trim();
        }

        // Parse origin/source: extract village name, coords, and ID from link
        var $originCell = $cells.eq(colMap.origin);
        var $originLink = $originCell.find('a[href*="info_village"]');
        var originText = $originCell.text().trim();
        cmd.sourceCoords = TWTools.parseCoords(originText);
        // Extract village name (before coords pattern)
        cmd.sourceName = originText.replace(/\s*\(\d+\|\d+\)\s*K\d+\s*$/, '').trim();
        if ($originLink.length > 0) {
          var originHref = $originLink.attr('href') || '';
          var originIdMatch = originHref.match(/id=(\d+)/);
          if (originIdMatch) cmd.sourceVillageId = parseInt(originIdMatch[1], 10);
          // Prefer link text as village name (more reliable)
          var linkText = $originLink.text().trim().replace(/\s*\(\d+\|\d+\)\s*K\d+\s*$/, '').trim();
          if (linkText) cmd.sourceName = linkText;
        }

        var $playerLink = $cells.eq(colMap.player).find('a[href*="info_player"]');
        cmd.attacker = $playerLink.text().trim() || 'Unknown';

        var distText = $cells.eq(colMap.distance).text().trim().replace(',', '.');
        cmd.distance = parseFloat(distText) || 0;

        var arrivalText = $cells.eq(colMap.arrival).text().trim();
        var arrivalMs = self.parseArrivalTime(arrivalText);
        if (arrivalMs !== null) {
          cmd.arrivalMs = arrivalMs;
          cmd.arrivalSec = Math.floor(arrivalMs / 1000) * 1000;
          cmd.ms = arrivalMs % 1000;
          cmd.timeMs = arrivalMs;
        }
        if (cmd.arrivalMs) commands.push(cmd);
      });
      return commands;
    },

    /**
     * Classify commands within a train by unit speed heuristic
     */
    classifyTrainCommands: function(train, worldSpeed, unitSpeedFactor, unitSpeeds) {
      if (!train.commands || train.commands.length === 0) return;
      // Use TWTools.Commands.classifyUnit if available
      if (window.TWTools && TWTools.Commands && TWTools.Commands.classifyUnit) {
        train.commands.forEach(function(cmd) {
          if (cmd.type === CMD_TYPE.SUPPORT) return;
          // Skip if icon already gave a definitive type (noble, scout)
          if (cmd.iconType === 'noble' || cmd.iconType === 'scout') return;
          var classified = TWTools.Commands.classifyUnit(cmd, train.commands, worldSpeed, unitSpeedFactor);
          if (classified) {
            cmd.type = classified.type;
            cmd.autoClassified = classified.autoClassified;
            cmd.detectedUnit = classified.detectedUnit;
          }
        });
        return;
      }

      // Fallback: local heuristic (only applies to commands where icon didn't determine type)
      var ws = worldSpeed || 1;
      var usf = unitSpeedFactor || 1;
      var dist = train.commands[0].distance || 0;
      if (dist === 0) {
        if (!train.commands[0].iconType || train.commands[0].iconType === 'unknown' || train.commands[0].iconType === 'attack') {
          train.commands[0].type = CMD_TYPE.CLEANER;
          train.commands[0].autoClassified = true;
        }
        return;
      }

      var speeds = unitSpeeds || DEFAULT_UNIT_SPEEDS;
      var travelTimes = {};
      var types = ['axe', 'light', 'ram', 'snob'];
      types.forEach(function(u) {
        var speed = speeds[u] || DEFAULT_UNIT_SPEEDS[u];
        travelTimes[u] = Math.round((dist * speed * 60000) / (ws * usf));
      });

      train.commands.sort(function(a, b) { return a.arrivalMs - b.arrivalMs; });
      if (train.commands.length === 1) {
        if (train.commands[0].type === CMD_TYPE.UNKNOWN) {
          train.commands[0].detectedUnit = 'single attack';
        }
        return;
      }

      var firstArrival = train.commands[0].arrivalMs;
      var ramNobleGap = travelTimes.snob - travelTimes.ram;
      var axeNobleGap = travelTimes.snob - travelTimes.axe;
      var lightNobleGap = travelTimes.snob - travelTimes.light;
      var tolerance = function(gap) { return Math.max(Math.abs(gap) * 0.05, 5000); };

      train.commands.forEach(function(cmd, idx) {
        if (cmd.type === CMD_TYPE.SUPPORT) return;
        // Skip if icon already gave a definitive type (noble, scout)
        if (cmd.iconType === 'noble' || cmd.iconType === 'scout') return;
        var gap = cmd.arrivalMs - firstArrival;
        if (idx === 0) {
          cmd.type = CMD_TYPE.CLEANER;
          cmd.autoClassified = true;
          cmd.detectedUnit = 'earliest arrival';
          return;
        }
        if (Math.abs(gap - ramNobleGap) < tolerance(ramNobleGap)) {
          cmd.type = CMD_TYPE.NOBLE; cmd.autoClassified = true; cmd.detectedUnit = 'snob (vs ram)';
        } else if (Math.abs(gap - axeNobleGap) < tolerance(axeNobleGap)) {
          cmd.type = CMD_TYPE.NOBLE; cmd.autoClassified = true; cmd.detectedUnit = 'snob (vs axe)';
        } else if (Math.abs(gap - lightNobleGap) < tolerance(lightNobleGap)) {
          cmd.type = CMD_TYPE.NOBLE; cmd.autoClassified = true; cmd.detectedUnit = 'snob (vs light)';
        } else if (gap < 60000) {
          cmd.type = CMD_TYPE.UNKNOWN; cmd.autoClassified = true;
          cmd.detectedUnit = 'gap ' + Math.round(gap / 1000) + 's — classify manually';
        } else {
          cmd.type = CMD_TYPE.UNKNOWN; cmd.autoClassified = true;
          cmd.detectedUnit = 'unmatched gap';
        }
      });
    },

    /**
     * Group commands into trains: same attacker + same target + within window
     */
    groupIntoTrains: function(commands, worldSpeed, unitSpeedFactor, unitSpeeds) {
      if (window.TWTools && TWTools.Commands && TWTools.Commands.groupIntoTrains) {
        return TWTools.Commands.groupIntoTrains(commands);
      }

      if (!commands.length) return [];
      var attacks = commands.filter(function(c) { return c.type !== CMD_TYPE.SUPPORT; });
      var supports = commands.filter(function(c) { return c.type === CMD_TYPE.SUPPORT; });
      var sorted = attacks.slice().sort(function(a, b) { return a.arrivalMs - b.arrivalMs; });
      var trains = [];

      if (sorted.length > 0) {
        var currentTrain = {
          attacker: sorted[0].attacker,
          targetCoords: sorted[0].targetCoords,
          commands: [sorted[0]]
        };
        for (var i = 1; i < sorted.length; i++) {
          var cmd = sorted[i];
          var lastCmd = currentTrain.commands[currentTrain.commands.length - 1];
          var same = cmd.attacker === currentTrain.attacker &&
            cmd.targetCoords && currentTrain.targetCoords &&
            cmd.targetCoords.x === currentTrain.targetCoords.x &&
            cmd.targetCoords.y === currentTrain.targetCoords.y &&
            Math.abs(cmd.arrivalMs - lastCmd.arrivalMs) <= TRAIN_GROUP_WINDOW_MS;

          if (same) {
            currentTrain.commands.push(cmd);
          } else {
            trains.push(currentTrain);
            currentTrain = { attacker: cmd.attacker, targetCoords: cmd.targetCoords, commands: [cmd] };
          }
        }
        trains.push(currentTrain);
      }

      supports.forEach(function(s) {
        trains.push({ attacker: s.attacker || 'Support', targetCoords: s.targetCoords, commands: [s] });
      });

      var self = this;
      trains.forEach(function(train, idx) {
        train.id = 'train_' + idx;
        var times = train.commands.map(function(c) { return c.arrivalMs || 0; });
        train.arrivalStart = Math.min.apply(null, times);
        train.arrivalEnd = Math.max.apply(null, times);
        self.classifyTrainCommands(train, worldSpeed, unitSpeedFactor, unitSpeeds);
        train.nobleCount = train.commands.filter(function(c) { return c.type === CMD_TYPE.NOBLE; }).length;
        train.isSupport = train.commands.length === 1 && train.commands[0].type === CMD_TYPE.SUPPORT;
      });

      return trains;
    },

    /**
     * Parse outgoing commands from rally point page
     */
    parseOutgoingCommands: function() {
      if (window.TWTools && TWTools.Commands && TWTools.Commands.parseOutgoing) {
        return TWTools.Commands.parseOutgoing();
      }
      // Fallback: attempt DOM parse on rally point page
      var commands = [];
      var $table = null;
      $('table').each(function() {
        var $t = $(this);
        var headerText = $t.find('th').first().text().trim().toLowerCase();
        if (headerText.indexOf('príkaz') !== -1 || headerText.indexOf('command') !== -1) {
          if ($t.find('a[href*="info_command"]').length > 0) {
            $table = $t;
          }
        }
      });
      if (!$table) return commands;

      var self = this;
      $table.find('tbody tr, tr').each(function() {
        var $row = $(this);
        var $cells = $row.find('td');
        if ($cells.length < 4) return;
        var $cmdLink = $cells.first().find('a[href*="info_command"]');
        if ($cmdLink.length === 0) return;

        var cmd = {};
        var cmdHref = $cmdLink.attr('href') || '';
        var idMatch = cmdHref.match(/id=(\d+)/);
        if (idMatch) cmd.commandId = parseInt(idMatch[1], 10);

        // Parse target coords from the row
        $cells.each(function() {
          var text = $(this).text().trim();
          var coords = TWTools.parseCoords(text);
          if (coords && !cmd.targetCoords) cmd.targetCoords = coords;
        });

        // Parse arrival/return time
        var lastCell = $cells.last().text().trim();
        var arrMs = self.parseArrivalTime(lastCell);
        if (arrMs !== null) {
          cmd.arrivalMs = arrMs;
          cmd.timeMs = arrMs;
        }

        cmd.type = 'outgoing';
        if (cmd.targetCoords) commands.push(cmd);
      });
      return commands;
    }
  };

  // ============================================================
  // STATE MANAGEMENT
  // ============================================================
  var State = {
    activeTab: 'timer',
    // Timer tab
    trains: [],
    selectedTrainId: null,
    selectedGapAfter: null,
    selectedGapBefore: null,
    mode: 'A',
    sourceVillage: null,
    targetBarb: null,
    travelTimeMs: 0,
    unitType: 'ram',
    // Timer source config - village/unit selections
    selectedMyVillageId: null,
    selectedBarbId: null,
    selectedUnitType: 'ram',
    // Scanner tab
    scanTarget: '',
    scanArrival: '',
    scanArrivalDate: 'today',
    scanUnits: { spear: false, sword: false, axe: false, spy: true, light: true, heavy: false, ram: false, catapult: false, knight: false, snob: false },
    scanResults: [],
    // Return-snipe tab
    returnTarget: '',
    returnCommands: [],
    selectedReturnCmd: null,
    returnManualSource: '',
    returnManualTarget: '',
    returnManualUnit: 'light',
    returnMyVillageId: null,
    // Coordination tab
    coordMode: 'A',
    coordTarget: '',
    // Noble tab
    nobleTarget: '',
    nobleSourceId: null,
    nobleArrival: '',
    nobleCount: 4,
    nobleGap: 200,
    nobleIncludeNuke: true,
    noblePlan: null,
    // Tools tab
    toolCalcFrom: '',
    toolCalcTo: '',
    toolBackOrigin: '',
    toolBackDest: '',
    toolBackArrival: '',
    toolBackUnit: 'snob',
    toolFieldsDuration: '',
    // Shared
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

    save: function() {
      Storage.set('state', {
        activeTab: this.activeTab,
        selectedTrainId: this.selectedTrainId,
        selectedGapAfter: this.selectedGapAfter,
        selectedGapBefore: this.selectedGapBefore,
        mode: this.mode,
        unitType: this.unitType,
        selectedMyVillageId: this.selectedMyVillageId,
        selectedBarbId: this.selectedBarbId,
        selectedUnitType: this.selectedUnitType,
        scanTarget: this.scanTarget,
        scanUnits: this.scanUnits,
        coordMode: this.coordMode,
        returnManualUnit: this.returnManualUnit,
        returnMyVillageId: this.returnMyVillageId,
        nobleTarget: this.nobleTarget,
        nobleSourceId: this.nobleSourceId,
        nobleArrival: this.nobleArrival,
        nobleCount: this.nobleCount,
        nobleGap: this.nobleGap,
        nobleIncludeNuke: this.nobleIncludeNuke
      });
    },

    load: function() {
      var saved = Storage.get('state');
      if (saved) {
        this.activeTab = saved.activeTab || 'timer';
        this.selectedTrainId = saved.selectedTrainId || null;
        this.selectedGapAfter = saved.selectedGapAfter !== undefined ? saved.selectedGapAfter : null;
        this.selectedGapBefore = saved.selectedGapBefore !== undefined ? saved.selectedGapBefore : null;
        this.mode = saved.mode || 'A';
        this.unitType = saved.unitType || 'ram';
        this.selectedMyVillageId = saved.selectedMyVillageId || null;
        this.selectedBarbId = saved.selectedBarbId || null;
        this.selectedUnitType = saved.selectedUnitType || 'ram';
        this.scanTarget = saved.scanTarget || '';
        if (saved.scanUnits) this.scanUnits = saved.scanUnits;
        this.coordMode = saved.coordMode || 'A';
        this.returnManualUnit = saved.returnManualUnit || 'light';
        this.returnMyVillageId = saved.returnMyVillageId || null;
        this.nobleTarget = saved.nobleTarget || '';
        this.nobleSourceId = saved.nobleSourceId || null;
        this.nobleArrival = saved.nobleArrival || '';
        this.nobleCount = saved.nobleCount !== undefined ? saved.nobleCount : 4;
        this.nobleGap = saved.nobleGap !== undefined ? saved.nobleGap : 200;
        this.nobleIncludeNuke = saved.nobleIncludeNuke !== undefined ? saved.nobleIncludeNuke : true;
      }
    },

    saveTrains: function() {
      Storage.set('trains', this.trains, CACHE_TTL.trains);
    },

    loadTrains: function() {
      var saved = Storage.get('trains');
      if (saved) this.trains = saved;
    }
  };

  // ============================================================
  // DATA LAYER (wraps TWTools.DataFetcher with fallbacks)
  // ============================================================
  var Data = {
    _worldConfig: null,
    _unitSpeeds: null,

    fetchWorldConfig: function(callback) {
      if (window.TWTools && TWTools.DataFetcher) {
        TWTools.DataFetcher.fetchWorldConfig(function(config) {
          Data._worldConfig = config;
          callback(config);
        });
        return;
      }
      // Fallback: direct API
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
          Storage.set('world_config', config, 86400000);
          callback(config);
        },
        error: function() { var fb = { speed: 1, unitSpeed: 1 }; self._worldConfig = fb; callback(fb); }
      });
    },

    fetchUnitInfo: function(callback) {
      if (window.TWTools && TWTools.DataFetcher) {
        TWTools.DataFetcher.fetchUnitInfo(function(speeds) {
          Data._unitSpeeds = speeds;
          callback(speeds);
        });
        return;
      }
      var cached = Storage.get('unit_info');
      if (cached) { this._unitSpeeds = cached; callback(cached); return; }
      var self = this;
      $.ajax({
        url: '/interface.php?func=get_unit_info',
        dataType: 'xml',
        success: function(xml) {
          var speeds = {};
          $(xml).children().each(function() {
            var speed = parseFloat($(this).find('speed').text());
            if (speed) speeds[this.tagName] = speed;
          });
          self._unitSpeeds = speeds;
          Storage.set('unit_info', speeds, 86400000);
          callback(speeds);
        },
        error: function() { self._unitSpeeds = DEFAULT_UNIT_SPEEDS; callback(DEFAULT_UNIT_SPEEDS); }
      });
    },

    fetchBarbVillages: function(callback) {
      if (window.TWTools && TWTools.DataFetcher) {
        TWTools.DataFetcher.fetchBarbVillages(callback);
        return;
      }
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
              barbs.push({ id: parseInt(cols[0], 10), x: parseInt(cols[2], 10), y: parseInt(cols[3], 10), points: parseInt(cols[5], 10) || 0 });
            }
          }
          Storage.set('barb_villages', barbs, 3600000);
          callback(barbs);
        },
        error: function() { callback([]); }
      });
    },

    fetchPlayerVillages: function(callback) {
      if (window.TWTools && TWTools.DataFetcher && TWTools.DataFetcher.fetchPlayerVillages) {
        TWTools.DataFetcher.fetchPlayerVillages(callback);
        return;
      }
      // Fallback: parse from DOM / game_data
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
          var coords = TWTools.parseCoords(text);
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
      callback(villages);
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
    distance: function(c1, c2) {
      if (window.TWTools && TWTools.distance) return TWTools.distance(c1, c2);
      var dx = c1.x - c2.x;
      var dy = c1.y - c2.y;
      return Math.sqrt(dx * dx + dy * dy);
    },
    travelTime: function(from, to, unitType) {
      if (window.TWTools && TWTools.DataFetcher && TWTools.DataFetcher.calcTravelTime) {
        return TWTools.DataFetcher.calcTravelTime(from, to, unitType);
      }
      var dist = this.distance(from, to);
      var unitSpeed = this.getUnitSpeed(unitType);
      return Math.round((dist * unitSpeed * 60000) / (this.getWorldSpeed() * this.getUnitSpeedFactor()));
    },
    findNearestBarbs: function(coord, maxResults, barbs) {
      maxResults = maxResults || 10;
      if (!barbs || !barbs.length) return [];
      var self = this;
      var withDist = barbs.map(function(b) {
        return { village: b, dist: self.distance(coord, b) };
      });
      withDist.sort(function(a, b) { return a.dist - b.dist; });
      return withDist.slice(0, maxResults);
    }
  };

  // ============================================================
  // TIME SYNC (wraps TWTools.TimeSync)
  // ============================================================
  var TimeSync = {
    init: function() {
      if (window.TWTools && TWTools.TimeSync) {
        TWTools.TimeSync.init();
        return;
      }
      this._readFromDOM();
      this._startObserver();
    },

    now: function() {
      if (window.TWTools && TWTools.TimeSync) return TWTools.TimeSync.now();
      var elapsed = performance.now() - this._perfOrigin;
      return Math.floor(this._serverTimeMs + elapsed);
    },

    currentMs: function() {
      return Math.floor(this.now() % 1000);
    },

    destroy: function() {
      if (window.TWTools && TWTools.TimeSync && TWTools.TimeSync.destroy) {
        TWTools.TimeSync.destroy();
        return;
      }
      if (this._observer) { this._observer.disconnect(); this._observer = null; }
      if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
    },

    // Fallback internals
    _serverTimeMs: 0,
    _perfOrigin: 0,
    _observer: null,
    _pollInterval: null,

    _readFromDOM: function() {
      var el = document.getElementById('serverTime');
      if (!el) return;
      var text = el.textContent || el.innerText || '';
      var match = text.match(/(\d{1,2}):(\d{2}):(\d{2})/);
      if (!match) return;
      this._serverTimeMs = ((parseInt(match[1], 10) * 3600) + (parseInt(match[2], 10) * 60) + parseInt(match[3], 10)) * 1000;
      this._perfOrigin = performance.now();
    },

    _startObserver: function() {
      var self = this;
      var domEl = document.getElementById('serverTime');
      if (!domEl || typeof MutationObserver === 'undefined') {
        this._pollInterval = setInterval(function() { self._readFromDOM(); }, 1000);
        return;
      }
      this._observer = new MutationObserver(function() { self._readFromDOM(); });
      this._observer.observe(domEl, { childList: true, characterData: true, subtree: true });
    }
  };

  // ============================================================
  // FORMAT HELPERS (wrappers around TWTools)
  // ============================================================

  function formatTime(ms) {
    if (window.TWTools && TWTools.formatTime) return TWTools.formatTime(ms);
    var neg = ms < 0;
    if (neg) ms = -ms;
    var totalSec = Math.floor(ms / 1000);
    var millis = ms % 1000;
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    return (neg ? '-' : '') + pad2(h) + ':' + pad2(m) + ':' + pad2(s) + ':' + pad3(millis);
  }

  function formatTimeSec(ms) {
    if (window.TWTools && TWTools.formatTimeSec) return TWTools.formatTimeSec(ms);
    var neg = ms < 0;
    if (neg) ms = -ms;
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    return (neg ? '-' : '') + pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  function formatDuration(ms) {
    if (window.TWTools && TWTools.formatDuration) return TWTools.formatDuration(ms);
    if (ms < 0) return 'PASSED';
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
  }

  function parseTimeToMs(str) {
    if (window.TWTools && TWTools.parseTimeToMs) return TWTools.parseTimeToMs(str);
    var parts = str.split(':');
    if (parts.length < 3) return NaN;
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var s = parseInt(parts[2], 10);
    var ms = parts.length > 3 ? parseInt(parts[3], 10) : 0;
    return ((h * 3600) + (m * 60) + s) * 1000 + ms;
  }

  function parseCoords(str) {
    if (window.TWTools && TWTools.parseCoords) return TWTools.parseCoords(str);
    var m = str.match(/(\d{1,3})\|(\d{1,3})/);
    if (!m) return null;
    return { x: parseInt(m[1], 10), y: parseInt(m[2], 10) };
  }

  /**
   * Build <option> tags for unit dropdown
   */
  function buildUnitOptions(selectedValue) {
    var html = '';
    for (var i = 0; i < UNIT_OPTIONS.length; i++) {
      var opt = UNIT_OPTIONS[i];
      var sel = opt.value === selectedValue ? ' selected' : '';
      html += '<option value="' + opt.value + '"' + sel + '>' + opt.label + '</option>';
    }
    return html;
  }

  /**
   * Build <option> tags for player village dropdown, sorted by distance to a target
   */
  function buildVillageOptions(villages, selectedId, targetCoords) {
    var items = [];
    for (var i = 0; i < villages.length; i++) {
      var v = villages[i];
      var dist = targetCoords ? Data.distance(v, targetCoords) : 0;
      items.push({ village: v, dist: dist });
    }
    if (targetCoords) {
      items.sort(function(a, b) { return a.dist - b.dist; });
    }
    var html = '<option value="">-- Select village --</option>';
    for (var j = 0; j < items.length; j++) {
      var item = items[j];
      var v = item.village;
      var sel = v.id === selectedId ? ' selected' : '';
      var distLabel = targetCoords ? ' [' + item.dist.toFixed(1) + 'f]' : '';
      html += '<option value="' + v.id + '"' + sel + '>' +
        (v.name || 'Village') + ' (' + v.x + '|' + v.y + ')' + distLabel + '</option>';
    }
    return html;
  }

  /**
   * Build <option> tags for nearby barbarian villages dropdown
   */
  function buildBarbOptions(barbs, selectedId, sourceCoords, maxResults) {
    maxResults = maxResults || 20;
    if (!barbs || !barbs.length || !sourceCoords) return '<option value="">No barbs loaded</option>';
    var nearBarbs = Data.findNearestBarbs(sourceCoords, maxResults, barbs);
    var html = '<option value="">-- Select barb --</option>';
    for (var i = 0; i < nearBarbs.length; i++) {
      var b = nearBarbs[i];
      var sel = b.village.id === selectedId ? ' selected' : '';
      html += '<option value="' + b.village.id + '"' + sel + '>(' + b.village.x + '|' + b.village.y + ') [' + b.dist.toFixed(1) + 'f]</option>';
    }
    return html;
  }

  /**
   * Find a village by ID in an array
   */
  function findVillageById(villages, id) {
    if (!id) return null;
    for (var i = 0; i < villages.length; i++) {
      if (villages[i].id === id) return villages[i];
    }
    return null;
  }

  // ============================================================
  // UI RENDERER
  // ============================================================
  var UI = {
    _container: null,
    _animFrame: null,
    _countdownInterval: null,

    // ----------------------------------------------------------
    // LIFECYCLE
    // ----------------------------------------------------------
    show: function() {
      if (this._container) this.destroy();

      var overlay = document.createElement('div');
      overlay.id = ID_PREFIX + 'overlay';
      overlay.innerHTML = this._buildModalHTML();
      document.body.appendChild(overlay);
      this._container = overlay;

      this._injectStyles();
      this._bindGlobalEvents();
      this._makeDraggable();
      this._activateTab(State.activeTab);
      this._startCountdown();
    },

    destroy: function() {
      this._stopCountdown();
      this._stopPrecisionBar();
      if (this._container) {
        this._container.remove();
        this._container = null;
      }
      $(document).off('.tws');
      $(document).off('.tws-drag');
      var styleEl = document.getElementById(ID_PREFIX + 'styles');
      if (styleEl) styleEl.remove();
    },

    // ----------------------------------------------------------
    // HTML BUILDERS
    // ----------------------------------------------------------
    _buildModalHTML: function() {
      var tabButtons = '';
      for (var i = 0; i < TAB_IDS.length; i++) {
        var active = TAB_IDS[i] === State.activeTab ? ' active' : '';
        tabButtons += '<button class="tws-tab' + active + '" data-tab="' + TAB_IDS[i] + '">' + TAB_LABELS[i] + '</button>';
      }

      var tabContents = '';
      for (var j = 0; j < TAB_IDS.length; j++) {
        var activeClass = TAB_IDS[j] === State.activeTab ? ' active' : '';
        tabContents += '<div id="' + ID_PREFIX + 'tab-' + TAB_IDS[j] + '" class="tws-tab-content' + activeClass + '"></div>';
      }

      return '' +
        '<div id="' + ID_PREFIX + 'modal">' +
          '<div id="' + ID_PREFIX + 'header">' +
            '<span id="' + ID_PREFIX + 'title">TW SNIPE v' + VERSION + '</span>' +
            '<span id="' + ID_PREFIX + 'server-time" class="tws-mono"></span>' +
            '<span id="' + ID_PREFIX + 'close">&times;</span>' +
          '</div>' +
          '<div id="' + ID_PREFIX + 'tabs">' + tabButtons + '</div>' +
          '<div id="' + ID_PREFIX + 'body">' + tabContents + '</div>' +
        '</div>';
    },

    // ----------------------------------------------------------
    // CSS INJECTION
    // ----------------------------------------------------------
    _injectStyles: function() {
      if (document.getElementById(ID_PREFIX + 'styles')) return;
      var C = COLORS;
      var css = '' +
        /* Overlay & Modal */
        '#tws-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:99998;display:flex;align-items:center;justify-content:center;font-family:Verdana,Arial,sans-serif;font-size:12px}' +
        '#tws-modal{width:85vw;max-width:1250px;height:88vh;background:' + C.bg + ';border:2px solid ' + C.border + ';border-radius:4px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.4)}' +
        /* Header */
        '#tws-header{display:flex;align-items:center;padding:6px 12px;background:' + C.bgDark + ';border-bottom:1px solid ' + C.border + ';cursor:move;user-select:none;gap:10px}' +
        '#tws-title{font-weight:bold;font-size:13px;color:' + C.accent + ';letter-spacing:1px}' +
        '#tws-server-time{margin-left:auto;font-size:12px;color:' + C.text + '}' +
        '#tws-close{font-size:20px;color:' + C.textDim + ';cursor:pointer;margin-left:10px;line-height:1}' +
        '#tws-close:hover{color:' + C.danger + '}' +
        /* Tabs */
        '#tws-tabs{display:flex;background:' + C.bgDark + ';border-bottom:1px solid ' + C.border + ';padding:0 8px;flex-wrap:wrap}' +
        '.tws-tab{background:none;border:none;color:' + C.textDim + ';padding:7px 14px;font-size:11px;cursor:pointer;font-family:Verdana,Arial,sans-serif;border-bottom:2px solid transparent;transition:all 0.15s}' +
        '.tws-tab:hover{color:' + C.text + '}' +
        '.tws-tab.active{color:' + C.accent + ';border-bottom-color:' + C.accent + ';font-weight:bold}' +
        /* Body */
        '#tws-body{flex:1;overflow-y:auto;padding:10px;color:' + C.text + '}' +
        '.tws-tab-content{display:none}' +
        '.tws-tab-content.active{display:block}' +
        /* Sections */
        '.tws-section{background:' + C.bgPanel + ';border:1px solid ' + C.borderLight + ';border-radius:3px;padding:10px;margin-bottom:10px}' +
        '.tws-section-title{font-size:11px;font-weight:bold;color:' + C.accent + ';text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px}' +
        /* Inputs */
        '.tws-input{background:' + C.bgInput + ';border:1px solid ' + C.borderLight + ';color:' + C.text + ';padding:4px 8px;font-family:Verdana,Arial,sans-serif;font-size:12px;border-radius:2px;outline:none;box-sizing:border-box}' +
        '.tws-input:focus{border-color:' + C.accent + '}' +
        '.tws-input-sm{width:72px}' +
        '.tws-input-ms{width:55px;text-align:center}' +
        '.tws-input-coords{width:80px}' +
        '.tws-input-time{width:110px}' +
        '.tws-input-full{width:100%}' +
        '.tws-mono{font-family:"Courier New",monospace}' +
        /* Buttons */
        '.tws-btn{background:' + C.bgDark + ';color:' + C.text + ';border:1px solid ' + C.border + ';padding:4px 12px;font-size:11px;font-weight:bold;cursor:pointer;border-radius:2px}' +
        '.tws-btn:hover{background:' + C.border + ';color:' + C.white + '}' +
        '.tws-btn-primary{background:' + C.accent + ';color:' + C.white + ';border-color:' + C.accent + '}' +
        '.tws-btn-primary:hover{background:#602000}' +
        '.tws-btn-sm{padding:2px 8px;font-size:10px}' +
        '.tws-btn-danger{background:' + C.danger + ';color:' + C.white + ';border-color:' + C.danger + '}' +
        '.tws-btn-danger:hover{background:#8e0000}' +
        '.tws-btn-mode{background:' + C.bgInput + ';color:' + C.text + ';border:1px solid ' + C.borderLight + ';padding:6px 14px;cursor:pointer}' +
        '.tws-btn-mode.active{background:' + C.accent + ';color:' + C.white + ';border-color:' + C.accent + '}' +
        /* Table */
        '.tws-table{width:100%;border-collapse:collapse;font-size:11px}' +
        '.tws-table th{background:' + C.bgDark + ';color:' + C.accent + ';padding:4px 6px;text-align:left;font-weight:bold;font-size:10px;text-transform:uppercase;letter-spacing:0.3px;border:1px solid ' + C.border + '}' +
        '.tws-table td{padding:4px 6px;border:1px solid ' + C.borderLight + '}' +
        '.tws-table tr:hover td{background:rgba(128,64,0,0.05)}' +
        '.tws-table tr.active td{background:rgba(128,64,0,0.12)}' +
        '.tws-table tr.past td{opacity:0.35}' +
        /* Status badges */
        '.tws-status-ok{color:' + C.success + '}' +
        '.tws-status-recommended{color:' + C.info + ';font-weight:bold}' +
        '.tws-status-soon{color:' + C.warning + '}' +
        '.tws-status-urgent{color:' + C.danger + ';font-weight:bold;animation:tws-blink 1s infinite}' +
        '.tws-status-missed{color:' + C.textDim + ';text-decoration:line-through}' +
        '@keyframes tws-blink{0%,100%{opacity:1}50%{opacity:0.3}}' +
        /* Countdown */
        '.tws-countdown{font-size:42px;font-weight:bold;text-align:center;padding:12px;font-family:"Courier New",monospace;letter-spacing:3px}' +
        /* MS precision bar */
        '.tws-ms-bar{position:relative;height:44px;background:' + C.canvasBg + ';border:1px solid ' + C.borderLight + ';border-radius:2px;overflow:hidden;margin:6px 0}' +
        /* Layout */
        '.tws-flex{display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
        '.tws-flex-between{display:flex;justify-content:space-between;align-items:center}' +
        '.tws-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
        '.tws-grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}' +
        '.tws-label{font-size:10px;color:' + C.textDim + ';text-transform:uppercase;margin-bottom:2px;display:block}' +
        /* Badges */
        '.tws-badge{display:inline-block;padding:1px 6px;border-radius:2px;font-size:10px;font-weight:bold}' +
        '.tws-badge-safe{background:rgba(46,125,50,0.15);color:' + C.success + '}' +
        '.tws-badge-warn{background:rgba(230,81,0,0.15);color:' + C.warning + '}' +
        '.tws-badge-danger{background:rgba(198,40,40,0.15);color:' + C.danger + '}' +
        '.tws-badge-info{background:rgba(21,101,192,0.15);color:' + C.info + '}' +
        '.tws-badge-rec{background:#c8e6c9;color:#1b5e20;font-weight:bold;border:1px solid #a5d6a7}' +
        /* Gap rows in train breakdown */
        '.tws-row-gap{cursor:pointer;text-align:center;padding:2px 6px !important;font-size:9px;color:' + C.textDim + ';border:1px dashed ' + C.borderLight + ' !important}' +
        '.tws-row-gap:hover{background:rgba(46,125,50,0.08) !important;color:' + C.success + '}' +
        '.tws-row-gap.selected{background:rgba(46,125,50,0.15) !important;color:' + C.success + '}' +
        /* Info/warn/error boxes */
        '.tws-info{padding:6px 10px;border-left:3px solid ' + C.info + ';background:rgba(21,101,192,0.05);margin:6px 0;font-size:11px}' +
        '.tws-warn{padding:6px 10px;border-left:3px solid ' + C.warning + ';background:rgba(230,81,0,0.05);margin:6px 0;font-size:11px}' +
        '.tws-error{padding:6px 10px;border-left:3px solid ' + C.danger + ';background:rgba(198,40,40,0.05);margin:6px 0;font-size:11px}' +
        /* Result box */
        '.tws-result-box{background:' + C.bgInput + ';border:2px solid ' + C.accent + ';border-radius:4px;padding:12px;text-align:center;margin:10px 0}' +
        '.tws-result-send{font-size:26px;font-weight:bold;color:' + C.accent + ';font-family:"Courier New",monospace;letter-spacing:2px}' +
        '.tws-result-label{font-size:10px;color:' + C.textDim + ';text-transform:uppercase;margin-top:4px}' +
        /* In-window indicator */
        '.tws-in-window{font-size:14px;font-weight:bold;color:' + C.success + ';text-align:center;padding:4px;animation:tws-pulse 0.5s infinite}' +
        '.tws-danger-zone{font-size:14px;font-weight:bold;color:' + C.danger + ';text-align:center;padding:4px}' +
        '@keyframes tws-pulse{0%,100%{opacity:1}50%{opacity:0.5}}' +
        /* Checkbox units */
        '.tws-unit-check{display:inline-flex;align-items:center;gap:3px;margin:2px 6px 2px 0;font-size:11px}' +
        '.tws-unit-check input{margin:0}' +
        /* Select */
        '.tws-select{background:' + C.bgInput + ';border:1px solid ' + C.borderLight + ';color:' + C.text + ';padding:4px 8px;font-size:12px;border-radius:2px}' +
        /* Textarea (for BBCode) */
        '.tws-textarea{width:100%;min-height:80px;background:' + C.bgInput + ';border:1px solid ' + C.borderLight + ';color:' + C.text + ';padding:6px;font-family:"Courier New",monospace;font-size:11px;border-radius:2px;resize:vertical;box-sizing:border-box}' +
        /* Cancel button for return-snipe */
        '.tws-cancel-btn{font-size:18px;padding:12px 40px;background:' + C.danger + ';color:' + C.white + ';border:2px solid #8e0000;border-radius:4px;cursor:pointer;font-weight:bold;text-transform:uppercase}' +
        '.tws-cancel-btn:hover{background:#8e0000}' +
        '';

      var style = document.createElement('style');
      style.id = ID_PREFIX + 'styles';
      style.textContent = css;
      document.head.appendChild(style);
    },

    // ----------------------------------------------------------
    // EVENT BINDING
    // ----------------------------------------------------------
    _bindGlobalEvents: function() {
      var self = this;
      $el('close').on('click', function() { self.destroy(); });
      $el('overlay').on('click', function(e) { if (e.target === this) self.destroy(); });
      $(document).on('keydown.tws', function(e) { if (e.key === 'Escape') self.destroy(); });

      // Tab switching
      $('#' + ID_PREFIX + 'tabs').on('click', '.tws-tab', function() {
        var tab = $(this).data('tab');
        self._activateTab(tab);
      });
    },

    _activateTab: function(tab) {
      State.activeTab = tab;
      State.save();
      $('.tws-tab').removeClass('active');
      $('.tws-tab[data-tab="' + tab + '"]').addClass('active');
      $('.tws-tab-content').removeClass('active');
      $el('tab-' + tab).addClass('active');
      this._stopPrecisionBar();
      this.renderActiveTab();
    },

    _makeDraggable: function() {
      var $modal = $el('modal');
      var $header = $el('header');
      var isDragging = false;
      var startX, startY, origX, origY;

      $header.on('mousedown', function(e) {
        if ($(e.target).is('#' + ID_PREFIX + 'close')) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        var pos = $modal[0].getBoundingClientRect();
        origX = pos.left;
        origY = pos.top;
        $modal.css({ position: 'fixed', margin: 0 });
      });
      $(document).on('mousemove.tws-drag', function(e) {
        if (!isDragging) return;
        $modal.css({ left: (origX + e.clientX - startX) + 'px', top: (origY + e.clientY - startY) + 'px', transform: 'none' });
      });
      $(document).on('mouseup.tws-drag', function() { isDragging = false; });
    },

    renderActiveTab: function() {
      switch (State.activeTab) {
        case 'timer': this.renderTimerTab(); break;
        case 'scanner': this.renderScannerTab(); break;
        case 'return-snipe': this.renderReturnSnipeTab(); break;
        case 'coordination': this.renderCoordinationTab(); break;
        case 'noble': this.renderNobleTab(); break;
        case 'tools': this.renderToolsTab(); break;
      }
    },

    // ----------------------------------------------------------
    // LIVE UPDATES (countdown + server time)
    // ----------------------------------------------------------
    _startCountdown: function() {
      var self = this;
      this._countdownInterval = setInterval(function() {
        self._updateServerTime();
        self._updateCountdowns();
      }, 50);
    },

    _stopCountdown: function() {
      if (this._countdownInterval) { clearInterval(this._countdownInterval); this._countdownInterval = null; }
    },

    _updateServerTime: function() {
      var domEl = el('server-time');
      if (domEl) domEl.textContent = formatTime(TimeSync.now());
    },

    _updateCountdowns: function() {
      var now = TimeSync.now();
      $('.tws-countdown-live').each(function() {
        var target = parseFloat($(this).data('target'));
        var remaining = target - now;
        $(this).text(formatDuration(remaining));
        if (remaining < 0) $(this).css('color', COLORS.textDim);
        else if (remaining < 120000) $(this).css('color', COLORS.danger);
        else if (remaining < 300000) $(this).css('color', COLORS.warning);
        else $(this).css('color', COLORS.success);
      });
    },

    // ============================================================
    // TAB 1: TIMER
    // ============================================================
    renderTimerTab: function() {
      var html = '';
      html += this._renderTrainSelector();
      html += this._renderTrainBreakdown();
      html += this._renderSafeWindow();
      html += this._renderModeToggle();
      html += this._renderSourceConfig();
      html += this._renderTimerResult();
      $el('tab-timer').html(html);
      this._bindTimerEvents();
    },

    _renderTrainSelector: function() {
      var html = '<div class="tws-section">';
      html += '<div class="tws-flex-between"><div class="tws-section-title">Incoming Trains</div>';
      html += '<div class="tws-flex">';
      if (IncomingParser.isOnIncomingsPage()) {
        html += '<button class="tws-btn tws-btn-sm" id="' + ID_PREFIX + 'refresh-trains">Refresh</button>';
      } else {
        html += '<button class="tws-btn tws-btn-sm" id="' + ID_PREFIX + 'goto-incomings">Go to Incomings</button>';
      }
      html += '<button class="tws-btn tws-btn-sm" id="' + ID_PREFIX + 'add-train">+ Manual</button>';
      html += '</div></div>';

      if (State.trains.length === 0) {
        html += '<div class="tws-warn">No trains loaded. Navigate to Incomings page or add manually.</div>';
      } else {
        html += '<select class="tws-select" id="' + ID_PREFIX + 'train-select" style="width:100%;margin-top:6px">';
        html += '<option value="">-- Select train (' + State.trains.length + ') --</option>';
        State.trains.forEach(function(train) {
          var selected = train.id === State.selectedTrainId ? ' selected' : '';
          var target = formatCoords(train.targetCoords);
          var label = train.isSupport ? 'SUPPORT' :
            (train.nobleCount > 0 ? train.nobleCount + ' noble(s)' : train.commands.length + ' cmd(s)');
          var arrStart = train.arrivalStart > 86400000 ? 'tmrw ' + formatTime(train.arrivalStart - 86400000) : formatTime(train.arrivalStart);
          html += '<option value="' + train.id + '"' + selected + '>' +
            train.attacker + ' \u2192 ' + target + ' | ' + arrStart + ' | ' + label + '</option>';
        });
        html += '</select>';
      }
      html += '</div>';
      return html;
    },

    _renderTrainBreakdown: function() {
      var train = State.getSelectedTrain();
      if (!train) return '';

      var html = '<div class="tws-section">';
      html += '<div class="tws-section-title">Train Breakdown \u2014 click gap to set return target, click type to change</div>';
      html += '<table class="tws-table"><thead><tr>' +
        '<th>#</th><th>Type</th><th>Arrival</th><th>Source Village</th><th>Dist</th>' +
        '</tr></thead><tbody>';

      train.commands.forEach(function(cmd, idx) {
        // Gap row before this command (if not first)
        if (idx > 0) {
          var isSelected = State.selectedGapAfter === (idx - 1) && State.selectedGapBefore === idx;
          var prevLabel = train.commands[idx - 1].type === CMD_TYPE.NOBLE ? 'noble' :
                         train.commands[idx - 1].type === CMD_TYPE.CLEANER ? 'cleaner' : 'cmd';
          html += '<tr class="tws-row-gap' + (isSelected ? ' selected' : '') +
            '" data-after="' + (idx - 1) + '" data-before="' + idx + '">' +
            '<td colspan="5">\u25BC return HERE \u25BC (after ' + prevLabel + ' #' + idx + ')</td></tr>';
        }

        // Type badge: use icon-based type as primary, heuristic as fallback
        var badge = BADGE_COLORS[cmd.type] || BADGE_COLORS.unknown;
        var autoTag = cmd.autoClassified ? ' *' : '';
        var iconHint = '';
        if (cmd.iconType && cmd.iconType !== 'unknown') {
          iconHint = cmd.iconType;
        }
        if (cmd.detectedUnit) {
          iconHint = iconHint ? iconHint + ' / ' + cmd.detectedUnit : cmd.detectedUnit;
        }
        if (cmd.userLabeled) {
          iconHint = iconHint ? iconHint + ' (labeled)' : 'user labeled';
        }
        var detectedHint = iconHint ? ' title="' + iconHint + '"' : '';

        // Arrival time: show ACTUAL arrival with ms precision
        var arrivalDisplay = '';
        if (cmd.arrivalMs) {
          arrivalDisplay = cmd.arrivalMs > 86400000 ?
            'tmrw ' + formatTime(cmd.arrivalMs - 86400000) : formatTime(cmd.arrivalMs);
        } else if (cmd.timeMs) {
          arrivalDisplay = cmd.timeMs > 86400000 ?
            'tmrw ' + formatTime(cmd.timeMs - 86400000) : formatTime(cmd.timeMs);
        } else {
          arrivalDisplay = '??:??:??:???';
        }

        // Source village: show village name + coords as hyperlink
        var sourceDisplay = '';
        if (cmd.sourceVillageId && cmd.sourceCoords) {
          var villageName = cmd.sourceName || 'Village';
          sourceDisplay = '<a href="/game.php?screen=info_village&id=' + cmd.sourceVillageId +
            '" target="_blank" style="color:' + COLORS.accent + ';text-decoration:underline">' +
            villageName + ' (' + formatCoords(cmd.sourceCoords) + ')</a>';
        } else if (cmd.sourceCoords) {
          var srcName = cmd.sourceName || '';
          sourceDisplay = srcName ? srcName + ' (' + formatCoords(cmd.sourceCoords) + ')' : formatCoords(cmd.sourceCoords);
        } else if (cmd.sourceName) {
          sourceDisplay = cmd.sourceName;
        }

        html += '<tr data-idx="' + idx + '">' +
          '<td>' + (idx + 1) + '</td>' +
          '<td class="tws-toggle-type" data-idx="' + idx + '" style="cursor:pointer"' + detectedHint + '>' +
            '<span class="tws-badge" style="background:' + badge.bg + ';color:' + badge.fg + '">' + badge.label + autoTag + '</span></td>' +
          '<td class="tws-mono">' + arrivalDisplay + '</td>' +
          '<td style="font-size:10px">' + sourceDisplay + '</td>' +
          '<td>' + (cmd.distance ? cmd.distance.toFixed(1) : '') + '</td>' +
          '</tr>';
      });

      html += '</tbody></table>';
      html += '<div style="font-size:9px;color:' + COLORS.textDim + ';margin-top:3px">* = auto-classified by heuristic. Click type badge to cycle. Hover for detection details.</div>';
      html += '</div>';
      return html;
    },

    _renderSafeWindow: function() {
      var train = State.getSelectedTrain();
      if (!train || train.commands.length < 2) return '';
      if (State.selectedGapAfter === null) return '';

      var win = calcSafeWindow(train.commands, State.selectedGapAfter, State.selectedGapBefore);
      var badgeClass = win.width >= 200 ? 'tws-badge-safe' :
                       win.width >= 50 ? 'tws-badge-warn' : 'tws-badge-danger';
      var warnMsg = win.width < 50 ? '<div class="tws-warn">NARROW WINDOW \u2014 high risk!</div>' :
                    win.crossesSecond ? '<div class="tws-info">Window crosses second boundary.</div>' : '';

      var html = '<div class="tws-section">';
      html += '<div class="tws-section-title">Safe Window</div>';
      html += '<div class="tws-flex" style="gap:12px">';
      html += '<div><span class="tws-label">Min MS</span><div class="tws-mono" style="font-size:18px;color:' + COLORS.success + '">:' + pad3(win.min) + '</div></div>';
      html += '<div style="font-size:18px">\u2192</div>';
      html += '<div><span class="tws-label">Max MS</span><div class="tws-mono" style="font-size:18px;color:' + COLORS.success + '">:' + pad3(win.max) + '</div></div>';
      html += '<div><span class="tws-badge ' + badgeClass + '">' + win.width + 'ms window</span></div>';
      html += '</div>';

      // Visual bar
      html += '<div style="position:relative;height:20px;background:' + COLORS.canvasBg + ';border:1px solid ' + COLORS.borderLight + ';border-radius:2px;margin-top:6px;overflow:hidden">';
      if (win.crossesSecond || win.min > win.max) {
        var p1 = (win.min / 1000) * 100;
        var p2 = ((win.max + 1) / 1000) * 100;
        html += '<div style="position:absolute;left:' + p1 + '%;right:0;top:0;bottom:0;background:' + COLORS.windowSafe + '"></div>';
        html += '<div style="position:absolute;left:0;width:' + p2 + '%;top:0;bottom:0;background:' + COLORS.windowSafe + '"></div>';
      } else {
        var pS = (win.min / 1000) * 100;
        var pW = (win.width / 1000) * 100;
        html += '<div style="position:absolute;left:' + pS + '%;width:' + pW + '%;top:0;bottom:0;background:' + COLORS.windowSafe + '"></div>';
      }
      html += '</div>';
      html += warnMsg;
      html += '</div>';
      return html;
    },

    _renderModeToggle: function() {
      var train = State.getSelectedTrain();
      if (!train) return '';
      var html = '<div class="tws-section"><div class="tws-section-title">Snipe Mode</div><div class="tws-flex">';
      var modes = [
        { id: 'A', label: 'A \u2014 Round-trip (barb)' },
        { id: 'B', label: 'B \u2014 Support + Recall' },
        { id: 'C', label: 'C \u2014 One-way Support' }
      ];
      modes.forEach(function(m) {
        var active = State.mode === m.id ? ' active' : '';
        html += '<button class="tws-btn-mode tws-mode-btn' + active + '" data-mode="' + m.id + '">' + m.label + '</button>';
      });
      html += '</div></div>';
      return html;
    },

    _renderSourceConfig: function() {
      var train = State.getSelectedTrain();
      if (!train) return '';
      var targetCoords = train.targetCoords;
      var html = '<div class="tws-section"><div class="tws-section-title">Source Configuration</div>';

      if (State.mode === 'A') {
        // Mode A: Round-trip barb. Need: My Village + Barb Village + Unit
        html += '<div class="tws-grid-2" style="margin-bottom:6px">';
        html += '<div><span class="tws-label">My Village</span><select class="tws-select" id="' + ID_PREFIX + 'my-village" style="width:100%">' +
          buildVillageOptions(State.playerVillages, State.selectedMyVillageId, targetCoords) + '</select></div>';
        html += '<div><span class="tws-label">Unit Type</span><select class="tws-select" id="' + ID_PREFIX + 'unit-type" style="width:100%">' +
          buildUnitOptions(State.selectedUnitType) + '</select></div>';
        html += '</div>';

        // Barb dropdown (populated based on selected village)
        var barbSource = State.selectedMyVillageId ? findVillageById(State.playerVillages, State.selectedMyVillageId) : targetCoords;
        html += '<div style="margin-bottom:6px"><span class="tws-label">Nearby Barbarian Village</span>' +
          '<select class="tws-select" id="' + ID_PREFIX + 'barb-select" style="width:100%">' +
          buildBarbOptions(State.barbVillages, State.selectedBarbId, barbSource, 30) + '</select></div>';

        // Show calculated travel time (read-only)
        var travelDisplay = State.travelTimeMs ? formatTimeSec(State.travelTimeMs) : '--:--:--';
        html += '<div class="tws-flex" style="gap:12px;margin-bottom:6px">';
        html += '<div><span class="tws-label">Travel Time (auto)</span><div class="tws-mono" style="font-size:14px;color:' + COLORS.accent + '">' + travelDisplay + '</div></div>';
        html += '<div><span class="tws-label">Round Trip</span><div class="tws-mono" style="font-size:14px;color:' + COLORS.accent + '">' + (State.travelTimeMs ? formatTimeSec(State.travelTimeMs * 2) : '--:--:--') + '</div></div>';
        html += '</div>';

        // Load barbs button if not loaded
        if (State.barbVillages.length === 0) {
          html += '<div class="tws-warn">Barb villages not loaded. <button class="tws-btn tws-btn-sm" id="' + ID_PREFIX + 'load-barbs">Load Barbs</button></div>';
        }

      } else if (State.mode === 'B') {
        // Mode B: Support + Recall. Need: My Village + Unit
        html += '<div class="tws-grid-2" style="margin-bottom:6px">';
        html += '<div><span class="tws-label">My Village</span><select class="tws-select" id="' + ID_PREFIX + 'my-village" style="width:100%">' +
          buildVillageOptions(State.playerVillages, State.selectedMyVillageId, targetCoords) + '</select></div>';
        html += '<div><span class="tws-label">Unit Type (slowest)</span><select class="tws-select" id="' + ID_PREFIX + 'unit-type" style="width:100%">' +
          buildUnitOptions(State.selectedUnitType) + '</select></div>';
        html += '</div>';

        // Show calculated travel time (read-only)
        var travelDisplayB = State.travelTimeMs ? formatTimeSec(State.travelTimeMs) : '--:--:--';
        html += '<div style="margin-bottom:6px"><span class="tws-label">Travel Time to Target (auto)</span>' +
          '<div class="tws-mono" style="font-size:14px;color:' + COLORS.accent + '">' + travelDisplayB + '</div></div>';

      } else {
        // Mode C: One-way support. Need: My Village + Unit
        html += '<div class="tws-grid-2" style="margin-bottom:6px">';
        html += '<div><span class="tws-label">My Village</span><select class="tws-select" id="' + ID_PREFIX + 'my-village" style="width:100%">' +
          buildVillageOptions(State.playerVillages, State.selectedMyVillageId, targetCoords) + '</select></div>';
        html += '<div><span class="tws-label">Unit Type</span><select class="tws-select" id="' + ID_PREFIX + 'unit-type" style="width:100%">' +
          buildUnitOptions(State.selectedUnitType) + '</select></div>';
        html += '</div>';

        // Show calculated travel time (read-only)
        var travelDisplayC = State.travelTimeMs ? formatTimeSec(State.travelTimeMs) : '--:--:--';
        html += '<div style="margin-bottom:6px"><span class="tws-label">Travel Time to Target (auto)</span>' +
          '<div class="tws-mono" style="font-size:14px;color:' + COLORS.accent + '">' + travelDisplayC + '</div></div>';
      }

      html += '<div style="margin-top:6px"><button class="tws-btn tws-btn-primary" id="' + ID_PREFIX + 'calculate">CALCULATE</button></div>';
      html += '</div>';
      return html;
    },

    _renderTimerResult: function() {
      var train = State.getSelectedTrain();
      if (!train || State.selectedGapAfter === null) return '';

      var win = calcSafeWindow(train.commands, State.selectedGapAfter, State.selectedGapBefore);
      var travelMs = State.travelTimeMs;
      if (!travelMs || !win.targetSecondMs) return '';

      var targetReturnMs = buildTargetTime(win.targetSecondMs, win.targetMs);
      var serverNow = TimeSync.now();
      var html = '';

      if (State.mode === 'A') {
        var result = calcModeA(targetReturnMs, travelMs, serverNow);
        html += '<div class="tws-result-box">';
        html += '<div class="tws-result-label">SEND AT</div>';
        html += '<div class="tws-result-send tws-mono">' + formatTime(result.sendTime) + '</div>';
        html += '<div class="tws-result-label" style="margin-top:6px">RETURN AT</div>';
        html += '<div class="tws-mono" style="font-size:16px;color:' + COLORS.success + '">' + formatTime(result.returnTime) + '</div>';
        html += '<div class="tws-result-label" style="margin-top:8px">REMAINING</div>';
        html += '<div class="tws-countdown tws-countdown-live" data-target="' + result.sendTime + '">' + formatDuration(result.remaining) + '</div>';
        html += '<div class="tws-status-' + result.status + '" style="font-size:13px">' + result.status.toUpperCase() + '</div>';
        html += '</div>';

        html += this._renderPrecisionBarSection(win);

      } else if (State.mode === 'B') {
        var table = calcModeB(targetReturnMs, travelMs, serverNow);
        html += '<div class="tws-result-box">';
        html += '<div class="tws-result-label">TARGET RETURN</div>';
        html += '<div class="tws-result-send tws-mono">' + formatTime(targetReturnMs) + '</div>';
        html += '<div style="font-size:11px;color:' + COLORS.textDim + ';margin-top:3px">HIT MS :' + pad3(win.targetMs) + ' on SEND!</div>';
        html += '</div>';

        html += this._renderPrecisionBarSection(win);

        if (table.length > 0) {
          html += '<div class="tws-section"><div class="tws-section-title">Retry Table (' + table.length + ')</div>';
          html += '<table class="tws-table"><thead><tr>' +
            '<th>Y (min)</th><th>SEND at</th><th>RECALL at</th><th>Return</th><th>Remaining</th><th>Status</th>' +
            '</tr></thead><tbody>';
          table.forEach(function(row) {
            html += '<tr><td>' + row.y + '</td>' +
              '<td class="tws-mono" style="color:' + COLORS.accent + ';font-weight:bold">' + formatTime(row.sendTime) + '</td>' +
              '<td class="tws-mono">' + formatTimeSec(row.recallTime) + '</td>' +
              '<td class="tws-mono">' + formatTime(row.returnTime) + '</td>' +
              '<td class="tws-countdown-live" data-target="' + row.sendTime + '">' + formatDuration(row.remaining) + '</td>' +
              '<td class="tws-status-' + row.status + '">' + row.status.toUpperCase() + '</td></tr>';
          });
          html += '</tbody></table></div>';
        } else {
          html += '<div class="tws-error">No valid retry attempts \u2014 all send times have passed.</div>';
        }
      } else {
        var resultC = calcModeC(targetReturnMs, travelMs, serverNow);
        html += '<div class="tws-result-box">';
        html += '<div class="tws-result-label">SEND SUPPORT AT</div>';
        html += '<div class="tws-result-send tws-mono">' + formatTime(resultC.sendTime) + '</div>';
        html += '<div class="tws-result-label" style="margin-top:6px">ARRIVES AT</div>';
        html += '<div class="tws-mono" style="font-size:16px;color:' + COLORS.success + '">' + formatTime(resultC.arrivalTime) + '</div>';
        html += '<div class="tws-result-label" style="margin-top:8px">REMAINING</div>';
        html += '<div class="tws-countdown tws-countdown-live" data-target="' + resultC.sendTime + '">' + formatDuration(resultC.remaining) + '</div>';
        html += '<div class="tws-status-' + resultC.status + '" style="font-size:13px">' + resultC.status.toUpperCase() + '</div>';
        html += '</div>';
        html += this._renderPrecisionBarSection(win);
      }

      return html;
    },

    /**
     * Auto-calculate travel time based on current selections
     */
    _autoCalcTravelTime: function() {
      var train = State.getSelectedTrain();
      if (!train) return;
      var targetCoords = train.targetCoords;
      var myVillage = findVillageById(State.playerVillages, State.selectedMyVillageId);
      var unitType = State.selectedUnitType || 'ram';

      if (State.mode === 'A') {
        // Round-trip: travel from my village to barb
        var barb = findVillageById(State.barbVillages, State.selectedBarbId);
        if (myVillage && barb) {
          State.travelTimeMs = Data.travelTime(myVillage, barb, unitType);
          State.sourceVillage = { x: myVillage.x, y: myVillage.y };
          State.targetBarb = { x: barb.x, y: barb.y };
        }
      } else if (State.mode === 'B' || State.mode === 'C') {
        // Support/recall or one-way: travel from my village to attack target
        if (myVillage && targetCoords) {
          State.travelTimeMs = Data.travelTime(myVillage, targetCoords, unitType);
          State.sourceVillage = { x: myVillage.x, y: myVillage.y };
        }
      }
    },

    _renderPrecisionBarSection: function(win) {
      var html = '<div class="tws-section"><div class="tws-section-title">MS Precision Bar</div>';
      html += '<div class="tws-ms-bar"><canvas id="' + ID_PREFIX + 'ms-canvas" style="width:100%;height:100%"></canvas></div>';
      html += '<div id="' + ID_PREFIX + 'window-indicator"></div>';
      html += '</div>';

      var self = this;
      setTimeout(function() { self._startPrecisionBar(ID_PREFIX + 'ms-canvas', win); }, 50);
      return html;
    },

    _bindTimerEvents: function() {
      var self = this;

      // Train selector
      $el('train-select').on('change', function() {
        State.selectedTrainId = $(this).val() || null;
        State.selectedGapAfter = null;
        State.selectedGapBefore = null;

        var train = State.getSelectedTrain();
        if (train && train.commands.length >= 2) {
          var lastCleaner = -1;
          for (var i = 0; i < train.commands.length; i++) {
            if (train.commands[i].type === CMD_TYPE.CLEANER) lastCleaner = i;
          }
          if (lastCleaner >= 0) {
            State.selectedGapAfter = lastCleaner;
            for (var j = lastCleaner + 1; j < train.commands.length; j++) {
              if (train.commands[j].type === CMD_TYPE.NOBLE) { State.selectedGapBefore = j; break; }
            }
          }
        }
        State.save();
        self.renderTimerTab();
      });

      // Gap selection
      $el('tab-timer').on('click', '.tws-row-gap', function() {
        State.selectedGapAfter = parseInt($(this).data('after'), 10);
        State.selectedGapBefore = parseInt($(this).data('before'), 10);
        State.save();
        self.renderTimerTab();
      });

      // Toggle type
      $el('tab-timer').on('click', '.tws-toggle-type', function() {
        var idx = parseInt($(this).data('idx'), 10);
        var train = State.getSelectedTrain();
        if (train && train.commands[idx]) {
          var current = train.commands[idx].type;
          if (current === CMD_TYPE.CLEANER) train.commands[idx].type = CMD_TYPE.NOBLE;
          else if (current === CMD_TYPE.NOBLE) train.commands[idx].type = CMD_TYPE.SCOUT;
          else if (current === CMD_TYPE.SCOUT) train.commands[idx].type = CMD_TYPE.UNKNOWN;
          else train.commands[idx].type = CMD_TYPE.CLEANER;
          train.commands[idx].autoClassified = false;
          train.nobleCount = train.commands.filter(function(c) { return c.type === CMD_TYPE.NOBLE; }).length;
          State.saveTrains();
          self.renderTimerTab();
        }
      });

      // Go to incomings
      $el('goto-incomings').on('click', function() {
        var vid = typeof game_data !== 'undefined' ? game_data.village.id : '';
        window.location.href = '/game.php?village=' + vid + '&screen=overview_villages&mode=incomings';
      });

      // Refresh trains
      $el('refresh-trains').on('click', function() {
        var commands = IncomingParser.parseIncomingCommands();
        if (commands.length) {
          State.trains = IncomingParser.groupIntoTrains(commands, Data.getWorldSpeed(), Data.getUnitSpeedFactor(), Data._unitSpeeds);
          State.saveTrains();
          State.selectedTrainId = null;
        }
        self.renderTimerTab();
      });

      // Mode toggle
      $el('tab-timer').on('click', '.tws-mode-btn', function() {
        State.mode = $(this).data('mode');
        State.save();
        self.renderTimerTab();
      });

      // My Village dropdown change
      $el('tab-timer').on('change', '#' + ID_PREFIX + 'my-village', function() {
        var villageId = parseInt($(this).val(), 10) || null;
        State.selectedMyVillageId = villageId;
        self._autoCalcTravelTime();
        State.save();
        self.renderTimerTab();
      });

      // Barb dropdown change
      $el('tab-timer').on('change', '#' + ID_PREFIX + 'barb-select', function() {
        var barbId = parseInt($(this).val(), 10) || null;
        State.selectedBarbId = barbId;
        self._autoCalcTravelTime();
        State.save();
        self.renderTimerTab();
      });

      // Unit type dropdown change
      $el('tab-timer').on('change', '#' + ID_PREFIX + 'unit-type', function() {
        State.selectedUnitType = $(this).val();
        self._autoCalcTravelTime();
        State.save();
        self.renderTimerTab();
      });

      // Load barbs button
      $el('tab-timer').on('click', '#' + ID_PREFIX + 'load-barbs', function() {
        $(this).text('Loading...').prop('disabled', true);
        Data.fetchBarbVillages(function(barbs) {
          State.barbVillages = barbs;
          self.renderTimerTab();
        });
      });

      // Calculate button
      $el('calculate').on('click', function() {
        self._autoCalcTravelTime();
        State.save();
        self.renderTimerTab();
      });

      // Add manual train
      $el('add-train').on('click', function() {
        var vx = typeof game_data !== 'undefined' ? game_data.village.x : 500;
        var vy = typeof game_data !== 'undefined' ? game_data.village.y : 500;
        var now = TimeSync.now();
        var newTrain = {
          id: 'train_manual_' + Date.now(),
          attacker: 'Manual',
          targetCoords: { x: vx, y: vy },
          commands: [
            { type: CMD_TYPE.CLEANER, arrivalSec: now + 3600000, ms: 0, timeMs: now + 3600000, arrivalMs: now + 3600000, attacker: 'Manual' },
            { type: CMD_TYPE.NOBLE, arrivalSec: now + 3600000, ms: 500, timeMs: now + 3600500, arrivalMs: now + 3600500, attacker: 'Manual' }
          ],
          arrivalStart: now + 3600000,
          arrivalEnd: now + 3600500,
          nobleCount: 1
        };
        State.trains.push(newTrain);
        State.selectedTrainId = newTrain.id;
        State.saveTrains();
        State.save();
        self.renderTimerTab();
      });
    },

    // ============================================================
    // TAB 2: SCANNER
    // ============================================================
    renderScannerTab: function() {
      var html = '';
      html += this._renderScannerInputs();
      html += this._renderScannerResults();
      $el('tab-scanner').html(html);
      this._bindScannerEvents();
    },

    _renderScannerInputs: function() {
      var html = '<div class="tws-section">';
      html += '<div class="tws-section-title">Snipe Scanner (Tsalkapone)</div>';
      html += '<div class="tws-grid-3" style="margin-bottom:8px">';
      html += '<div><span class="tws-label">Target Village</span><input class="tws-input tws-input-coords" id="' + ID_PREFIX + 'scan-target" placeholder="408|510" value="' + State.scanTarget + '"></div>';
      html += '<div><span class="tws-label">Date</span><select class="tws-select" id="' + ID_PREFIX + 'scan-date">' +
        '<option value="today"' + (State.scanArrivalDate === 'today' ? ' selected' : '') + '>Today</option>' +
        '<option value="tomorrow"' + (State.scanArrivalDate === 'tomorrow' ? ' selected' : '') + '>Tomorrow</option>' +
        '</select></div>';
      html += '<div><span class="tws-label">Arrival Time</span><input class="tws-input tws-input-time" id="' + ID_PREFIX + 'scan-arrival" placeholder="15:30:45:000" value="' + State.scanArrival + '"></div>';
      html += '</div>';

      // Unit checkboxes
      html += '<div class="tws-label">Units to include:</div>';
      html += '<div class="tws-flex" style="margin-bottom:8px">';
      ALL_UNIT_TYPES.forEach(function(u) {
        var checked = State.scanUnits[u] ? ' checked' : '';
        html += '<label class="tws-unit-check"><input type="checkbox" class="tws-scan-unit" data-unit="' + u + '"' + checked + '>' + u + '</label>';
      });
      html += '</div>';

      html += '<div class="tws-flex">';
      html += '<button class="tws-btn tws-btn-primary" id="' + ID_PREFIX + 'scan-go">SCAN</button>';
      html += '<button class="tws-btn tws-btn-sm" id="' + ID_PREFIX + 'scan-bbcode" style="margin-left:auto">Copy BBCode</button>';
      html += '</div>';
      html += '</div>';
      return html;
    },

    _renderScannerResults: function() {
      if (State.scanResults.length === 0) return '';
      var now = TimeSync.now();

      // Filter: only villages where launch time > now
      var valid = State.scanResults.filter(function(r) { return r.remaining > 0; });
      valid.sort(function(a, b) { return a.launchTime - b.launchTime; });

      if (valid.length === 0) {
        return '<div class="tws-error">No villages can make it in time. All launch times have passed.</div>';
      }

      var html = '<div class="tws-section">';
      html += '<div class="tws-section-title">Scan Results (' + valid.length + ' villages can still make it)</div>';
      html += '<table class="tws-table"><thead><tr>' +
        '<th>Village</th><th>Unit</th><th>Dist</th><th>Travel</th><th>Launch At</th><th>Remaining</th><th>Status</th>' +
        '</tr></thead><tbody>';

      valid.forEach(function(r) {
        var isRec = r.remaining >= 120000 && r.remaining <= 600000;
        var status = remainingStatus(r.remaining);
        var statusLabel = isRec ? 'RECOMMENDED' : status.toUpperCase();
        var statusClass = isRec ? 'tws-status-recommended' : 'tws-status-' + status;
        var recBadge = isRec ? ' <span class="tws-badge tws-badge-rec">REC</span>' : '';
        var launchDisplay = r.launchTime > 86400000 ? 'tmrw ' + formatTime(r.launchTime - 86400000) : formatTime(r.launchTime);

        html += '<tr>' +
          '<td>' + (r.villageName ? r.villageName + ' ' : '') + '(' + formatCoords(r.village) + ')</td>' +
          '<td>' + r.unit + '</td>' +
          '<td>' + r.distance.toFixed(1) + '</td>' +
          '<td class="tws-mono">' + formatTimeSec(r.travelTime) + '</td>' +
          '<td class="tws-mono" style="font-weight:bold;color:' + COLORS.accent + '">' + launchDisplay + '</td>' +
          '<td class="tws-countdown-live" data-target="' + r.launchTime + '">' + formatDuration(r.remaining) + '</td>' +
          '<td class="' + statusClass + '">' + statusLabel + recBadge + '</td>' +
          '</tr>';
      });

      html += '</tbody></table></div>';

      // BBCode output (hidden until button clicked)
      html += '<div id="' + ID_PREFIX + 'bbcode-output" style="display:none" class="tws-section">';
      html += '<div class="tws-section-title">BBCode Export</div>';
      html += '<textarea class="tws-textarea" id="' + ID_PREFIX + 'bbcode-text" readonly>' + this._generateScanBBCode(valid) + '</textarea>';
      html += '</div>';

      return html;
    },

    _generateScanBBCode: function(results) {
      var target = State.scanTarget || '?';
      var arrival = State.scanArrival || '?';
      var bbcode = '[b]Snipe Plan - Target: ' + target + ' | Arrival: ' + arrival + '[/b]\n';
      bbcode += '[table]\n';
      bbcode += '[**]Village[||]Unit[||]Launch Time[||]Distance[/**]\n';
      results.forEach(function(r) {
        var launchStr = r.launchTime > 86400000 ? 'tmrw ' + formatTimeSec(r.launchTime - 86400000) : formatTimeSec(r.launchTime);
        bbcode += '[*]' + (r.villageName || '') + ' (' + formatCoords(r.village) + ')' +
          '[|]' + r.unit +
          '[|]' + launchStr +
          '[|]' + r.distance.toFixed(1) + ' fields[/*]\n';
      });
      bbcode += '[/table]';
      return bbcode;
    },

    _bindScannerEvents: function() {
      var self = this;

      // Unit checkbox changes
      $el('tab-scanner').on('change', '.tws-scan-unit', function() {
        var unit = $(this).data('unit');
        State.scanUnits[unit] = $(this).is(':checked');
        State.save();
      });

      // Scan button
      $el('scan-go').on('click', function() {
        var targetStr = $el('scan-target').val();
        var arrivalStr = $el('scan-arrival').val();
        var dateStr = $el('scan-date').val();
        State.scanTarget = targetStr;
        State.scanArrival = arrivalStr;
        State.scanArrivalDate = dateStr;
        State.save();

        var targetCoords = parseCoords(targetStr);
        if (!targetCoords) {
          State.scanResults = [];
          self.renderScannerTab();
          return;
        }

        // Parse arrival time
        var arrivalMs = parseTimeToMs(arrivalStr);
        if (isNaN(arrivalMs)) {
          State.scanResults = [];
          self.renderScannerTab();
          return;
        }
        if (dateStr === 'tomorrow') arrivalMs += 86400000;

        // Get selected units
        var selectedUnits = [];
        ALL_UNIT_TYPES.forEach(function(u) {
          if (State.scanUnits[u]) selectedUnits.push(u);
        });

        if (selectedUnits.length === 0) {
          State.scanResults = [];
          self.renderScannerTab();
          return;
        }

        // Fetch player villages, then compute
        $(this).text('Scanning...').prop('disabled', true);
        Data.fetchPlayerVillages(function(villages) {
          State.playerVillages = villages;
          var now = TimeSync.now();
          var results = [];

          villages.forEach(function(v) {
            selectedUnits.forEach(function(unit) {
              var dist = Data.distance(v, targetCoords);
              var tt = Data.travelTime(v, targetCoords, unit);
              var launchTime = arrivalMs - tt;
              if (launchTime < 0) launchTime += 86400000;
              var remaining = launchTime - now;
              if (remaining < -43200000) remaining += 86400000;

              if (remaining > 0) {
                results.push({
                  village: { x: v.x, y: v.y },
                  villageName: v.name || '',
                  villageId: v.id,
                  unit: unit,
                  distance: dist,
                  travelTime: tt,
                  launchTime: launchTime,
                  remaining: remaining
                });
              }
            });
          });

          State.scanResults = results;
          self.renderScannerTab();
        });
      });

      // BBCode export button
      $el('scan-bbcode').on('click', function() {
        var $output = $el('bbcode-output');
        $output.toggle();
        if ($output.is(':visible')) {
          $el('bbcode-text').select();
          try { document.execCommand('copy'); } catch (e) {}
        }
      });
    },

    // ============================================================
    // TAB 3: RETURN-SNIPE
    // ============================================================
    renderReturnSnipeTab: function() {
      var html = '';
      html += this._renderReturnSnipeInputs();
      html += this._renderReturnSnipeCommands();
      html += this._renderReturnSnipeDetail();
      $el('tab-return-snipe').html(html);
      this._bindReturnSnipeEvents();
    },

    _renderReturnSnipeInputs: function() {
      var html = '<div class="tws-section">';
      html += '<div class="tws-section-title">Return-Snipe Calculator</div>';
      html += '<div class="tws-info">Cancel your outgoing command so your troops return home in the exact ms gap before the enemy noble lands.</div>';
      html += '<div class="tws-grid-2" style="margin-top:6px">';
      html += '<div><span class="tws-label">Enemy Arrival (HH:MM:SS:mmm)</span><input class="tws-input tws-input-time" id="' + ID_PREFIX + 'return-target" placeholder="15:45:30:000" value="' + State.returnTarget + '"></div>';
      html += '<div style="display:flex;align-items:flex-end"><button class="tws-btn" id="' + ID_PREFIX + 'return-parse-outgoing">Parse Outgoing (Rally Point)</button></div>';
      html += '</div>';

      // My Village dropdown for return-snipe
      html += '<div class="tws-grid-2" style="margin-top:6px">';
      html += '<div><span class="tws-label">My Village (troops return here)</span><select class="tws-select" id="' + ID_PREFIX + 'return-my-village" style="width:100%">' +
        buildVillageOptions(State.playerVillages, State.returnMyVillageId, null) + '</select></div>';
      html += '<div></div>';
      html += '</div>';

      // Manual input section
      html += '<div style="margin-top:8px;border-top:1px solid ' + COLORS.borderLight + ';padding-top:8px">';
      html += '<div class="tws-section-title" style="font-size:10px">Manual Input (alternative)</div>';
      html += '<div class="tws-grid-3">';
      html += '<div><span class="tws-label">Source Coords (your village)</span><input class="tws-input tws-input-coords" id="' + ID_PREFIX + 'return-manual-source" placeholder="463|595" value="' + State.returnManualSource + '"></div>';
      html += '<div><span class="tws-label">Target Coords (where troops went)</span><input class="tws-input tws-input-coords" id="' + ID_PREFIX + 'return-manual-target" placeholder="408|510" value="' + State.returnManualTarget + '"></div>';
      html += '<div><span class="tws-label">Unit Type</span><select class="tws-select" id="' + ID_PREFIX + 'return-manual-unit">' +
        buildUnitOptions(State.returnManualUnit) + '</select></div>';
      html += '</div>';
      html += '<div style="margin-top:4px"><button class="tws-btn tws-btn-sm" id="' + ID_PREFIX + 'return-add-manual">Add Manual Command</button></div>';
      html += '</div>';

      html += '</div>';
      return html;
    },

    _renderReturnSnipeCommands: function() {
      if (State.returnCommands.length === 0) return '';

      var html = '<div class="tws-section">';
      html += '<div class="tws-section-title">Your Outgoing Commands (' + State.returnCommands.length + ')</div>';
      html += '<table class="tws-table"><thead><tr>' +
        '<th>Target</th><th>Unit</th><th>Travel Back</th><th>Cancel At</th><th>Remaining</th><th>Action</th>' +
        '</tr></thead><tbody>';

      var now = TimeSync.now();
      var enemyArrival = parseTimeToMs(State.returnTarget);
      if (isNaN(enemyArrival)) enemyArrival = 0;

      State.returnCommands.forEach(function(cmd, idx) {
        var cancelTime = enemyArrival - cmd.travelBack;
        if (cancelTime < 0) cancelTime += 86400000;
        var remaining = cancelTime - now;
        if (remaining < -43200000) remaining += 86400000;
        var status = remainingStatus(remaining);
        var selected = State.selectedReturnCmd === idx ? ' class="active"' : '';

        html += '<tr' + selected + '>' +
          '<td>' + formatCoords(cmd.targetCoords) + '</td>' +
          '<td>' + (cmd.unit || '?') + '</td>' +
          '<td class="tws-mono">' + formatTimeSec(cmd.travelBack) + '</td>' +
          '<td class="tws-mono" style="color:' + COLORS.accent + ';font-weight:bold">' + formatTime(cancelTime) + '</td>' +
          '<td class="tws-countdown-live" data-target="' + cancelTime + '">' + formatDuration(remaining) + '</td>' +
          '<td><button class="tws-btn tws-btn-sm tws-return-select" data-idx="' + idx + '">Select</button></td>' +
          '</tr>';
      });

      html += '</tbody></table></div>';
      return html;
    },

    _renderReturnSnipeDetail: function() {
      if (State.selectedReturnCmd === null || State.selectedReturnCmd === undefined) return '';
      var cmd = State.returnCommands[State.selectedReturnCmd];
      if (!cmd) return '';

      var enemyArrival = parseTimeToMs(State.returnTarget);
      if (isNaN(enemyArrival)) return '';
      var cancelTime = enemyArrival - cmd.travelBack;
      if (cancelTime < 0) cancelTime += 86400000;
      var now = TimeSync.now();
      var remaining = cancelTime - now;
      if (remaining < -43200000) remaining += 86400000;

      var html = '<div class="tws-section">';
      html += '<div class="tws-section-title">Return-Snipe Detail</div>';

      html += '<div class="tws-grid-2" style="margin-bottom:8px">';
      html += '<div class="tws-result-box" style="border-color:' + COLORS.danger + '">';
      html += '<div class="tws-result-label">Enemy Arrives</div>';
      html += '<div class="tws-mono" style="font-size:20px;color:' + COLORS.danger + '">' + formatTime(enemyArrival) + '</div>';
      html += '</div>';
      html += '<div class="tws-result-box">';
      html += '<div class="tws-result-label">Your Travel Back</div>';
      html += '<div class="tws-mono" style="font-size:20px">' + formatTimeSec(cmd.travelBack) + '</div>';
      html += '</div>';
      html += '</div>';

      html += '<div class="tws-result-box" style="border-color:' + COLORS.accent + '">';
      html += '<div class="tws-result-label">CANCEL CLICK AT</div>';
      html += '<div class="tws-result-send tws-mono">' + formatTime(cancelTime) + '</div>';
      html += '<div style="font-size:10px;color:' + COLORS.textDim + ';margin-top:4px">MS of your click = MS of return arrival</div>';
      html += '</div>';

      html += '<div class="tws-countdown tws-countdown-live" data-target="' + cancelTime + '" style="font-size:48px">' + formatDuration(remaining) + '</div>';

      // MS precision bar for cancel timing
      // Safe window: the ms we want to hit
      var targetMs = enemyArrival % 1000;
      var safeWin = { min: targetMs, max: targetMs, width: 1, crossesSecond: false };
      // If we have train data for this enemy, get actual safe window
      var train = State.getSelectedTrain();
      if (train && train.commands.length >= 2 && State.selectedGapAfter !== null) {
        safeWin = calcSafeWindow(train.commands, State.selectedGapAfter, State.selectedGapBefore);
      }
      html += '<div class="tws-ms-bar"><canvas id="' + ID_PREFIX + 'return-ms-canvas" style="width:100%;height:100%"></canvas></div>';
      html += '<div id="' + ID_PREFIX + 'return-window-indicator"></div>';

      // Cancel button
      if (cmd.commandId) {
        html += '<div style="text-align:center;margin-top:10px">';
        html += '<button class="tws-cancel-btn" id="' + ID_PREFIX + 'return-cancel-cmd" data-id="' + cmd.commandId + '">CANCEL COMMAND</button>';
        html += '</div>';
      }

      // Key mechanic note
      html += '<div class="tws-info" style="margin-top:10px">' +
        '<b>Key mechanic:</b> The millisecond of your cancel click = the millisecond your troops arrive home. ' +
        'Time the click so your troops return in the safe window between cleaner and noble.</div>';

      html += '</div>';

      var self = this;
      setTimeout(function() { self._startPrecisionBar(ID_PREFIX + 'return-ms-canvas', safeWin); }, 50);

      return html;
    },

    _bindReturnSnipeEvents: function() {
      var self = this;

      // My Village dropdown for return-snipe
      $el('return-my-village').on('change', function() {
        State.returnMyVillageId = parseInt($(this).val(), 10) || null;
        State.save();
      });

      // Parse outgoing from rally point
      $el('return-parse-outgoing').on('click', function() {
        var commands = IncomingParser.parseOutgoingCommands();
        if (commands.length === 0) {
          State.returnCommands = [];
          self.renderReturnSnipeTab();
          return;
        }

        // Use selected village or current village as home
        var myVillage = null;
        if (State.returnMyVillageId) {
          myVillage = findVillageById(State.playerVillages, State.returnMyVillageId);
        }
        if (!myVillage && typeof game_data !== 'undefined') {
          myVillage = { x: game_data.village.x, y: game_data.village.y };
        }

        var processed = [];
        commands.forEach(function(cmd) {
          if (cmd.targetCoords && myVillage) {
            // Travel back = distance from target to my village
            var travelBack = Data.travelTime(cmd.targetCoords, myVillage, 'light');
            processed.push({
              commandId: cmd.commandId,
              targetCoords: cmd.targetCoords,
              unit: 'light',
              travelBack: travelBack
            });
          }
        });
        State.returnCommands = processed;
        self.renderReturnSnipeTab();
      });

      // Add manual command
      $el('return-add-manual').on('click', function() {
        var src = parseCoords($el('return-manual-source').val());
        var tgt = parseCoords($el('return-manual-target').val());
        var unit = $el('return-manual-unit').val();
        State.returnManualSource = $el('return-manual-source').val();
        State.returnManualTarget = $el('return-manual-target').val();
        State.returnManualUnit = unit;
        State.save();

        if (!src || !tgt) return;
        var travelBack = Data.travelTime(tgt, src, unit);
        State.returnCommands.push({
          commandId: null,
          targetCoords: tgt,
          sourceCoords: src,
          unit: unit,
          travelBack: travelBack
        });
        self.renderReturnSnipeTab();
      });

      // Save return target on change
      $el('return-target').on('change', function() {
        State.returnTarget = $(this).val();
        State.save();
        self.renderReturnSnipeTab();
      });

      // Select command for detail view
      $el('tab-return-snipe').on('click', '.tws-return-select', function() {
        State.selectedReturnCmd = parseInt($(this).data('idx'), 10);
        self.renderReturnSnipeTab();
      });

      // Cancel command button
      $el('tab-return-snipe').on('click', '#' + ID_PREFIX + 'return-cancel-cmd', function() {
        var cmdId = $(this).data('id');
        if (window.TWTools && TWTools.Commands && TWTools.Commands.cancel) {
          TWTools.Commands.cancel(cmdId);
        } else {
          // Fallback: navigate to cancel page
          var vid = typeof game_data !== 'undefined' ? game_data.village.id : '';
          window.location.href = '/game.php?village=' + vid + '&screen=place&mode=cancel&id=' + cmdId;
        }
      });
    },

    // ============================================================
    // TAB 4: COORDINATION
    // ============================================================
    renderCoordinationTab: function() {
      var html = '';
      html += this._renderCoordVillageScanner();
      html += this._renderCoordTrainsMatrix();
      html += this._renderCoordModeSelector();
      html += this._renderCoordSnipeSources();
      html += this._renderCoordSendSchedule();
      html += this._renderCoordBBCode();
      $el('tab-coordination').html(html);
      this._bindCoordinationEvents();
    },

    _renderCoordVillageScanner: function() {
      var html = '<div class="tws-section">';
      html += '<div class="tws-flex-between"><div class="tws-section-title">Village Scanner</div>';
      html += '<button class="tws-btn tws-btn-sm" id="' + ID_PREFIX + 'coord-scan">Scan Barbs & Villages</button></div>';
      html += '<div class="tws-flex" style="margin-top:4px">';
      html += '<span>Your villages: ' + State.playerVillages.length + '</span>';
      html += '<span>Barbs loaded: ' + State.barbVillages.length + '</span>';
      html += '</div></div>';
      return html;
    },

    _renderCoordTrainsMatrix: function() {
      if (State.trains.length === 0) {
        return '<div class="tws-section"><div class="tws-section-title">Incoming Trains</div>' +
          '<div class="tws-info">No trains loaded. Go to incomings page and refresh.</div></div>';
      }

      var byTarget = {};
      State.trains.forEach(function(train) {
        var key = formatCoords(train.targetCoords);
        if (!byTarget[key]) byTarget[key] = [];
        byTarget[key].push(train);
      });

      var html = '<div class="tws-section"><div class="tws-section-title">Incoming Trains</div>';
      Object.keys(byTarget).forEach(function(targetKey) {
        var trains = byTarget[targetKey];
        html += '<div style="margin:6px 0;padding:6px;border:1px solid ' + COLORS.borderLight + ';border-radius:2px">';
        html += '<div style="font-weight:bold;color:' + COLORS.accent + ';margin-bottom:3px">Target: ' + targetKey + '</div>';
        html += '<table class="tws-table"><thead><tr>' +
          '<th>Attacker</th><th>Arrival</th><th>Nobles</th><th>Cmds</th><th>Action</th>' +
          '</tr></thead><tbody>';
        trains.forEach(function(train) {
          html += '<tr><td>' + train.attacker + '</td>' +
            '<td class="tws-mono">' + formatTimeSec(train.arrivalStart) + '</td>' +
            '<td>' + train.nobleCount + '</td><td>' + train.commands.length + '</td>' +
            '<td><button class="tws-btn tws-btn-sm tws-coord-open-train" data-id="' + train.id + '">Open</button></td></tr>';
        });
        html += '</tbody></table></div>';
      });
      html += '</div>';
      return html;
    },

    _renderCoordModeSelector: function() {
      var html = '<div class="tws-section"><div class="tws-section-title">Coordination Mode</div>';
      html += '<div class="tws-flex">';
      var modes = [
        { id: 'A', label: 'A \u2014 Round-trip to barb' },
        { id: 'B', label: 'B \u2014 Support + recall' },
        { id: 'C', label: 'C \u2014 One-way support' }
      ];
      modes.forEach(function(m) {
        var active = State.coordMode === m.id ? ' active' : '';
        html += '<button class="tws-btn-mode tws-coord-mode-btn' + active + '" data-mode="' + m.id + '">' + m.label + '</button>';
      });
      html += '</div></div>';
      return html;
    },

    _renderCoordSnipeSources: function() {
      if (State.barbVillages.length === 0 || State.trains.length === 0) return '';

      var serverNow = TimeSync.now();
      var allPlans = [];

      State.trains.forEach(function(train) {
        if (train.commands.length < 2) return;
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

        var win = calcSafeWindow(train.commands, afterIdx, beforeIdx);
        if (!win.targetSecondMs) return;
        var targetReturnMs = buildTargetTime(win.targetSecondMs, win.targetMs);

        State.playerVillages.forEach(function(village) {
          if (State.coordMode === 'A') {
            var nearBarbs = Data.findNearestBarbs(village, 3, State.barbVillages);
            nearBarbs.forEach(function(barbInfo) {
              var travelMs = Data.travelTime(village, barbInfo.village, 'ram');
              var result = calcModeA(targetReturnMs, travelMs, serverNow);
              if (result.status !== 'missed') {
                allPlans.push({
                  train: train, source: village, target: barbInfo.village,
                  mode: 'A', dist: barbInfo.dist, travelMs: travelMs,
                  sendTime: result.sendTime, remaining: result.remaining, status: result.status
                });
              }
            });
          } else if (State.coordMode === 'B') {
            var travelToTarget = Data.travelTime(village, train.targetCoords, 'light');
            var table = calcModeB(targetReturnMs, travelToTarget, serverNow);
            if (table.length > 0) {
              allPlans.push({
                train: train, source: village, target: train.targetCoords,
                mode: 'B', dist: Data.distance(village, train.targetCoords), travelMs: travelToTarget,
                sendTime: table[0].sendTime, remaining: table[0].remaining, status: table[0].status,
                retries: table.length
              });
            }
          } else {
            var travelC = Data.travelTime(village, train.targetCoords, 'light');
            var resultC = calcModeC(targetReturnMs, travelC, serverNow);
            if (resultC.status !== 'missed') {
              allPlans.push({
                train: train, source: village, target: train.targetCoords,
                mode: 'C', dist: Data.distance(village, train.targetCoords), travelMs: travelC,
                sendTime: resultC.sendTime, remaining: resultC.remaining, status: resultC.status
              });
            }
          }
        });
      });

      if (allPlans.length === 0) return '';
      allPlans.sort(function(a, b) { return a.sendTime - b.sendTime; });

      State.snipePlans = allPlans;

      var html = '<div class="tws-section"><div class="tws-section-title">Snipe Sources (' + allPlans.length + ' options)</div>';
      html += '<table class="tws-table"><thead><tr>' +
        '<th>Source</th><th>Mode</th><th>Target/Barb</th><th>Fields</th><th>Travel</th><th>Send At</th><th>Remaining</th><th>Status</th><th>Train</th>' +
        '</tr></thead><tbody>';

      allPlans.slice(0, 60).forEach(function(plan) {
        var statusClass = 'tws-status-' + plan.status;
        html += '<tr><td>' + formatCoords(plan.source) + '</td>' +
          '<td>' + plan.mode + '</td>' +
          '<td>' + formatCoords(plan.target) + '</td>' +
          '<td>' + plan.dist.toFixed(1) + '</td>' +
          '<td class="tws-mono">' + formatTimeSec(plan.travelMs) + '</td>' +
          '<td class="tws-mono" style="color:' + COLORS.accent + '">' + formatTime(plan.sendTime) + '</td>' +
          '<td class="tws-countdown-live" data-target="' + plan.sendTime + '">' + formatDuration(plan.remaining) + '</td>' +
          '<td class="' + statusClass + '">' + plan.status.toUpperCase() + '</td>' +
          '<td style="font-size:10px">' + plan.train.attacker + '</td></tr>';
      });

      html += '</tbody></table></div>';
      return html;
    },

    _renderCoordSendSchedule: function() {
      if (!State.snipePlans || State.snipePlans.length === 0) return '';

      var nextAction = null;
      State.snipePlans.forEach(function(plan) {
        if (plan.remaining > 0 && (!nextAction || plan.sendTime < nextAction.sendTime)) {
          nextAction = plan;
        }
      });

      var html = '<div class="tws-section"><div class="tws-section-title">Unified Send Schedule</div>';
      if (nextAction) {
        html += '<div class="tws-result-box" style="margin-bottom:8px">';
        html += '<div class="tws-result-label">NEXT ACTION</div>';
        html += '<div class="tws-countdown tws-countdown-live" data-target="' + nextAction.sendTime + '" style="font-size:32px">' + formatDuration(nextAction.remaining) + '</div>';
        html += '<div style="font-size:11px;color:' + COLORS.textDim + '">' +
          formatCoords(nextAction.source) + ' \u2192 ' + formatCoords(nextAction.target) + ' (for ' + nextAction.train.attacker + ')</div>';
        html += '</div>';
      }
      html += '</div>';
      return html;
    },

    _renderCoordBBCode: function() {
      if (!State.snipePlans || State.snipePlans.length === 0) return '';
      var html = '<div class="tws-section"><div class="tws-flex-between"><div class="tws-section-title">BBCode Export</div>';
      html += '<button class="tws-btn tws-btn-sm" id="' + ID_PREFIX + 'coord-bbcode-btn">Generate BBCode</button></div>';
      html += '<div id="' + ID_PREFIX + 'coord-bbcode-area" style="display:none;margin-top:6px">';
      html += '<textarea class="tws-textarea" id="' + ID_PREFIX + 'coord-bbcode-text" readonly>' + this._generateCoordBBCode() + '</textarea></div></div>';
      return html;
    },

    _generateCoordBBCode: function() {
      if (!State.snipePlans || State.snipePlans.length === 0) return '';
      var bbcode = '[b]Snipe Coordination Plan[/b]\n';
      bbcode += '[table]\n';
      bbcode += '[**]#[||]Source[||]Mode[||]Target[||]Send Time[||]Train[/**]\n';
      State.snipePlans.slice(0, 30).forEach(function(plan, idx) {
        var sendStr = plan.sendTime > 86400000 ? 'tmrw ' + formatTime(plan.sendTime - 86400000) : formatTime(plan.sendTime);
        bbcode += '[*]' + (idx + 1) + '[|]' + formatCoords(plan.source) + '[|]' + plan.mode +
          '[|]' + formatCoords(plan.target) + '[|]' + sendStr + '[|]' + plan.train.attacker + '[/*]\n';
      });
      bbcode += '[/table]';
      return bbcode;
    },

    _bindCoordinationEvents: function() {
      var self = this;

      // Scan barbs & villages
      $el('coord-scan').on('click', function() {
        var $btn = $(this);
        $btn.text('Scanning...').prop('disabled', true);
        var loaded = 0;
        function onDone() {
          loaded++;
          if (loaded >= 2) self.renderCoordinationTab();
        }
        Data.fetchBarbVillages(function(barbs) { State.barbVillages = barbs; onDone(); });
        Data.fetchPlayerVillages(function(villages) { State.playerVillages = villages; onDone(); });
      });

      // Open train in timer tab
      $el('tab-coordination').on('click', '.tws-coord-open-train', function() {
        var trainId = $(this).data('id');
        State.selectedTrainId = trainId;
        self._activateTab('timer');
      });

      // Coordination mode switch
      $el('tab-coordination').on('click', '.tws-coord-mode-btn', function() {
        State.coordMode = $(this).data('mode');
        State.save();
        self.renderCoordinationTab();
      });

      // BBCode toggle
      $el('coord-bbcode-btn').on('click', function() {
        $el('coord-bbcode-area').toggle();
        if ($el('coord-bbcode-area').is(':visible')) {
          $el('coord-bbcode-text').select();
          try { document.execCommand('copy'); } catch (e) {}
        }
      });
    },

    // ============================================================
    // TAB 5: NOBLE TRAIN
    // ============================================================
    renderNobleTab: function() {
      var html = '';
      html += this._renderNobleInputs();
      if (State.noblePlan) {
        html += this._renderNoblePlanTable();
      }
      $el('tab-noble').html(html);
      this._bindNobleEvents();
      this._startNobleCountdown();
    },

    _renderNobleInputs: function() {
      var targetCoords = parseCoords(State.nobleTarget);
      var html = '<div class="tws-section">';
      html += '<div class="tws-section-title">Noble Train Planner</div>';
      html += '<div class="tws-info">Plan a coordinated noble train with clearing nuke and timed noble arrivals.</div>';

      // Row 1: Target + Source
      html += '<div class="tws-grid-2" style="margin-bottom:6px">';
      html += '<div><span class="tws-label">Target Village</span>';
      html += '<input class="tws-input tws-input-coords" id="' + ID_PREFIX + 'noble-target" placeholder="408|510" value="' + State.nobleTarget + '"></div>';
      html += '<div><span class="tws-label">Source Village</span>';
      html += '<select class="tws-select" id="' + ID_PREFIX + 'noble-source" style="width:100%">' +
        buildVillageOptions(State.playerVillages, State.nobleSourceId, targetCoords) + '</select></div>';
      html += '</div>';

      // Row 2: Arrival + Noble count
      html += '<div class="tws-grid-2" style="margin-bottom:6px">';
      html += '<div><span class="tws-label">Desired Arrival (HH:MM:SS.mmm)</span>';
      html += '<input class="tws-input tws-input-time" id="' + ID_PREFIX + 'noble-arrival" placeholder="10:30:00:000" value="' + State.nobleArrival + '"></div>';
      html += '<div><span class="tws-label">Number of Nobles (1-4)</span>';
      html += '<select class="tws-select" id="' + ID_PREFIX + 'noble-count">';
      for (var i = 1; i <= 4; i++) {
        var sel = i === State.nobleCount ? ' selected' : '';
        html += '<option value="' + i + '"' + sel + '>' + i + '</option>';
      }
      html += '</select></div>';
      html += '</div>';

      // Row 3: Gap + Include nuke
      html += '<div class="tws-grid-2" style="margin-bottom:6px">';
      html += '<div><span class="tws-label">Gap Between Nobles (ms)</span>';
      html += '<input class="tws-input" id="' + ID_PREFIX + 'noble-gap" type="number" min="50" max="2000" step="50" value="' + State.nobleGap + '"></div>';
      html += '<div style="display:flex;align-items:flex-end;padding-bottom:4px">';
      html += '<label style="cursor:pointer;font-size:12px;color:' + COLORS.text + '">';
      html += '<input type="checkbox" id="' + ID_PREFIX + 'noble-nuke"' + (State.nobleIncludeNuke ? ' checked' : '') + ' style="margin-right:4px">';
      html += 'Include clearing nuke (ram speed)</label></div>';
      html += '</div>';

      // World speed info
      var ws = Data.getWorldSpeed();
      var usf = Data.getUnitSpeedFactor();
      html += '<div style="font-size:10px;color:' + COLORS.textDim + ';margin-bottom:8px">World speed: ' + ws + 'x | Unit speed factor: ' + usf + 'x</div>';

      // Calculate button
      html += '<button class="tws-btn" id="' + ID_PREFIX + 'noble-calc" style="width:100%">Calculate Noble Train</button>';
      html += '</div>';
      return html;
    },

    _calcNoblePlan: function() {
      var target = parseCoords(State.nobleTarget);
      var source = findVillageById(State.playerVillages, State.nobleSourceId);
      var arrivalMs = parseTimeToMs(State.nobleArrival);
      var count = State.nobleCount;
      var gap = State.nobleGap;
      var includeNuke = State.nobleIncludeNuke;

      if (!target) return { error: 'Invalid target coordinates.' };
      if (!source) return { error: 'Select a source village.' };
      if (isNaN(arrivalMs)) return { error: 'Invalid arrival time. Use HH:MM:SS or HH:MM:SS:mmm format.' };

      var dist = Data.distance(source, target);
      var nobleTravel = Data.travelTime(source, target, 'snob');
      var nukeTravel = Data.travelTime(source, target, 'ram');
      var sourceName = (source.name || 'Village') + '(' + source.x + '|' + source.y + ')';
      var targetName = '(' + target.x + '|' + target.y + ')';

      var entries = [];
      var seq = 1;

      // Noble arrivals: first noble at arrivalMs + gap (to leave room for nuke before it)
      // Nuke arrives at arrivalMs (gap ms before first noble)
      // Noble 1 arrives at arrivalMs + gap
      // Noble 2 arrives at arrivalMs + 2*gap, etc.
      // But per spec: Noble arrivals = arrival+0ms, +gap, +2*gap, +3*gap
      // Clearing nuke arrival = noble_arrival_1 - gap

      for (var i = 0; i < count; i++) {
        var nobleArrival = arrivalMs + (i * gap);
        var nobleSend = nobleArrival - nobleTravel;
        if (nobleSend < 0) nobleSend += 86400000;
        entries.push({
          type: 'Noble ' + (i + 1),
          typeClass: 'noble',
          source: sourceName,
          target: targetName,
          dist: dist,
          sendTime: nobleSend,
          arrivalTime: nobleArrival,
          travelTime: nobleTravel
        });
      }

      if (includeNuke) {
        var nukeArrival = arrivalMs - gap;
        if (nukeArrival < 0) nukeArrival += 86400000;
        var nukeSend = nukeArrival - nukeTravel;
        if (nukeSend < 0) nukeSend += 86400000;
        entries.push({
          type: 'NUKE',
          typeClass: 'cleaner',
          source: sourceName,
          target: targetName,
          dist: dist,
          sendTime: nukeSend,
          arrivalTime: nukeArrival,
          travelTime: nukeTravel
        });
      }

      // Sort by send time
      entries.sort(function(a, b) { return a.sendTime - b.sendTime; });

      // Assign sequence numbers
      for (var j = 0; j < entries.length; j++) {
        entries[j].seq = j + 1;
      }

      return { entries: entries, dist: dist, source: sourceName, target: targetName };
    },

    _renderNoblePlanTable: function() {
      var plan = State.noblePlan;
      if (plan.error) {
        return '<div class="tws-section"><div class="tws-warn">' + plan.error + '</div></div>';
      }

      var entries = plan.entries;
      var now = TimeSync.now();
      var html = '<div class="tws-section">';
      html += '<div class="tws-flex-between"><div class="tws-section-title">Send Schedule</div>';
      html += '<button class="tws-btn tws-btn-sm" id="' + ID_PREFIX + 'noble-copy-bb">Copy BBCode</button></div>';

      html += '<table class="tws-table" style="margin-top:6px"><thead><tr>';
      html += '<th>#</th><th>Type</th><th>Source</th><th>Target</th><th>Dist</th>';
      html += '<th>Send Time</th><th>Arrival</th><th>Travel</th><th>Countdown</th><th>Verify</th>';
      html += '</tr></thead><tbody>';

      // Find the next action (first entry with sendTime in the future)
      var nextIdx = -1;
      for (var i = 0; i < entries.length; i++) {
        var remaining = entries[i].sendTime - now;
        if (remaining < -43200000) remaining += 86400000;
        if (remaining > 0 && nextIdx === -1) nextIdx = i;
      }

      for (var j = 0; j < entries.length; j++) {
        var e = entries[j];
        var isNext = j === nextIdx;
        var badge = BADGE_COLORS[e.typeClass] || BADGE_COLORS.unknown;
        var rowStyle = isNext ? 'background:' + COLORS.windowSafe + ';font-weight:bold' : '';
        var verified = Math.abs((e.sendTime + e.travelTime) - e.arrivalTime) < 2;
        // Handle day wrap for verification
        if (!verified) {
          verified = Math.abs(((e.sendTime + e.travelTime) % 86400000) - (e.arrivalTime % 86400000)) < 2;
        }

        html += '<tr style="' + rowStyle + '">';
        html += '<td>' + e.seq + '</td>';
        html += '<td><span style="background:' + badge.bg + ';color:' + badge.fg + ';padding:1px 5px;border-radius:2px;font-size:10px;font-weight:bold">' + e.type + '</span></td>';
        html += '<td style="font-size:11px">' + e.source + '</td>';
        html += '<td style="font-size:11px">' + e.target + '</td>';
        html += '<td class="tws-mono">' + e.dist.toFixed(2) + '</td>';
        html += '<td class="tws-mono" style="font-weight:bold">' + formatTime(e.sendTime) + '</td>';
        html += '<td class="tws-mono">' + formatTime(e.arrivalTime) + '</td>';
        html += '<td class="tws-mono">' + formatTimeSec(e.travelTime) + '</td>';
        html += '<td class="tws-mono tws-countdown-live tws-noble-cd" data-target="' + e.sendTime + '" data-seq="' + e.seq + '">' + formatDuration(e.sendTime - now) + '</td>';
        html += '<td style="text-align:center;color:' + (verified ? COLORS.success : COLORS.danger) + '">' + (verified ? '&#10003;' : '&#10007;') + '</td>';
        html += '</tr>';
      }

      html += '</tbody></table></div>';
      return html;
    },

    _startNobleCountdown: function() {
      if (this._nobleInterval) clearInterval(this._nobleInterval);
      if (!State.noblePlan || State.noblePlan.error) return;

      var self = this;
      var beeped = {};
      this._nobleInterval = setInterval(function() {
        if (State.activeTab !== 'noble') {
          clearInterval(self._nobleInterval);
          self._nobleInterval = null;
          return;
        }

        var now = TimeSync.now();
        var entries = State.noblePlan.entries;
        var nextIdx = -1;

        for (var i = 0; i < entries.length; i++) {
          var remaining = entries[i].sendTime - now;
          if (remaining < -43200000) remaining += 86400000;
          if (remaining > 0 && nextIdx === -1) nextIdx = i;
        }

        $('.tws-noble-cd').each(function() {
          var target = parseFloat($(this).data('target'));
          var seq = parseInt($(this).data('seq'), 10);
          var remaining = target - now;
          if (remaining < -43200000) remaining += 86400000;
          $(this).text(formatDuration(remaining));

          // Color coding
          if (remaining < 0) $(this).css('color', COLORS.textDim);
          else if (remaining < 5000) $(this).css({ color: COLORS.danger, fontWeight: 'bold' });
          else if (remaining < 30000) $(this).css('color', COLORS.warning);
          else $(this).css('color', COLORS.success);

          // Flash the row when within 3 seconds
          var row = $(this).closest('tr');
          if (remaining > 0 && remaining < 3000) {
            var flash = Math.floor(Date.now() / 300) % 2 === 0;
            row.css('background', flash ? COLORS.windowDanger : COLORS.windowSafe);
          } else if (remaining <= 0 && remaining > -2000) {
            row.css('background', COLORS.windowDanger);
          }

          // Beep when countdown reaches 0
          if (remaining <= 0 && remaining > -1000 && !beeped[seq]) {
            beeped[seq] = true;
            self._nobleBeep();
          }
        });

        // Highlight next action row
        $el('tab-noble').find('tbody tr').each(function(idx) {
          if (idx === nextIdx) {
            var existing = $(this).css('background');
            if (!existing || existing.indexOf('rgba') === -1) {
              $(this).css('background', COLORS.windowSafe);
            }
          }
        });
      }, 50);
    },

    _nobleBeep: function() {
      try {
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.value = 880;
        gain.gain.value = 0.15;
        osc.start();
        osc.stop(ctx.currentTime + 0.12);
      } catch (e) { /* silent fail if no audio */ }
    },

    _buildNobleBBCode: function() {
      var plan = State.noblePlan;
      if (!plan || plan.error) return '';
      var entries = plan.entries;
      var bb = '[b]Noble Train Plan[/b]\n';
      bb += 'Target: [coord]' + State.nobleTarget + '[/coord]\n';
      bb += 'Source: ' + plan.source + '\n';
      bb += 'Distance: ' + plan.dist.toFixed(2) + ' fields\n\n';
      bb += '[table]\n';
      bb += '[**]#[||]Type[||]Send Time[||]Arrival[||]Travel[/**]\n';
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        bb += '[*]' + e.seq + '[|]' + e.type + '[|]' + formatTime(e.sendTime) + '[|]' + formatTime(e.arrivalTime) + '[|]' + formatTimeSec(e.travelTime) + '\n';
      }
      bb += '[/table]';
      return bb;
    },

    _bindNobleEvents: function() {
      var self = this;

      $el('noble-calc').on('click', function() {
        // Save inputs
        State.nobleTarget = $el('noble-target').val();
        State.nobleSourceId = $el('noble-source').val() || null;
        State.nobleArrival = $el('noble-arrival').val();
        State.nobleCount = parseInt($el('noble-count').val(), 10) || 4;
        State.nobleGap = parseInt($el('noble-gap').val(), 10) || 200;
        State.nobleIncludeNuke = $el('noble-nuke').is(':checked');
        State.save();

        // Calculate
        State.noblePlan = self._calcNoblePlan();
        self.renderNobleTab();
      });

      // Re-sort source dropdown when target changes
      $el('noble-target').on('change', function() {
        State.nobleTarget = $(this).val();
        State.save();
        self.renderNobleTab();
      });

      $el('noble-source').on('change', function() {
        State.nobleSourceId = $(this).val() || null;
        State.save();
      });

      // Copy BBCode
      $el('tab-noble').on('click', '#' + ID_PREFIX + 'noble-copy-bb', function() {
        var bb = self._buildNobleBBCode();
        if (navigator.clipboard) {
          navigator.clipboard.writeText(bb).then(function() {
            $(this).text('Copied!');
            setTimeout(function() { self.renderNobleTab(); }, 1500);
          }.bind(this));
        } else {
          // Fallback: textarea trick
          var ta = document.createElement('textarea');
          ta.value = bb;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          $(this).text('Copied!');
          setTimeout(function() { self.renderNobleTab(); }, 1500);
        }
      });
    },

    // ============================================================
    // TAB 6: TOOLS
    // ============================================================
    renderToolsTab: function() {
      var html = '';
      html += this._renderToolDistance();
      html += this._renderToolBackTime();
      html += this._renderToolFields();
      $el('tab-tools').html(html);
      this._bindToolsEvents();
    },

    _renderToolDistance: function() {
      var html = '<div class="tws-section">';
      html += '<div class="tws-section-title">Distance Calculator</div>';
      html += '<div class="tws-grid-2" style="margin-bottom:6px">';
      html += '<div><span class="tws-label">From</span><input class="tws-input tws-input-coords" id="' + ID_PREFIX + 'tool-from" placeholder="463|595" value="' + State.toolCalcFrom + '"></div>';
      html += '<div><span class="tws-label">To</span><input class="tws-input tws-input-coords" id="' + ID_PREFIX + 'tool-to" placeholder="408|510" value="' + State.toolCalcTo + '"></div>';
      html += '</div>';
      html += '<button class="tws-btn tws-btn-sm" id="' + ID_PREFIX + 'tool-calc-dist">Calculate</button>';
      html += '<div id="' + ID_PREFIX + 'tool-dist-result"></div>';
      html += '</div>';
      return html;
    },

    _renderToolBackTime: function() {
      var html = '<div class="tws-section">';
      html += '<div class="tws-section-title">Back-Time Calculator</div>';
      html += '<div class="tws-info">Calculate when your troops return from a destination.</div>';
      html += '<div class="tws-grid-2" style="margin-bottom:4px">';
      html += '<div><span class="tws-label">Origin</span><input class="tws-input tws-input-coords" id="' + ID_PREFIX + 'tool-back-origin" placeholder="463|595" value="' + State.toolBackOrigin + '"></div>';
      html += '<div><span class="tws-label">Destination</span><input class="tws-input tws-input-coords" id="' + ID_PREFIX + 'tool-back-dest" placeholder="408|510" value="' + State.toolBackDest + '"></div>';
      html += '</div>';
      html += '<div class="tws-grid-2" style="margin-bottom:6px">';
      html += '<div><span class="tws-label">Arrival at dest (HH:MM:SS)</span><input class="tws-input tws-input-time" id="' + ID_PREFIX + 'tool-back-arrival" placeholder="15:30:45" value="' + State.toolBackArrival + '"></div>';
      html += '<div><span class="tws-label">Slowest Unit</span><select class="tws-select" id="' + ID_PREFIX + 'tool-back-unit">';
      ALL_UNIT_TYPES.forEach(function(u) {
        var sel = u === State.toolBackUnit ? ' selected' : '';
        html += '<option value="' + u + '"' + sel + '>' + u + '</option>';
      });
      html += '</select></div></div>';
      html += '<button class="tws-btn tws-btn-sm" id="' + ID_PREFIX + 'tool-calc-back">Calculate</button>';
      html += '<div id="' + ID_PREFIX + 'tool-back-result"></div>';
      html += '</div>';
      return html;
    },

    _renderToolFields: function() {
      var html = '<div class="tws-section">';
      html += '<div class="tws-section-title">Fields Calculator</div>';
      html += '<div class="tws-info">Given a travel duration, how many fields can each unit type travel?</div>';
      html += '<div style="margin-bottom:6px"><span class="tws-label">Duration (HH:MM:SS)</span><input class="tws-input tws-input-time" id="' + ID_PREFIX + 'tool-fields-dur" placeholder="1:30:00" value="' + State.toolFieldsDuration + '"></div>';
      html += '<button class="tws-btn tws-btn-sm" id="' + ID_PREFIX + 'tool-calc-fields">Calculate</button>';
      html += '<div id="' + ID_PREFIX + 'tool-fields-result"></div>';
      html += '</div>';
      return html;
    },

    _bindToolsEvents: function() {
      var self = this;

      // Distance calculator
      $el('tool-calc-dist').on('click', function() {
        var from = parseCoords($el('tool-from').val());
        var to = parseCoords($el('tool-to').val());
        State.toolCalcFrom = $el('tool-from').val();
        State.toolCalcTo = $el('tool-to').val();
        if (!from || !to) {
          $el('tool-dist-result').html('<div class="tws-warn">Invalid coordinates.</div>');
          return;
        }
        var dist = Data.distance(from, to);
        var html = '<div style="margin-top:8px"><div style="font-size:14px;font-weight:bold">Distance: ' + dist.toFixed(2) + ' fields</div>';
        html += '<table class="tws-table" style="margin-top:6px"><thead><tr><th>Unit</th><th>Speed</th><th>Travel Time</th></tr></thead><tbody>';
        ALL_UNIT_TYPES.forEach(function(u) {
          var tt = Data.travelTime(from, to, u);
          html += '<tr><td>' + u + '</td><td>' + (Data.getUnitSpeed(u) || '?') + ' min/f</td><td class="tws-mono">' + formatTimeSec(tt) + '</td></tr>';
        });
        html += '</tbody></table></div>';
        $el('tool-dist-result').html(html);
      });

      // Back-time calculator
      $el('tool-calc-back').on('click', function() {
        var origin = parseCoords($el('tool-back-origin').val());
        var dest = parseCoords($el('tool-back-dest').val());
        var arrivalStr = $el('tool-back-arrival').val();
        var unit = $el('tool-back-unit').val();
        State.toolBackOrigin = $el('tool-back-origin').val();
        State.toolBackDest = $el('tool-back-dest').val();
        State.toolBackArrival = arrivalStr;
        State.toolBackUnit = unit;

        if (!origin || !dest) {
          $el('tool-back-result').html('<div class="tws-warn">Invalid coordinates.</div>');
          return;
        }
        var arrivalMs = parseTimeToMs(arrivalStr);
        if (isNaN(arrivalMs)) {
          $el('tool-back-result').html('<div class="tws-warn">Invalid arrival time.</div>');
          return;
        }

        var tt = Data.travelTime(origin, dest, unit);
        var returnTime = arrivalMs + tt;
        var returnDisplay = returnTime > 86400000 ? 'tmrw ' + formatTime(returnTime - 86400000) : formatTime(returnTime);

        var html = '<div style="margin-top:8px">';
        html += '<div class="tws-result-box">';
        html += '<div class="tws-result-label">Arrival at destination</div>';
        html += '<div class="tws-mono" style="font-size:16px">' + formatTime(arrivalMs) + '</div>';
        html += '<div class="tws-result-label" style="margin-top:4px">Travel time (' + unit + ')</div>';
        html += '<div class="tws-mono" style="font-size:16px">' + formatTimeSec(tt) + '</div>';
        html += '<div class="tws-result-label" style="margin-top:6px">RETURN HOME AT</div>';
        html += '<div class="tws-result-send tws-mono">' + returnDisplay + '</div>';
        html += '</div></div>';
        $el('tool-back-result').html(html);
      });

      // Fields calculator
      $el('tool-calc-fields').on('click', function() {
        var durStr = $el('tool-fields-dur').val();
        State.toolFieldsDuration = durStr;
        var durMs = parseTimeToMs(durStr);
        if (isNaN(durMs)) {
          $el('tool-fields-result').html('<div class="tws-warn">Invalid duration.</div>');
          return;
        }

        var ws = Data.getWorldSpeed();
        var usf = Data.getUnitSpeedFactor();

        var html = '<table class="tws-table" style="margin-top:8px"><thead><tr><th>Unit</th><th>Speed (min/f)</th><th>Max Fields</th></tr></thead><tbody>';
        ALL_UNIT_TYPES.forEach(function(u) {
          var speed = Data.getUnitSpeed(u);
          // travelTime = dist * speed * 60000 / (ws * usf)
          // => dist = travelTime * ws * usf / (speed * 60000)
          var maxFields = (durMs * ws * usf) / (speed * 60000);
          html += '<tr><td>' + u + '</td><td>' + speed + '</td><td style="font-weight:bold">' + maxFields.toFixed(1) + '</td></tr>';
        });
        html += '</tbody></table>';
        $el('tool-fields-result').html(html);
      });
    },

    // ============================================================
    // MS PRECISION BAR (Canvas, 60fps)
    // ============================================================
    _startPrecisionBar: function(canvasId, safeWindow) {
      this._stopPrecisionBar();
      var canvas = document.getElementById(canvasId);
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      var self = this;

      // HiDPI scaling
      var rect = canvas.parentElement.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      ctx.scale(dpr, dpr);
      var w = rect.width;
      var h = rect.height;

      function draw() {
        var ms = TimeSync.currentMs();

        // Background
        ctx.fillStyle = COLORS.canvasBg;
        ctx.fillRect(0, 0, w, h);

        // Safe window zone
        if (safeWindow) {
          ctx.fillStyle = COLORS.canvasSafe;
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
          ctx.lineWidth = 1.5;
          var lMin = (safeWindow.min / 1000) * w;
          var lMax = ((safeWindow.max + 1) / 1000) * w;
          ctx.beginPath(); ctx.moveTo(lMin, 0); ctx.lineTo(lMin, h); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(lMax, 0); ctx.lineTo(lMax, h); ctx.stroke();

          // Boundary labels
          ctx.fillStyle = COLORS.success;
          ctx.font = '10px Verdana';
          ctx.textAlign = 'center';
          ctx.fillText(':' + pad3(safeWindow.min), lMin, 12);
          ctx.fillText(':' + pad3(safeWindow.max), lMax, 12);
        }

        // 100ms tick marks
        ctx.strokeStyle = 'rgba(128,64,0,0.12)';
        ctx.lineWidth = 0.5;
        ctx.font = '8px Verdana';
        ctx.fillStyle = 'rgba(128,64,0,0.25)';
        ctx.textAlign = 'center';
        for (var i = 0; i <= 9; i++) {
          var tx = (i * 100 / 1000) * w;
          ctx.beginPath(); ctx.moveTo(tx, h - 10); ctx.lineTo(tx, h); ctx.stroke();
          ctx.fillText(i * 100, tx, h - 1);
        }

        // Needle
        var needleX = (ms / 1000) * w;
        ctx.strokeStyle = COLORS.canvasNeedle;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(needleX, 0); ctx.lineTo(needleX, h); ctx.stroke();

        // Needle glow
        ctx.save();
        ctx.shadowColor = COLORS.canvasNeedle;
        ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.moveTo(needleX, 0); ctx.lineTo(needleX, h); ctx.stroke();
        ctx.restore();

        // Current ms label on needle
        ctx.fillStyle = COLORS.accent;
        ctx.font = 'bold 13px "Courier New",monospace';
        ctx.textAlign = 'center';
        ctx.fillText(':' + pad3(ms), needleX, h * 0.55);

        // In-window indicator
        if (safeWindow) {
          var inWindow;
          if (safeWindow.crossesSecond || safeWindow.min > safeWindow.max) {
            inWindow = ms >= safeWindow.min || ms <= safeWindow.max;
          } else {
            inWindow = ms >= safeWindow.min && ms <= safeWindow.max;
          }

          // Update DOM indicator outside canvas
          var indicatorId = canvasId.replace('ms-canvas', 'window-indicator');
          var indicatorEl = document.getElementById(indicatorId);
          if (indicatorEl) {
            if (inWindow) {
              indicatorEl.className = 'tws-in-window';
              indicatorEl.textContent = '\u2714 IN WINDOW';
            } else {
              indicatorEl.className = 'tws-danger-zone';
              indicatorEl.textContent = '\u2716 DANGER';
            }
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
    // Toggle if already open (click quickbar again = close)
    if (document.getElementById(ID_PREFIX + 'overlay')) {
      document.getElementById(ID_PREFIX + 'overlay').remove();
      var styleEl = document.getElementById(ID_PREFIX + 'styles');
      if (styleEl) styleEl.remove();
      return;
    }

    // Init time sync
    TimeSync.init();

    // Load saved state
    State.load();
    State.loadTrains();

    // Parallel data loading: world config + unit info
    var loaded = 0;
    function onLoaded() {
      loaded++;
      if (loaded < 2) return;

      // If on incomings page, parse incoming commands and group into trains
      if (IncomingParser.isOnIncomingsPage()) {
        var commands = IncomingParser.parseIncomingCommands();
        if (commands.length) {
          State.trains = IncomingParser.groupIntoTrains(commands, Data.getWorldSpeed(), Data.getUnitSpeedFactor(), Data._unitSpeeds);
          State.saveTrains();
        }
      }

      // Load player villages and barb villages in parallel
      var dataLoaded = 0;
      var dataTotal = 2;
      function onDataLoaded() {
        dataLoaded++;
        if (dataLoaded >= dataTotal) {
          // Show UI once all data is ready
          UI.show();
        }
      }

      Data.fetchPlayerVillages(function(villages) {
        State.playerVillages = villages;
        onDataLoaded();
      });

      Data.fetchBarbVillages(function(barbs) {
        State.barbVillages = barbs;
        onDataLoaded();
      });
    }

    Data.fetchWorldConfig(function(config) {
      State.worldConfig = config;
      onLoaded();
    });

    Data.fetchUnitInfo(function(speeds) {
      State.unitSpeeds = speeds;
      onLoaded();
    });
  }

  // ============================================================
  // EXPOSE FOR TESTING
  // ============================================================
  if (typeof window.TW_SNIPE_TESTS !== 'undefined') {
    window.TWSnipe = {
      VERSION: VERSION,
      pad2: pad2,
      pad3: pad3,
      formatTime: formatTime,
      formatTimeSec: formatTimeSec,
      formatDuration: formatDuration,
      parseTimeToMs: parseTimeToMs,
      parseCoords: parseCoords,
      formatCoords: formatCoords,
      calcSafeWindow: calcSafeWindow,
      calcModeA: calcModeA,
      calcModeB: calcModeB,
      calcModeC: calcModeC,
      buildTargetTime: buildTargetTime,
      remainingStatus: remainingStatus,
      buildUnitOptions: buildUnitOptions,
      buildVillageOptions: buildVillageOptions,
      buildBarbOptions: buildBarbOptions,
      findVillageById: findVillageById,
      UNIT_OPTIONS: UNIT_OPTIONS,
      TimeSync: TimeSync,
      Storage: Storage,
      Data: Data,
      State: State,
      IncomingParser: IncomingParser,
      UI: UI,
      CMD_TYPE: CMD_TYPE,
      COLORS: COLORS,
      init: init
    };
  }

  // ============================================================
  // RUN
  // ============================================================
  init();

})(window, jQuery);
