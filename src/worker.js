// Desk dashboard backend: proxies and trims public data feeds for the frame,
// and stores the grocery / to-do lists in KV. Static files come from ./public.
import MANUAL_BIRTHDAYS from './birthdays.js';
import { lookupFood, splitQty } from './foods.js';
import { PREVIEW, homeState, trigger } from './home.js';
import { HEALTH } from './health.js';
import { handleAlexa } from './alexa.js';

const LAT = 38.9012, LON = -77.2653; // Vienna, VA
const TZ = 'America/New_York';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const PSG = 160; // ESPN team id
const UA = { 'User-Agent': 'Mozilla/5.0 (desk-dashboard)' };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/img') return image(url, ctx);
    // Alexa can't send the dashboard key; alexa.js verifies Amazon's request signature instead.
    if (url.pathname === '/alexa' && request.method === 'POST') return handleAlexa(request, env, alexaApi(env));
    const isPrivate = url.pathname.startsWith('/api/') || url.pathname.startsWith('/photos/');
    if (!isPrivate) return env.ASSETS.fetch(request);
    if (env.DASH_TOKEN && request.headers.get('x-dash-key') !== env.DASH_TOKEN && url.searchParams.get('k') !== env.DASH_TOKEN) {
      return json({ error: 'unauthorized' }, 401);
    }
    // Photos live in KV (uploaded by scripts/add-photos.sh), so deploys from GitHub never carry them.
    if (url.pathname.startsWith('/photos/')) {
      const img = await env.LISTS.get(`photo:${url.pathname.slice(8)}`, 'arrayBuffer');
      return img ? new Response(img, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400' } }) : new Response('not found', { status: 404 });
    }
    try {
      return await route(request, env, ctx, url);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 502);
    }
  },
};

// API routes. Awaited by the caller, so a failure inside cached() becomes a 502, not a crash.
async function route(request, env, ctx, url) {
  switch (url.pathname) {
    case '/api/weather': return cached(request, ctx, 600, weather);
    case '/api/cricket': return cached(request, ctx, 60, cricket);
    case '/api/football': return cached(request, ctx, 60, football);
    case '/api/news': return cached(request, ctx, 900, news);
    case '/api/stocks': return cached(request, ctx, 60, stocks);
    case '/api/fpl': return cached(request, ctx, 120, () => fpl(url.searchParams.get('entry') || env.FPL_ENTRY));
    case '/api/lists': return lists(request, env);
    case '/api/chess':
      return url.searchParams.get('mode') === 'next'
        ? json(await getJSON('https://lichess.org/api/puzzle/next'))
        : cached(request, ctx, 3600, () => getJSON('https://lichess.org/api/puzzle/daily'));
    case '/api/photos': return json((await kvJSON(env, 'photos:manifest')) || []);
    case '/api/birthdays': return json(await birthdays(env));
    // The page polls this and reloads itself when a new version is deployed.
    case '/api/version': return json({ version: env.CF_VERSION?.id || 'dev' });
    case '/api/groceries/insights': return json(await groceryInsights(env));
    case '/api/health': return health(request, env);
    case '/api/read': return cached(request, ctx, 86400, () => readArticle(url.searchParams.get('u')));
    case '/api/home':
      if (!env.VOICEMONKEY_TOKEN) return request.method === 'GET' ? json(PREVIEW) : json({ error: 'Smart home is not connected yet' }, 501);
      if (request.method === 'GET') return json(await homeState(env.VOICEMONKEY_TOKEN));
      return json(await trigger(env.VOICEMONKEY_TOKEN, (await request.json()).trigger));
    case '/api/claude': return json(await claudeStatus(env));
    case '/api/claude/hi': return request.method === 'POST' ? claudeHi(env) : json({ error: 'method' }, 405);
  }
  return json({ error: 'not found' }, 404);
}

