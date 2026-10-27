// Desk dashboard front end. Plain script (no build step) that runs in Android WebView 106.
(function () {
  'use strict';

  var TZ = 'America/New_York';
  var IDLE_MS = 5 * 60e3; // screensaver after 5 minutes without a touch
  var $ = function (id) { return document.getElementById(id); };

  // Access key: passed once as ?k=… in the kiosk URL, then remembered.
  var KEY = new URLSearchParams(location.search).get('k') || '';
  try { if (KEY) localStorage.setItem('dashKey', KEY); else KEY = localStorage.getItem('dashKey') || ''; } catch (e) {}

  function store(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem(k));
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { return null; }
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'x-dash-key': KEY, 'content-type': 'application/json' }, opts.headers || {});
    return fetch(path, opts).then(function (r) {
      if (!r.ok) throw new Error(r.status + ' ' + path);
      return r.json();
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Remote images go through the Worker's allowlisted proxy (see /img in worker.js).
  function img(u) { return '/img?u=' + encodeURIComponent(u); }

  function fmt(date, opts) { return new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: TZ }, opts)).format(date); }
  function dayKey(date) { return fmt(date, { year: 'numeric', month: '2-digit', day: '2-digit' }); }
  function hourLabel(date) { return fmt(date, { hour: 'numeric' }).replace(' ', '').toLowerCase(); }

  function when(iso) {
    var d = new Date(iso), now = new Date();
    var t = fmt(d, { hour: 'numeric', minute: '2-digit' });
    if (dayKey(d) === dayKey(now)) return 'Today ' + t;
    if (dayKey(d) === dayKey(new Date(now.getTime() + 864e5))) return 'Tomorrow ' + t;
    return fmt(d, { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + t;
  }

  function countdown(iso) {
    var ms = new Date(iso) - new Date();
    if (ms <= 0) return 'now';
    var m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    if (d > 0) return d + 'd ' + h + 'h';
    return h + 'h ' + (m % 60) + 'm';
  }

  function ago(iso) {
    var m = Math.round((new Date() - new Date(iso)) / 60000);
    if (m < 60) return m + 'm ago';
    if (m < 1440) return Math.round(m / 60) + 'h ago';
    return Math.round(m / 1440) + 'd ago';
  }

  function mmss(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function failed(el, label, err) {
    var e = el.querySelector('.err') || document.createElement('div');
    e.className = 'err';
    e.textContent = label + ' unavailable (' + err.message + ')';
    el.appendChild(e);
  }

  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-on'); }, 2200);
  }

  // ---------------------------------------------------------------- fit 1280x800 stage to the screen
  function fit() {
    var w = document.documentElement.clientWidth, h = document.documentElement.clientHeight;
    var s = Math.min(w / 1280, h / 800);
    $('stage').style.transform = 'translate(' + (w - 1280 * s) / 2 + 'px,' + (h - 800 * s) / 2 + 'px) scale(' + s + ')';
  }
  window.addEventListener('resize', fit);
  fit();

  // ---------------------------------------------------------------- overlays (focus, chess, Premier League, screensaver)
  var openers = {};
  function openOv(name) {
    document.querySelectorAll('.ov.is-open').forEach(function (o) { if (o.id !== 'ov-saver') o.classList.remove('is-open'); });
    $('ov-' + name).classList.add('is-open');
    if (openers[name]) openers[name]();
  }
  function closeOv(el) { el.classList.remove('is-open'); }
  document.querySelectorAll('[data-open]').forEach(function (b) {
    b.addEventListener('click', function () { openOv(b.getAttribute('data-open')); });
  });
  document.querySelectorAll('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () { closeOv(b.closest('.ov')); });
  });

  // ---------------------------------------------------------------- theme: auto (sun-based) / light / dark
  var THEMES = ['auto', 'light', 'dark'], theme = store('theme') || 'auto', sun = null;
  var themeParam = new URLSearchParams(location.search).get('theme');
  if (THEMES.indexOf(themeParam) >= 0) theme = themeParam;
  function applyTheme() {
    var mode = theme;
    if (mode === 'auto') {
      var now = new Date();
      mode = sun ? (now >= sun.rise && now < sun.set ? 'light' : 'dark') : (now.getHours() >= 7 && now.getHours() < 18 ? 'light' : 'dark');
    }
    document.documentElement.setAttribute('data-theme', mode);
    $('themeLabel').textContent = theme === 'auto' ? 'Auto' : theme === 'light' ? 'Light' : 'Dark';
    return mode;
  }
  $('themeBtn').addEventListener('click', function () {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    store('theme', theme);
    var mode = applyTheme();
    toast(theme === 'auto' ? 'Theme: auto (' + mode + ' now)' : 'Theme: ' + theme);
  });

  // ---------------------------------------------------------------- clock
  var weatherNow = null, birthdays = [], focusMini = '';
  function tick() {
    var now = new Date();
    var parts = fmt(now, { hour: 'numeric', minute: '2-digit' }).split(' ');
    $('time').textContent = parts[0];
    $('ampm').textContent = parts[1] || '';
    $('date').textContent = fmt(now, { weekday: 'long', month: 'long', day: 'numeric' });
    var hr = +fmt(now, { hour: 'numeric', hour12: false });
    // Birthdays take over the greeting from three days before.
    var soon = birthdays.filter(function (b) { return b.days <= 3; })[0];
    var bday = soon && (soon.emoji + ' ' + soon.name + (soon.days === 0 ? (soon.name === 'Anniversary' ? ' today!' : '’s birthday today!')
      : soon.days === 1 ? ' tomorrow' : ' in ' + soon.days + ' days'));
    $('greet').innerHTML = focusMini
      ? '<span class="focus-mini">' + esc(focusMini) + '</span>'
      : bday ? esc(bday)
      : hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    document.querySelectorAll('[data-countdown]').forEach(function (el) { el.textContent = countdown(el.getAttribute('data-countdown')); });
    focusTick();
    saverTick(now);
  }

  // ---------------------------------------------------------------- Claude: start the usage window early
  var claudePoll = null;
  function renderClaude(d) {
    var el = $('claudeStatus');
    $('claudeBtn').classList.toggle('is-busy', !!d.running);
    if (!d.configured) { el.textContent = 'Not connected yet'; return; }
    if (d.running) { el.innerHTML = '<b>Saying hi…</b><br>about a minute'; return; }
    if (d.windowEnds && new Date(d.windowEnds) > new Date()) {
      el.innerHTML = 'Resets in <b data-countdown="' + esc(d.windowEnds) + '">' + countdown(d.windowEnds) + '</b><br>at ' + fmt(new Date(d.windowEnds), { hour: 'numeric', minute: '2-digit' });
    } else {
      el.innerHTML = 'No active window' + (d.lastHi ? '<br>last hi ' + ago(d.lastHi) : '');
    }
  }
  function loadClaude() {
    return api('/api/claude').then(function (d) { renderClaude(d); return d; })
      .catch(function () { $('claudeStatus').textContent = 'Status unavailable'; });
  }
  $('claudeBtn').addEventListener('click', function () {
    var btn = $('claudeBtn');
    if (btn.classList.contains('is-busy')) return;
    btn.classList.add('is-busy');
    $('claudeStatus').innerHTML = '<b>Sending…</b>';
    api('/api/claude/hi', { method: 'POST', body: '{}' }).then(function () {
      renderClaude({ configured: true, running: true });
      clearInterval(claudePoll);
      var tries = 0;
      claudePoll = setInterval(function () {
        loadClaude().then(function (d) { if (++tries > 18 || (d && !d.running && tries > 2)) clearInterval(claudePoll); });
      }, 10e3);
    }).catch(function (e) {
      btn.classList.remove('is-busy');
      $('claudeStatus').textContent = 'Failed: ' + e.message;
    });
  });

  // ---------------------------------------------------------------- weather (today)
  var WX = {
    sun: '<circle cx="12" cy="12" r="4.2" fill="#f5b84a"/><g stroke="#f5b84a" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></g>',
    moon: '<path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.6A7 7 0 0 1 15.5 3.5z" fill="#aab8f0"/>',
    cloud: '<path d="M7 19h10.5a4.5 4.5 0 0 0 .6-8.96A6 6 0 0 0 6.5 11.1 4 4 0 0 0 7 19z" fill="#aab4c6"/>',
    part: '<circle cx="8.5" cy="8.5" r="3.6" fill="#f5b84a"/><path d="M9 20h9a4 4 0 0 0 .5-7.96A5.3 5.3 0 0 0 8.4 13 3.5 3.5 0 0 0 9 20z" fill="#c3cad8"/>',
    partnight: '<path d="M10.5 3.2a5 5 0 1 0 3.4 7.6 4.2 4.2 0 0 1-3.4-7.6z" fill="#aab8f0"/><path d="M9 20h9a4 4 0 0 0 .5-7.96A5.3 5.3 0 0 0 8.4 13 3.5 3.5 0 0 0 9 20z" fill="#c3cad8"/>',
    rain: '<path d="M7 15h10.5a4.5 4.5 0 0 0 .6-8.96A6 6 0 0 0 6.5 7.1 4 4 0 0 0 7 15z" fill="#8f9bb0"/><g stroke="#6ea8ff" stroke-width="1.8" stroke-linecap="round"><path d="M8 17.5l-1 2.5M12 17.5l-1 2.5M16 17.5l-1 2.5"/></g>',
    snow: '<path d="M7 15h10.5a4.5 4.5 0 0 0 .6-8.96A6 6 0 0 0 6.5 7.1 4 4 0 0 0 7 15z" fill="#aab4c6"/><g fill="#9cc2ff"><circle cx="8" cy="19" r="1.2"/><circle cx="12" cy="20.5" r="1.2"/><circle cx="16" cy="19" r="1.2"/></g>',
    storm: '<path d="M7 14h10.5a4.5 4.5 0 0 0 .6-8.96A6 6 0 0 0 6.5 6.1 4 4 0 0 0 7 14z" fill="#7d879a"/><path d="M12.5 14l-3 5h2.6l-1.3 3.5 4-5.5h-2.7l1.4-3z" fill="#f5b84a"/>',
    fog: '<g stroke="#aab4c6" stroke-width="2" stroke-linecap="round"><path d="M4 9h16M6 13h12M4 17h16"/></g>',
    umbrella: '<path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9z" fill="currentColor"/><path d="M12 12v6.5a2 2 0 0 1-4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  };
  function wxKind(code, isDay) {
    if (code === 0 || code === 1) return isDay === false ? 'moon' : 'sun';
    if (code === 2) return isDay === false ? 'partnight' : 'part';
    if (code === 3) return 'cloud';
    if (code === 45 || code === 48) return 'fog';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'storm';
    return 'rain';
  }
  var WX_TEXT = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog', 51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 95: 'Thunderstorms', 96: 'Thunderstorms', 99: 'Thunderstorms' };
  function icon(kind) { return '<svg viewBox="0 0 24 24">' + WX[kind] + '</svg>'; }

  // One sentence about rain over the next 18 hours.
  function rainSummary(hours) {
    var wet = hours.slice(0, 18).filter(function (h) { return h.rain >= 40; });
    if (!wet.length) {
      var max = Math.max.apply(null, hours.slice(0, 18).map(function (h) { return h.rain; }));
      return { wet: false, text: max >= 20 ? 'Small chance of rain (' + max + '%)' : 'No rain expected' };
    }
    var start = new Date(wet[0].time), end = new Date(wet[wet.length - 1].time);
    var peak = Math.max.apply(null, wet.map(function (h) { return h.rain; }));
    var from = hourLabel(start), to = hourLabel(new Date(end.getTime() + 3600e3));
    var day = dayKey(start) === dayKey(new Date()) ? '' : ' tomorrow';
    return { wet: true, text: 'Rain likely ' + from + '–' + to + day + ' · up to ' + peak + '%' };
  }

  function loadWeather() {
    return api('/api/weather').then(function (d) {
      var n = d.now, today = d.days[0];
      // Open-Meteo gives local wall-clock times; the frame runs in the same zone.
      sun = { rise: new Date(today.sunrise), set: new Date(today.sunset) };
      applyTheme();
      weatherNow = n.temp + '° ' + (WX_TEXT[n.code] || '');
      var rain = rainSummary(d.hours);
      // Every third hour across the next ~18 hours.
      var hours = d.hours.filter(function (h, i) { return i > 0 && i % 3 === 1; }).slice(0, 6).map(function (h) {
        return '<div class="wx-h">' + hourLabel(new Date(h.time)) + icon(wxKind(h.code, h.isDay)) + '<b class="num">' + h.temp + '°</b>' +
          '<span class="r">' + (h.rain >= 20 ? h.rain + '%' : '') + '</span><span class="bar"><i style="width:' + h.rain + '%"></i></span></div>';
      }).join('');
      $('weather').innerHTML =
        '<div class="label">Vienna, VA · today<span>H ' + today.hi + '° · L ' + today.lo + '°</span></div>' +
        '<div class="wx-now">' + icon(wxKind(n.code, n.isDay)) +
        '<div class="wx-now__temp num">' + n.temp + '°</div>' +
        '<div class="wx-now__meta"><b>' + (WX_TEXT[n.code] || '') + '</b>Feels ' + n.feels + '° · ' + n.wind + ' mph<br>Sunset ' + fmt(sun.set, { hour: 'numeric', minute: '2-digit' }) + '</div></div>' +
        '<div class="wx-rain' + (rain.wet ? ' is-wet' : '') + '">' + icon('umbrella') + esc(rain.text) + '</div>' +
        '<div class="wx-hours">' + hours + '</div>';
    }).catch(function (e) { failed($('weather'), 'Weather', e); });
  }

  // ---------------------------------------------------------------- birthdays (shown in the greeting and on the screensaver)
  function loadBirthdays() {
    return api('/api/birthdays').then(function (list) { birthdays = list; }).catch(function () {});
  }

  // ---------------------------------------------------------------- PSG + Premier League
  function teamBlock(t) {
    return '<div class="match__team">' + (t.logo ? '<img src="' + img(t.logo) + '" alt="">' : '') + '<span>' + esc(t.name) + '</span></div>';
  }
  function resultPill(m) {
    var psgHome = m.home.abbr === 'PSG';
    var us = +(psgHome ? m.home.score : m.away.score), them = +(psgHome ? m.away.score : m.home.score);
    var r = us > them ? ['W', 'good'] : us < them ? ['L', 'bad'] : ['D', 'draw'];
    return '<span class="pill pill--' + r[1] + '">' + r[0] + '</span>';
  }

  var plData = null;
  function loadFootball() {
    return api('/api/football').then(function (d) {
      var p = d.psg, m = p.live || p.next[0];
      var mid = '';
      if (p.live) {
        mid = '<div class="match__score num">' + esc(p.live.home.score) + ' – ' + esc(p.live.away.score) + '</div><div class="match__sub"><span class="pill pill--live">Live</span> ' + esc(p.live.detail) + '</div>';
      } else if (m) {
        mid = '<div class="match__when">' + esc(when(m.date)) + '</div><div class="match__sub">' + esc(m.league) + ' · in <span data-countdown="' + esc(m.date) + '">' + countdown(m.date) + '</span></div>';
      }
      var pos = p.position ? '<span>Ligue 1 · <b>#' + p.position.rank + '</b> · ' + esc(p.position.pts) + ' pts</span>' : '';
      var last = p.last.map(function (r) {
        return '<div class="psg-res">' + resultPill(r) + ' <span class="muted">' + esc(r.league) + '</span><b class="num">' +
          esc(r.home.abbr) + ' ' + esc(r.home.score) + '–' + esc(r.away.score) + ' ' + esc(r.away.abbr) + '</b></div>';
      }).join('');
      $('psg').innerHTML =
        '<div class="label label--light"><b>Paris Saint-Germain</b>' + pos + '</div>' +
        (m ? '<div class="match">' + teamBlock(m.home) + '<div class="match__mid">' + mid + '</div>' + teamBlock(m.away) + '</div>' : '<div class="pad muted">No upcoming match</div>') +
        '<div class="psg-row">' + last + '</div>' +
        '<ul class="psg-news">' + p.news.slice(0, 1).map(function (a) { return '<li>' + esc(a.headline) + '</li>'; }).join('') + '</ul>';

      plData = d.pl;
      var plLive = d.pl.matches.some(function (x) { return x.state === 'in'; });
      document.querySelector('[data-open="pl"]').classList.toggle('is-on', plLive);
      if ($('ov-pl').classList.contains('is-open')) renderPl();
      return p.live || plLive;
    }).catch(function (e) { failed($('psg'), 'Football', e); });
  }

  function renderPl() {
    if (!plData) return;
    $('plRound').textContent = 'Premier League · this week';
    $('plMatches').innerHTML = plData.matches.map(function (x) {
      var live = x.state === 'in';
      var mid = x.state === 'pre'
        ? '<small>' + esc(fmt(new Date(x.date), { weekday: 'short' })) + '</small>' + esc(fmt(new Date(x.date), { hour: 'numeric', minute: '2-digit' }))
        : esc(x.home.score) + '–' + esc(x.away.score) + '<small>' + esc(live ? x.detail : 'FT') + '</small>';
      var name = function (t) { return '<span class="' + (x.state === 'post' && t.winner ? 'w' : '') + '">' + esc(t.name) + '</span>'; };
      var logo = function (t) { return t.logo ? '<img src="' + img(t.logo) + '" alt="">' : '<span></span>'; };
      return '<div class="pl-m' + (live ? ' is-live' : '') + '"><span class="h">' + name(x.home) + '</span>' + logo(x.home) +
        '<span class="s">' + mid + '</span>' + logo(x.away) + name(x.away) + '</div>';
    }).join('') || '<div class="pad muted">No matches this week</div>';
    var n = plData.table.length;
    $('plTable').innerHTML = plData.table.map(function (t) {
      var cls = t.rank <= 4 ? 'top4' : t.rank > n - 3 ? 'drop' : '';
      return '<tr class="' + cls + '"><td>' + t.rank + '</td><td>' + (t.logo ? '<img src="' + img(t.logo) + '" alt="">' : '') + esc(t.name) +
        '</td><td class="n">' + esc(t.gp) + '</td><td class="n">' + esc(t.gd) + '</td><td class="p">' + esc(t.pts) + '</td></tr>';
    }).join('');
  }
  openers.pl = renderPl;

  // ---------------------------------------------------------------- FPL
  function loadFpl() {
    return api('/api/fpl').then(function (d) {
      var dl = d.deadline;
      var stats = '<div class="stat stat--deadline"><small>GW' + (dl ? dl.gw : '') + ' due</small><b>' + (dl ? '<span data-countdown="' + esc(dl.time) + '">' + countdown(dl.time) + '</span>' : '—') + '</b></div>';
      var advice = [], label = '';
      if (d.team) {
        var t = d.team;
        label = esc(t.name) + ' · #' + (t.overallRank ? Number(t.overallRank).toLocaleString('en-US') : '—');
        stats += '<div class="stat"><small>GW' + d.gameweek.gw + ' pts</small><b>' + t.gwPoints + '</b></div>' +
          '<div class="stat"><small>Free TF</small><b>' + t.freeTransfers + '</b></div>' +
          '<div class="stat"><small>Bank</small><b>£' + esc(t.bank) + 'm</b></div>';
        if (t.advice.captain) advice.push('<li><em>Captain</em>' + esc(t.advice.captain.name) + ' <span class="muted">vs ' + esc(t.advice.captain.next) + '</span></li>');
        if (t.advice.transfer) advice.push('<li><em>Transfer</em>' + esc(t.advice.transfer.out) + ' → ' + esc(t.advice.transfer.in.name) + ' <span class="muted">£' + esc(t.advice.transfer.in.price) + 'm · ' + esc(t.advice.transfer.why) + '</span></li>');
        t.flagged.slice(0, 1).forEach(function (f) { advice.push('<li><em>Flag</em>' + esc(f.name) + ' <span class="muted">' + esc(f.news) + '</span></li>'); });
      } else {
        stats += '<div class="stat"><small>GW' + (d.gameweek ? d.gameweek.gw : '') + ' average</small><b>' + (d.gameweek ? d.gameweek.avg : '—') + '</b></div>' +
          '<div class="stat"><small>GW highest</small><b>' + (d.gameweek ? d.gameweek.highest : '—') + '</b></div><div></div>';
        d.topPicks.slice(0, 2).forEach(function (p) {
          advice.push('<li><em>Hot</em>' + esc(p.name) + ' <span class="muted">' + esc(p.pos) + ' £' + esc(p.price) + 'm · form ' + esc(p.form) + ' · ' + esc(p.next) + '</span></li>');
        });
      }
      (d.takes || []).slice(0, 6).forEach(function (k) { advice.push('<li data-read="' + esc(k.link) + '"><em>Take</em>' + esc(k.title) + '</li>'); });
      $('fpl').innerHTML = '<div class="label">Fantasy PL<span>' + label + '</span></div><div class="fpl-top">' + stats + '</div><ul class="fpl-advice">' + advice.join('') + '</ul>';
    }).catch(function (e) { failed($('fpl'), 'FPL', e); });
  }

  // ---------------------------------------------------------------- cricket
  function loadCricket() {
    return api('/api/cricket').then(function (d) {
      // A live match gets the whole card (batters, bowler, this over); otherwise show up to two.
      var shown = d.matches[0] && d.matches[0].live ? d.matches.slice(0, 1) : d.matches.slice(0, 2);
      var html = shown.map(function (m) {
        var tag = m.state === 'in' ? '<span class="pill pill--live">Live</span> ' : m.state === 'pre' ? '<span class="pill">' + esc(when(m.date)) + '</span> ' : '<span class="pill">Result</span> ';
        var lv = m.live, live = '';
        if (lv) {
          live = '<div class="cm__live">' + lv.batters.map(function (b, i) {
            return '<span class="who">🏏 ' + esc(b.name) + (i === 0 ? '*' : '') + '</span><span class="fig">' + b.runs + ' (' + b.balls + ')' + (b.sixes ? ' · ' + b.sixes + '×6' : '') + '</span>';
          }).join('') +
            (lv.bowler ? '<span class="who bowl">' + esc(lv.bowler.name) + ' (bowling)</span><span class="fig">' + lv.bowler.wickets + '/' + lv.bowler.conceded + ' (' + lv.bowler.overs + ')</span>' : '') + '</div>' +
            '<div class="over">This over ' + lv.thisOver.map(function (b) { return '<b class="b' + esc(b) + '">' + (b === '0' ? '·' : esc(b)) + '</b>'; }).join('') +
            '<span style="margin-left:auto">RR ' + esc(lv.runRate) + '</span></div>';
        }
        return '<div class="cm"><div class="cm__title">' + tag + esc(m.title) + '</div>' +
          m.teams.map(function (t) {
            return '<div class="cm__team' + (t.name === 'India' ? ' is-india' : '') + '">' + (t.logo ? '<img src="' + img(t.logo) + '" alt="">' : '') + esc(t.name) + '<span class="sc">' + esc(t.score) + '</span></div>';
          }).join('') +
          (m.summary && m.state !== 'pre' ? '<div class="cm__sum">' + esc(m.summary) + '</div>' : '') +
          (live || '<div class="cm__series">' + esc(m.series) + '</div>') + '</div>';
      }).join('');
      $('cricket').innerHTML = '<div class="label">India cricket</div>' + (html || '<div class="pad muted">No India matches right now</div>');
      return d.matches.some(function (m) { return m.state === 'in'; });
    }).catch(function (e) { failed($('cricket'), 'Cricket', e); });
  }

  // ---------------------------------------------------------------- stocks
  function spark(points) {
    if (!points || points.length < 2) return '';
    var lo = Math.min.apply(null, points), hi = Math.max.apply(null, points), span = hi - lo || 1;
    var pts = points.map(function (v, i) { return (i / (points.length - 1) * 56).toFixed(1) + ',' + (32 - (v - lo) / span * 30).toFixed(1); }).join(' ');
    return '<svg viewBox="0 0 56 34"><polyline points="' + pts + '"/></svg>';
  }
  function money(n) { return n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n.toFixed(2); }
  function loadStocks() {
    return api('/api/stocks').then(function (d) {
      $('stocks').innerHTML = '<div class="label">Markets<span>today</span></div><div class="tick-grid">' + d.quotes.map(function (q) {
        if (q.error) return '<div class="tick"><b>' + esc(q.symbol) + '</b><div class="muted">unavailable</div></div>';
        var up = q.change >= 0;
        return '<div class="tick ' + (up ? 'up' : 'down') + '"><b>' + esc(q.symbol) + '</b><small>' + esc(q.label) + '</small>' +
          '<div><span class="px">$' + money(q.price) + '</span><span class="chg">' + (up ? '+' : '') + q.pct.toFixed(2) + '%</span></div>' + spark(q.spark) + '</div>';
      }).join('') + '</div>';
    }).catch(function (e) { failed($('stocks'), 'Stocks', e); });
  }

  // ---------------------------------------------------------------- lists
  // Groceries and to-do each have their own card; body.list says which one an action is for.
  var lists = { groceries: [], todo: [] };
  function renderLists() {
    ['groceries', 'todo'].forEach(function (name) {
      var items = lists[name] || [];
      document.querySelector('[data-items="' + name + '"]').innerHTML = items.length ? items.map(function (i) {
        return '<li data-id="' + esc(i.id) + '" class="' + (i.done ? 'done' : '') + '"><i class="box"></i><span>' + esc(i.text) + '</span>' +
          (i.qty ? '<span class="qty">' + esc(i.qty) + '</span>' : '') +
          (i.food ? '<span class="kcal">' + i.food.kcal + ' kcal</span>' : '') + '</li>';
      }).join('') : '<li class="empty">Nothing here yet</li>';
    });
    if ($('ov-groceries').classList.contains('is-open')) renderGroceries();
  }
  function loadLists() { return api('/api/lists').then(function (d) { lists = d; renderLists(); }).catch(function () {}); }
  function listAction(body) {
    return api('/api/lists', { method: 'POST', body: JSON.stringify(body) }).then(function (d) { lists = d; renderLists(); });
  }

  // Expanded grocery view: calories, basket mix, suggestions from purchase history.
  var MIX = { produce: '#3ecf8e', protein: '#f5b84a', dairy: '#9cc2ff', grains: '#d4a373', pantry: '#8b94a7', drinks: '#6ee7f0', treats: '#ff6b9a' };
  function renderGroceries() {
    var items = lists.groceries || [];
    var open = items.filter(function (i) { return !i.done; });
    $('gxCount').textContent = open.length + ' to buy';
    $('gxItems').innerHTML = items.length ? items.map(function (i) {
      var meta = i.food ? '<span class="meta"><b>' + i.food.kcal + ' kcal</b>per ' + esc(i.food.per) + '</span>' : '<span class="meta">—</span>';
      var qty = '<span class="qtyc"><button data-q="-1" data-qid="' + esc(i.id) + '">−</button><span>' + esc(i.qty || '1') + '</span><button data-q="1" data-qid="' + esc(i.id) + '">+</button></span>';
      return '<li data-id="' + esc(i.id) + '" class="' + (i.done ? 'done' : '') + '"><i class="box"></i><span class="t">' + esc(i.text) + '</span>' + meta + qty +
        '<button class="rm" data-rm="' + esc(i.id) + '" aria-label="Remove">×</button></li>';
    }).join('') : '<li class="empty">Your list is empty</li>';
    var counts = {};
    open.forEach(function (i) { var c = i.food ? i.food.cat : 'pantry'; counts[c] = (counts[c] || 0) + 1; });
    var total = open.length || 1;
    $('gxMix').innerHTML = Object.keys(counts).map(function (c) { return '<i style="width:' + (counts[c] / total * 100) + '%;background:' + MIX[c] + '"></i>'; }).join('');
    $('gxLegend').innerHTML = Object.keys(counts).map(function (c) { return '<span style="--c:' + MIX[c] + '">' + c + ' ' + counts[c] + '</span>'; }).join('') ||
      '<span style="--c:var(--faint)">Add items to see the mix</span>';
  }
  function loadInsights() {
    return api('/api/groceries/insights').then(function (d) {
      $('gxSugg').innerHTML = d.suggestions.length ? d.suggestions.map(function (s) {
        return '<li><div><b>' + esc(s.text) + '</b><small>' + esc(s.reason) + (s.food ? ' · ' + s.food.kcal + ' kcal' : '') + '</small></div><button data-sugg="' + esc(s.text) + '">+ Add</button></li>';
      }).join('') : '<li class="empty">Check items off as you shop. After a couple of trips, I’ll suggest what you usually need.</li>';
      $('gxRecent').innerHTML = d.recent.map(function (r) { return '<span>' + esc(r.text) + ' <small class="muted">' + ago(new Date(r.at).toISOString()) + '</small></span>'; }).join('') ||
        '<span class="muted">Nothing yet</span>';
    }).catch(function () {});
  }
  // "2 lb" -> "3 lb"; a quantity without a number ("1 bunch") steps from 1; never below 1.
  function stepQty(qty, delta) {
    var m = String(qty || '1').match(/^(\d+(?:\.\d+)?)(.*)$/);
    var n = m ? parseFloat(m[1]) : 1, rest = m ? m[2] : ' ' + qty;
    return Math.max(1, n + delta) + rest;
  }
  $('gxItems').addEventListener('click', function (e) {
    var q = e.target.closest('[data-q]');
    if (q) {
      var item = (lists.groceries || []).filter(function (i) { return i.id === q.getAttribute('data-qid'); })[0];
      if (item) listAction({ list: 'groceries', action: 'qty', id: item.id, value: stepQty(item.qty, +q.getAttribute('data-q')) });
      return;
    }
    var rm = e.target.closest('[data-rm]');
    if (rm) return listAction({ list: 'groceries', action: 'remove', id: rm.getAttribute('data-rm') });
    var li = e.target.closest('li[data-id]');
    if (li) listAction({ list: 'groceries', action: 'toggle', id: li.getAttribute('data-id') }).then(loadInsights);
  });
  $('gxSugg').addEventListener('click', function (e) {
    var b = e.target.closest('[data-sugg]');
    if (b) listAction({ list: 'groceries', action: 'add', text: b.getAttribute('data-sugg') }).then(loadInsights);
  });
  $('gxAdd').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('gxText');
    if (!input.value.trim()) return;
    // Comma-separated adds several at once: "milk, eggs, spinach"
    var parts = input.value.split(',').filter(function (t) { return t.trim(); });
    parts.reduce(function (p, t) { return p.then(function () { return listAction({ list: 'groceries', action: 'add', text: t }); }); }, Promise.resolve())
      .then(function () { input.value = ''; input.blur(); loadInsights(); });
  });
  openers.groceries = function () { renderGroceries(); loadInsights(); };
  document.querySelectorAll('[data-items]').forEach(function (ul) {
    ul.addEventListener('click', function (e) {
      var li = e.target.closest('li[data-id]');
      if (li) listAction({ list: ul.getAttribute('data-items'), action: 'toggle', id: li.getAttribute('data-id') });
    });
  });
  document.querySelectorAll('[data-clear]').forEach(function (b) {
    b.addEventListener('click', function () { listAction({ list: b.getAttribute('data-clear'), action: 'clear_done' }); });
  });
  document.querySelectorAll('[data-add]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = form.querySelector('input');
      if (!input.value.trim()) return;
      listAction({ list: form.getAttribute('data-add'), action: 'add', text: input.value }).then(function () { input.value = ''; input.blur(); });
    });
  });

  // ---------------------------------------------------------------- news
  var news = { top: [], markets: [] }, currentFeed = 'top';
  function renderNews() {
    $('headlines').innerHTML = (news[currentFeed] || []).map(function (a) {
      return '<li data-read="' + esc(a.link) + '">' + esc(a.title) + '<small>' + esc(a.source) + (a.published ? ' · ' + ago(a.published) : '') + '</small></li>';
    }).join('');
  }
  function loadNews() { return api('/api/news').then(function (d) { news = d; renderNews(); }).catch(function (e) { failed($('news'), 'News', e); }); }
  function setFeed(f) {
    currentFeed = f;
    document.querySelectorAll('[data-feed]').forEach(function (x) { x.classList.toggle('is-on', x.getAttribute('data-feed') === f); });
    renderNews();
  }
  document.querySelectorAll('[data-feed]').forEach(function (b) { b.addEventListener('click', function () { setFeed(b.getAttribute('data-feed')); }); });

  // ---------------------------------------------------------------- article reader (tap a news headline or FPL take)
  function openReader(link) {
    $('reader').innerHTML = '<div class="loading">Loading article…</div>';
    $('reader').scrollTop = 0;
    openOv('read');
    api('/api/read?u=' + encodeURIComponent(link)).then(function (a) {
      $('reader').innerHTML = '<h1>' + esc(a.title) + '</h1><div class="src">' + esc(a.site) + '</div>' +
        (a.paragraphs.length ? a.paragraphs.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') : '<p class="muted">This article has no readable text.</p>');
    }).catch(function (e) { $('reader').innerHTML = '<div class="loading">Couldn’t load this article (' + esc(e.message) + ')</div>'; });
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-read]');
    if (el && el.getAttribute('data-read')) openReader(el.getAttribute('data-read'));
  });

  // ---------------------------------------------------------------- health: water + supplements, with gentle reminders
  var healthData = null, lastNudge = '';
  function minutesNow() { var p = fmt(new Date(), { hour: '2-digit', minute: '2-digit', hour12: false }).split(':'); return (+p[0] % 24) * 60 + +p[1]; }
  function toMin(hhmm) { var p = hhmm.split(':'); return +p[0] * 60 + +p[1]; }
  function healthDue(d) {
    var now = minutesNow(), w = d.water, due = [];
    // Expected glasses so far if the goal is spread evenly across the waking window.
    var frac = Math.max(0, Math.min(1, (now - w.start * 60) / ((w.end - w.start) * 60)));
    var expected = Math.floor(w.goal * frac);
    if (d.today.water < expected) due.push('Drink some water (' + d.today.water + '/' + expected + ' so far)');
    d.supplements.forEach(function (s) { if (!d.today.taken[s.id] && now >= toMin(s.at)) due.push('Take your ' + s.name); });
    return due;
  }
  function renderHealth() {
    var d = healthData;
    if (!d) return;
    var w = d.water, n = d.today.water, due = healthDue(d);
    var drops = '';
    for (var i = 0; i < w.goal; i++) drops += '<i class="' + (i < n ? 'on' : '') + '"></i>';
    $('health').classList.toggle('is-due', due.length > 0);
    $('health').innerHTML = '<div class="label">Health today<span>' + n * w.glassOz + ' oz water</span></div>' +
      '<div class="water"><div class="water__num">' + n + '<small> / ' + w.goal + ' ' + esc(w.unit) + '</small></div>' +
      '<div class="water__btns"><button data-water="-1" aria-label="Remove a glass">−</button><button class="plus" data-water="1" aria-label="Add a glass">+</button></div></div>' +
      '<div class="drops">' + drops + '</div>' +
      '<ul class="supp">' + d.supplements.map(function (s) {
        var t = d.today.taken[s.id];
        return '<li data-take="' + esc(s.id) + '" class="' + (t ? 'done' : '') + '"><i class="box"></i>' + esc(s.name) + ' <span class="muted">' + esc(s.dose) + '</span>' +
          '<span class="at">' + (t ? 'taken ' + fmt(new Date(t), { hour: 'numeric', minute: '2-digit' }) : 'due ' + esc(s.at)) + '</span></li>';
      }).join('') + '</ul>' +
      (due.length ? '<div class="nudge">' + esc(due[0]) + '</div>' : '');
    // One toast per reminder per hour so it nudges without nagging.
    var key = due[0] ? due[0].split(' (')[0] + '@' + fmt(new Date(), { hour: 'numeric' }) : '';
    if (key && key !== lastNudge) { lastNudge = key; toast(due[0]); }
  }
  function loadHealth() { return api('/api/health').then(function (d) { healthData = d; renderHealth(); }).catch(function (e) { failed($('health'), 'Health', e); }); }
  $('health').addEventListener('click', function (e) {
    var w = e.target.closest('[data-water]'), t = e.target.closest('[data-take]');
    var body = w ? { action: 'water', delta: +w.getAttribute('data-water') } : t ? { action: 'take', id: t.getAttribute('data-take') } : null;
    if (body) api('/api/health', { method: 'POST', body: JSON.stringify(body) }).then(function (d) { healthData = d; renderHealth(); });
  });

  // ---------------------------------------------------------------- smart home: Voice Monkey triggers fire Alexa routines
  var HOME_ICONS = {
    light: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
    purifier: '<rect x="6" y="3" width="12" height="18" rx="3"/><path d="M9 8h6M9 11h6M9 14h6"/>',
    other: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  };
  var home = null, lastAction = store('homeLast') || {};
  function renderHome() {
    if (!home) return;
    $('hmDevices').innerHTML = home.devices.map(function (d) {
      var last = lastAction[d.name];
      return '<div class="dev' + (last && /^on|\d/i.test(last) ? ' is-on' : '') + '"><div class="dev__top"><span class="dev__icon"><svg viewBox="0 0 24 24">' + HOME_ICONS[d.kind] + '</svg></span></div>' +
        '<div><div class="dev__name">' + esc(d.name) + '</div><div class="dev__state">' + (last ? 'Last: ' + esc(last) : home.connected ? 'Ready' : 'Not connected') + '</div></div>' +
        '<div class="dev__ctl">' + (d.actions.length ? d.actions.map(function (a) {
          return '<button data-trigger="' + esc(a.id) + '" data-dev="' + esc(d.name) + '" data-label="' + esc(a.label) + '">' + esc(a.label) + '</button>';
        }).join('') : '<button disabled>—</button>') + '</div></div>';
    }).join('') || (home.scenes.length ? '' : '<div class="muted">No Voice Monkey triggers yet. Create some named like “Room Lights On”.</div>');
    $('hmScenes').innerHTML = home.scenes.map(function (s) {
      var icon = /night|off|sleep/i.test(s.name) ? '🌙' : /light/i.test(s.name) ? '💡' : '✨';
      return '<button class="scene" data-trigger="' + esc(s.id) + '" data-label="' + esc(s.name) + '"><span class="scene__icon">' + icon + '</span><b>' + esc(s.name) + '</b><small>Tap to run</small></button>';
    }).join('') || '<div class="muted">Add triggers named “Scene Movie”, “Scene Bedtime”… for one-tap scenes.</div>';
    $('hmNote').textContent = home.connected ? 'Buttons run your Alexa routines through Voice Monkey.' : 'Preview: connect Voice Monkey to make these work.';
  }
  $('ov-home').addEventListener('click', function (e) {
    var b = e.target.closest('[data-trigger]');
    if (!b) return;
    if (!home || !home.connected) return toast('Smart home isn’t connected yet');
    b.disabled = true;
    api('/api/home', { method: 'POST', body: JSON.stringify({ trigger: b.getAttribute('data-trigger') }) }).then(function () {
      var dev = b.getAttribute('data-dev'), label = b.getAttribute('data-label');
      if (dev) { lastAction[dev] = label; store('homeLast', lastAction); }
      toast((dev ? dev + ': ' : '') + label);
      renderHome();
    }).catch(function (err) { toast('Didn’t work: ' + err.message); b.disabled = false; });
  });
  openers.home = function () {
    renderHome();
    api('/api/home').then(function (d) { home = d; renderHome(); }).catch(function (e) { $('hmNote').textContent = 'Couldn’t reach Voice Monkey (' + e.message + ')'; });
  };

  // ---------------------------------------------------------------- focus timer
  var RING = 565.49;
  var focus = store('focus') || { mode: 'focus', total: 25 * 60e3, remaining: 25 * 60e3, endsAt: null, task: '' };
  var audio = null;

  function focusLeft() { return focus.endsAt ? focus.endsAt - Date.now() : focus.remaining; }
  function saveFocus() { store('focus', focus); }
  function beep() {
    if (!audio) return;
    [0, .35, .7].forEach(function (t) {
      var o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
      g.gain.setValueAtTime(.0001, audio.currentTime + t);
      g.gain.exponentialRampToValueAtTime(.4, audio.currentTime + t + .02);
      g.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + t + .3);
      o.start(audio.currentTime + t); o.stop(audio.currentTime + t + .32);
    });
  }
  function focusStats() {
    var s = store('focusStats');
    return s && s.day === dayKey(new Date()) ? s : { day: dayKey(new Date()), sessions: 0, minutes: 0 };
  }
  function renderFocus() {
    var left = focusLeft();
    $('focusTime').textContent = mmss(left);
    $('focusBar').style.strokeDashoffset = String(RING * (1 - left / focus.total));
    $('focusState').textContent = focus.endsAt ? (focus.mode === 'break' ? 'Break' : 'Focusing') : left < focus.total ? 'Paused' : 'Ready';
    $('focusGo').textContent = focus.endsAt ? 'Pause' : left < focus.total ? 'Resume' : 'Start';
    $('focusTask').textContent = focus.task || 'Pick a to-do';
    $('ov-focus').classList.toggle('is-break', focus.mode === 'break');
    document.querySelectorAll('[data-min]').forEach(function (b) { b.classList.toggle('is-on', +b.getAttribute('data-min') * 60e3 === focus.total); });
    var st = focusStats();
    $('focusStats').textContent = st.sessions ? 'Today: ' + st.sessions + ' session' + (st.sessions > 1 ? 's' : '') + ' · ' + st.minutes + ' min' : 'No sessions yet today';
  }
  function focusTick() {
    focusMini = focus.endsAt ? (focus.mode === 'break' ? 'Break ' : 'Focus ') + mmss(focusLeft()) + ' left' : '';
    document.querySelector('[data-open="focus"]').classList.toggle('is-on', !!focus.endsAt);
    if (focus.endsAt && focusLeft() <= 0) {
      var wasFocus = focus.mode === 'focus';
      if (wasFocus) {
        var st = focusStats();
        st.sessions += 1; st.minutes += Math.round(focus.total / 60e3);
        store('focusStats', st);
      }
      beep();
      focus = { mode: wasFocus ? 'break' : 'focus', total: (wasFocus ? 5 : 25) * 60e3, remaining: (wasFocus ? 5 : 25) * 60e3, endsAt: null, task: focus.task };
      saveFocus();
      openOv('focus');
      toast(wasFocus ? 'Nice work! Take a 5 minute break.' : 'Break over. Ready for another?');
    }
    if ($('ov-focus').classList.contains('is-open')) renderFocus();
  }
  $('focusGo').addEventListener('click', function () {
    if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (audio && audio.state === 'suspended') audio.resume();
    if (focus.endsAt) { focus.remaining = focusLeft(); focus.endsAt = null; }
    else focus.endsAt = Date.now() + focus.remaining;
    saveFocus(); renderFocus();
  });
  $('focusReset').addEventListener('click', function () {
    focus.endsAt = null; focus.remaining = focus.total; saveFocus(); renderFocus();
  });
  document.querySelectorAll('[data-min]').forEach(function (b) {
    b.addEventListener('click', function () {
      var min = +b.getAttribute('data-min');
      focus = { mode: min <= 10 ? 'break' : 'focus', total: min * 60e3, remaining: min * 60e3, endsAt: null, task: focus.task };
      saveFocus(); renderFocus();
    });
  });
  $('focusTask').addEventListener('click', function () {
    var todos = (lists.todo || []).filter(function (i) { return !i.done; }).map(function (i) { return i.text; });
    var options = [''].concat(todos);
    focus.task = options[(options.indexOf(focus.task) + 1) % options.length];
    saveFocus(); renderFocus();
  });
  openers.focus = renderFocus;

  // ---------------------------------------------------------------- chess puzzles (Lichess)
  var chess = null, sol = [], step = 0, solver = 'w', sel = null, last = [], hintSq = null, puzzle = null, mistake = false;
  var PIECE_URL = 'https://lichess1.org/assets/piece/cburnett/';
  function pieceSrc(code) { return img(PIECE_URL + code + '.svg'); }

  function sqName(f, r) { return 'abcdefgh'[f] + (r + 1); }
  function renderBoard(badSq) {
    var html = '', legal = sel ? chess.moves({ square: sel, verbose: true }) : [];
    for (var row = 0; row < 8; row++) {
      for (var col = 0; col < 8; col++) {
        var f = solver === 'w' ? col : 7 - col, r = solver === 'w' ? 7 - row : row, sq = sqName(f, r);
        var p = chess.get(sq), cls = ['sq', (f + r) % 2 ? 'l' : 'd'];
        if (sq === sel) cls.push('sel');
        if (last.indexOf(sq) >= 0) cls.push('last');
        if (sq === hintSq) cls.push('hint');
        if (sq === badSq) cls.push('bad');
        var mv = legal.filter(function (m) { return m.to === sq; })[0];
        html += '<div class="' + cls.join(' ') + '" data-sq="' + sq + '">' +
          (p ? '<img src="' + pieceSrc(p.color + p.type.toUpperCase()) + '" alt="">' : '') +
          (mv ? (p ? '<i class="cap"></i>' : '<i class="dot"></i>') : '') +
          (col === 0 ? '<span class="coord">' + (r + 1) + '</span>' : '') + '</div>';
      }
    }
    $('board').innerHTML = html;
  }
  function chessMsg(text, cls) { $('chessMsg').textContent = text; $('chessMsg').className = 'chess__msg ' + (cls || ''); }
  function chessStreak() {
    var s = store('chessStreak') || 0;
    $('chessStreak').textContent = s ? 'Streak: ' + s + ' solved in a row' : '';
  }
  function uciMove(uci) { return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' }); }
  function solved() {
    chessMsg(mistake ? 'Solved, but it took a retry.' : 'Solved! Nice.', 'good');
    store('chessStreak', mistake ? 0 : (store('chessStreak') || 0) + 1);
    chessStreak();
    sol = []; // stop accepting moves
  }
  function opponentReply() {
    if (step >= sol.length) return solved();
    setTimeout(function () {
      var m = uciMove(sol[step]);
      last = [m.from, m.to]; step++;
      renderBoard();
      if (step >= sol.length) solved(); else chessMsg('Keep going: find the next move.');
    }, 450);
  }
  function tryMove(from, to) {
    var piece = chess.get(from);
    var expected = sol[step] || '';
    var promo = piece.type === 'p' && (to[1] === '8' || to[1] === '1') ? (expected.slice(0, 4) === from + to && expected[4] ? expected[4] : 'q') : '';
    var uci = from + to + promo;
    var m = chess.move({ from: from, to: to, promotion: promo || undefined });
    if (!m) return;
    if (uci === expected || chess.in_checkmate()) {
      sel = null; hintSq = null; last = [from, to]; step++;
      renderBoard();
      if (chess.in_checkmate()) return solved();
      chessMsg('Good move!', 'good');
      opponentReply();
    } else {
      chess.undo();
      mistake = true; sel = null;
      renderBoard(to);
      chessMsg('Not quite. Try again.', 'bad');
      setTimeout(function () { renderBoard(); }, 600);
    }
  }
  $('board').addEventListener('click', function (e) {
    var el = e.target.closest('[data-sq]');
    if (!el || !sol.length || chess.turn() !== solver) return;
    var sq = el.getAttribute('data-sq'), p = chess.get(sq);
    if (sel && chess.moves({ square: sel, verbose: true }).some(function (m) { return m.to === sq; })) return tryMove(sel, sq);
    sel = p && p.color === solver ? (sel === sq ? null : sq) : null;
    renderBoard();
  });
  function themeWords(t) { return t.replace(/([A-Z])/g, ' $1').replace(/^mateIn(\d)/i, 'mate in $1').toLowerCase(); }
  function loadPuzzle(mode) {
    chessMsg('Loading…');
    return api('/api/chess' + (mode === 'next' ? '?mode=next' : '')).then(function (d) {
      puzzle = d; chess = new Chess();
      d.game.pgn.split(' ').forEach(function (san) { chess.move(san); });
      var h = chess.history({ verbose: true }), lm = h[h.length - 1];
      sol = d.puzzle.solution.slice(); step = 0; sel = null; hintSq = null; mistake = false;
      last = lm ? [lm.from, lm.to] : [];
      solver = chess.turn();
      $('chessTitle').textContent = (solver === 'w' ? 'White' : 'Black') + ' to move';
      $('chessMeta').textContent = (mode === 'next' ? 'Puzzle' : 'Daily puzzle') + ' · rating ' + d.puzzle.rating + ' · ' +
        d.puzzle.themes.filter(function (t) { return ['short', 'long', 'oneMove', 'veryLong'].indexOf(t) < 0; }).slice(0, 3).map(themeWords).join(', ');
      chessMsg('Find the best move.');
      chessStreak();
      renderBoard();
    }).catch(function (e) { chessMsg('Could not load a puzzle (' + e.message + ')', 'bad'); });
  }
  $('chessHint').addEventListener('click', function () {
    if (!sol[step]) return;
    hintSq = sol[step].slice(0, 2); mistake = true; renderBoard();
  });
  $('chessShow').addEventListener('click', function () {
    if (!sol.length) return;
    mistake = true;
    (function play() {
      if (step >= sol.length) { chessMsg('That was the solution.'); sol = []; store('chessStreak', 0); chessStreak(); return; }
      var m = uciMove(sol[step]); last = [m.from, m.to]; step++; renderBoard();
      setTimeout(play, 700);
    })();
  });
  $('chessNext').addEventListener('click', function () { loadPuzzle('next'); });
  $('chessDaily').addEventListener('click', function () { loadPuzzle('daily'); });
  openers.chess = function () { if (!puzzle) loadPuzzle('daily'); };

  // ---------------------------------------------------------------- screensaver: photos when idle, dim clock at night
  var lastTouch = Date.now(), photos = null, photoIdx = 0, photoTimer = null, saverSide = 'A';
  ['touchstart', 'mousedown', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, function () { lastTouch = Date.now(); }, true);
  });
  function isNight(now) { var h = +fmt(now, { hour: 'numeric', hour12: false }); return h >= 23 || h < 6; }
  function showPhoto() {
    if (!photos || !photos.length) return;
    var src = photos[photoIdx++ % photos.length] + (KEY ? '?k=' + encodeURIComponent(KEY) : '');
    var img = new Image();
    img.onload = function () {
      var next = $(saverSide === 'A' ? 'saverB' : 'saverA'), prev = $(saverSide === 'A' ? 'saverA' : 'saverB');
      next.style.backgroundImage = 'url("' + src + '")';
      next.classList.add('is-on'); prev.classList.remove('is-on');
      saverSide = saverSide === 'A' ? 'B' : 'A';
    };
    img.src = src;
  }
  function openSaver() {
    $('ov-saver').classList.add('is-open');
    var go = function () {
      $('ov-saver').classList.toggle('is-night', isNight(new Date()) || !photos || !photos.length);
      showPhoto();
      clearInterval(photoTimer);
      photoTimer = setInterval(showPhoto, 12e3);
    };
    if (photos) go();
    else api('/api/photos').then(function (list) {
      photos = list.map(function (p) { return p.src; }).sort(function () { return Math.random() - .5; });
      go();
    }).catch(function () { photos = []; go(); });
  }
  function closeSaver() {
    $('ov-saver').classList.remove('is-open');
    clearInterval(photoTimer);
    lastTouch = Date.now();
  }
  $('ov-saver').addEventListener('click', closeSaver);
  openers.saver = function () { $('ov-saver').classList.remove('is-open'); openSaver(); };
  function saverTick(now) {
    var open = $('ov-saver').classList.contains('is-open');
    if (!open && now - lastTouch > IDLE_MS && !focus.endsAt) openSaver();
    if (!open) return;
    var parts = fmt(now, { hour: 'numeric', minute: '2-digit' });
    $('saverTime').textContent = parts.replace(/ [AP]M$/, '');
    $('saverDate').textContent = fmt(now, { weekday: 'long', month: 'long', day: 'numeric' });
    var b = birthdays.filter(function (x) { return x.days <= 7; })[0];
    $('saverLine').textContent = [weatherNow, b ? b.emoji + ' ' + b.name + (b.days === 0 ? ' today!' : ' in ' + b.days + (b.days === 1 ? ' day' : ' days')) : ''].filter(Boolean).join('  ·  ');
    $('ov-saver').classList.toggle('is-night', isNight(now) || !photos || !photos.length);
  }

  // ---------------------------------------------------------------- schedule
  function every(fn, ms) { fn(); return setInterval(fn, ms); }
  applyTheme();
  every(loadLists, 10e3);
  every(loadBirthdays, 60 * 60e3);
  every(loadHealth, 15e3);
  tick();
  setInterval(tick, 1000);
  setInterval(applyTheme, 60e3);
  every(loadClaude, 5 * 60e3);
  every(loadWeather, 15 * 60e3);
  every(loadNews, 15 * 60e3);
  every(loadStocks, 2 * 60e3);
  every(loadFpl, 5 * 60e3);
  // Rotate feeds only when nobody has touched the screen for a minute, so reading isn't interrupted.
  setInterval(function () { if (Date.now() - lastTouch > 60e3) setFeed(currentFeed === 'top' ? 'markets' : 'top'); }, 45e3);

  // Sports refresh faster while something is live.
  function sportsLoop() {
    Promise.all([loadFootball(), loadCricket()]).then(function (live) {
      setTimeout(sportsLoop, (live[0] || live[1]) ? 60e3 : 5 * 60e3);
      $('status').textContent = '· updated ' + fmt(new Date(), { hour: 'numeric', minute: '2-digit' });
    });
  }
  sportsLoop();

  // Reload when a new version has been deployed (checked every minute), and once a day at 4am to clear memory.
  var loadedVersion = null;
  setInterval(function () {
    api('/api/version').then(function (d) {
      if (loadedVersion && d.version !== loadedVersion) location.reload();
      loadedVersion = d.version;
    }).catch(function () {});
  }, 60e3);
  // Daily reload:
  setInterval(function () { if (fmt(new Date(), { hour: '2-digit', minute: '2-digit', hour12: false }) === '04:00') location.reload(); }, 60e3);

  // Deep links for testing: ?open=focus|chess|pl|saver
  var openParam = new URLSearchParams(location.search).get('open');
  if (openParam && $('ov-' + openParam)) openOv(openParam);
})();
