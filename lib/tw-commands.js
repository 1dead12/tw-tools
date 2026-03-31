;(function(window, $) {
  'use strict';

  var TWTools = window.TWTools;
  if (!TWTools) {
    throw new Error('tw-commands.js requires tw-core.js to be loaded first (window.TWTools missing)');
  }

  // ============================================================
  // CONSTANTS
  // ============================================================

  /** Command type classification constants. */
  var CMD_TYPE = {
    CLEANER: 'cleaner',
    NOBLE: 'noble',
    SCOUT: 'scout',
    SUPPORT: 'support',
    UNKNOWN: 'unknown'
  };

  /** Default train grouping window in milliseconds. */
  var DEFAULT_TRAIN_WINDOW_MS = 30000;

  // ============================================================
  // OUTGOING COMMANDS PARSER
  // ============================================================

  /**
   * Parse outgoing commands from the rally point page.
   * Reads the #commands_outgoings table for active outgoing commands.
   *
   * @returns {Array.<{
   *   id: number,
   *   target: {x: number, y: number},
   *   targetName: string,
   *   arrival: number,
   *   arrivalText: string,
   *   type: string
   * }>} Array of parsed outgoing commands.
   */
  function parseOutgoing() {
    var commands = [];
    var $table = $('#commands_outgoings');

    if ($table.length === 0) {
      // Try alternate selector for different TW versions
      $table = $('table.commands-table, #command-data-outgoing table');
    }

    if ($table.length === 0) return commands;

    $table.find('tbody tr, tr').each(function() {
      var $row = $(this);
      var $cells = $row.find('td');

      // Need at least a few cells to be a data row
      if ($cells.length < 3) return;

      var cmd = {};

      // Find command ID from cancel link or info link
      var $cancelLink = $row.find('a[href*="cancel"]');
      var $infoLink = $row.find('a[href*="info_command"]');
      var idMatch = null;

      if ($cancelLink.length > 0) {
        idMatch = ($cancelLink.attr('href') || '').match(/id=(\d+)/);
      }
      if (!idMatch && $infoLink.length > 0) {
        idMatch = ($infoLink.attr('href') || '').match(/id=(\d+)/);
      }
      if (idMatch) {
        cmd.id = parseInt(idMatch[1], 10);
      } else {
        // Try data attribute
        var dataId = $row.attr('data-command-id') || $row.find('[data-command-id]').attr('data-command-id');
        if (dataId) {
          cmd.id = parseInt(dataId, 10);
        } else {
          return; // Skip row without identifiable command
        }
      }

      // Determine command type from icons/text
      var $icon = $row.find('img[src*="command/"]').first();
      var iconSrc = ($icon.attr('src') || '').toLowerCase();
      var rowText = $row.text().toLowerCase();

      if (iconSrc.indexOf('support') !== -1 || rowText.indexOf('support') !== -1 ||
          rowText.indexOf('posil') !== -1 || rowText.indexOf('unterstützung') !== -1) {
        cmd.type = 'support';
      } else {
        cmd.type = 'attack';
      }

      // Parse target coordinates from row text
      var coordMatches = [];
      var rowHtml = $row.html() || '';
      var coordRegex = /(\d{1,3})\|(\d{1,3})/g;
      var coordMatch;
      while ((coordMatch = coordRegex.exec(rowHtml)) !== null) {
        coordMatches.push({
          x: parseInt(coordMatch[1], 10),
          y: parseInt(coordMatch[2], 10)
        });
      }

      // For outgoing: first coord is typically source (our village), second is target
      // But we want the target — look for the coord that isn't our village
      var myVillageId = TWTools.getVillageId();
      if (coordMatches.length >= 2) {
        cmd.target = coordMatches[1]; // Second coord is usually target
      } else if (coordMatches.length === 1) {
        cmd.target = coordMatches[0];
      }

      // Target name from target link
      var $targetLink = $row.find('a[href*="info_village"]');
      if ($targetLink.length > 1) {
        // Multiple village links — second one is typically the target
        cmd.targetName = $targetLink.eq(1).text().replace(/\s*\(\d+\|\d+\)\s*K?\d*\s*$/, '').trim();
      } else if ($targetLink.length === 1) {
        cmd.targetName = $targetLink.text().replace(/\s*\(\d+\|\d+\)\s*K?\d*\s*$/, '').trim();
      } else {
        cmd.targetName = '';
      }

      // Arrival time — search for time pattern in cells
      $cells.each(function() {
        var cellText = $(this).text().trim();
        var arrivalMs = TWTools.parseArrivalTime(cellText);
        if (arrivalMs !== null && !cmd.arrival) {
          cmd.arrival = arrivalMs;
          cmd.arrivalText = cellText;
        }
      });

      // Only add commands with valid data
      if (cmd.target && cmd.arrival) {
        commands.push(cmd);
      }
    });

    return commands;
  }

  // ============================================================
  // INCOMING COMMANDS PARSER
  // ============================================================

  /**
   * Parse incoming commands from the incomings overview page.
   * Reads the overview_villages incomings table with multi-language header detection.
   * Classifies commands by unit speed heuristic.
   *
   * @returns {Array.<{
   *   id: number,
   *   source: {x: number, y: number},
   *   sourceName: string,
   *   player: string,
   *   arrival: number,
   *   arrivalText: string,
   *   distance: number,
   *   type: string
   * }>} Array of parsed incoming commands.
   */
  function parseIncoming() {
    var commands = [];

    // Find the incomings data table — look for command/attack header
    // Multi-language: Príkaz (SK), Command (EN), Befehl (DE), Polecenie (PL)
    var $table = null;
    $('table').each(function() {
      var $t = $(this);
      var $ths = $t.find('th');
      var hasCommandHeader = false;

      $ths.each(function() {
        var text = $(this).text().trim().toLowerCase();
        if (text.indexOf('príkaz') !== -1 ||
            text.indexOf('command') !== -1 ||
            text.indexOf('befehl') !== -1 ||
            text.indexOf('polecenie') !== -1 ||
            text.indexOf('opdracht') !== -1) {
          hasCommandHeader = true;
          return false;
        }
      });

      // Must have command header AND contain command info links (not a wrapper table)
      if (hasCommandHeader && $t.find('a[href*="info_command"]').length > 0) {
        $table = $t;
      }
    });

    if (!$table) return commands;

    // Detect column indices from header row
    var colMap = {};
    $table.find('th').each(function(idx) {
      var text = $(this).text().trim().toLowerCase();

      // Command column: SK=Príkaz, EN=Command, DE=Befehl, PL=Polecenie, NL=Opdracht
      if (text.indexOf('príkaz') !== -1 || text.indexOf('command') !== -1 ||
          text.indexOf('befehl') !== -1 || text.indexOf('polecenie') !== -1 ||
          text.indexOf('opdracht') !== -1) {
        colMap.command = idx;
      }
      // Target column: SK=Cieľ, EN=Target, DE=Ziel, PL=Cel
      else if (text.indexOf('cieľ') !== -1 || text.indexOf('target') !== -1 ||
               text.indexOf('ziel') !== -1 || text.indexOf('cel') !== -1 ||
               text.indexOf('doel') !== -1) {
        colMap.target = idx;
      }
      // Origin column: SK=Pôvod, EN=Origin, DE=Herkunft, PL=Pochodzenie
      else if (text.indexOf('pôvod') !== -1 || text.indexOf('origin') !== -1 ||
               text.indexOf('herkunft') !== -1 || text.indexOf('pochodzenie') !== -1 ||
               text.indexOf('oorsprong') !== -1) {
        colMap.origin = idx;
      }
      // Player column: SK=Hráč, EN=Player, DE=Spieler, PL=Gracz
      else if (text.indexOf('hráč') !== -1 || text.indexOf('player') !== -1 ||
               text.indexOf('spieler') !== -1 || text.indexOf('gracz') !== -1 ||
               text.indexOf('speler') !== -1) {
        colMap.player = idx;
      }
      // Distance column: SK=Vzdialenosť, EN=Distance, DE=Entfernung, PL=Dystans
      else if (text.indexOf('vzdialenosť') !== -1 || text.indexOf('distance') !== -1 ||
               text.indexOf('entfernung') !== -1 || text.indexOf('dystans') !== -1 ||
               text.indexOf('afstand') !== -1) {
        colMap.distance = idx;
      }
      // Arrival column: SK=Čas príchodu, EN=Arrival, DE=Ankunft, PL=Przybycie
      else if (text.indexOf('čas príchodu') !== -1 || text.indexOf('príchodu') !== -1 ||
               text.indexOf('arrival') !== -1 || text.indexOf('ankunft') !== -1 ||
               text.indexOf('przybycie') !== -1 || text.indexOf('aankomst') !== -1) {
        colMap.arrival = idx;
      }
    });

    // Fallback column positions if headers not found
    if (colMap.command === undefined) colMap.command = 0;
    if (colMap.target === undefined) colMap.target = 1;
    if (colMap.origin === undefined) colMap.origin = 2;
    if (colMap.player === undefined) colMap.player = 3;
    if (colMap.distance === undefined) colMap.distance = 4;
    if (colMap.arrival === undefined) colMap.arrival = 5;

    // Parse data rows
    $table.find('tbody tr, tr').each(function() {
      var $row = $(this);
      var $cells = $row.find('td');

      // Skip header rows and rows without enough cells
      if ($cells.length < 6) return;

      // Skip if no command link
      var $cmdLink = $cells.eq(colMap.command).find('a[href*="info_command"]');
      if ($cmdLink.length === 0) return;

      var cmd = {};

      // Command ID from link href
      var cmdHref = $cmdLink.attr('href') || '';
      var idMatch = cmdHref.match(/id=(\d+)/);
      if (idMatch) {
        cmd.id = parseInt(idMatch[1], 10);
      }

      // Command type from icon
      var $icon = $cells.eq(colMap.command).find('img').first();
      var iconSrc = ($icon.attr('src') || '').toLowerCase();
      var cmdText = $cmdLink.text().trim().toLowerCase();

      if (iconSrc.indexOf('snob') !== -1 || iconSrc.indexOf('noble') !== -1) {
        cmd.type = CMD_TYPE.NOBLE;
      } else if (iconSrc.indexOf('support') !== -1 || iconSrc.indexOf('def') !== -1 ||
                 cmdText.indexOf('posil') !== -1 || cmdText.indexOf('support') !== -1 ||
                 cmdText.indexOf('unterstützung') !== -1 || cmdText.indexOf('wsparcie') !== -1) {
        cmd.type = CMD_TYPE.SUPPORT;
      } else {
        cmd.type = CMD_TYPE.UNKNOWN;
      }

      // Source/origin village (Pôvod column)
      var originText = $cells.eq(colMap.origin).text().trim();
      cmd.source = TWTools.parseCoords(originText);
      cmd.sourceName = originText.replace(/\s*\(\d+\|\d+\)\s*K?\d*\s*$/, '').trim();

      // Player name (Hráč column)
      var $playerLink = $cells.eq(colMap.player).find('a[href*="info_player"]');
      cmd.player = $playerLink.text().trim() || 'Unknown';

      // Distance (Vzdialenosť column)
      var distText = $cells.eq(colMap.distance).text().trim().replace(',', '.');
      cmd.distance = parseFloat(distText) || 0;

      // Arrival time with ms (Čas príchodu column)
      var arrivalText = $cells.eq(colMap.arrival).text().trim();
      var arrivalMs = TWTools.parseArrivalTime(arrivalText);
      if (arrivalMs !== null) {
        cmd.arrival = arrivalMs;
        cmd.arrivalText = arrivalText;
      }

      // Only add if we have valid arrival time
      if (cmd.arrival) {
        commands.push(cmd);
      }
    });

    return commands;
  }

  // ============================================================
  // COMMAND CANCEL
  // ============================================================

  /**
   * Cancel an outgoing command via AJAX POST to the rally point.
   *
   * @param {number} commandId - The command ID to cancel.
   * @returns {Object} jQuery jqXHR promise.
   */
  function cancel(commandId) {
    return $.ajax({
      url: '/game.php?screen=place&ajaxaction=cancel',
      type: 'POST',
      dataType: 'json',
      data: {
        id: commandId,
        village: TWTools.getVillageId(),
        h: TWTools.getCsrf()
      }
    });
  }

  // ============================================================
  // TRAIN GROUPING
  // ============================================================

  /**
   * Group commands into trains based on same attacker, same target,
   * and arrival time within a configurable window.
   *
   * @param {Array} commands - Array of parsed command objects.
   * @param {number} [windowMs=30000] - Grouping window in milliseconds.
   * @returns {Array.<{
   *   id: string,
   *   attacker: string,
   *   targetCoords: {x: number, y: number},
   *   commands: Array,
   *   arrivalStart: number,
   *   arrivalEnd: number,
   *   nobleCount: number,
   *   isSupport: boolean
   * }>} Array of train objects.
   */
  function groupIntoTrains(commands, windowMs) {
    windowMs = windowMs || DEFAULT_TRAIN_WINDOW_MS;

    if (!commands || !commands.length) return [];

    // Separate support from attack commands
    var attacks = [];
    var supports = [];
    for (var i = 0; i < commands.length; i++) {
      if (commands[i].type === CMD_TYPE.SUPPORT) {
        supports.push(commands[i]);
      } else {
        attacks.push(commands[i]);
      }
    }

    // Sort attacks by arrival time
    var sorted = attacks.slice().sort(function(a, b) {
      return (a.arrival || 0) - (b.arrival || 0);
    });

    var trains = [];

    if (sorted.length > 0) {
      var currentTrain = {
        attacker: sorted[0].player || sorted[0].attacker || '',
        targetCoords: sorted[0].source || null, // For incomings, target is our village
        commands: [sorted[0]]
      };

      for (var j = 1; j < sorted.length; j++) {
        var cmd = sorted[j];
        var lastCmd = currentTrain.commands[currentTrain.commands.length - 1];
        var cmdAttacker = cmd.player || cmd.attacker || '';
        var sameAttacker = cmdAttacker === currentTrain.attacker;

        // For incomings, "same target" means same source (same attacker village)
        var cmdCoords = cmd.source || null;
        var trainCoords = currentTrain.targetCoords;
        var sameTarget = cmdCoords && trainCoords &&
          cmdCoords.x === trainCoords.x &&
          cmdCoords.y === trainCoords.y;

        var withinWindow = Math.abs((cmd.arrival || 0) - (lastCmd.arrival || 0)) <= windowMs;

        if (sameAttacker && sameTarget && withinWindow) {
          currentTrain.commands.push(cmd);
        } else {
          trains.push(currentTrain);
          currentTrain = {
            attacker: cmdAttacker,
            targetCoords: cmdCoords,
            commands: [cmd]
          };
        }
      }
      trains.push(currentTrain);
    }

    // Add support commands as individual "trains" for visibility
    for (var k = 0; k < supports.length; k++) {
      trains.push({
        attacker: supports[k].player || supports[k].attacker || 'Support',
        targetCoords: supports[k].source || null,
        commands: [supports[k]]
      });
    }

    // Enrich each train with metadata
    for (var t = 0; t < trains.length; t++) {
      var train = trains[t];
      train.id = 'train_' + t;

      var times = [];
      for (var c = 0; c < train.commands.length; c++) {
        if (train.commands[c].arrival) {
          times.push(train.commands[c].arrival);
        }
      }
      train.arrivalStart = times.length > 0 ? Math.min.apply(null, times) : 0;
      train.arrivalEnd = times.length > 0 ? Math.max.apply(null, times) : 0;

      var nobleCount = 0;
      for (var n = 0; n < train.commands.length; n++) {
        if (train.commands[n].type === CMD_TYPE.NOBLE) nobleCount++;
      }
      train.nobleCount = nobleCount;
      train.isSupport = train.commands.length === 1 &&
        train.commands[0].type === CMD_TYPE.SUPPORT;
    }

    return trains;
  }

  // ============================================================
  // UNIT CLASSIFICATION HEURISTIC
  // ============================================================

  /**
   * Classify the probable unit type based on travel time and distance.
   * Computes expected travel time for each unit type, finds the closest match.
   * Uses 5% tolerance for matching.
   *
   * @param {number} travelTimeMs - Observed travel time in milliseconds.
   * @param {number} dist - Distance in fields.
   * @param {Object} [unitSpeeds] - Unit speeds map (default: fetched or DEFAULT_UNIT_SPEEDS).
   * @param {Object} [worldConfig] - World config with speed and unitSpeed properties.
   * @returns {{
   *   unit: string,
   *   confidence: string,
   *   expectedMs: number,
   *   diffMs: number,
   *   diffPercent: number
   * }} Classification result.
   */
  function classifyUnit(travelTimeMs, dist, unitSpeeds, worldConfig) {
    unitSpeeds = unitSpeeds || TWTools.DataFetcher._unitSpeeds || TWTools.DEFAULT_UNIT_SPEEDS;
    worldConfig = worldConfig || TWTools.DataFetcher._worldConfig || { speed: 1, unitSpeed: 1 };

    var ws = worldConfig.speed || 1;
    var usf = worldConfig.unitSpeed || 1;

    // No distance — can't classify
    if (!dist || dist <= 0) {
      return {
        unit: 'unknown',
        confidence: 'none',
        expectedMs: 0,
        diffMs: 0,
        diffPercent: 100
      };
    }

    // Calculate expected travel time for each unit type
    var candidates = [];
    var unitNames = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher',
                     'heavy', 'ram', 'catapult', 'knight', 'snob'];

    for (var i = 0; i < unitNames.length; i++) {
      var unitName = unitNames[i];
      var speed = unitSpeeds[unitName] || TWTools.DEFAULT_UNIT_SPEEDS[unitName];
      if (!speed) continue;

      var expected = TWTools.travelTime(dist, speed, ws, usf);
      var diff = Math.abs(travelTimeMs - expected);
      var diffPercent = expected > 0 ? (diff / expected) * 100 : 100;

      candidates.push({
        unit: unitName,
        expectedMs: expected,
        diffMs: diff,
        diffPercent: diffPercent
      });
    }

    // Sort by smallest difference
    candidates.sort(function(a, b) {
      return a.diffMs - b.diffMs;
    });

    if (candidates.length === 0) {
      return {
        unit: 'unknown',
        confidence: 'none',
        expectedMs: 0,
        diffMs: 0,
        diffPercent: 100
      };
    }

    var best = candidates[0];

    // Determine confidence based on tolerance
    var confidence;
    if (best.diffPercent <= 2) {
      confidence = 'high';
    } else if (best.diffPercent <= 5) {
      confidence = 'medium';
    } else if (best.diffPercent <= 10) {
      confidence = 'low';
    } else {
      confidence = 'none';
    }

    return {
      unit: best.unit,
      confidence: confidence,
      expectedMs: best.expectedMs,
      diffMs: best.diffMs,
      diffPercent: Math.round(best.diffPercent * 10) / 10
    };
  }

  // ============================================================
  // PUBLIC API — extend window.TWTools.Commands
  // ============================================================

  TWTools.Commands = {
    CMD_TYPE: CMD_TYPE,
    parseOutgoing: parseOutgoing,
    parseIncoming: parseIncoming,
    cancel: cancel,
    groupIntoTrains: groupIntoTrains,
    classifyUnit: classifyUnit
  };

})(window, jQuery);