// What the Alexa skill can do, built on the same handlers the frame uses.
function alexaApi(env) {
  const call = (path, body) => new Request(`https://desk.local${path}`, body ? { method: 'POST', body: JSON.stringify(body) } : {});
  return {
    lists: async () => (await lists(call('/api/lists'), env)).json(),
    listAdd: (list, text) => lists(call('/api/lists', { list, action: 'add', text }), env),
    water: async () => (await health(call('/api/health', { action: 'water', delta: 1 }), env)).json(),
    async takeSupplement(name) {
      const d = await (await health(call('/api/health'), env)).json();
      const s = d.supplements.find((x) => x.name.toLowerCase().includes(name) || name.includes(x.name.toLowerCase()));
      if (!s) return null;
      if (!d.today.taken[s.id]) await health(call('/api/health', { action: 'take', id: s.id }), env);
      return s.name;
    },
    fpl: () => fpl(env.FPL_ENTRY),
    football: () => football(),
    cricket: () => cricket(),
    claudeHi: async () => (await claudeHi(env)).ok,
  };
}

// ---------------------------------------------------------------- helpers

// Image proxy for team logos and chess pieces: the frame's old trust store (and, over USB, its lack
// of internet) can't load these hosts directly. Only allowlisted hosts are fetched.
const IMG_HOSTS = ['a.espncdn.com', 'lichess1.org'];

