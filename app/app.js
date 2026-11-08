/*
 * tvOS style home for webOS: black, a pinned dock row, an app grid, and one glass highlight that
 * springs between tiles. A port of the Android launcher in ../../launcher.
 *
 * webOS does not let third-party apps list installed apps, so sync-apps.py writes them into apps.js.
 */
(function () {
  'use strict';

  var COLUMNS = Math.max(1, CONFIG.columns || 4);
  var TILE_W = 360, TILE_H = 202;
  var CELL_W = (1920 - 2 * 112) / COLUMNS;
  var ROW_PITCH = 292;
  var DOCK_TOP = 708;           // tile top of the dock row: next row peeks in at the bottom
  var DOCK_GAP = 36;            // extra space below the dock
  var HEADER_H = 96;            // space a section title takes above its first row
  var FOCUS_SCALE = 1.14;
  var GLASS_PAD = 6;            // how far the glass ring sits outside the scaled tile
  var VIEW_TOP = 80, VIEW_BOTTOM = 1060;    // area grid rows scroll into (the header hides below the dock)

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27 };

  var GREETINGS = [[5, 'Good night'], [12, 'Good morning'], [17, 'Good afternoon'], [22, 'Good evening'], [24, 'Good night']];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
    'October', 'November', 'December'];

  var ICON_INPUT = 'M18,7V4c0,-1.1 -0.9,-2 -2,-2H8C6.9,2 6,2.9 6,4v3H5v6l3,6v3h8v-3l3,-6V7H18zM8,4h8v3h-2V5h-1v2h-2V5h-1v2H8V4z';
  var ICON_LIVETV = 'M21,6h-7.59l3.29,-3.29L16,2l-4,4l-4,-4l-0.71,0.71L10.59,6H3c-1.1,0 -2,0.89 -2,2v12c0,1.1 0.9,2 2,2h18c1.1,0 2,-0.89 2,-2V8C23,6.89 22.1,6 21,6zM21,20H3V8h18V20zM9,10v8l7,-4L9,10z';

  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'), tilesEl = $('tiles'), glass = $('glass'), hero = $('hero');
  var ambients = [$('ambientA'), $('ambientB')], ambientFront = 0, ambientColor = null;
  var pills = [$('btnInputs'), $('btnWifi'), $('btnSettings'), $('btnEdit')];
  var panel = $('inputsPanel');

  var items = [];               // {app, el, color, row, col} in one flat list, section by section
  var counts = [];              // how many of items belong to each section, in order
  var titles = [];              // each section's heading; the dock's is null
  var heads = [];               // the heading elements, one per section
  var rows = [];                // {top, section, items: [index into items]}
  var zone = 'grid';            // 'grid' | 'top' | 'inputs'
  var focused = 0, pillFocus = 0, inputFocus = 0, inputRows = [];
  var offset = 0, heroShown = false, glassShown = false;
  var editMode = false;         // arranging: the arrows pick a tile, OK takes it in hand
  var editing = null;           // {item, snapshot, sizes} while a tile is in hand

  // ---- luna bus ------------------------------------------------------------------------------

  var bridges = [];   // keep a reference: a collected bridge drops its callback

  function luna(uri, params, cb) {
    try {
      var b = new PalmServiceBridge();
      b.onservicecallback = function (msg) {
        var res;
        try { res = JSON.parse(msg); } catch (e) { res = { returnValue: false }; }
        if (cb) cb(res);
        if (!params || !params.subscribe) bridges.splice(bridges.indexOf(b), 1);
      };
      bridges.push(b);
      b.call(uri, JSON.stringify(params || {}));
    } catch (e) {
      if (cb) cb({ returnValue: false, errorText: String(e) });   // not on a TV (desktop preview)
    }
  }

  function launch(id, title, params) {
    noteLaunch(id);
    luna('luna://com.webos.applicationManager/launch', { id: id, params: params || {} }, function (res) {
      if (res.returnValue === false) toast("Can't open " + (title || id));
    });
  }

  var toastTimer;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.classList.add('shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('shown'); }, 2200);
  }

  // ---- what gets opened ----------------------------------------------------------------------

  var USE_KEY = 'tvhome.use';

  /** How often each app has been opened from here: {id: {n: times, at: last time}}. */
  function loadUse() {
    try { return JSON.parse(localStorage.getItem(USE_KEY)) || {}; } catch (e) { return {}; }
  }

  function noteLaunch(id) {
    try {
      var use = loadUse();
      var st = use[id] || { n: 0, at: 0 };
      st.n++;
      st.at = Date.now();
      use[id] = st;
      localStorage.setItem(USE_KEY, JSON.stringify(use));
    } catch (e) { /* storage unavailable: the top row stays on the configured apps */ }
  }

  /**
   * The apps for the top row: most opened first, counted with a three-day half-life so something
   * you have stopped watching drops out and whatever you are on now climbs.
   */
  function recentIds(all) {
    var use = loadUse(), now = Date.now(), scored = [];
    all.forEach(function (a) {
      var st = use[a.id];
      if (!st) return;
      var days = (now - (st.at || 0)) / 86400000;
      scored.push({ id: a.id, score: st.n * Math.pow(0.5, days / 3), at: st.at || 0 });
    });
    scored.sort(function (x, y) { return (y.score - x.score) || (y.at - x.at); });
    var ids = scored.slice(0, COLUMNS).map(function (s) { return s.id; });
    (CONFIG.dockApps || []).forEach(function (id) {       // not enough history yet: config fills in
      if (ids.length < COLUMNS && ids.indexOf(id) < 0) ids.push(id);
    });
    return ids;
  }

  /** The top row as it stands, to notice when coming back from an app has changed it. */
  function dockSignature() {
    return items.slice(0, counts[0] || 0).map(function (it) { return it.app.id; }).join(',');
  }

  // ---- apps ----------------------------------------------------------------------------------

  /** The top row, then one group per configured category, then everything left over. */
  function sectionPlan() {
    var all = (window.TV_APPS && TV_APPS.apps) || [];
    var byId = {};
    all.forEach(function (a) { byId[a.id] = a; });
    var taken = {};
    (CONFIG.hiddenApps || []).forEach(function (id) { taken[id] = true; });
    var byTitle = function (a, b) { return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1; };

    var secTitles = [null];                                   // the top row is named by the shelf
    (CONFIG.categories || []).forEach(function (c) { secTitles.push(c.title); });
    secTitles.push(CONFIG.otherTitle || 'More');
    var groups = secTitles.map(function () { return []; });

    var take = function (ids, into) {
      (ids || []).forEach(function (id) {
        if (byId[id] && !taken[id]) { into.push(byId[id]); taken[id] = true; }
      });
    };

    // The top row is the launcher's own: what you open most, and a shortcut there as well as in
    // its category, so it is not marked taken and cannot be rearranged by hand.
    recentIds(all).forEach(function (id) {
      if (byId[id] && !taken[id]) groups[0].push(byId[id]);
    });
    if (!groups[0].length) {                                  // nothing opened yet and no dockApps
      groups[0] = all.filter(function (a) { return !taken[a.id]; }).sort(byTitle).slice(0, COLUMNS);
    }

    // An arrangement made on the TV wins for the categories, until config.js changes.
    var saved = loadOrder();
    if (saved) {
      groups.forEach(function (g, i) { if (i) take(saved[i], g); });
    } else {
      (CONFIG.categories || []).forEach(function (cat, i) {
        take(cat.apps, groups[i + 1]);
        groups[i + 1].sort(byTitle);
      });
    }

    // Never placed, or newly installed since the arrangement was saved: into the last section.
    var rest = all.filter(function (a) { return !taken[a.id]; }).sort(byTitle);
    groups[groups.length - 1] = groups[groups.length - 1].concat(rest);

    for (var i = groups.length - 1; i > 0; i--) {                   // drop sections left empty
      if (!groups[i].length) { groups.splice(i, 1); secTitles.splice(i, 1); }
    }
    return { titles: secTitles, groups: groups };
  }

  var ORDER_KEY = 'tvhome.order';

  /** The config an arrangement was made against: change the categories and it starts fresh. */
  function configSignature() {
    return (CONFIG.dockApps || []).join(',') + '|' +
      (CONFIG.categories || []).map(function (c) { return c.title; }).join(',');
  }

  function loadOrder() {
    try {
      var s = JSON.parse(localStorage.getItem(ORDER_KEY));
      return s && s.sig === configSignature() ? s.sections : null;
    } catch (e) {
      return null;
    }
  }

  function saveOrder() {
    try {
      var sections = [], at = 0;
      counts.forEach(function (n) {
        sections.push(items.slice(at, at + n).map(function (it) { return it.app.id; }));
        at += n;
      });
      localStorage.setItem(ORDER_KEY, JSON.stringify({ sig: configSignature(), sections: sections }));
    } catch (e) { /* storage unavailable: the order lasts until the app restarts */ }
  }

  function rowOf(i) { return items[i] ? items[i].row : 0; }
  function colOf(i) { return items[i] ? items[i].col : 0; }
  function tileLeft(i) { return 112 + colOf(i) * CELL_W + (CELL_W - TILE_W) / 2; }
  function tileTop(i) { var r = rows[rowOf(i)]; return r ? r.top : DOCK_TOP; }
  function sectionOf(i) { var r = rows[rowOf(i)]; return r ? r.section : 0; }

  /** Walks the sections top to bottom, giving every tile a row and column and every heading a place. */
  function computeLayout() {
    rows = [];
    var y = DOCK_TOP, at = 0;
    counts.forEach(function (n, s) {
      if (s > 0 && heads[s]) {
        heads[s].hidden = !n;                   // a section emptied by rearranging loses its title
        if (n) {
          heads[s].style.top = (y + 20) + 'px';
          y += HEADER_H;
        }
      }
      for (var k = 0; k < n; k += COLUMNS) {
        var row = { top: y, section: s, items: [] };
        for (var c = 0; c < COLUMNS && k + c < n; c++) {
          items[at + k + c].row = rows.length;
          items[at + k + c].col = c;
          row.items.push(at + k + c);
        }
        rows.push(row);
        y += ROW_PITCH;
      }
      if (s === 0) y += DOCK_GAP;
      at += n;
    });
  }

  function build() {
    tilesEl.innerHTML = '';
    var plan = sectionPlan();
    titles = plan.titles;
    counts = plan.groups.map(function (g) { return g.length; });

    heads = titles.map(function (title, s) {
      if (s === 0) return null;                 // the dock is named by the top shelf instead
      var h = document.createElement('div');
      h.className = 'section';
      h.textContent = title;
      tilesEl.appendChild(h);
      return h;
    });

    var flat = [];
    plan.groups.forEach(function (g) { g.forEach(function (a) { flat.push(a); }); });

    items = flat.map(function (app) {
      var el = document.createElement('div');
      el.className = 'item';
      var card = document.createElement('div');
      card.className = 'card';
      var img = document.createElement('img');
      var item = { app: app, el: el, card: card, color: null };
      img.onload = function () { paintTile(item, img); };
      img.src = app.icon;
      if (app.tileColor) paintTile(item, img);    // baked: no need to wait for the icon to load
      card.appendChild(img);
      el.appendChild(card);
      var name = document.createElement('div');
      name.className = 'name';
      name.textContent = app.title;
      el.appendChild(name);
      el.addEventListener('mouseover', function () {
        if (zone !== 'inputs' && !editing) focusTile(items.indexOf(item));
      });
      el.addEventListener('click', function () {
        if (editing) dropTile(true);
        else if (editMode) { focusTile(items.indexOf(item)); pickUpTile(); }
        else launch(app.id, app.title);
      });
      tilesEl.appendChild(el);
      return item;
    });
    layout();
  }

  /** Places every tile by its position in items; tiles glide when the order changes. */
  function layout() {
    computeLayout();
    items.forEach(function (it, i) {
      it.el.style.left = tileLeft(i) + 'px';
      it.el.style.top = tileTop(i) + 'px';
      it.el.classList.toggle('dock', sectionOf(i) === 0);   // the dock has no labels: the top shelf names it
    });

    var band = $('dockBand');
    var n = Math.min(COLUMNS, counts[0] || 0);
    band.style.display = n ? 'block' : 'none';
    band.style.left = (112 + (CELL_W - TILE_W) / 2 - 28) + 'px';
    band.style.top = (DOCK_TOP - 28) + 'px';
    band.style.width = ((n - 1) * CELL_W + TILE_W + 56) + 'px';
    band.style.height = (TILE_H + 56) + 'px';
  }

  function animateIn() {
    items.forEach(function (it, i) {
      it.el.classList.remove('shown');
      setTimeout(function () { it.el.classList.add('shown'); }, 60 + Math.min(i, 16) * 40);
    });
  }

  /**
   * Store icons are square logos on a solid colour: fill the wide tile with that colour so the logo
   * reads as a banner. LG's system icons are glyphs on transparent: use the app's own colour.
   */
  function paintTile(item, img) {
    // bake-colors.py measures the icons on a computer and writes the answers into apps.js: webOS
    // serves this app from file://, where reading pixels back out of a canvas is blocked.
    var baked = parseColor(item.app.tileColor);
    if (baked) {
      item.card.style.background = 'rgb(' + baked.join(',') + ')';
      if (item.app.glyph) item.card.classList.add('glyph');
      item.color = parseColor(item.app.glowColor) || baked;
      if (items[focused] === item) setAmbient(item.color);
      return;
    }

    var px = null, edge = null;
    try {
      var c = document.createElement('canvas');
      c.width = 12; c.height = 12;
      var g = c.getContext('2d');
      g.drawImage(img, 0, 0, 12, 12);
      px = g.getImageData(0, 0, 12, 12).data;
      edge = edgeColor(img);
    } catch (e) { /* tainted canvas: fall back to the app's colour */ }

    var glyphColor = null;
    if (edge && edge[3] > 200) {
      item.card.style.background = 'rgb(' + edge[0] + ',' + edge[1] + ',' + edge[2] + ')';
    } else {
      item.card.classList.add('glyph');
      item.card.style.background = glyphBackground(item.app.iconColor);
      glyphColor = glyphBackground(item.app.iconColor) === '#2c2c2e' ? null : parseColor(item.app.iconColor);
    }
    // A white glyph says nothing about the app: glow in the tile's colour instead.
    item.color = glyphColor || (px ? vividColor(px) : parseColor(item.app.iconColor));
    if (items[focused] === item) setAmbient(item.color);
  }

  /**
   * The icon's background at full size: a corner pixel, or the middle of the left edge for rounded
   * icons whose corners are transparent. A downscaled sample would blend in the logo.
   */
  function edgeColor(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    var corner = g.getImageData(2, 2, 1, 1).data;
    return corner[3] > 200 ? corner : g.getImageData(2, Math.floor(h / 2), 1, 1).data;
  }

  function glyphBackground(hex) {
    var c = parseColor(hex);
    if (!c) return '#2c2c2e';
    var hsv = rgbToHsv(c);
    if (hsv[1] < 0.15 && (hsv[2] > 0.85 || hsv[2] < 0.1)) return '#2c2c2e';   // white or black glyph colour
    return 'rgb(' + c.join(',') + ')';
  }

  /** A vivid colour from the icon: the most saturated, not too dark pixel, or the lifted average. */
  function vividColor(px) {
    var best = null, bestScore = -1, sum = [0, 0, 0], n = 0;
    for (var i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      var p = [px[i], px[i + 1], px[i + 2]];
      sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; n++;
      var hsv = rgbToHsv(p);
      var score = hsv[1] * Math.min(1, hsv[2] * 1.4);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (!n) return [68, 68, 68];
    if (bestScore < 0.25) {   // nearly monochrome icon (e.g. white): its average, lifted
      var avg = rgbToHsv([sum[0] / n, sum[1] / n, sum[2] / n]);
      avg[2] = Math.max(avg[2], 0.55);
      return hsvToRgb(avg);
    }
    var h = rgbToHsv(best);
    h[1] = Math.min(1, h[1] * 1.1);
    h[2] = Math.max(0.5, h[2]);
    return hsvToRgb(h);
  }

  function parseColor(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    var v = parseInt(m[1], 16);
    return [v >> 16 & 255, v >> 8 & 255, v & 255];
  }

  function rgbToHsv(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, max ? d / max : 0, max];
  }

  function hsvToRgb(hsv) {
    var h = hsv[0], s = hsv[1], v = hsv[2];
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return rgb.map(function (k) { return Math.round((k + m) * 255); });
  }

  // ---- focus & glass -------------------------------------------------------------------------

  function focusTile(i) {
    if (!items.length) return;
    i = Math.max(0, Math.min(i, items.length - 1));
    setZone('grid');
    if (items[focused]) items[focused].el.classList.remove('focused');
    focused = i;
    items[i].el.classList.add('focused');

    var top = tileTop(i), inDock = sectionOf(i) === 0;
    if (inDock) {
      offset = 0;
    } else {
      // Scroll just enough so the whole glass and the name below the tile are visible.
      if (top - offset + TILE_H + 70 > VIEW_BOTTOM) offset = top + TILE_H + 70 - VIEW_BOTTOM;
      if (top - offset - 24 < VIEW_TOP) offset = top - 24 - VIEW_TOP;
    }
    stage.style.transform = 'translateY(' + (-offset) + 'px)';
    // Keep the header until the content (the dock band is topmost) would run into it.
    var header = document.querySelector('header');
    var headerBottom = header.offsetTop + header.offsetHeight;   // layout box: ignores the hide slide
    document.body.classList.toggle('scrolled', DOCK_TOP - 28 - offset < headerBottom + 24);

    var w = TILE_W * FOCUS_SCALE + 2 * GLASS_PAD, h = TILE_H * FOCUS_SCALE + 2 * GLASS_PAD;
    var x = tileLeft(i) + TILE_W / 2 - w / 2, y = top + TILE_H / 2 - h / 2;
    glass.style.width = w + 'px';
    glass.style.height = h + 'px';
    glass.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    if (!glassShown) {
      // First show: jump there without the spring, then fade in.
      glass.style.transition = 'none';
      glass.offsetWidth;   // flush the jump before restoring the transition
      glass.style.transition = '';
      glass.style.opacity = '1';
      glassShown = true;
    }

    if (inDock) showHero(items[i]);
    else hideHero();
    setAmbient(items[i].color);   // the glow follows the focused tile in every row
  }

  function hideGlass() {
    glassShown = false;
    glass.style.opacity = '0';
  }

  function showHero(item) {
    var label = item.app.title;
    hero.style.top = (DOCK_TOP - 28 - 52 - 96) + 'px';
    if (!heroShown) {
      hero.textContent = label;
      hero.style.transform = 'none';
      hero.style.opacity = '1';
      heroShown = true;
    } else if (hero.textContent !== label) {
      hero.style.opacity = '0';
      hero.style.transform = 'translateX(-24px)';
      clearTimeout(hero.swap);
      hero.swap = setTimeout(function () {
        hero.textContent = label;
        hero.style.transition = 'none';
        hero.style.transform = 'translateX(24px)';
        hero.offsetWidth;
        hero.style.transition = '';
        hero.style.transform = 'none';
        hero.style.opacity = '1';
      }, 120);
    }
    setAmbient(item.color);
  }

  function hideHero() {
    if (!heroShown) return;
    heroShown = false;
    hero.style.opacity = '0';
  }

  /** Crossfades the glow to a new colour by swapping between two layers. */
  function setAmbient(color) {
    if (!color) return;
    var key = color.join(',');
    if (key === ambientColor) return;
    ambientColor = key;
    var back = ambients[1 - ambientFront];
    back.style.background = 'radial-gradient(circle 1190px at 32% 42%, rgba(' + key + ',0.36) 0%, rgba(' +
      key + ',0.15) 50%, rgba(' + key + ',0) 100%)';
    back.style.opacity = '1';
    ambients[ambientFront].style.opacity = '0';
    ambientFront = 1 - ambientFront;
  }

  function focusPill(i) {
    setZone('top');
    document.body.classList.remove('scrolled');
    pills[pillFocus].classList.remove('focused');
    pillFocus = Math.max(0, Math.min(i, pills.length - 1));
    pills[pillFocus].classList.add('focused');
  }

  function setZone(z) {
    if (zone === z) return;
    if (zone === 'top') pills[pillFocus].classList.remove('focused');
    if (zone === 'grid') {
      if (items[focused]) items[focused].el.classList.remove('focused');
      hideGlass();
    }
    zone = z;
  }

  /** The pill straight above a dock tile, by horizontal distance. */
  function pillAbove(i) {
    var cx = tileLeft(i) + TILE_W / 2, best = 0, bestD = Infinity;
    pills.forEach(function (p, k) {
      var r = p.getBoundingClientRect();
      var d = Math.abs(r.left + r.width / 2 - cx);
      if (d < bestD) { bestD = d; best = k; }
    });
    return best;
  }

  // ---- top bar -------------------------------------------------------------------------------

  function updateClock() {
    var now = new Date(), h = now.getHours();
    for (var k = 0; k < GREETINGS.length; k++) {
      if (h < GREETINGS[k][0]) { $('greeting').textContent = GREETINGS[k][1]; break; }
    }
    var m = now.getMinutes();
    $('clock').textContent = ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m;
    $('ampm').textContent = h < 12 ? 'am' : 'pm';
    $('date').textContent = DAYS[now.getDay()] + '  ' + now.getDate() + ' ' + MONTHS[now.getMonth()];
  }

  /** Shows the Wi-Fi network name when the TV reports it, otherwise the connection type. */
  function watchNetwork() {
    luna('luna://com.palm.connectionmanager/getStatus', { subscribe: true }, function (res) {
      if (res.returnValue === false && !res.wifi && !res.wired) return;
      var text = 'Wi-Fi';
      if (res.wired && res.wired.state === 'connected') text = 'Ethernet';
      else if (res.wifi && res.wifi.state === 'connected') text = res.wifi.ssid || 'Wi-Fi';
      else if (res.isInternetConnectionAvailable === false) text = 'Offline';
      $('wifiLabel').textContent = text;
    });
  }

  function activatePill(i) {
    if (i === 0) showInputs();
    else if (i === 1) launch('com.palm.app.settings', 'Settings', { target: 'network' });
    else if (i === 2) launch('com.palm.app.settings', 'Settings');
    else if (editMode) exitEditMode();
    else { focusTile(Math.max(focused, counts[0] || 0)); enterEditMode(); }
  }

  // ---- inputs dropdown -----------------------------------------------------------------------

  function showInputs() {
    panel.innerHTML = '';
    inputRows = [];
    var inputs = (window.TV_APPS && TV_APPS.inputs) || [];
    inputs.forEach(function (inp) { addInputRow(ICON_INPUT, inp.label, inp.appId); });
    if (CONFIG.liveTvApp) {
      if (inputRows.length) panel.appendChild(Object.assign(document.createElement('div'), { className: 'separator' }));
      addInputRow(ICON_LIVETV, 'Live TV', CONFIG.liveTvApp);
    }
    if (!inputRows.length) { toast('No inputs found'); return; }

    // Hang right below the Inputs pill, at least as wide as it.
    var r = pills[0].getBoundingClientRect();
    panel.style.left = r.left + 'px';
    panel.style.top = (r.bottom + 20) + 'px';
    panel.style.minWidth = Math.max(r.width, 300) + 'px';
    panel.classList.remove('hidden');
    pills[pillFocus].classList.remove('focused');
    zone = 'inputs';
    focusInput(0);
  }

  function addInputRow(icon, label, appId) {
    var row = document.createElement('div');
    row.className = 'inputRow';
    row.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + icon + '"/></svg>';
    row.appendChild(document.createTextNode(label));
    var idx = inputRows.length;
    row.addEventListener('mouseover', function () { focusInput(idx); });
    row.addEventListener('click', function () { hideInputs(); launch(appId, label); });
    row.appId = appId;
    row.label = label;
    inputRows.push(row);
    panel.appendChild(row);
  }

  function focusInput(i) {
    if (inputRows[inputFocus]) inputRows[inputFocus].classList.remove('focused');
    inputFocus = Math.max(0, Math.min(i, inputRows.length - 1));
    inputRows[inputFocus].classList.add('focused');
  }

  function hideInputs() {
    panel.classList.add('hidden');
    zone = 'none';
    focusPill(0);
  }

  // ---- rearranging ---------------------------------------------------------------------------

  /**
   * Two steps, so one visit arranges as many tiles as you like: Edit (or holding OK) turns
   * arranging on, then inside it the arrows walk the grid, OK takes a tile in hand and OK again
   * puts it down. Back drops the tile where it was, or leaves arranging when nothing is in hand.
   */
  function enterEditMode(hint) {
    if (editMode) return;
    editMode = true;
    document.body.classList.add('editing');
    if (hint !== false) toast('Arranging  ·  OK to pick a tile up  ·  Back when done');
  }

  function exitEditMode() {
    if (editing) dropTile(false);
    editMode = false;
    document.body.classList.remove('editing');
    toast('Arrangement saved');
  }

  /** Takes the focused tile in hand. The top row is the launcher's own, so it stays put. */
  function pickUpTile() {
    var it = items[focused];
    if (!it || editing) return;
    if (sectionOf(focused) === 0) {
      toast('The top row follows the apps you open');
      return;
    }
    editing = { item: it, snapshot: items.slice(), sizes: counts.slice() };
    it.el.classList.add('moving');
  }

  /** Puts the tile in hand down where it is now, or back where it came from. */
  function dropTile(keep) {
    if (!editing) return;
    var it = editing.item;
    if (!keep) {
      items = editing.snapshot;
      counts = editing.sizes;
      layout();
    }
    editing = null;
    it.el.classList.remove('moving');
    if (keep) saveOrder();
    focused = items.indexOf(it);
    focusTile(focused);
  }

  /** Which section a place in the flat list falls in, by walking the section sizes. */
  function sectionAt(i) {
    var at = 0;
    for (var s = 0; s < counts.length; s++) {
      at += counts[s];
      if (i < at) return s;
    }
    return counts.length - 1;
  }

  /** The tile at a column in another row, or that row's last one when it is shorter. */
  function nearestIn(r, col) {
    var row = rows[r];
    return row.items[Math.min(col, row.items.length - 1)];
  }

  /** Moves the tile in hand, handing it to whichever section it lands in; never the top row. */
  function moveTo(to) {
    to = Math.max(counts[0] || 0, Math.min(to, items.length - 1));
    if (to === focused) return;
    counts[sectionAt(focused)]--;
    var moved = items.splice(focused, 1)[0];
    counts[sectionAt(to)]++;
    items.splice(to, 0, moved);
    focused = to;
    layout();
    focusTile(to);
  }

  // ---- keys ----------------------------------------------------------------------------------

  var LONG_PRESS_MS = 600;
  var REPEAT_GAP = 180;         // a gap longer than this between OK events means the key came up
  var okStart = 0, okHold = null, okRelease = null, okHandled = false;

  /**
   * A held OK on a tile starts arranging instead of opening the app. webOS remotes differ in what
   * they send while OK is held — one keydown, repeating keydowns, or keydown/keyup pairs — so the
   * press is timed from the first keydown and only counted as over once nothing has arrived for
   * REPEAT_GAP. Arranging starts the moment the hold is long enough, so it is felt, not guessed.
   */
  function okPressed() {
    clearTimeout(okRelease);
    okRelease = null;
    if (okStart) return;                       // still the same press: a repeat, or its keyup
    okStart = Date.now();
    okHandled = false;
    okHold = setTimeout(function () {
      okHold = null;
      okHandled = true;                        // the hold became a rearrange: releasing does nothing
      enterEditMode(false);
      pickUpTile();
      toast('Arrows to move  ·  OK to put it down  ·  Back to cancel');
    }, LONG_PRESS_MS);
  }

  function okReleased() {
    if (!okStart || okRelease) return;
    okRelease = setTimeout(function () {
      var held = Date.now() - okStart;
      okStart = 0;
      okRelease = null;
      clearTimeout(okHold);
      okHold = null;
      if (okHandled || held >= LONG_PRESS_MS) return;
      var it = items[focused];
      if (it) launch(it.app.id, it.app.title);
    }, REPEAT_GAP);
  }

  document.addEventListener('keyup', function (e) {
    if (e.keyCode === KEY.OK) okReleased();
  });

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    // A tile's OK waits for the release, to tell a tap from a hold. Everywhere else it acts at once.
    if (k === KEY.OK && zone === 'grid' && !editMode) { okPressed(); e.preventDefault(); return; }
    if (editing) {
      var er = rowOf(focused), ec = colOf(focused);
      if (k === KEY.LEFT) moveTo(focused - 1);
      else if (k === KEY.RIGHT) moveTo(focused + 1);
      else if (k === KEY.UP) moveTo(er > 0 ? nearestIn(er - 1, ec) : 0);
      else if (k === KEY.DOWN) moveTo(er + 1 < rows.length ? nearestIn(er + 1, ec) : items.length - 1);
      else if (k === KEY.OK) dropTile(true);
      else if (k === KEY.BACK || k === KEY.ESC) dropTile(false);
      else return;
    } else if (editMode) {
      var mr = rowOf(focused), mc = colOf(focused);
      if (k === KEY.LEFT) { if (mc > 0) focusTile(rows[mr].items[mc - 1]); }
      else if (k === KEY.RIGHT) { if (mc + 1 < rows[mr].items.length) focusTile(rows[mr].items[mc + 1]); }
      else if (k === KEY.UP) { if (mr > 0) focusTile(nearestIn(mr - 1, mc)); }
      else if (k === KEY.DOWN) { if (mr + 1 < rows.length) focusTile(nearestIn(mr + 1, mc)); }
      else if (k === KEY.OK) pickUpTile();
      else if (k === KEY.BACK || k === KEY.ESC) exitEditMode();
      else return;
    } else if (zone === 'inputs') {
      if (k === KEY.UP) focusInput(inputFocus - 1);
      else if (k === KEY.DOWN) focusInput(inputFocus + 1);
      else if (k === KEY.OK) { var row = inputRows[inputFocus]; hideInputs(); launch(row.appId, row.label); }
      else if (k === KEY.BACK || k === KEY.ESC || k === KEY.LEFT || k === KEY.RIGHT) hideInputs();
      else return;
    } else if (zone === 'top') {
      if (k === KEY.LEFT) focusPill(pillFocus - 1);
      else if (k === KEY.RIGHT) focusPill(pillFocus + 1);
      else if (k === KEY.DOWN) focusTile(rowOf(focused) === 0 ? focused : 0);
      else if (k === KEY.OK) activatePill(pillFocus);
      else if (k === KEY.BACK) { /* home screen: Back goes nowhere */ }
      else return;
    } else {
      var r = rowOf(focused), col = colOf(focused);
      if (k === KEY.LEFT) { if (col > 0) focusTile(rows[r].items[col - 1]); }
      else if (k === KEY.RIGHT) { if (col + 1 < rows[r].items.length) focusTile(rows[r].items[col + 1]); }
      else if (k === KEY.UP) {
        if (r === 0) focusPill(pillAbove(focused));
        else focusTile(nearestIn(r - 1, col));
      } else if (k === KEY.DOWN) {
        if (r + 1 < rows.length) focusTile(nearestIn(r + 1, col));
      } else if (k === KEY.OK) {
        okPressed();                      // zone 'none', before the first tile has taken focus
      } else if (k === KEY.BACK) { /* home screen: Back goes nowhere */ }
      else return;
    }
    e.preventDefault();
  });

  pills.forEach(function (p, i) {
    p.addEventListener('mouseover', function () { if (zone !== 'inputs') focusPill(i); });
    p.addEventListener('click', function () { activatePill(i); });
  });

  // ---- lifecycle -----------------------------------------------------------------------------

  /** Back from another app (or opened again from the shortcut): replay the entrance, keep the tile. */
  function resume() {
    if (editing) dropTile(false);
    if (editMode) { editMode = false; document.body.classList.remove('editing'); }
    okStart = 0;
    clearTimeout(okHold);
    clearTimeout(okRelease);
    updateClock();
    if (zone === 'inputs') panel.classList.add('hidden');
    pills.forEach(function (p) { p.classList.remove('focused'); });
    zone = 'none';
    // Opening an app changes what the top row should hold: rebuild when it no longer matches.
    var want = recentRow();
    if (want.length && want.join(',') !== dockSignature()) {
      var was = items[focused] && items[focused].app.id;
      build();
      focused = 0;
      items.some(function (it, i) { if (it.app.id === was) { focused = i; return true; } });
    }
    animateIn();
    focusTile(focused);
  }

  /** What the top row would hold now, to compare against what it holds. */
  function recentRow() {
    var all = (window.TV_APPS && TV_APPS.apps) || [];
    var ok = {};
    all.forEach(function (a) { ok[a.id] = true; });
    (CONFIG.hiddenApps || []).forEach(function (id) { ok[id] = false; });
    return recentIds(all).filter(function (id) { return ok[id]; });
  }

  document.addEventListener('webOSRelaunch', resume);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) resume(); });

  build();
  updateClock();
  setInterval(updateClock, 10000);
  watchNetwork();
  animateIn();
  zone = 'none';
  focusTile(0);
})();
