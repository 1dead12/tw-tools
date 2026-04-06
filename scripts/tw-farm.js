/**
 * TW Farm v3.0.0 — Native Farm Assistant integration.
 * Plan table injected before #am_widget_Farm, one-click-per-farm using
 * TribalWars.post() and Accountmanager API. Settings via Dialog.show().
 *
 * @version 3.0.0
 * @requires jQuery, TribalWars game env, window.TWTools (tw-core.js, tw-ui.js)
 */
;(function(window, $) {
  'use strict';

  if (!window.TWTools || !window.TWTools.UI) {
    throw new Error('tw-farm.js requires tw-core.js and tw-ui.js');
  }

  var TWTools = window.TWTools;
  var VERSION = '3.0.0';
  var STORAGE_PREFIX = 'twf_';
  var LC_SPEED = 10;
  var LC_CARRY = 80;
  var DEFAULT_SETTINGS = {
    groupId: '0', maxDistance: 20, cooldownMinutes: 5, minLC: 5, useBForMaxLoot: true
  };
  var LOOT = { GREEN: 'green', YELLOW: 'yellow', RED: 'red', UNKNOWN: 'unknown' };

  // ---- Storage wrapper ----
  var Store = {
    get: function(k, fb) { var v = TWTools.Storage.get(STORAGE_PREFIX + k); return v !== null ? v : fb; },
    set: function(k, v) { TWTools.Storage.set(STORAGE_PREFIX + k, v); }
  };

  // ---- Settings ----
  var settings = {};
  function loadSettings() { settings = $.extend(true, {}, DEFAULT_SETTINGS, Store.get('settings', null) || {}); }
  function saveSettings() { Store.set('settings', settings); }

  // ---- State ----
  var sourceVillages = [], farmTargets = [], outgoingAttacks = [], farmPlan = [];
  var availableGroups = [{ id: '0', name: 'All villages' }];
  var isScanning = false, isFarming = false;
  var csrfToken = '', sendUnitsLink = '';
  var realTemplateA = null, realTemplateB = null;
  var farmSentCount = 0, farmErrorCount = 0, enterKeyBound = false;

  // ---- Format helpers ----
  function formatNum(n) { return (typeof n !== 'number' || isNaN(n)) ? '0' : n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function pInt(text) { return parseInt((text || '').replace(/\./g, '').replace(/[^\d-]/g, ''), 10) || 0; }
  function esc(s) { return !s ? '' : s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmtDist(d) { return d.toFixed(1); }
  function fmtTravel(ms) {
    var t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return h > 0 ? h + 'h ' + m + 'm' : m > 0 ? m + 'm ' + s + 's' : s + 's';
  }
  function fmtTime(ms) {
    var t = Math.floor(ms / 1000), h = Math.floor(t / 3600) % 24, m = Math.floor((t % 3600) / 60), s = t % 60;
    return TWTools.pad2(h) + ':' + TWTools.pad2(m) + ':' + TWTools.pad2(s);
  }

  // ============================================================
  // DATA FETCHING — SOURCE VILLAGES
  // ============================================================

  function fetchSourceVillages(callback, statusCb) {
    var groupParam = (settings.groupId && settings.groupId !== '0') ? '&group=' + settings.groupId : '';
    var all = [], page = 0;
    if (statusCb) statusCb('Fetching source villages...');

    (function fetchPage() {
      var url = '/game.php?village=' + TWTools.getVillageId() +
        '&screen=overview_villages&mode=units&type=own_home' + groupParam + '&page=' + page;
      $.ajax({ url: url, dataType: 'html', timeout: 15000,
        success: function(html) {
          var r = parseSourceVillages(html);
          all = all.concat(r.villages);
          if (statusCb) statusCb('Sources: page ' + (page + 1) + ' (' + all.length + ' villages)...');
          if (r.hasNextPage) { page++; setTimeout(fetchPage, 200); }
          else callback(all);
        },
        error: function() { if (statusCb) statusCb('Error fetching sources.'); callback(all); }
      });
    })();
  }

  function parseSourceVillages(html) {
    var $p = $('<div/>').html(html), villages = [];
    var $t = $p.find('#units_table, table.vis.overview_table');
    if (!$t.length) $t = $p.find('table.vis').filter(function() { return $(this).find('tr').length > 2; }).first();
    if (!$t.length) return { villages: [], hasNextPage: false };

    var lcCol = -1;
    $t.find('tr:first th, thead th').each(function(idx) {
      if ($(this).find('img[src*="unit_light"]').length) { lcCol = idx; return false; }
      var txt = $.trim($(this).text()).toLowerCase();
      if (txt === 'light' || txt === 'lc' || txt === 'lk') { lcCol = idx; return false; }
    });

    $t.find('tbody tr, tr').not(':first').each(function() {
      var $r = $(this), $c = $r.find('td');
      if ($c.length < 3) return;
      var $vl = $();
      $r.find('a[href*="village="]').each(function() {
        if ($.trim($(this).text()).match(/\(\d{1,3}\|\d{1,3}\)/)) { $vl = $(this); return false; }
      });
      if (!$vl.length) return;
      var href = $vl.attr('href') || '', vm = href.match(/village=(\d+)/);
      if (!vm) return;
      var lt = $.trim($vl.text()), cm = lt.match(/\((\d{1,3}\|\d{1,3})\)/);
      var coords = cm ? cm[1] : '', name = lt.replace(/\s*\(\d{1,3}\|\d{1,3}\)\s*K?\d*\s*$/, '').trim();
      var lc = (lcCol >= 0 && lcCol < $c.length) ? pInt($c.eq(lcCol).text()) : 0;
      var parsed = TWTools.parseCoords(coords);
      if (!parsed) return;
      villages.push({ id: parseInt(vm[1], 10), name: name || ('Village ' + coords), coords: coords,
        coordsParsed: parsed, lcAvailable: lc, lcTotal: lc, targetsInRange: 0, status: 'ready' });
    });

    var hasNext = false;
    $p.find('a.paged-nav-item, a[href*="page="]').each(function() {
      var txt = $.trim($(this).text());
      if (txt === '>>' || txt === '>' || /next|Dopredu/i.test(txt)) { hasNext = true; return false; }
    });
    return { villages: villages, hasNextPage: hasNext };
  }

  // ============================================================
  // DATA FETCHING — OUTGOING ATTACKS
  // ============================================================

  function fetchOutgoingAttacks(callback, statusCb) {
    if (statusCb) statusCb('Fetching outgoing attacks...');
    var attacks = [], page = 0;

    (function fetchPage() {
      var url = '/game.php?village=' + TWTools.getVillageId() +
        '&screen=overview_villages&mode=commands&type=attack&page=' + page;
      $.ajax({ url: url, dataType: 'html', timeout: 15000,
        success: function(html) {
          var r = parseOutgoingAttacks(html);
          attacks = attacks.concat(r.attacks);
          if (r.hasNextPage) { page++; setTimeout(fetchPage, 200); }
          else callback(attacks);
        },
        error: function() { if (statusCb) statusCb('Error fetching commands.'); callback([]); }
      });
    })();
  }

  function parseOutgoingAttacks(html) {
    var $p = $('<div/>').html(html), attacks = [];
    var $t = $p.find('#commands_table, table.vis.overview_table');
    if (!$t.length) $t = $p.find('table.vis').filter(function() { return $(this).find('tr').length > 2; }).first();
    if (!$t.length) return { attacks: [], hasNextPage: false };

    $t.find('tbody tr, tr').not(':first').each(function() {
      var $r = $(this), $c = $r.find('td');
      if ($c.length < 3) return;
      var tgtCoords = '', srcId = 0, arrText = '';
      $r.find('a[href*="village="]').each(function() {
        var cm = $.trim($(this).text()).match(/\((\d{1,3}\|\d{1,3})\)/);
        if (cm) tgtCoords = cm[1];
      });
      var $sl = $r.find('a[href*="village="]').first();
      if ($sl.length) { var sm = ($sl.attr('href') || '').match(/village=(\d+)/); if (sm) srcId = parseInt(sm[1], 10); }
      $c.each(function() { var ct = $.trim($(this).text()); if (ct.match(/\d{1,2}:\d{2}:\d{2}/)) arrText = ct; });
      if (tgtCoords && arrText) {
        var ms = TWTools.parseArrivalTime(arrText);
        if (ms !== null) attacks.push({ targetCoords: tgtCoords, arrivalMs: ms, sourceId: srcId });
      }
    });

    var hasNext = false;
    $p.find('a.paged-nav-item, a[href*="page="]').each(function() {
      var txt = $.trim($(this).text());
      if (txt === '>>' || txt === '>' || /next|Dopredu/i.test(txt)) { hasNext = true; return false; }
    });
    return { attacks: attacks, hasNextPage: hasNext };
  }

  // ============================================================
  // DATA FETCHING — FARM TARGETS
  // ============================================================

  function readAccountmanagerGlobals() {
    try {
      if (typeof Accountmanager !== 'undefined' && Accountmanager.farm && Accountmanager.farm.templates) {
        var keys = Object.keys(Accountmanager.farm.templates).filter(function(k) { return k.indexOf('t_') === 0; }).sort();
        if (keys.length >= 1) realTemplateA = parseInt(keys[0].replace('t_', ''), 10);
        if (keys.length >= 2) realTemplateB = parseInt(keys[1].replace('t_', ''), 10);
      }
    } catch (e) {}
    try { if (typeof Accountmanager !== 'undefined' && Accountmanager.send_units_link) sendUnitsLink = Accountmanager.send_units_link; } catch (e) {}
    if (typeof game_data !== 'undefined' && game_data.csrf) csrfToken = game_data.csrf;
  }

  function fetchFarmTargets(callback, statusCb) {
    if (statusCb) statusCb('Reading farm targets...');
    readAccountmanagerGlobals();

    // Parse from live DOM (page 0)
    var domHtml = document.getElementById('contentContainer')
      ? document.getElementById('contentContainer').innerHTML : document.body.innerHTML;
    var r0 = parseFarmTargets(domHtml);
    var targets = r0.targets;
    if (r0.csrf && !csrfToken) csrfToken = r0.csrf;
    if (r0.sendLink && !sendUnitsLink) sendUnitsLink = r0.sendLink;
    if (statusCb) statusCb('Farm targets: page 1 (' + targets.length + ' targets)...');

    if (!r0.hasNextPage) { callback(targets); return; }

    var page = 1;
    (function fetchNext() {
      var url = '/game.php?village=' + TWTools.getVillageId() + '&screen=am_farm&Farm_page=' + page;
      $.ajax({ url: url, dataType: 'html', timeout: 15000,
        success: function(html) {
          var rp = parseFarmTargets(html);
          targets = targets.concat(rp.targets);
          if (statusCb) statusCb('Farm targets: page ' + (page + 1) + ' (' + targets.length + ')...');
          if (rp.hasNextPage) { page++; setTimeout(fetchNext, 200); } else callback(targets);
        },
        error: function() { callback(targets); }
      });
    })();
  }

  function parseFarmTargets(html) {
    var $p = $('<div/>').html(html), targets = [], csrf = '', sendLink = '';

    // CSRF
    if (typeof game_data !== 'undefined' && game_data.csrf) csrf = game_data.csrf;
    $p.find('form[action*="am_farm"]').each(function() {
      var hm = ($(this).attr('action') || '').match(/[&?]h=([a-f0-9]+)/);
      if (hm) csrf = hm[1];
    });
    if (!csrf) $p.find('a[href*="am_farm"][href*="h="]').first().each(function() {
      var hm = ($(this).attr('href') || '').match(/[&?]h=([a-f0-9]+)/); if (hm) csrf = hm[1];
    });

    // Template IDs from HTML fallback
    var hs = typeof html === 'string' ? html : '';
    if (realTemplateA === null) {
      var mA = hs.match(/farm_icon_a[^>]*sendUnits\(\s*this\s*,\s*\d+\s*,\s*(\d+)\s*\)/);
      if (mA) realTemplateA = parseInt(mA[1], 10);
      if (realTemplateA === null) { var ms = hs.match(/templates\['t_(\d+)'\]/); if (ms) realTemplateA = parseInt(ms[1], 10); }
    }
    if (realTemplateB === null) {
      var mB = hs.match(/farm_icon_b[^>]*sendUnits\(\s*this\s*,\s*\d+\s*,\s*(\d+)\s*\)/);
      if (mB) realTemplateB = parseInt(mB[1], 10);
    }

    // send_units_link from script blocks
    if (!sendLink) {
      var slm = hs.match(/Accountmanager\.send_units_link\s*=\s*'([^']+)'/) || hs.match(/send_units_link\s*[=:]\s*['"]([^'"]+)['"]/);
      if (slm) sendLink = slm[1];
    }

    // Parse #plunder_list
    var $pt = $p.find('#plunder_list');
    if (!$pt.length) $pt = $p.find('table.vis').filter(function() {
      return $(this).find('.farm_icon, .farm_icon_a, .farm_icon_b').length > 0;
    }).first();

    if ($pt.length) {
      var todayWords = TWTools.DATE_WORDS ? TWTools.DATE_WORDS.today : ['dnes', 'today'];

      $pt.find('tr[id], tr.row_a, tr.row_b, tbody tr').each(function() {
        var $r = $(this), $c = $r.find('td');
        if ($c.length < 3) return;

        var tId = 0, tCoords = '', player = '', loot = LOOT.UNKNOWN, maxLoot = false, wall = 0;

        // Row ID: "farm_row_XXXXX"
        var rm = ($r.attr('id') || '').match(/(\d+)/);
        if (rm) tId = parseInt(rm[1], 10);

        $r.find('a[href*="info_village"]').each(function() {
          var cm = $.trim($(this).text()).match(/(\d{1,3}\|\d{1,3})/);
          if (cm) tCoords = cm[1];
          if (!tId) { var vm = ($(this).attr('href') || '').match(/id=(\d+)/); if (vm) tId = parseInt(vm[1], 10); }
        });
        if (!tCoords) $c.each(function() { var cm = $.trim($(this).text()).match(/(\d{1,3}\|\d{1,3})/); if (cm && !tCoords) tCoords = cm[1]; });

        $r.find('a[href*="info_player"]').each(function() { player = $.trim($(this).text()); });

        // Loot status
        var $ri = $r.find('img[src*="dots"], img[src*="report"]');
        if ($ri.length) {
          var src = $ri.attr('src') || '';
          if (src.indexOf('green') !== -1) loot = LOOT.GREEN;
          else if (src.indexOf('yellow') !== -1) loot = LOOT.YELLOW;
          else if (src.indexOf('red') !== -1) loot = LOOT.RED;
        }
        var $sc = $r.find('.report-status, [class*="dot"]');
        if ($sc.length) {
          var cls = $sc.attr('class') || '';
          if (cls.indexOf('green') !== -1) loot = LOOT.GREEN;
          else if (cls.indexOf('yellow') !== -1) loot = LOOT.YELLOW;
          else if (cls.indexOf('red') !== -1) loot = LOOT.RED;
        }
        if ($r.find('img[src*="max_loot"], img[src*="haul"]').length) maxLoot = true;

        // Last report time
        var lastMs = 0;
        $c.each(function() {
          var txt = $.trim($(this).text());
          for (var w = 0; w < todayWords.length; w++) {
            var rgx = new RegExp(todayWords[w] + '\\s+(\\d{1,2}):(\\d{2}):(\\d{2})', 'i');
            var tm = txt.match(rgx);
            if (tm) { lastMs = (parseInt(tm[1], 10) * 3600 + parseInt(tm[2], 10) * 60 + parseInt(tm[3], 10)) * 1000; return false; }
          }
        });

        // Active attack check
        var $bA = $r.find('.farm_icon_a');
        var hasActive = $bA.length > 0 && ($bA.hasClass('done') || ($bA.hasClass('farm_icon_disabled') && !$bA.hasClass('start_locked')));

        // Wall
        $c.each(function() {
          var txt = $.trim($(this).text());
          if (txt.match(/^\d{1,2}$/) && !txt.match(/\|/)) { var w2 = parseInt(txt, 10); if (w2 <= 20 && w2 >= 0) wall = w2; }
        });

        if (tCoords) {
          var parsed = TWTools.parseCoords(tCoords);
          if (parsed) targets.push({ id: tId, coords: tCoords, coordsParsed: parsed, playerName: player,
            lootStatus: loot, maxLoot: maxLoot, wallLevel: wall, lastReportMs: lastMs, hasActiveAttack: hasActive, distance: 0 });
        }
      });
    }

    // Pagination
    var hasNext = false;
    $p.find('a[href*="Farm_page"]').each(function() {
      var txt = $.trim($(this).text()), href = $(this).attr('href') || '';
      if ((txt === '>>' || txt === '>' || /next|Dopredu/i.test(txt)) && href.match(/Farm_page=\d+/)) hasNext = true;
    });
    $p.find('.paged-nav-item').each(function() {
      var txt = $.trim($(this).text());
      if (txt === '>' || txt === '>>') { hasNext = true; return false; }
    });

    return { targets: targets, hasNextPage: hasNext, csrf: csrf, sendLink: sendLink };
  }

  // ============================================================
  // SCANNING
  // ============================================================

  function runScan(callback, statusCb) {
    if (isScanning) { TWTools.UI.toast('Scan already in progress...', 'warning'); return; }
    isScanning = true;
    if (typeof game_data !== 'undefined' && game_data.csrf) csrfToken = game_data.csrf;
    var done = 0;
    function check() {
      done++;
      if (statusCb) statusCb('Scanning... (' + done + '/3)');
      if (done < 3) return;
      isScanning = false;
      updateTargetsInRange();
      var totalLC = 0;
      for (var i = 0; i < sourceVillages.length; i++) totalLC += sourceVillages[i].lcAvailable || 0;
      if (statusCb) statusCb('Scanned: ' + sourceVillages.length + ' sources (' + totalLC + ' LC), ' +
        farmTargets.length + ' targets, ' + outgoingAttacks.length + ' outgoing.');
      callback();
    }
    fetchSourceVillages(function(v) { sourceVillages = v; check(); }, statusCb);
    fetchOutgoingAttacks(function(a) { outgoingAttacks = a; check(); }, statusCb);
    fetchFarmTargets(function(t) { farmTargets = t; check(); }, statusCb);
  }

  function updateTargetsInRange() {
    for (var i = 0; i < sourceVillages.length; i++) {
      var s = sourceVillages[i], c = 0;
      for (var j = 0; j < farmTargets.length; j++) {
        if (TWTools.distance(s.coordsParsed, farmTargets[j].coordsParsed) <= settings.maxDistance) c++;
      }
      s.targetsInRange = c;
    }
  }

  // ============================================================
  // PLANNING ENGINE
  // ============================================================

  function hasCollision(tgtCoords, estArrival) {
    var cdMs = settings.cooldownMinutes * 60000;
    for (var i = 0; i < outgoingAttacks.length; i++) {
      var a = outgoingAttacks[i];
      if (a.targetCoords === tgtCoords && Math.abs(a.arrivalMs - estArrival) < cdMs) return true;
    }
    return false;
  }

  function buildPlan(statusCb) {
    farmPlan = [];
    if (!sourceVillages.length) { if (statusCb) statusCb('No source villages.'); return farmPlan; }
    if (!farmTargets.length) { if (statusCb) statusCb('No farm targets.'); return farmPlan; }
    if (realTemplateA === null) {
      if (statusCb) statusCb('No templates configured!');
      TWTools.UI.toast('Set up Template A/B in Farm Assistant first.', 'error');
      return farmPlan;
    }

    var ws = 1, usf = 1;
    if (TWTools.DataFetcher._worldConfig) { ws = TWTools.DataFetcher._worldConfig.speed || 1; usf = TWTools.DataFetcher._worldConfig.unitSpeed || 1; }
    var planned = {}, lcPool = {}, nowMs = TWTools.TimeSync.now(), cdMs = settings.cooldownMinutes * 60000;
    for (var si = 0; si < sourceVillages.length; si++) lcPool[sourceVillages[si].id] = sourceVillages[si].lcAvailable;

    for (var i = 0; i < sourceVillages.length; i++) {
      var src = sourceVillages[i], byDist = [];
      for (var j = 0; j < farmTargets.length; j++) {
        var d = TWTools.distance(src.coordsParsed, farmTargets[j].coordsParsed);
        if (d <= settings.maxDistance) byDist.push({ target: farmTargets[j], distance: d });
      }
      byDist.sort(function(a, b) { return a.distance - b.distance; });

      for (var k = 0; k < byDist.length; k++) {
        if (lcPool[src.id] < settings.minLC) break;
        var tgt = byDist[k].target, dist = byDist[k].distance;
        var travelMs = TWTools.travelTime(dist, LC_SPEED, ws, usf), estArr = nowMs + travelMs;

        if (tgt.hasActiveAttack) continue;
        if (tgt.lastReportMs > 0) {
          var since = nowMs - tgt.lastReportMs; if (since < 0) since += 86400000;
          if (since < cdMs) continue;
        }
        if (hasCollision(tgt.coords, estArr)) continue;
        var pf = planned[tgt.coords] || [], selfHit = false;
        for (var p = 0; p < pf.length; p++) { if (Math.abs(pf[p] - estArr) < cdMs) { selfHit = true; break; } }
        if (selfHit) continue;

        var tmplId = realTemplateA, tmplLbl = 'A';
        if (settings.useBForMaxLoot && tgt.maxLoot && realTemplateB !== null) { tmplId = realTemplateB; tmplLbl = 'B'; }

        farmPlan.push({ sourceId: src.id, sourceName: src.name, sourceCoords: src.coords,
          targetId: tgt.id, targetCoords: tgt.coords, distance: dist,
          templateId: tmplId, templateLabel: tmplLbl, travelTimeMs: travelMs, estArrival: fmtTime(estArr) });

        if (!planned[tgt.coords]) planned[tgt.coords] = [];
        planned[tgt.coords].push(estArr);
        lcPool[src.id] -= settings.minLC;
      }
    }
    if (statusCb) statusCb('Plan: ' + farmPlan.length + ' attacks across ' + sourceVillages.length + ' villages.');
    return farmPlan;
  }

  // ============================================================
  // SETTINGS DIALOG — Dialog.show('TWFarm', html)
  // ============================================================

  function showSettingsDialog() {
    var grpOpts = '';
    for (var i = 0; i < availableGroups.length; i++) {
      grpOpts += '<option value="' + availableGroups[i].id + '"' +
        (settings.groupId === availableGroups[i].id ? ' selected' : '') + '>' +
        esc(availableGroups[i].name) + '</option>';
    }

    var h = '<div id="twf-dlg" style="padding:10px;min-width:320px;">' +
      '<h3 style="margin:0 0 10px;font-size:13px;">TW Farm v' + VERSION + '</h3>' +
      '<table class="vis" style="width:100%;">' +
      '<tr class="row_a"><td style="width:140px;"><b>Village Group</b></td><td>' +
        '<select id="twf-d-grp" style="font-size:11px;">' + grpOpts + '</select></td></tr>' +
      '<tr class="row_b"><td><b>Max Distance</b></td><td>' +
        '<input type="number" id="twf-d-dist" value="' + settings.maxDistance + '" style="width:50px;" min="1" max="100"> fields</td></tr>' +
      '<tr class="row_a"><td><b>Cooldown</b></td><td>' +
        '<input type="number" id="twf-d-cd" value="' + settings.cooldownMinutes + '" style="width:50px;" min="0" max="60"> min</td></tr>' +
      '<tr class="row_b"><td><b>Min LC/village</b></td><td>' +
        '<input type="number" id="twf-d-lc" value="' + settings.minLC + '" style="width:50px;" min="1" max="500"></td></tr>' +
      '<tr class="row_a"><td><b>Use B for max loot</b></td><td>' +
        '<input type="checkbox" id="twf-d-useb"' + (settings.useBForMaxLoot ? ' checked' : '') + '> ' +
        'Send Template B to full-haul targets</td></tr>' +
      '</table>' +
      '<div style="padding:6px;background:#f0e0b0;border:1px solid #c0a060;border-radius:3px;margin:10px 0;font-size:10px;">' +
        '<b>Templates:</b> A=' + (realTemplateA !== null ? realTemplateA : '<i>?</i>') +
        ', B=' + (realTemplateB !== null ? realTemplateB : '<i>?</i>') +
        ' | <b>Sources:</b> ' + sourceVillages.length +
        ' | <b>Targets:</b> ' + farmTargets.length +
      '</div>' +
      '<div style="text-align:center;">' +
        '<button class="btn" id="twf-d-save" style="margin-right:6px;">Save</button>' +
        '<button class="btn" id="twf-d-plan" style="font-weight:bold;padding:4px 16px;' +
          'background:linear-gradient(to bottom,#6a9c2a,#4a7a1e);color:#fff;border:1px solid #3e5a10;">' +
          'Scan &amp; Plan</button>' +
        '<button class="btn" id="twf-d-close" style="margin-left:6px;">Close</button>' +
      '</div></div>';

    Dialog.show('TWFarm', h);

    setTimeout(function() {
      $('#twf-d-save').on('click', function() { readDlgSettings(); saveSettings(); TWTools.UI.toast('Settings saved', 'success'); });
      $('#twf-d-plan').on('click', function() { readDlgSettings(); saveSettings(); Dialog.close(); startScanAndPlan(); });
      $('#twf-d-close').on('click', function() { Dialog.close(); });
    }, 50);
  }

  function readDlgSettings() {
    settings.groupId = $('#twf-d-grp').val() || '0';
    settings.maxDistance = parseInt($('#twf-d-dist').val(), 10) || 20;
    settings.cooldownMinutes = parseInt($('#twf-d-cd').val(), 10) || 5;
    settings.minLC = parseInt($('#twf-d-lc').val(), 10) || 5;
    settings.useBForMaxLoot = $('#twf-d-useb').is(':checked');
  }

  // ============================================================
  // SCAN + PLAN WORKFLOW
  // ============================================================

  function startScanAndPlan() {
    injectStatusBar('Scanning...');
    TWTools.DataFetcher.fetchWorldConfig(function() {
      runScan(function() {
        updateStatusBar('Building plan...');
        buildPlan(function(s) { updateStatusBar(s); });
        if (!farmPlan.length) {
          updateStatusBar('No attacks planned. Check settings or scan again.');
          setTimeout(removeStatusBar, 3000);
          return;
        }
        removeStatusBar();
        injectFarmTable();
      }, function(s) { updateStatusBar(s); });
    });
  }

  // ---- Status bar (temporary) ----
  function injectStatusBar(text) {
    removeStatusBar();
    var $bar = $('<div id="twf-sbar" style="padding:8px 12px;margin-bottom:8px;background:#f0e0b0;' +
      'border:1px solid #c0a060;border-radius:3px;font-size:11px;"><b>TW Farm:</b> <span id="twf-stxt">' + esc(text) + '</span></div>');
    var $w = $('#am_widget_Farm');
    $w.length ? $w.before($bar) : $('#contentContainer').prepend($bar);
  }
  function updateStatusBar(text) { var $t = $('#twf-stxt'); $t.length ? $t.html(esc(text)) : injectStatusBar(text); }
  function removeStatusBar() { $('#twf-sbar').remove(); }

  // ============================================================
  // FARM TABLE — injected before #am_widget_Farm
  // ============================================================

  function injectFarmTable() {
    removeFarmTable();
    isFarming = true; farmSentCount = 0; farmErrorCount = 0;
    var total = farmPlan.length;

    var h = '<div id="twf-fc">' +
      // Header
      '<div style="padding:6px 10px;background:linear-gradient(to bottom,#dac48c,#c1a264);' +
        'border:1px solid #804000;border-bottom:none;border-radius:3px 3px 0 0;' +
        'display:flex;align-items:center;justify-content:space-between;">' +
        '<span style="font-weight:bold;font-size:12px;">TW Farm v' + VERSION + '</span>' +
        '<span id="twf-ptxt" style="font-size:11px;">0 / ' + total + ' sent</span>' +
        '<button class="btn" id="twf-cancel">Cancel</button>' +
      '</div>' +
      // Progress bar
      '<div style="height:6px;background:#e8d8a8;border-left:1px solid #804000;border-right:1px solid #804000;">' +
        '<div id="twf-pbar" style="height:100%;width:0%;background:linear-gradient(to bottom,#6a9c2a,#4a7a1e);transition:width 0.3s;"></div>' +
      '</div>' +
      // Table
      '<table class="vis" id="twf-tbl" style="width:100%;border:1px solid #804000;">' +
      '<thead><tr>' +
        '<th style="width:30px;">#</th><th>Source</th><th>Target</th>' +
        '<th style="text-align:right;width:50px;">Dist</th>' +
        '<th style="text-align:right;width:60px;">Travel</th>' +
        '<th style="text-align:center;width:40px;">Send</th>' +
      '</tr></thead><tbody id="twf-tbody">';

    for (var i = 0; i < total; i++) {
      var pl = farmPlan[i], rc = i % 2 === 0 ? 'row_a' : 'row_b';
      var ic = pl.templateLabel === 'B' ? 'farm_icon_b' : 'farm_icon_a';
      h += '<tr class="' + rc + (i === 0 ? ' twf-act' : '') + '" id="twf-r-' + i + '" data-idx="' + i + '">' +
        '<td style="text-align:center;color:#7a6840;">' + (i + 1) + '</td>' +
        '<td>' + esc(pl.sourceName) + ' <span style="color:#7a6840;">(' + pl.sourceCoords + ')</span></td>' +
        '<td>(' + pl.targetCoords + ')</td>' +
        '<td style="text-align:right;">' + fmtDist(pl.distance) + '</td>' +
        '<td style="text-align:right;">' + fmtTravel(pl.travelTimeMs) + '</td>' +
        '<td style="text-align:center;">' +
          '<a class="farm_icon ' + ic + ' twf-si" data-idx="' + i + '" ' +
            'title="Send ' + pl.templateLabel + ': ' + pl.sourceCoords + ' -> ' + pl.targetCoords + '" ' +
            'style="cursor:pointer;display:inline-block;"></a></td></tr>';
    }

    h += '</tbody></table>' +
      '<div style="padding:4px 10px;background:#e8d8a8;border:1px solid #804000;border-top:none;' +
        'border-radius:0 0 3px 3px;font-size:10px;color:#5a4a2a;">' +
        '<span id="twf-sum">' + total + ' attacks planned. Click farm icon or press <b>Enter</b> to send.</span></div></div>';

    var $w = $('#am_widget_Farm');
    $w.length ? $w.before(h) : $('#contentContainer').prepend(h);

    var $fc = $('#twf-fc');
    if ($fc.length) $('html, body').animate({ scrollTop: $fc.offset().top - 10 }, 300);

    // Events
    $('#twf-tbl').on('click', '.twf-si', function(e) { e.preventDefault(); sendEntry(parseInt($(this).attr('data-idx'), 10)); });
    $('#twf-cancel').on('click', function() { finishFarming('Cancelled by user.'); });
    bindEnterKey();
    injectFarmCSS();
  }

  function injectFarmCSS() {
    if ($('#twf-css').length) return;
    $('<style id="twf-css">' +
      '.twf-act{background:#d4e8b0 !important}.twf-act td{font-weight:bold}' +
      '.twf-si{opacity:.9}.twf-si:hover{opacity:1;transform:scale(1.2)}.twf-sending{opacity:.5;pointer-events:none}' +
    '</style>').appendTo('head');
  }

  function removeFarmTable() { $('#twf-fc').remove(); unbindEnterKey(); }

  // ---- Enter key ----
  function bindEnterKey() {
    if (enterKeyBound) return; enterKeyBound = true;
    $(document).on('keydown.twfarm', function(e) {
      if (e.which !== 13 || !isFarming) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      e.preventDefault();
      var $fr = $('#twf-tbody tr:first');
      if ($fr.length) sendEntry(parseInt($fr.attr('data-idx'), 10));
    });
  }
  function unbindEnterKey() { if (!enterKeyBound) return; enterKeyBound = false; $(document).off('keydown.twfarm'); }

  // ============================================================
  // SEND FARM ENTRY
  // ============================================================

  function sendEntry(idx) {
    if (idx < 0 || idx >= farmPlan.length) return;
    var pl = farmPlan[idx], $r = $('#twf-r-' + idx);
    if (!$r.length || $r.hasClass('twf-sending')) return;
    $r.addClass('twf-sending');
    $r.find('.twf-si').css('opacity', '0.3');

    var url = sendUnitsLink;
    if (!url) {
      var csrf = csrfToken || (typeof game_data !== 'undefined' ? game_data.csrf : '');
      url = '/game.php?village=' + pl.sourceId + '&screen=am_farm&mode=farm&ajaxaction=farm&json=1&h=' + encodeURIComponent(csrf);
    }
    // Replace village= with source village ID (send_units_link has current page village)
    url = url.replace(/village=\d+/, 'village=' + pl.sourceId);

    // Farm Assistant POST uses: target, template_id, source (NOT source_village)
    var data = { target: pl.targetId, template_id: pl.templateId, source: pl.sourceId };

    // Use plain $.ajax for reliability — TribalWars.post can fail on cross-village sends
    // The h= CSRF token and json=1 in the URL handle authentication
    $.ajax({
      url: url,
      type: 'POST',
      data: data,
      dataType: 'json',
      timeout: 15000,
      success: function(resp) { onSendOk(idx, pl, resp); },
      error: function(xhr) {
        // Try to parse response even on HTTP error (TW sometimes returns 200 with error JSON)
        var respText = xhr && xhr.responseText;
        if (respText) {
          try {
            var parsed = JSON.parse(respText);
            if (parsed && !parsed.error) { onSendOk(idx, pl, parsed); return; }
          } catch (e) {}
        }
        onSendErr(idx, pl, 'Network error');
      }
    });
  }

  function onSendOk(idx, pl, resp) {
    if (resp && resp.error) {
      onSendErr(idx, pl, Array.isArray(resp.error) ? resp.error[0] : String(resp.error));
      return;
    }
    farmSentCount++;
    if (resp && resp.units) updateUnits(pl.sourceId, resp.units);

    if (typeof UI !== 'undefined' && typeof UI.SuccessMessage === 'function') {
      UI.SuccessMessage('Farm: ' + pl.sourceCoords + ' -> ' + pl.targetCoords + ' (' + pl.templateLabel + ')');
    }
    markPlunderDone(pl.targetId);

    var $r = $('#twf-r-' + idx);
    $r.fadeOut(200, function() {
      $r.remove();
      hlFirst();
      updateProgress();
      if (!$('#twf-tbody tr').length) finishFarming('All done! Sent ' + farmSentCount + ' / ' + farmPlan.length + ' attacks.');
    });
  }

  function onSendErr(idx, pl, msg) {
    farmErrorCount++;
    var $r = $('#twf-r-' + idx);
    $r.removeClass('twf-sending').find('.twf-si').css('opacity', '1');
    $r.css('background', '#f5c0c0');
    setTimeout(function() { $r.css('background', ''); hlFirst(); }, 1500);
    if (typeof UI !== 'undefined' && typeof UI.ErrorMessage === 'function') {
      UI.ErrorMessage('Farm error (' + pl.targetCoords + '): ' + msg);
    } else { TWTools.UI.toast('Error: ' + msg, 'error'); }
    updateProgress();
  }

  function markPlunderDone(targetId) {
    $('#plunder_list tr[id*="' + targetId + '"]').find('.farm_icon_a, .farm_icon_b').addClass('farm_icon_disabled done');
  }

  function updateUnits(srcId, units) {
    for (var i = 0; i < sourceVillages.length; i++) {
      if (sourceVillages[i].id === srcId && typeof units.light !== 'undefined') {
        sourceVillages[i].lcAvailable = parseInt(units.light, 10) || 0; break;
      }
    }
  }

  function hlFirst() {
    $('#twf-tbody tr').removeClass('twf-act');
    $('#twf-tbody tr:first').addClass('twf-act');
  }

  function updateProgress() {
    var total = farmPlan.length, rem = $('#twf-tbody tr').length;
    var pct = total > 0 ? Math.round(((total - rem) / total) * 100) : 0;
    $('#twf-pbar').css('width', pct + '%');
    var txt = farmSentCount + ' / ' + total + ' sent';
    if (farmErrorCount > 0) txt += ' (' + farmErrorCount + ' errors)';
    $('#twf-ptxt').text(txt);
  }

  function finishFarming(msg) {
    isFarming = false; unbindEnterKey();
    var $fc = $('#twf-fc');
    if ($fc.length) {
      $fc.html('<div style="padding:10px;background:#f0e0b0;border:1px solid #804000;border-radius:3px;text-align:center;">' +
        '<b>TW Farm Complete</b><br/><span style="font-size:11px;">' + esc(msg) + '</span><br/>' +
        '<span style="font-size:10px;color:#7a6840;">Sent: ' + farmSentCount + ' | Errors: ' + farmErrorCount +
        ' | Planned: ' + farmPlan.length + '</span><br/>' +
        '<button class="btn" id="twf-dismiss" style="margin-top:8px;">Dismiss</button></div>');
      $('#twf-dismiss').on('click', function() { removeFarmTable(); });
      setTimeout(removeFarmTable, 10000);
    }
    TWTools.UI.toast(msg, 'success');
  }

  // ============================================================
  // TOOLBAR BUTTON
  // ============================================================

  function injectToolbarButton() {
    if ($('#twf-btn').length) return;
    var $btn = $('<button class="btn" id="twf-btn" style="font-weight:bold;margin-left:10px;padding:2px 10px;">TW Farm</button>');

    var $hdr = $('h3:contains("Farm"), h4:contains("Farm")').filter(function() {
      return $(this).closest('#am_widget_Farm, .am_widget, #contentContainer').length > 0;
    }).first();

    if ($hdr.length) {
      $hdr.append($btn);
    } else {
      var $w = $('#am_widget_Farm');
      $w.length ? $('<div style="margin-bottom:6px;"></div>').append($btn).insertBefore($w)
                : $('#contentContainer').prepend($('<div style="margin-bottom:6px;"></div>').append($btn));
    }
    $btn.on('click', function(e) { e.preventDefault(); showSettingsDialog(); });
  }

  // ============================================================
  // PAGE CHECK + REDIRECT
  // ============================================================

  function ensureAmFarmPage() {
    var screen = (typeof game_data !== 'undefined' && game_data.screen) || '';
    if (screen === 'am_farm') return true;
    TWTools.UI.toast('Redirecting to Farm Assistant...', 'warning');
    window.location.href = '/game.php?village=' + TWTools.getVillageId() + '&screen=am_farm';
    return false;
  }

  // ============================================================
  // INIT + AUTO-START
  // ============================================================

  function init() {
    loadSettings();
    readAccountmanagerGlobals();
    if (TWTools.TimeSync && typeof TWTools.TimeSync.init === 'function') TWTools.TimeSync.init();

    TWTools.DataFetcher.fetchGroups(function(groups) {
      availableGroups = groups;
      var found = false;
      for (var i = 0; i < groups.length; i++) { if (groups[i].id === settings.groupId) { found = true; break; } }
      if (!found) { settings.groupId = '0'; saveSettings(); }
    });
    TWTools.DataFetcher.fetchWorldConfig(function() {});

    injectToolbarButton();
    TWTools.UI.toast('TW Farm v' + VERSION + ' loaded', 'success');
  }

  $(function() {
    if (!TWTools.getPlayerId()) return;
    if (!ensureAmFarmPage()) return;
    init();
  });

})(window, jQuery);
