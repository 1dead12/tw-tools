;(function(window, $) {
  'use strict';

  // ============================================================
  // TW MAP TOOLS v1.0.0
  // ============================================================
  // Extended map tools: Barb Finder, Bonus Finder, Coordinates,
  // and Watchtower planner. Best used on the map page (screen=map).
  //
  // REQUIRES: window.TWTools (tw-core.js), window.TWTools.UI (tw-ui.js)
  // ============================================================

  var VERSION = '1.0.0';
  var ID_PREFIX = 'twmt-';
  var STORAGE_PREFIX = 'twmt_';

  // ============================================================
  // CONSTANTS
  // ============================================================

  /**
   * Bonus type definitions.
   * In village.txt, field index 6 is bonus_id. Non-zero = bonus village.
   * @type {Object.<number, string>}
   */
  var BONUS_TYPES = {
    1: 'Wood +100%',
    2: 'Clay +100%',
    3: 'Iron +100%',
    4: 'Wood +30%, Clay +30%, Iron +30%',
    5: 'Population +10%',
    6: 'Barracks speed +33%',
    7: 'Stable speed +33%',
    8: 'Workshop speed +33%'
  };

  /**
   * Watchtower detection ranges in fields, indexed by level (1-20).
   * @type {Object.<number, number>}
   */
  var WT_RANGES = {
    1: 1.1, 2: 1.3, 3: 1.5, 4: 1.7, 5: 2.0,
    6: 2.3, 7: 2.6, 8: 3.0, 9: 3.4, 10: 3.9,
    11: 4.4, 12: 5.0, 13: 5.7, 14: 6.4, 15: 7.2,
    16: 8.1, 17: 9.1, 18: 10.2, 19: 11.5, 20: 12.9
  };

  /**
   * Unit display names for travel time table.
   * @type {Object.<string, string>}
   */
  var UNIT_DISPLAY_NAMES = {
    spear: 'Spear', sword: 'Sword', axe: 'Axe', archer: 'Archer',
    spy: 'Spy', light: 'Light Cav', marcher: 'Mounted Archer',
    heavy: 'Heavy Cav', ram: 'Ram', catapult: 'Catapult',
    knight: 'Paladin', snob: 'Noble'
  };

  // ============================================================
  // SETTINGS
  // ============================================================

  var Settings = {
    /** @type {number} Barb finder: minimum points. */
    barbMinPts: 0,
    /** @type {number} Barb finder: maximum points. */
    barbMaxPts: 12000,
    /** @type {number} Barb finder: minimum distance. */
    barbMinDist: 0,
    /** @type {number} Barb finder: maximum distance. */
    barbMaxDist: 30,
    /** @type {string} Barb finder: continent filter (comma-separated K numbers, e.g. "K54,K55"). */
    barbContinent: '',
    /** @type {string} Barb finder: sort field ('distance' or 'points'). */
    barbSort: 'distance',

    /** @type {number} Bonus finder: bonus type filter (0 = all). */
    bonusType: 0,
    /** @type {number} Bonus finder: minimum distance. */
    bonusMinDist: 0,
    /** @type {number} Bonus finder: maximum distance. */
    bonusMaxDist: 30,
    /** @type {string} Bonus finder: owner filter ('any', 'barb', 'player'). */
    bonusOwner: 'any',
    /** @type {number} Bonus finder: minimum points. */
    bonusMinPts: 0,
    /** @type {number} Bonus finder: maximum points. */
    bonusMaxPts: 99999,
    /** @type {string} Bonus finder: sort field ('distance' or 'points'). */
    bonusSort: 'distance',

    /** @type {string} Coords tab: output format ('bbcode', 'plain', 'claim'). */
    coordFormat: 'bbcode',

    /** @type {Array.<{x: number, y: number, level: number}>} Watchtower entries. */
    wtEntries: [],

    /**
     * Load all settings from storage.
     */
    load: function() {
      var saved = TWTools.Storage.get(STORAGE_PREFIX + 'settings');
      if (saved) {
        var keys = Object.keys(saved);
        for (var i = 0; i < keys.length; i++) {
          if (this.hasOwnProperty(keys[i])) {
            this[keys[i]] = saved[keys[i]];
          }
        }
      }
    },

    /**
     * Save all settings to storage.
     */
    save: function() {
      TWTools.Storage.set(STORAGE_PREFIX + 'settings', {
        barbMinPts: this.barbMinPts,
        barbMaxPts: this.barbMaxPts,
        barbMinDist: this.barbMinDist,
        barbMaxDist: this.barbMaxDist,
        barbContinent: this.barbContinent,
        barbSort: this.barbSort,
        bonusType: this.bonusType,
        bonusMinDist: this.bonusMinDist,
        bonusMaxDist: this.bonusMaxDist,
        bonusOwner: this.bonusOwner,
        bonusMinPts: this.bonusMinPts,
        bonusMaxPts: this.bonusMaxPts,
        bonusSort: this.bonusSort,
        coordFormat: this.coordFormat,
        wtEntries: this.wtEntries
      });
    }
  };

  // ============================================================
  // HELPER FUNCTIONS
  // ============================================================

  /**
   * Get the current village's coordinates.
   * @returns {{x: number, y: number}|null} Current village coords or null.
   */
  function getCurrentVillageCoords() {
    if (typeof game_data !== 'undefined' && game_data.village) {
      return {
        x: parseInt(game_data.village.x, 10) || 0,
        y: parseInt(game_data.village.y, 10) || 0
      };
    }
    return null;
  }

  /**
   * Get the continent string (e.g. "K54") for coordinates.
   * @param {number} x - X coordinate.
   * @param {number} y - Y coordinate.
   * @returns {string} Continent string.
   */
  function getContinent(x, y) {
    return 'K' + Math.floor(y / 100) + '' + Math.floor(x / 100);
  }

  /**
   * Center the map on specific coordinates if on map page.
   * @param {number} x - X coordinate.
   * @param {number} y - Y coordinate.
   */
  function centerMap(x, y) {
    if (typeof TWMap !== 'undefined' && TWMap.focus) {
      TWMap.focus(x, y);
    } else {
      TWTools.UI.toast('Map not available — open map page first', 'warning');
    }
  }

  /**
   * Copy text to clipboard with fallback.
   * @param {string} text - Text to copy.
   */
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        TWTools.UI.toast('Copied to clipboard!', 'success');
      }, function() {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

  /**
   * Fallback copy using textarea.
   * @param {string} text - Text to copy.
   * @private
   */
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      TWTools.UI.toast('Copied to clipboard!', 'success');
    } catch (e) {
      TWTools.UI.toast('Copy failed — select text manually', 'error');
    }
    document.body.removeChild(ta);
  }

  /**
   * Build a TW-styled input element.
   * @param {string} id - Element ID.
   * @param {string} type - Input type.
   * @param {*} value - Initial value.
   * @param {Object} [attrs] - Additional attributes.
   * @returns {string} HTML string for the input.
   */
  function buildInput(id, type, value, attrs) {
    var extra = '';
    if (attrs) {
      var keys = Object.keys(attrs);
      for (var i = 0; i < keys.length; i++) {
        extra += ' ' + keys[i] + '="' + attrs[keys[i]] + '"';
      }
    }
    return '<input type="' + type + '" id="' + ID_PREFIX + id + '" value="' + value + '"' +
      ' style="width:60px;padding:1px 3px;font-size:10px;border:1px solid #c0a060;background:#fff8e8;"' +
      extra + '>';
  }

  /**
   * Build a TW-styled select element.
   * @param {string} id - Element ID.
   * @param {Array.<{value: string, label: string}>} options - Option list.
   * @param {string} selected - Currently selected value.
   * @returns {string} HTML string for the select.
   */
  function buildSelect(id, options, selected) {
    var html = '<select id="' + ID_PREFIX + id + '" style="padding:1px 3px;font-size:10px;border:1px solid #c0a060;background:#fff8e8;">';
    for (var i = 0; i < options.length; i++) {
      var sel = options[i].value === selected ? ' selected' : '';
      html += '<option value="' + options[i].value + '"' + sel + '>' + options[i].label + '</option>';
    }
    html += '</select>';
    return html;
  }

  /**
   * Build a TW-styled button.
   * @param {string} id - Element ID.
   * @param {string} label - Button text.
   * @param {string} [extraStyle] - Additional inline style.
   * @returns {string} HTML string for the button.
   */
  function buildButton(id, label, extraStyle) {
    return '<input type="button" id="' + ID_PREFIX + id + '" class="btn" value="' + label + '"' +
      ' style="font-size:10px;padding:2px 8px;margin:2px;cursor:pointer;' + (extraStyle || '') + '">';
  }

  // ============================================================
  // BARB FINDER TAB
  // ============================================================

  var BarbFinder = {
    /** @private {Array} Cached results. */
    _results: [],

    /**
     * Render the barb finder controls and results area.
     * @param {jQuery} $panel - Tab panel jQuery element.
     */
    render: function($panel) {
      var html =
        '<div style="margin-bottom:6px;">' +
          '<table style="width:100%;font-size:10px;">' +
            '<tr>' +
              '<td>Points:</td>' +
              '<td>' + buildInput('barb-min-pts', 'number', Settings.barbMinPts, {min: '0', step: '100'}) +
              ' - ' + buildInput('barb-max-pts', 'number', Settings.barbMaxPts, {min: '0', step: '100'}) + '</td>' +
            '</tr>' +
            '<tr>' +
              '<td>Distance:</td>' +
              '<td>' + buildInput('barb-min-dist', 'number', Settings.barbMinDist, {min: '0', step: '1'}) +
              ' - ' + buildInput('barb-max-dist', 'number', Settings.barbMaxDist, {min: '0', step: '1'}) + ' fields</td>' +
            '</tr>' +
            '<tr>' +
              '<td>Continent:</td>' +
              '<td>' + buildInput('barb-continent', 'text', Settings.barbContinent, {placeholder: 'K54,K55', style: 'width:100px;padding:1px 3px;font-size:10px;border:1px solid #c0a060;background:#fff8e8;'}) + '</td>' +
            '</tr>' +
            '<tr>' +
              '<td>Sort by:</td>' +
              '<td>' + buildSelect('barb-sort', [
                {value: 'distance', label: 'Distance'},
                {value: 'points', label: 'Points'}
              ], Settings.barbSort) + '</td>' +
            '</tr>' +
          '</table>' +
          buildButton('barb-search', 'Search Barbs') + ' ' +
          buildButton('barb-export', 'Export BB-Code') +
        '</div>' +
        '<div id="' + ID_PREFIX + 'barb-stats" style="font-size:10px;margin-bottom:4px;color:#5a4a2a;"></div>' +
        '<div id="' + ID_PREFIX + 'barb-results" style="max-height:280px;overflow-y:auto;"></div>';

      $panel.html(html);
      this._bindEvents($panel);
    },

    /**
     * Bind events for barb finder controls.
     * @param {jQuery} $panel - Tab panel jQuery element.
     * @private
     */
    _bindEvents: function($panel) {
      var self = this;

      $panel.on('click', '#' + ID_PREFIX + 'barb-search', function() {
        self._readSettings();
        self._search($panel);
      });

      $panel.on('click', '#' + ID_PREFIX + 'barb-export', function() {
        self._export();
      });

      // Delegate center-map clicks
      $panel.on('click', '.twmt-center-map', function() {
        var x = parseInt($(this).attr('data-x'), 10);
        var y = parseInt($(this).attr('data-y'), 10);
        centerMap(x, y);
      });
    },

    /**
     * Read current filter settings from inputs.
     * @private
     */
    _readSettings: function() {
      Settings.barbMinPts = parseInt($('#' + ID_PREFIX + 'barb-min-pts').val(), 10) || 0;
      Settings.barbMaxPts = parseInt($('#' + ID_PREFIX + 'barb-max-pts').val(), 10) || 99999;
      Settings.barbMinDist = parseFloat($('#' + ID_PREFIX + 'barb-min-dist').val()) || 0;
      Settings.barbMaxDist = parseFloat($('#' + ID_PREFIX + 'barb-max-dist').val()) || 999;
      Settings.barbContinent = ($('#' + ID_PREFIX + 'barb-continent').val() || '').trim();
      Settings.barbSort = $('#' + ID_PREFIX + 'barb-sort').val() || 'distance';
      Settings.save();
    },

    /**
     * Execute barb village search.
     * @param {jQuery} $panel - Tab panel.
     * @private
     */
    _search: function($panel) {
      var $stats = $panel.find('#' + ID_PREFIX + 'barb-stats');
      var $results = $panel.find('#' + ID_PREFIX + 'barb-results');

      $stats.text('Searching...');
      $results.empty();

      var myCoords = getCurrentVillageCoords();
      if (!myCoords) {
        $stats.text('Error: Could not determine current village coordinates.');
        return;
      }

      // Parse continent filter
      var continentFilter = [];
      if (Settings.barbContinent) {
        var parts = Settings.barbContinent.toUpperCase().split(/[,\s]+/);
        for (var i = 0; i < parts.length; i++) {
          var k = parts[i].trim();
          if (k && /^K\d{1,2}$/.test(k)) {
            continentFilter.push(k);
          }
        }
      }

      var self = this;
      TWTools.DataFetcher.fetchBarbVillages(function(barbs) {
        var filtered = [];

        for (var i = 0; i < barbs.length; i++) {
          var b = barbs[i];
          var dist = TWTools.distance(myCoords, {x: b.x, y: b.y});
          var continent = getContinent(b.x, b.y);

          // Apply filters
          if (b.points < Settings.barbMinPts || b.points > Settings.barbMaxPts) continue;
          if (dist < Settings.barbMinDist || dist > Settings.barbMaxDist) continue;
          if (continentFilter.length > 0 && continentFilter.indexOf(continent) === -1) continue;

          filtered.push({
            x: b.x,
            y: b.y,
            points: b.points,
            distance: dist,
            continent: continent
          });
        }

        // Sort
        if (Settings.barbSort === 'points') {
          filtered.sort(function(a, b) { return b.points - a.points; });
        } else {
          filtered.sort(function(a, b) { return a.distance - b.distance; });
        }

        self._results = filtered;

        // Stats
        var totalPts = 0;
        for (var j = 0; j < filtered.length; j++) {
          totalPts += filtered[j].points;
        }
        $stats.html('Found: <b>' + filtered.length + '</b> barbs | ' +
          'Total points: <b>' + totalPts.toLocaleString() + '</b> | ' +
          'Avg distance: <b>' + (filtered.length > 0 ? (filtered.reduce(function(s, v) { return s + v.distance; }, 0) / filtered.length).toFixed(1) : '0') + '</b> fields');

        // Build results table
        if (filtered.length === 0) {
          $results.html('<p style="font-size:10px;color:#8a6a40;">No barbarian villages found matching criteria.</p>');
          return;
        }

        var table = '<table class="vis" style="width:100%;">' +
          '<tr><th>#</th><th>Coords</th><th>Points</th><th>Distance</th><th>K</th><th>Action</th></tr>';

        var limit = Math.min(filtered.length, 200);
        for (var k = 0; k < limit; k++) {
          var v = filtered[k];
          table += '<tr>' +
            '<td>' + (k + 1) + '</td>' +
            '<td><a href="#" class="twmt-center-map" data-x="' + v.x + '" data-y="' + v.y + '">' + v.x + '|' + v.y + '</a></td>' +
            '<td>' + v.points.toLocaleString() + '</td>' +
            '<td>' + v.distance.toFixed(1) + '</td>' +
            '<td>' + v.continent + '</td>' +
            '<td><input type="button" class="btn twmt-center-map" data-x="' + v.x + '" data-y="' + v.y + '" value="Center" style="font-size:9px;padding:1px 4px;cursor:pointer;"></td>' +
            '</tr>';
        }

        if (filtered.length > 200) {
          table += '<tr><td colspan="6" style="text-align:center;font-style:italic;">Showing 200 of ' + filtered.length + ' results. Narrow your filters.</td></tr>';
        }

        table += '</table>';
        $results.html(table);
      });
    },

    /**
     * Export results as BB-code coordinate list.
     * @private
     */
    _export: function() {
      if (!this._results || this._results.length === 0) {
        TWTools.UI.toast('No results to export — run a search first', 'warning');
        return;
      }

      var lines = [];
      for (var i = 0; i < this._results.length; i++) {
        var v = this._results[i];
        lines.push('[coord]' + v.x + '|' + v.y + '[/coord]');
      }

      copyToClipboard(lines.join('\n'));
    }
  };

  // ============================================================
  // BONUS FINDER TAB
  // ============================================================

  var BonusFinder = {
    /** @private {Array} Cached results. */
    _results: [],

    /**
     * Render the bonus finder controls and results area.
     * @param {jQuery} $panel - Tab panel jQuery element.
     */
    render: function($panel) {
      // Build bonus type options
      var bonusOptions = [{value: '0', label: 'All bonus types'}];
      var typeKeys = Object.keys(BONUS_TYPES);
      for (var i = 0; i < typeKeys.length; i++) {
        bonusOptions.push({value: typeKeys[i], label: BONUS_TYPES[typeKeys[i]]});
      }

      var html =
        '<div style="margin-bottom:6px;">' +
          '<table style="width:100%;font-size:10px;">' +
            '<tr>' +
              '<td>Bonus type:</td>' +
              '<td>' + buildSelect('bonus-type', bonusOptions, '' + Settings.bonusType) + '</td>' +
            '</tr>' +
            '<tr>' +
              '<td>Distance:</td>' +
              '<td>' + buildInput('bonus-min-dist', 'number', Settings.bonusMinDist, {min: '0', step: '1'}) +
              ' - ' + buildInput('bonus-max-dist', 'number', Settings.bonusMaxDist, {min: '0', step: '1'}) + ' fields</td>' +
            '</tr>' +
            '<tr>' +
              '<td>Owner:</td>' +
              '<td>' + buildSelect('bonus-owner', [
                {value: 'any', label: 'Any'},
                {value: 'barb', label: 'Barbarian only'},
                {value: 'player', label: 'Player-owned only'}
              ], Settings.bonusOwner) + '</td>' +
            '</tr>' +
            '<tr>' +
              '<td>Points:</td>' +
              '<td>' + buildInput('bonus-min-pts', 'number', Settings.bonusMinPts, {min: '0', step: '100'}) +
              ' - ' + buildInput('bonus-max-pts', 'number', Settings.bonusMaxPts, {min: '0', step: '100'}) + '</td>' +
            '</tr>' +
            '<tr>' +
              '<td>Sort by:</td>' +
              '<td>' + buildSelect('bonus-sort', [
                {value: 'distance', label: 'Distance'},
                {value: 'points', label: 'Points'}
              ], Settings.bonusSort) + '</td>' +
            '</tr>' +
          '</table>' +
          buildButton('bonus-search', 'Search Bonus') + ' ' +
          buildButton('bonus-export', 'Export BB-Code') +
        '</div>' +
        '<div id="' + ID_PREFIX + 'bonus-stats" style="font-size:10px;margin-bottom:4px;color:#5a4a2a;"></div>' +
        '<div id="' + ID_PREFIX + 'bonus-results" style="max-height:280px;overflow-y:auto;"></div>';

      $panel.html(html);
      this._bindEvents($panel);
    },

    /**
     * Bind events for bonus finder controls.
     * @param {jQuery} $panel - Tab panel.
     * @private
     */
    _bindEvents: function($panel) {
      var self = this;

      $panel.on('click', '#' + ID_PREFIX + 'bonus-search', function() {
        self._readSettings();
        self._search($panel);
      });

      $panel.on('click', '#' + ID_PREFIX + 'bonus-export', function() {
        self._export();
      });

      $panel.on('click', '.twmt-center-map', function() {
        var x = parseInt($(this).attr('data-x'), 10);
        var y = parseInt($(this).attr('data-y'), 10);
        centerMap(x, y);
      });
    },

    /**
     * Read current filter settings from inputs.
     * @private
     */
    _readSettings: function() {
      Settings.bonusType = parseInt($('#' + ID_PREFIX + 'bonus-type').val(), 10) || 0;
      Settings.bonusMinDist = parseFloat($('#' + ID_PREFIX + 'bonus-min-dist').val()) || 0;
      Settings.bonusMaxDist = parseFloat($('#' + ID_PREFIX + 'bonus-max-dist').val()) || 999;
      Settings.bonusOwner = $('#' + ID_PREFIX + 'bonus-owner').val() || 'any';
      Settings.bonusMinPts = parseInt($('#' + ID_PREFIX + 'bonus-min-pts').val(), 10) || 0;
      Settings.bonusMaxPts = parseInt($('#' + ID_PREFIX + 'bonus-max-pts').val(), 10) || 99999;
      Settings.bonusSort = $('#' + ID_PREFIX + 'bonus-sort').val() || 'distance';
      Settings.save();
    },

    /**
     * Execute bonus village search.
     * Fetches ALL villages (village.txt includes bonus_id at index 6).
     * @param {jQuery} $panel - Tab panel.
     * @private
     */
    _search: function($panel) {
      var $stats = $panel.find('#' + ID_PREFIX + 'bonus-stats');
      var $results = $panel.find('#' + ID_PREFIX + 'bonus-results');

      $stats.text('Fetching village data...');
      $results.empty();

      var myCoords = getCurrentVillageCoords();
      if (!myCoords) {
        $stats.text('Error: Could not determine current village coordinates.');
        return;
      }

      var self = this;

      // Fetch raw village.txt to get bonus_id (index 6) — the standard fetchAllVillages
      // doesn't parse bonus_id, so we fetch raw data here.
      var cached = TWTools.Storage.get('bonus_villages');
      if (cached) {
        self._filterAndDisplay(cached, myCoords, $stats, $results);
        return;
      }

      $.ajax({
        url: '/map/village.txt',
        dataType: 'text',
        success: function(csv) {
          var villages = [];
          var lines = csv.split('\n');
          for (var i = 0; i < lines.length; i++) {
            var cols = lines[i].split(',');
            // CSV: id, name, x, y, owner_id, points, bonus_id
            if (cols.length >= 7) {
              var bonusId = parseInt(cols[6], 10) || 0;
              if (bonusId > 0) {
                villages.push({
                  id: parseInt(cols[0], 10),
                  x: parseInt(cols[2], 10),
                  y: parseInt(cols[3], 10),
                  owner: parseInt(cols[4], 10) || 0,
                  points: parseInt(cols[5], 10) || 0,
                  bonusId: bonusId
                });
              }
            }
          }
          TWTools.Storage.set('bonus_villages', villages, 3600000); // 1h cache
          self._filterAndDisplay(villages, myCoords, $stats, $results);
        },
        error: function() {
          $stats.text('Error: Failed to fetch village data.');
        }
      });
    },

    /**
     * Filter and display bonus village results.
     * @param {Array} villages - All bonus villages.
     * @param {{x: number, y: number}} myCoords - Current village coords.
     * @param {jQuery} $stats - Stats element.
     * @param {jQuery} $results - Results container.
     * @private
     */
    _filterAndDisplay: function(villages, myCoords, $stats, $results) {
      var filtered = [];

      for (var i = 0; i < villages.length; i++) {
        var v = villages[i];
        var dist = TWTools.distance(myCoords, {x: v.x, y: v.y});

        // Bonus type filter
        if (Settings.bonusType > 0 && v.bonusId !== Settings.bonusType) continue;

        // Distance filter
        if (dist < Settings.bonusMinDist || dist > Settings.bonusMaxDist) continue;

        // Owner filter
        if (Settings.bonusOwner === 'barb' && v.owner !== 0) continue;
        if (Settings.bonusOwner === 'player' && v.owner === 0) continue;

        // Points filter
        if (v.points < Settings.bonusMinPts || v.points > Settings.bonusMaxPts) continue;

        filtered.push({
          x: v.x,
          y: v.y,
          points: v.points,
          bonusId: v.bonusId,
          bonusName: BONUS_TYPES[v.bonusId] || 'Unknown (#' + v.bonusId + ')',
          owner: v.owner,
          ownerLabel: v.owner === 0 ? 'Barbarian' : 'Player',
          distance: dist
        });
      }

      // Sort
      if (Settings.bonusSort === 'points') {
        filtered.sort(function(a, b) { return b.points - a.points; });
      } else {
        filtered.sort(function(a, b) { return a.distance - b.distance; });
      }

      this._results = filtered;

      // Stats
      var barbCount = 0;
      for (var j = 0; j < filtered.length; j++) {
        if (filtered[j].owner === 0) barbCount++;
      }
      $stats.html('Found: <b>' + filtered.length + '</b> bonus villages | ' +
        'Barbarian: <b>' + barbCount + '</b> | ' +
        'Player-owned: <b>' + (filtered.length - barbCount) + '</b>');

      // Build results table
      if (filtered.length === 0) {
        $results.html('<p style="font-size:10px;color:#8a6a40;">No bonus villages found matching criteria.</p>');
        return;
      }

      var table = '<table class="vis" style="width:100%;">' +
        '<tr><th>Coords</th><th>Points</th><th>Bonus</th><th>Owner</th><th>Dist</th><th>Action</th></tr>';

      var limit = Math.min(filtered.length, 200);
      for (var k = 0; k < limit; k++) {
        var r = filtered[k];
        var ownerStyle = r.owner === 0 ? 'color:#3a7a1a;' : '';
        table += '<tr>' +
          '<td><a href="#" class="twmt-center-map" data-x="' + r.x + '" data-y="' + r.y + '">' + r.x + '|' + r.y + '</a></td>' +
          '<td>' + r.points.toLocaleString() + '</td>' +
          '<td style="font-size:9px;">' + r.bonusName + '</td>' +
          '<td style="' + ownerStyle + '">' + r.ownerLabel + '</td>' +
          '<td>' + r.distance.toFixed(1) + '</td>' +
          '<td><input type="button" class="btn twmt-center-map" data-x="' + r.x + '" data-y="' + r.y + '" value="Center" style="font-size:9px;padding:1px 4px;cursor:pointer;"></td>' +
          '</tr>';
      }

      if (filtered.length > 200) {
        table += '<tr><td colspan="6" style="text-align:center;font-style:italic;">Showing 200 of ' + filtered.length + ' results.</td></tr>';
      }

      table += '</table>';
      $results.html(table);
    },

    /**
     * Export results as BB-code coordinate list.
     * @private
     */
    _export: function() {
      if (!this._results || this._results.length === 0) {
        TWTools.UI.toast('No results to export — run a search first', 'warning');
        return;
      }

      var lines = [];
      for (var i = 0; i < this._results.length; i++) {
        var v = this._results[i];
        lines.push('[coord]' + v.x + '|' + v.y + '[/coord]');
      }

      copyToClipboard(lines.join('\n'));
    }
  };

  // ============================================================
  // COORDINATES TAB
  // ============================================================

  var Coordinates = {
    /** @private {Array.<{x: number, y: number}>} Collected coordinates. */
    _collected: [],

    /** @private {boolean} Whether click capture is active. */
    _capturing: false,

    /** @private {?Function} Original map click handler. */
    _origClickHandler: null,

    /**
     * Render the coordinates tab.
     * @param {jQuery} $panel - Tab panel jQuery element.
     */
    render: function($panel) {
      var html =
        '<div style="margin-bottom:8px;">' +
          '<b style="font-size:11px;">Coordinate Picker</b><br>' +
          '<span style="font-size:10px;color:#7a6840;">Click on the map to collect coordinates. Toggle capture mode below.</span><br>' +
          buildButton('coord-capture-toggle', 'Start Capture') + ' ' +
          buildButton('coord-clear', 'Clear All') +
          '<div style="margin-top:4px;">' +
            '<span style="font-size:10px;">Format: </span>' +
            buildSelect('coord-format', [
              {value: 'bbcode', label: 'BB-Code'},
              {value: 'plain', label: 'Plain'},
              {value: 'claim', label: 'Claim'}
            ], Settings.coordFormat) +
            ' ' + buildButton('coord-copy', 'Copy') +
          '</div>' +
          '<textarea id="' + ID_PREFIX + 'coord-output" readonly style="width:100%;height:80px;margin-top:4px;' +
            'font-size:10px;font-family:monospace;border:1px solid #c0a060;background:#fff8e8;resize:vertical;"></textarea>' +
        '</div>';

      $panel.html(html);
      this._bindEvents($panel);
    },

    /**
     * Bind events for coordinates tab.
     * @param {jQuery} $panel - Tab panel.
     * @private
     */
    _bindEvents: function($panel) {
      var self = this;

      $panel.on('click', '#' + ID_PREFIX + 'coord-capture-toggle', function() {
        if (self._capturing) {
          self._stopCapture();
          $(this).val('Start Capture');
        } else {
          self._startCapture();
          $(this).val('Stop Capture');
        }
      });

      $panel.on('click', '#' + ID_PREFIX + 'coord-clear', function() {
        self._collected = [];
        self._updateOutput();
      });

      $panel.on('change', '#' + ID_PREFIX + 'coord-format', function() {
        Settings.coordFormat = $(this).val();
        Settings.save();
        self._updateOutput();
      });

      $panel.on('click', '#' + ID_PREFIX + 'coord-copy', function() {
        var text = $('#' + ID_PREFIX + 'coord-output').val();
        if (text) {
          copyToClipboard(text);
        } else {
          TWTools.UI.toast('No coordinates to copy', 'warning');
        }
      });
    },

    /**
     * Start capturing map clicks.
     * Hooks into the map container to capture coordinates from click position.
     * @private
     */
    _startCapture: function() {
      this._capturing = true;

      if (typeof TWMap === 'undefined') {
        TWTools.UI.toast('Map not available — capture works only on map page', 'warning');
        this._capturing = false;
        return;
      }

      var self = this;

      // Find the map element — TW uses #map_big as the main map viewport,
      // falling back to #map_container or the first canvas inside #map
      var mapEl = document.getElementById('map_big') ||
                  document.getElementById('map_container') ||
                  document.querySelector('#map canvas') ||
                  document.getElementById('map');
      if (mapEl) {
        this._captureMapEl = mapEl;
        this._mapClickListener = function(e) {
          if (!self._capturing) return;

          // Prevent the default map click behaviour (e.g. opening village info)
          e.stopPropagation();
          e.preventDefault();

          // Calculate map coordinates from the click position.
          // Prefer TWMap.map.coordByEvent / coordByPixel if available (uses TW's
          // own conversion which handles zoom, offset, and viewport correctly).
          // Otherwise fall back to manual calculation using TWMap.pos.
          var cx, cy;

          if (TWMap.map && typeof TWMap.map.coordByEvent === 'function') {
            // TW's own pixel-to-coord conversion (most reliable)
            var coord = TWMap.map.coordByEvent(e);
            cx = coord[0];
            cy = coord[1];
          } else {
            // Fallback: manual calculation
            var fieldSize = 53; // default TW field pixel size
            if (TWMap.map && TWMap.map.scale) {
              // scale is an array indexed by zoom level; zoom may be undefined
              // on some worlds, so fall back to scale[0] (default zoom)
              var zoom = (typeof TWMap.map.zoom === 'number') ? TWMap.map.zoom : 0;
              fieldSize = TWMap.map.scale[zoom] || TWMap.map.scale[0] || 53;
            }

            var rect = mapEl.getBoundingClientRect();
            var pixelX = e.clientX - rect.left;
            var pixelY = e.clientY - rect.top;

            var centerX = 500;
            var centerY = 500;
            if (TWMap.pos) {
              centerX = TWMap.pos[0];
              centerY = TWMap.pos[1];
            }

            cx = Math.floor(centerX + (pixelX - rect.width / 2) / fieldSize);
            cy = Math.floor(centerY + (pixelY - rect.height / 2) / fieldSize);
          }

          self._toggleCoord(cx, cy);
        };

        mapEl.addEventListener('click', this._mapClickListener, true);
        TWTools.UI.toast('Capture mode ON — click map to collect coords', 'success');
      } else {
        TWTools.UI.toast('Cannot find map element — capture unavailable', 'warning');
        this._capturing = false;
      }
    },

    /**
     * Stop capturing map clicks.
     * @private
     */
    _stopCapture: function() {
      this._capturing = false;

      var mapEl = this._captureMapEl ||
                  document.getElementById('map_big') ||
                  document.getElementById('map_container') ||
                  document.querySelector('#map canvas') ||
                  document.getElementById('map');
      if (mapEl && this._mapClickListener) {
        mapEl.removeEventListener('click', this._mapClickListener, true);
        this._mapClickListener = null;
      }
      this._captureMapEl = null;

      TWTools.UI.toast('Capture mode OFF', 'success');
    },

    /**
     * Toggle a coordinate in the collected list.
     * @param {number} x - X coordinate.
     * @param {number} y - Y coordinate.
     * @private
     */
    _toggleCoord: function(x, y) {
      // Check if already collected
      for (var i = 0; i < this._collected.length; i++) {
        if (this._collected[i].x === x && this._collected[i].y === y) {
          // Remove it
          this._collected.splice(i, 1);
          TWTools.UI.toast('Removed ' + x + '|' + y, 'warning');
          this._updateOutput();
          return;
        }
      }

      // Add it
      this._collected.push({x: x, y: y});
      TWTools.UI.toast('Added ' + x + '|' + y, 'success');
      this._updateOutput();
    },

    /**
     * Update the output textarea based on current format setting.
     * @private
     */
    _updateOutput: function() {
      var $output = $('#' + ID_PREFIX + 'coord-output');
      if (!$output.length) return;

      if (this._collected.length === 0) {
        $output.val('');
        return;
      }

      var lines = [];
      var format = Settings.coordFormat || 'bbcode';

      for (var i = 0; i < this._collected.length; i++) {
        var c = this._collected[i];
        if (format === 'bbcode') {
          lines.push('[coord]' + c.x + '|' + c.y + '[/coord]');
        } else if (format === 'claim') {
          lines.push(c.x + '|' + c.y + ' — claimed');
        } else {
          lines.push(c.x + '|' + c.y);
        }
      }

      $output.val(lines.join('\n'));
    },

    /**
     * Clean up capture listeners on destroy.
     */
    destroy: function() {
      if (this._capturing) {
        this._stopCapture();
      }
    }
  };

  // ============================================================
  // WATCHTOWER TAB
  // ============================================================

  var Watchtower = {
    /**
     * Render the watchtower planner tab.
     * @param {jQuery} $panel - Tab panel jQuery element.
     */
    render: function($panel) {
      var html =
        '<div style="margin-bottom:6px;">' +
          '<b style="font-size:11px;">Watchtower Range Planner</b><br>' +
          '<span style="font-size:10px;color:#7a6840;">Add village coords + watchtower level to visualize detection coverage.</span><br><br>' +
          '<table style="width:100%;font-size:10px;">' +
            '<tr>' +
              '<td>Village:</td>' +
              '<td>' + buildInput('wt-coords', 'text', '', {placeholder: '500|500', style: 'width:80px;padding:1px 3px;font-size:10px;border:1px solid #c0a060;background:#fff8e8;'}) +
              ' ' + buildButton('wt-use-current', 'Current') + '</td>' +
            '</tr>' +
            '<tr>' +
              '<td>WT Level:</td>' +
              '<td>' + buildInput('wt-level', 'number', '1', {min: '1', max: '20', style: 'width:50px;padding:1px 3px;font-size:10px;border:1px solid #c0a060;background:#fff8e8;'}) + '</td>' +
            '</tr>' +
          '</table>' +
          buildButton('wt-add', 'Add Village') + ' ' +
          buildButton('wt-clear', 'Clear All') + ' ' +
          buildButton('wt-draw', 'Draw on Map') +
        '</div>' +
        '<div id="' + ID_PREFIX + 'wt-list" style="margin-bottom:6px;"></div>' +
        '<div id="' + ID_PREFIX + 'wt-coverage" style="font-size:10px;"></div>';

      $panel.html(html);
      this._bindEvents($panel);
      this._renderList($panel);
    },

    /**
     * Bind events for watchtower tab.
     * @param {jQuery} $panel - Tab panel.
     * @private
     */
    _bindEvents: function($panel) {
      var self = this;

      $panel.on('click', '#' + ID_PREFIX + 'wt-use-current', function() {
        var coords = getCurrentVillageCoords();
        if (coords) {
          $('#' + ID_PREFIX + 'wt-coords').val(coords.x + '|' + coords.y);
        }
      });

      $panel.on('click', '#' + ID_PREFIX + 'wt-add', function() {
        self._addEntry($panel);
      });

      $panel.on('click', '#' + ID_PREFIX + 'wt-clear', function() {
        Settings.wtEntries = [];
        Settings.save();
        self._renderList($panel);
      });

      $panel.on('click', '#' + ID_PREFIX + 'wt-draw', function() {
        self._drawOnMap();
      });

      $panel.on('click', '.twmt-wt-remove', function() {
        var idx = parseInt($(this).attr('data-idx'), 10);
        if (!isNaN(idx) && idx >= 0 && idx < Settings.wtEntries.length) {
          Settings.wtEntries.splice(idx, 1);
          Settings.save();
          self._renderList($panel);
        }
      });
    },

    /**
     * Add a watchtower entry from the input fields.
     * @param {jQuery} $panel - Tab panel.
     * @private
     */
    _addEntry: function($panel) {
      var coordStr = $('#' + ID_PREFIX + 'wt-coords').val();
      var level = parseInt($('#' + ID_PREFIX + 'wt-level').val(), 10);

      var coords = TWTools.parseCoords(coordStr);
      if (!coords) {
        TWTools.UI.toast('Invalid coordinates. Use format: 500|500', 'error');
        return;
      }

      if (!level || level < 1 || level > 20) {
        TWTools.UI.toast('Watchtower level must be 1-20', 'error');
        return;
      }

      Settings.wtEntries.push({
        x: coords.x,
        y: coords.y,
        level: level
      });
      Settings.save();

      // Clear inputs
      $('#' + ID_PREFIX + 'wt-coords').val('');
      $('#' + ID_PREFIX + 'wt-level').val('1');

      this._renderList($panel);
    },

    /**
     * Render the watchtower entries table.
     * @param {jQuery} $panel - Tab panel.
     * @private
     */
    _renderList: function($panel) {
      var $list = $panel.find('#' + ID_PREFIX + 'wt-list');
      var $coverage = $panel.find('#' + ID_PREFIX + 'wt-coverage');

      if (Settings.wtEntries.length === 0) {
        $list.html('<p style="font-size:10px;color:#8a6a40;">No villages added. Add a village with watchtower level above.</p>');
        $coverage.empty();
        return;
      }

      var table = '<table class="vis" style="width:100%;">' +
        '<tr><th>#</th><th>Village</th><th>WT Level</th><th>Range (fields)</th><th>Action</th></tr>';

      for (var i = 0; i < Settings.wtEntries.length; i++) {
        var entry = Settings.wtEntries[i];
        var range = WT_RANGES[entry.level] || 0;

        table += '<tr>' +
          '<td>' + (i + 1) + '</td>' +
          '<td>' + entry.x + '|' + entry.y + '</td>' +
          '<td>' + entry.level + '</td>' +
          '<td>' + range.toFixed(1) + '</td>' +
          '<td><input type="button" class="btn twmt-wt-remove" data-idx="' + i + '" value="Remove" style="font-size:9px;padding:1px 4px;cursor:pointer;"></td>' +
          '</tr>';
      }

      table += '</table>';
      $list.html(table);

      // Build coverage matrix
      this._buildCoverageMatrix($coverage);
    },

    /**
     * Build a text-based coverage matrix showing watchtower overlaps.
     * @param {jQuery} $coverage - Coverage display element.
     * @private
     */
    _buildCoverageMatrix: function($coverage) {
      if (Settings.wtEntries.length < 2) {
        $coverage.empty();
        return;
      }

      var html = '<b>Coverage Overlap Matrix:</b><br>' +
        '<table class="vis" style="width:100%;margin-top:4px;">' +
        '<tr><th></th>';

      // Headers
      for (var i = 0; i < Settings.wtEntries.length; i++) {
        var e = Settings.wtEntries[i];
        html += '<th style="font-size:9px;">' + e.x + '|' + e.y + '</th>';
      }
      html += '</tr>';

      // Rows
      for (var r = 0; r < Settings.wtEntries.length; r++) {
        var re = Settings.wtEntries[r];
        var rRange = WT_RANGES[re.level] || 0;
        html += '<tr><td style="font-size:9px;font-weight:bold;">' + re.x + '|' + re.y + '</td>';

        for (var c = 0; c < Settings.wtEntries.length; c++) {
          if (r === c) {
            html += '<td style="background:#ddd;text-align:center;">-</td>';
            continue;
          }

          var ce = Settings.wtEntries[c];
          var cRange = WT_RANGES[ce.level] || 0;
          var dist = TWTools.distance({x: re.x, y: re.y}, {x: ce.x, y: ce.y});

          // Check if villages are within each other's range
          var rCovers = dist <= rRange;
          var cCovers = dist <= cRange;
          var gap = dist - rRange - cRange;

          var cellColor = '';
          var cellText = '';

          if (gap <= 0) {
            // Ranges overlap or touch
            cellColor = 'background:#c0e8c0;';
            cellText = 'Covered (' + dist.toFixed(1) + ')';
          } else {
            // Gap between ranges
            cellColor = 'background:#f8d0d0;';
            cellText = 'Gap: ' + gap.toFixed(1) + ' (' + dist.toFixed(1) + ')';
          }

          html += '<td style="font-size:9px;text-align:center;' + cellColor + '">' + cellText + '</td>';
        }

        html += '</tr>';
      }

      html += '</table>';

      // Detection range reference table
      html += '<br><b>Watchtower Range Reference:</b><br>' +
        '<table class="vis" style="width:100%;margin-top:4px;">' +
        '<tr><th>Level</th><th>Range</th><th>Level</th><th>Range</th><th>Level</th><th>Range</th><th>Level</th><th>Range</th></tr>';

      for (var lvl = 1; lvl <= 20; lvl += 4) {
        html += '<tr>';
        for (var col = 0; col < 4; col++) {
          var l = lvl + col;
          if (l <= 20) {
            html += '<td>L' + l + '</td><td>' + WT_RANGES[l].toFixed(1) + '</td>';
          } else {
            html += '<td></td><td></td>';
          }
        }
        html += '</tr>';
      }
      html += '</table>';

      $coverage.html(html);
    },

    /**
     * Draw watchtower ranges on the map using canvas overlay or sector highlights.
     * @private
     */
    _drawOnMap: function() {
      if (Settings.wtEntries.length === 0) {
        TWTools.UI.toast('No watchtower entries to draw', 'warning');
        return;
      }

      if (typeof TWMap === 'undefined') {
        TWTools.UI.toast('Map not available — open map page first', 'warning');
        return;
      }

      // Try to use TWMap's built-in sector highlight
      if (TWMap.mapHandler && typeof TWMap.mapHandler.addSectorHighlight === 'function') {
        for (var i = 0; i < Settings.wtEntries.length; i++) {
          var entry = Settings.wtEntries[i];
          var range = WT_RANGES[entry.level] || 0;

          // Highlight sectors within range
          var minX = Math.floor(entry.x - range);
          var maxX = Math.ceil(entry.x + range);
          var minY = Math.floor(entry.y - range);
          var maxY = Math.ceil(entry.y + range);

          for (var sx = minX; sx <= maxX; sx++) {
            for (var sy = minY; sy <= maxY; sy++) {
              var d = TWTools.distance({x: entry.x, y: entry.y}, {x: sx, y: sy});
              if (d <= range) {
                try {
                  TWMap.mapHandler.addSectorHighlight(sx, sy, 'rgba(0,200,0,0.25)');
                } catch (e) {
                  // Some map implementations may not support this
                }
              }
            }
          }
        }
        TWTools.UI.toast('Watchtower ranges drawn on map', 'success');
        return;
      }

      // Fallback: try custom canvas overlay
      this._drawCanvasOverlay();
    },

    /**
     * Draw watchtower ranges using a custom canvas overlay on the map.
     * @private
     */
    _drawCanvasOverlay: function() {
      // Find the map canvas or container
      var mapCanvas = document.getElementById('map_canvas');
      if (!mapCanvas) {
        TWTools.UI.toast('Cannot draw overlay — map canvas not found. Check the coverage table instead.', 'warning');
        return;
      }

      // Remove previous overlay
      var existing = document.getElementById(ID_PREFIX + 'wt-overlay');
      if (existing) {
        existing.parentNode.removeChild(existing);
      }

      var overlay = document.createElement('canvas');
      overlay.id = ID_PREFIX + 'wt-overlay';
      overlay.width = mapCanvas.width;
      overlay.height = mapCanvas.height;
      overlay.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:100;';

      mapCanvas.parentNode.style.position = 'relative';
      mapCanvas.parentNode.appendChild(overlay);

      var ctx = overlay.getContext('2d');

      // Get map view parameters
      var fieldSize = 53; // default TW field size in pixels
      if (TWMap.map && TWMap.map.scale) {
        var zoom = (typeof TWMap.map.zoom === 'number') ? TWMap.map.zoom : 0;
        fieldSize = TWMap.map.scale[zoom] || TWMap.map.scale[0] || 53;
      }

      var centerX = 0;
      var centerY = 0;
      if (TWMap.map) {
        centerX = TWMap.map.pos ? TWMap.map.pos[0] : 500;
        centerY = TWMap.map.pos ? TWMap.map.pos[1] : 500;
      }

      // Draw circles for each watchtower
      for (var i = 0; i < Settings.wtEntries.length; i++) {
        var entry = Settings.wtEntries[i];
        var range = WT_RANGES[entry.level] || 0;

        // Convert world coords to canvas coords
        var pixelX = (entry.x - centerX) * fieldSize + (overlay.width / 2);
        var pixelY = (entry.y - centerY) * fieldSize + (overlay.height / 2);
        var pixelRadius = range * fieldSize;

        ctx.beginPath();
        ctx.arc(pixelX, pixelY, pixelRadius, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(0, 200, 0, 0.15)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 150, 0, 0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Label
        ctx.fillStyle = '#1a5a1a';
        ctx.font = 'bold 10px Verdana, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('L' + entry.level + ' (' + range.toFixed(1) + ')', pixelX, pixelY - pixelRadius - 4);
        ctx.fillText(entry.x + '|' + entry.y, pixelX, pixelY + 4);
      }

      TWTools.UI.toast('Watchtower ranges drawn on map overlay', 'success');
    }
  };

  // ============================================================
  // MAIN CARD
  // ============================================================

  var card = null;

  /**
   * Check whether the current world has the watchtower building enabled.
   * Uses multiple detection methods for reliability.
   * @returns {boolean} True if watchtower is available on this world.
   */
  function hasWatchtower() {
    // Method 1: Check game_data.features (must be active or possible, not just key exists)
    if (typeof game_data !== 'undefined') {
      if (game_data.features && game_data.features.Watchtower &&
          (game_data.features.Watchtower.active || game_data.features.Watchtower.possible)) {
        return true;
      }
      // Method 2: Check village building data (level must be > 0, not just key exists)
      if (game_data.village && game_data.village.buildings &&
          game_data.village.buildings.watchtower > 0) {
        return true;
      }
    }
    // Method 3: Check if watchtower building exists in DOM
    // ONLY match actual building elements — do NOT use img[src*="watchtower"]
    // because map topo_image tile URLs contain "watchtower=0" as a query
    // parameter even on worlds without watchtower, causing false positives.
    // Also avoid [data-building="watchtower"] on build menus (level 0 buildings).
    if (typeof $ !== 'undefined' &&
        $('.building_watchtower[data-level]:not([data-level="0"])').length > 0) {
      return true;
    }
    // Method 4: Check cached world config from DataFetcher
    if (typeof TWTools !== 'undefined' && TWTools.DataFetcher && TWTools.DataFetcher._worldConfig) {
      var cfg = TWTools.DataFetcher._worldConfig;
      if (cfg.watchtower > 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * Initialize and show the Map Tools card.
   */
  function init() {
    // Verify dependencies
    if (typeof window.TWTools === 'undefined') {
      alert('[TW Map Tools] Error: TWTools core library not loaded.');
      return;
    }
    if (!TWTools.UI || !TWTools.UI.createCard) {
      alert('[TW Map Tools] Error: TWTools UI library not loaded.');
      return;
    }

    // Initialize TimeSync
    TWTools.TimeSync.init();

    // Load settings
    Settings.load();

    // Destroy existing card if any
    if (card) {
      card.destroy();
      card = null;
    }

    // Build tabs — watchtower tab only appears on worlds that have the building
    var tabs = [
      {id: 'barbs', label: 'Barb Finder'},
      {id: 'bonus', label: 'Bonus Finder'},
      {id: 'coords', label: 'Coordinates'}
    ];
    if (hasWatchtower()) {
      tabs.push({id: 'watchtower', label: 'Watchtower'});
    }

    // Create the floating card
    card = TWTools.UI.createCard({
      id: 'map-tools',
      title: 'TW Map Tools',
      version: VERSION,
      width: 520,
      height: 560,
      minWidth: 400,
      minHeight: 300,
      tabs: tabs,
      onTabChange: function(tabId) {
        // Lazy-render tabs on first activation
        var $panel = card.getTabContent(tabId);
        if ($panel.children().length === 0) {
          renderTab(tabId, $panel);
        }
      },
      onClose: function() {
        Coordinates.destroy();
        card = null;
      }
    });

    // Render the first tab immediately
    var $firstPanel = card.getTabContent('barbs');
    BarbFinder.render($firstPanel);

    card.setStatus('TW Map Tools v' + VERSION + ' | Ready');
  }

  /**
   * Render a specific tab panel.
   * @param {string} tabId - Tab identifier.
   * @param {jQuery} $panel - Tab panel jQuery element.
   */
  function renderTab(tabId, $panel) {
    switch (tabId) {
      case 'barbs':
        BarbFinder.render($panel);
        break;
      case 'bonus':
        BonusFinder.render($panel);
        break;
      case 'coords':
        Coordinates.render($panel);
        break;
      case 'watchtower':
        Watchtower.render($panel);
        break;
    }
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, jQuery);