async function image(url, ctx) {
  let target;
  try { target = new URL(url.searchParams.get('u')); } catch { return new Response('bad url', { status: 400 }); }
  if (target.protocol !== 'https:' || !IMG_HOSTS.includes(target.hostname)) return new Response('host not allowed', { status: 403 });
  const key = new Request(target.toString());
  const hit = await caches.default.match(key);
  if (hit) return hit;
  const res = await fetch(target, { headers: UA });
  if (!res.ok) return new Response('upstream ' + res.status, { status: 502 });
  const out = new Response(res.body, {
    headers: { 'content-type': res.headers.get('content-type') || 'image/png', 'cache-control': 'public, max-age=604800' },
  });
  ctx.waitUntil(caches.default.put(key, out.clone()));
  return out;
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

async function cached(request, ctx, ttl, fn) {
  const cache = caches.default;
  const key = new Request(new URL(request.url).toString().replace(/[?&]k=[^&]*/, ''), { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return new Response(hit.body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  const body = JSON.stringify({ ...(await fn()), fetchedAt: new Date().toISOString() });
  ctx.waitUntil(cache.put(key, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${ttl}` } })));
  return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

async function getJSON(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

const score = (s) => (s == null ? null : typeof s === 'object' ? s.displayValue : s);

// ---------------------------------------------------------------- weather

async function weather() {
  const q = new URLSearchParams({
    latitude: LAT, longitude: LON, timezone: TZ,
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch', forecast_days: '7',
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
  });
  const d = await getJSON(`https://api.open-meteo.com/v1/forecast?${q}`);
  const c = d.current;
  return {
    now: {
      temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature),
      humidity: c.relative_humidity_2m, wind: Math.round(c.wind_speed_10m), code: c.weather_code, isDay: !!c.is_day,
    },
    days: d.daily.time.map((date, i) => ({
      date, code: d.daily.weather_code[i],
      hi: Math.round(d.daily.temperature_2m_max[i]), lo: Math.round(d.daily.temperature_2m_min[i]),
      rain: d.daily.precipitation_probability_max[i],
      sunrise: d.daily.sunrise[i], sunset: d.daily.sunset[i],
    })),
    // Next 24 hours from the current hour (local wall-clock times).
    hours: d.hourly.time.map((time, i) => ({
      time, temp: Math.round(d.hourly.temperature_2m[i]), rain: d.hourly.precipitation_probability[i],
      code: d.hourly.weather_code[i], isDay: !!d.hourly.is_day[i],
    })).filter((h) => h.time >= c.time.slice(0, 13)).slice(0, 24),
  };
}

// ---------------------------------------------------------------- cricket (India men's team)

async function cricket() {
  const d = await getJSON('https://site.api.espn.com/apis/v2/scoreboard/header?sport=cricket');
  const matches = [];
  for (const league of d.sports?.[0]?.leagues || []) {
    for (const e of league.events || []) {
      const teams = e.competitors || [];
      if (!teams.some((t) => t.displayName === 'India')) continue;
      matches.push({
        id: e.id, league: league.id,
        title: e.description || e.name,
        series: league.name,
        state: e.status, // pre | in | post
        date: e.date,
        summary: e.fullStatus?.longSummary || e.fullStatus?.summary || e.summary || '',
        teams: teams.map((t) => ({ name: t.displayName, abbr: t.abbreviation, score: t.score || '', winner: !!t.winner, logo: t.logo })),
      });
    }
  }
  const rank = { in: 0, pre: 1, post: 2 };
  matches.sort((a, b) => rank[a.state] - rank[b.state] || (a.state === 'post' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
  const top = matches.slice(0, 3);
  await Promise.all(top.filter((m) => m.state === 'in').map(async (m) => {
    try { m.live = await cricketLive(m.league, m.id); } catch { m.live = null; }
  }));
  return { matches: top };
}

// Who's batting and bowling, from the last page of ball-by-ball commentary.
async function cricketLive(league, event) {
  const base = `https://site.api.espn.com/apis/site/v2/sports/cricket/${league}/playbyplay?event=${event}&limit=25`;
  const first = await getJSON(base);
  const pages = first.commentary?.pageCount || 1;
  const items = (pages > 1 ? await getJSON(`${base}&page=${pages}`) : first).commentary?.items || [];
  const last = items[items.length - 1];
  if (!last) return null;
  const bat = (b) => b && { name: b.athlete.displayName, runs: b.totalRuns, balls: b.faced, fours: b.fours, sixes: b.sixes };
  const ball = (x) => x.dismissal?.dismissal ? 'W' : /wide/i.test(x.playType?.description) ? 'wd' : /no ball/i.test(x.playType?.description) ? 'nb' : String(x.scoreValue ?? 0);
  const inn = last.innings || {};
  return {
    batting: last.team?.displayName,
    batters: [bat(last.batsman), bat(last.otherBatsman)].filter(Boolean),
    bowler: last.bowler && { name: last.bowler.athlete.displayName, overs: last.bowler.overs, wickets: last.bowler.wickets, conceded: last.bowler.conceded },
    thisOver: items.filter((x) => x.over?.number === last.over?.number && x.period === last.period).map(ball),
    last: last.shortText,
    runRate: inn.runRate, target: inn.target || null, need: inn.remainingRuns || null,
    score: `${inn.runs}/${inn.wickets}`, overs: last.over?.overs,
  };
}

// ---------------------------------------------------------------- football (PSG + Premier League)

function mapEvent(e) {
  const c = e.competitions?.[0] || {};
  const side = (ha) => {
    const t = (c.competitors || []).find((x) => x.homeAway === ha) || {};
    return { name: t.team?.shortDisplayName || t.team?.displayName, abbr: t.team?.abbreviation, score: score(t.score), logo: t.team?.logo || t.team?.logos?.[0]?.href, winner: t.winner };
  };
  const st = c.status?.type || e.status?.type || {};
  return {
    id: e.id, date: e.date, league: e.league?.abbreviation || e.league?.name || c.type?.abbreviation || '',
    state: st.state, detail: st.shortDetail || st.detail, home: side('home'), away: side('away'),
    venue: c.venue?.fullName,
  };
}

async function football() {
  const [pl, psgPast, psgNext, table, psgNews, plTable] = await Promise.all([
    getJSON(`${ESPN}/soccer/eng.1/scoreboard`),
    getJSON(`${ESPN}/soccer/all/teams/${PSG}/schedule`),
    getJSON(`${ESPN}/soccer/all/teams/${PSG}/schedule?fixture=true`),
    getJSON('https://site.api.espn.com/apis/v2/sports/soccer/fra.1/standings'),
    getJSON(`${ESPN}/soccer/fra.1/news?team=${PSG}&limit=6`),
    getJSON('https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings'),
  ]);
  const results = (psgPast.events || []).map(mapEvent).filter((m) => m.state === 'post').sort((a, b) => b.date.localeCompare(a.date));
  const fixtures = (psgNext.events || []).map(mapEvent).filter((m) => m.state !== 'post').sort((a, b) => a.date.localeCompare(b.date));
  const stat = (x, n) => x.stats.find((s) => s.name === n)?.displayValue;
  const standings = (t) => (t.children?.[0]?.standings?.entries || [])
    .map((x) => ({
      abbr: x.team.abbreviation, name: x.team.shortDisplayName, rank: +stat(x, 'rank'), pts: stat(x, 'points'),
      gp: stat(x, 'gamesPlayed'), gd: stat(x, 'pointDifferential'), logo: x.team.logos?.[0]?.href, id: +x.team.id,
    }))
    .sort((a, b) => a.rank - b.rank);
  const ligue1 = standings(table);
  return {
    psg: {
      live: fixtures.find((m) => m.state === 'in') || null,
      next: fixtures.filter((m) => m.state === 'pre').slice(0, 3),
      last: results.slice(0, 3),
      table: ligue1.slice(0, 5),
      position: ligue1.find((t) => t.id === PSG) || null,
      news: (psgNews.articles || []).slice(0, 4).map((a) => ({ headline: a.headline, published: a.published })),
    },
    pl: {
      round: pl.leagues?.[0]?.season?.type?.name || '',
      matches: (pl.events || []).map(mapEvent),
      table: standings(plTable),
    },
  };
}

// ---------------------------------------------------------------- news (RSS with direct article links, so the reader can open them)

function decodeEntities(s) {
  return s.replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&nbsp;/g, ' ').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function parseRss(xml, n, source = '') {
  const out = [];
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const it of items.slice(0, n)) {
    const pick = (tag) => (it.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || '';
    out.push({ title: decodeEntities(pick('title')).trim(), link: decodeEntities(pick('link')).trim(), source, published: pick('pubDate') });
  }
  return out;
}

async function news() {
  const feed = (u) => fetch(u, { headers: UA }).then((r) => r.text());
  const [top, markets] = await Promise.all([
    feed('https://feeds.npr.org/1001/rss.xml'),
    feed('https://www.cnbc.com/id/10001147/device/rss/rss.html'),
  ]);
  return { top: parseRss(top, 10, 'NPR'), markets: parseRss(markets, 10, 'CNBC') };
}

// ---------------------------------------------------------------- stocks (Yahoo Finance chart API)

const WATCHLIST = [
  { symbol: 'NBIS', label: 'Nebius' },
  { symbol: 'GOOG', label: 'Alphabet' },
  { symbol: 'GC=F', label: 'Gold', unit: '/oz' },
  { symbol: 'VOO', label: 'S&P 500' },
];

async function quote({ symbol, label, unit }) {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`;
  let d;
  try { d = await getJSON(`https://query1.finance.yahoo.com${path}`); } catch { d = await getJSON(`https://query2.finance.yahoo.com${path}`); }
  const r = d.chart.result[0], m = r.meta;
  const closes = (r.indicators.quote[0].close || []).filter((x) => x != null);
  const price = m.regularMarketPrice, prev = m.chartPreviousClose;
  // Thin the intraday series to ~40 points for a sparkline.
  const step = Math.max(1, Math.ceil(closes.length / 40));
  return {
    symbol: symbol.replace('=F', ''), label, unit: unit || '', price, prev,
    change: +(price - prev).toFixed(2), pct: +(((price - prev) / prev) * 100).toFixed(2),
    spark: closes.filter((_, i) => i % step === 0).map((x) => +x.toFixed(2)),
    time: m.regularMarketTime,
  };
}

async function stocks() {
  return { quotes: await Promise.all(WATCHLIST.map((w) => quote(w).catch(() => ({ ...w, error: true })))) };
}

// ---------------------------------------------------------------- article reader: title + paragraphs, no ads or scripts

const READ_HOSTS = ['www.fantasyfootballscout.co.uk', 'www.npr.org', 'www.cnbc.com'];

async function readArticle(u) {
  let target;
  try { target = new URL(u); } catch { throw new Error('bad url'); }
  if (target.protocol !== 'https:' || !READ_HOSTS.includes(target.hostname)) throw new Error('site not supported');
  const html = await fetch(target, { headers: UA }).then((r) => r.text());
  const meta = (p) => decodeEntities((html.match(new RegExp(`<meta[^>]+property="${p}"[^>]+content="([^"]*)"`)) || [])[1] || '');
  const art = (html.match(/<article[\s\S]*?<\/article>/) || [html])[0]
    .replace(/<(script|style|figure|figcaption|aside|nav|footer|form)[\s\S]*?<\/\1>/g, '');
  const paragraphs = (art.match(/<p[^>]*>[\s\S]*?<\/p>/g) || [])
    .map((p) => decodeEntities(p.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim())
    // Drop short fragments and menu soup (long runs with almost no spaces).
    .filter((p) => p.length > 40 && (p.match(/ /g) || []).length / p.length > 0.1)
    .slice(0, 80);
  // A block that repeats the headline is the page header (byline, share buttons), not body text.
  const title = meta('og:title').split(' | ')[0];
  if (title && paragraphs[0] && paragraphs[0].includes(title)) paragraphs.shift();
  return { title: title || target.hostname, site: meta('og:site_name') || target.hostname, url: target.toString(), paragraphs };
}

// ---------------------------------------------------------------- Fantasy Premier League

const FPL = 'https://fantasy.premierleague.com/api';
const POS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };

// Free transfers aren't public, so estimate them from the transfer history: one per gameweek after
// GW1, rolling up to five, used first by any transfer; wildcard / free hit weeks don't spend them.
function freeTransfers(history) {
  const chipWeeks = new Set(history.chips.filter((c) => c.name === 'wildcard' || c.name === 'freehit').map((c) => c.event));
  let ft = 0;
  for (const gw of history.current) {
    if (gw.event === 1) { ft = 1; continue; }
    if (!chipWeeks.has(gw.event)) ft -= Math.min(ft, gw.event_transfers);
    ft = Math.min(5, ft + 1);
  }
  return ft;
}

async function fplTakes() {
  const xml = await fetch('https://www.fantasyfootballscout.co.uk/feed', { headers: UA }).then((r) => r.text());
  return parseRss(xml, 8, 'Fantasy Football Scout');
}

async function fpl(entry) {
  const [boot, fixtures, takes] = await Promise.all([
    getJSON(`${FPL}/bootstrap-static/`), getJSON(`${FPL}/fixtures/?future=1`), fplTakes().catch(() => []),
  ]);
  const current = boot.events.find((e) => e.is_current) || null;
  const next = boot.events.find((e) => e.is_next) || null;
  const teams = Object.fromEntries(boot.teams.map((t) => [t.id, t.short_name]));

  // Average difficulty of each team's next three fixtures (1 easy .. 5 hard).
  const upcoming = {};
  for (const f of fixtures.filter((f) => f.event).sort((a, b) => a.event - b.event)) {
    (upcoming[f.team_h] ||= []).push({ opp: teams[f.team_a], home: true, fdr: f.team_h_difficulty, gw: f.event });
    (upcoming[f.team_a] ||= []).push({ opp: teams[f.team_h], home: false, fdr: f.team_a_difficulty, gw: f.event });
  }
  const ease = (teamId) => {
    const list = (upcoming[teamId] || []).slice(0, 3);
    return list.length ? list.reduce((s, x) => s + x.fdr, 0) / list.length : 3;
  };
  const nextOpp = (teamId) => {
    const f = (upcoming[teamId] || [])[0];
    return f ? `${f.opp} (${f.home ? 'H' : 'A'})` : '';
  };
  // Simple expected-value score: recent form, scaled up for easy fixtures, zeroed when unavailable.
  const value = (p) => {
    const avail = p.chance_of_playing_next_round == null ? (p.status === 'a' ? 1 : 0) : p.chance_of_playing_next_round / 100;
    return parseFloat(p.form) * (6 - ease(p.team)) * avail;
  };
  const brief = (p) => ({
    name: p.web_name, team: teams[p.team], pos: POS[p.element_type], price: (p.now_cost / 10).toFixed(1),
    form: p.form, next: nextOpp(p.team), news: p.news || '', score: +value(p).toFixed(1),
    chance: p.chance_of_playing_next_round == null ? (p.status === 'a' ? 100 : 0) : p.chance_of_playing_next_round,
  });

  const result = {
    deadline: next && { gw: next.id, time: next.deadline_time },
    gameweek: current && { gw: current.id, avg: current.average_entry_score, highest: current.highest_score, finished: current.finished },
    topPicks: boot.elements.filter((p) => p.minutes > 180).sort((a, b) => value(b) - value(a)).slice(0, 5).map(brief),
    takes,
    team: null,
  };
  if (!entry || !current) return result;

  const [info, picks, history] = await Promise.all([
    getJSON(`${FPL}/entry/${entry}/`), getJSON(`${FPL}/entry/${entry}/event/${current.id}/picks/`), getJSON(`${FPL}/entry/${entry}/history/`),
  ]);
  const byId = Object.fromEntries(boot.elements.map((p) => [p.id, p]));
  const live = await getJSON(`${FPL}/event/${current.id}/live/`);
  const livePts = Object.fromEntries(live.elements.map((e) => [e.id, e.stats.total_points]));
  const squad = picks.picks.map((pk) => ({ ...brief(byId[pk.element]), id: pk.element, mult: pk.multiplier, captain: pk.is_captain, bench: pk.position > 11, pts: livePts[pk.element] || 0 }));
  const gwPoints = squad.reduce((s, p) => s + p.pts * p.mult, 0) - (picks.entry_history.event_transfers_cost || 0);
  const starters = squad.filter((p) => !p.bench);
  const bank = picks.entry_history.bank / 10;

  // Recommendations: captain = best starter; out = weakest or flagged starter; in = best affordable same-position player not owned.
  const captain = [...starters].sort((a, b) => b.score - a.score)[0];
  const out = [...starters].filter((p) => p.pos !== 'GK').sort((a, b) => a.chance - b.chance || a.score - b.score)[0];
  const owned = new Set(squad.map((p) => p.id));
  const budget = out ? parseFloat(out.price) + bank : 0;
  const into = out && boot.elements
    .filter((p) => POS[p.element_type] === out.pos && !owned.has(p.id) && p.now_cost / 10 <= budget && p.minutes > 180)
    .sort((a, b) => value(b) - value(a))[0];

  result.team = {
    name: info.name, manager: `${info.player_first_name} ${info.player_last_name}`.trim(),
    overallRank: info.summary_overall_rank, totalPoints: info.summary_overall_points,
    gwPoints, gwRank: info.summary_event_rank, bank: bank.toFixed(1),
    value: (picks.entry_history.value / 10).toFixed(1), freeTransfers: freeTransfers(history),
    flagged: squad.filter((p) => p.news).map((p) => ({ name: p.name, news: p.news })),
    advice: {
      captain: captain && { name: captain.name, next: captain.next },
      transfer: out && into ? { out: out.name, in: brief(into), why: out.news || `form ${out.form}, next ${out.next}` } : null,
    },
  };
  return result;
}

// ---------------------------------------------------------------- Claude "say hi" (GitHub Actions runs `claude -p`)
// Claude's usage window starts at the first message, so a tiny early message starts the clock.
// The workflow holds the Claude Code OAuth token; this Worker only holds a GitHub token that can dispatch it.

const WORKFLOW = 'claude-hi.yml';
const WINDOW_MS = 5 * 3600e3;

function github(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${env.GH_REPO}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28', 'user-agent': 'desk-dashboard', ...(init.headers || {}),
    },
  });
}

async function claudeHi(env) {
  if (!env.GH_TOKEN || !env.GH_REPO) return json({ error: 'not configured' }, 503);
  const res = await github(env, `/actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
  if (res.status !== 204) return json({ error: `GitHub ${res.status}` }, 502);
  return json({ ok: true });
}

async function claudeStatus(env) {
  if (!env.GH_TOKEN || !env.GH_REPO) return { configured: false };
  const res = await github(env, `/actions/workflows/${WORKFLOW}/runs?per_page=30`);
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const runs = (await res.json()).workflow_runs || [];
  const running = runs.some((r) => r.status === 'queued' || r.status === 'in_progress');
  // Rebuild the window chain from successful hellos: a hi after a window has expired opens a new one.
  let start = null;
  for (const t of runs.filter((r) => r.conclusion === 'success').map((r) => Date.parse(r.run_started_at)).sort((a, b) => a - b)) {
    if (start === null || t >= start + WINDOW_MS) start = t;
  }
  const last = runs.find((r) => r.conclusion === 'success');
  return {
    configured: true, running,
    lastHi: last ? last.run_started_at : null,
    windowEnds: start !== null && start + WINDOW_MS > Date.now() ? new Date(start + WINDOW_MS).toISOString() : null,
  };
}

// ---------------------------------------------------------------- birthdays

async function birthdays(env) {
  const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()) + 'T00:00:00Z');
  // Manual entries (with custom emoji, anniversaries) win over the same name from Contacts.
  const manual = new Set(MANUAL_BIRTHDAYS.map((b) => b.name.toLowerCase()));
  // Contacts' birthdays are uploaded to KV by scripts/sync-birthdays.sh (kept out of git).
  const contacts = (await kvJSON(env, 'birthdays:contacts')) || [];
  const all = [...MANUAL_BIRTHDAYS, ...contacts.filter((b) => !manual.has(b.name.toLowerCase()))];
  return all.map((b) => {
    const [m, d] = b.date.split('-').map(Number);
    let next = new Date(Date.UTC(today.getUTCFullYear(), m - 1, d));
    if (next < today) next = new Date(Date.UTC(today.getUTCFullYear() + 1, m - 1, d));
    return {
      name: b.name, emoji: b.emoji || '🎂', month: m, day: d,
      days: Math.round((next - today) / 864e5),
      turning: b.year ? next.getUTCFullYear() - b.year : null,
    };
  }).sort((a, b) => a.days - b.days);
}

// Read a JSON value from KV; a missing or corrupt value reads as null instead of failing the request.
async function kvJSON(env, key) {
  try { return await env.LISTS.get(key, 'json'); } catch { return null; }
}

// ---------------------------------------------------------------- health tracker (KV, one record per day)

async function health(request, env) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const key = `health:${day}`;
  const today = (await kvJSON(env, key)) || { water: 0, taken: {} };
  if (request.method === 'POST') {
    const body = await request.json();
    if (body.action === 'water') today.water = Math.max(0, Math.min(30, today.water + (body.delta === -1 ? -1 : 1)));
    else if (body.action === 'take' && HEALTH.supplements.some((s) => s.id === body.id)) {
      if (today.taken[body.id]) delete today.taken[body.id];
      else today.taken[body.id] = Date.now();
    } else return json({ error: 'bad action' }, 400);
    await env.LISTS.put(key, JSON.stringify(today), { expirationTtl: 90 * 86400 });
  }
  return json({ day, ...HEALTH, today });
}

// ---------------------------------------------------------------- lists (KV)

const LIST_NAMES = ['groceries', 'todo'];
const norm = (s) => s.trim().toLowerCase();

// Attach calorie estimates to grocery items for display.
function withFood(data) {
  return {
    ...data,
    groceries: data.groceries.map((i) => {
      const food = lookupFood(i.text);
      return { ...i, qty: i.qty || (food && food.buy) || null, food };
    }),
  };
}

// Checking a grocery off counts as buying it; unchecking the same day takes that back.
async function recordPurchase(env, text, bought) {
  const history = (await kvJSON(env, 'history')) || [];
  if (bought) history.push({ text: text.trim(), at: Date.now() });
  else {
    const i = history.map((h) => norm(h.text)).lastIndexOf(norm(text));
    if (i >= 0 && Date.now() - history[i].at < 864e5) history.splice(i, 1);
  }
  await env.LISTS.put('history', JSON.stringify(history.slice(-500)));
}

async function groceryInsights(env) {
  const [data, history] = await Promise.all([kvJSON(env, 'lists'), kvJSON(env, 'history')]);
  const onList = new Set(((data && data.groceries) || []).filter((i) => !i.done).map((i) => norm(i.text)));
  const byItem = {};
  for (const h of history || []) (byItem[norm(h.text)] ||= { text: h.text, times: [] }).times.push(h.at);
  const now = Date.now(), day = 864e5;
  const items = Object.values(byItem).map((x) => {
    const t = x.times.sort((a, b) => a - b);
    const gaps = t.slice(1).map((v, i) => v - t[i]).filter((g) => g > day / 2);
    const every = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length / day : null;
    return { text: x.text, count: t.length, last: t[t.length - 1], every, since: (now - t[t.length - 1]) / day, food: lookupFood(x.text) };
  });
  const suggestions = items
    .filter((x) => !onList.has(norm(x.text)) && x.count >= 2)
    .map((x) => {
      const due = x.every ? x.since / x.every : 0;
      const reason = x.every
        ? `Usually every ${Math.round(x.every)} days · last ${Math.round(x.since)}d ago`
        : `Bought ${x.count} times`;
      return { text: x.text, reason, due, count: x.count, food: x.food };
    })
    .sort((a, b) => b.due - a.due || b.count - a.count)
    .slice(0, 6);
  const recent = [...(history || [])].reverse().filter((h, i, arr) => arr.findIndex((y) => norm(y.text) === norm(h.text)) === i).slice(0, 8);
  return { suggestions, recent, tracked: (history || []).length };
}

async function lists(request, env) {
  const load = async () => (await kvJSON(env, 'lists')) || { groceries: [], todo: [] };
  if (request.method === 'GET') return json(withFood(await load()));
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  const body = await request.json();
  const data = await load();
  const list = data[body.list];
  if (!LIST_NAMES.includes(body.list) || !list) return json({ error: 'unknown list' }, 400);
  if (body.action === 'add' && body.text && body.text.trim()) {
    const item = { id: crypto.randomUUID().slice(0, 8), text: body.text.trim().slice(0, 80), done: false, at: Date.now() };
    if (body.list === 'groceries') {
      const { qty, text } = splitQty(item.text);
      item.text = text;
      item.qty = qty || lookupFood(text)?.buy || null;
    }
    list.unshift(item);
  } else if (body.action === 'qty') {
    const item = list.find((i) => i.id === body.id);
    if (item) item.qty = String(body.value || '').slice(0, 20) || null;
  } else if (body.action === 'toggle') {
    const item = list.find((i) => i.id === body.id);
    if (item) {
      item.done = !item.done;
      if (body.list === 'groceries') await recordPurchase(env, item.text, item.done);
    }
  } else if (body.action === 'remove') {
    data[body.list] = list.filter((i) => i.id !== body.id);
  } else if (body.action === 'clear_done') {
    data[body.list] = list.filter((i) => !i.done);
  } else {
    return json({ error: 'bad action' }, 400);
  }
  await env.LISTS.put('lists', JSON.stringify(data));
  return json(withFood(data));
}
