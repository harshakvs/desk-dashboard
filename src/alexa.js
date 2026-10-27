// Alexa custom skill ("my desk"). Alexa calls POST /alexa directly, so instead of the dashboard key
// each request is checked the way Amazon requires for HTTPS endpoints: the signing certificate URL,
// the RSA signature over the body, a fresh timestamp, and our own skill ID.

const MAX_SKEW_MS = 150 * 1000;

// ---------------------------------------------------------------- request verification

function certUrlOk(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname.toLowerCase() === 's3.amazonaws.com' &&
      u.pathname.startsWith('/echo.api/') && (u.port === '' || u.port === '443');
  } catch { return false; }
}

// Minimal DER walker: enough to pull the SubjectPublicKeyInfo and validity out of an X.509 cert.
function readTLV(buf, pos) {
  const tag = buf[pos];
  let len = buf[pos + 1], off = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[off + i];
    off += n;
  }
  return { tag, start: pos, body: off, end: off + len };
}
function children(buf, tlv) {
  const out = [];
  for (let p = tlv.body; p < tlv.end;) { const c = readTLV(buf, p); out.push(c); p = c.end; }
  return out;
}
function parseTime(buf, tlv) {
  const s = new TextDecoder().decode(buf.slice(tlv.body, tlv.end));
  const full = tlv.tag === 0x17 ? (+s.slice(0, 2) >= 50 ? '19' : '20') + s : s; // UTCTime vs GeneralizedTime
  return Date.UTC(+full.slice(0, 4), +full.slice(4, 6) - 1, +full.slice(6, 8), +full.slice(8, 10), +full.slice(10, 12), +full.slice(12, 14));
}

const certCache = new Map();

async function signingKey(certUrl) {
  if (certCache.has(certUrl)) return certCache.get(certUrl);
  const pem = await fetch(certUrl).then((r) => r.text());
  const first = pem.match(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/);
  if (!first) throw new Error('no certificate');
  const der = Uint8Array.from(atob(first[1].replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  // Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signature }
  const tbs = children(der, readTLV(der, 0))[0];
  const fields = children(der, tbs);
  const i = fields[0].tag === 0xa0 ? 1 : 0; // optional [0] version
  const validity = children(der, fields[i + 3]);
  const now = Date.now();
  if (now < parseTime(der, validity[0]) || now > parseTime(der, validity[1])) throw new Error('certificate expired');
  // The subject alternative names must include echo-api.amazon.com.
  if (!new TextDecoder('latin1').decode(der).includes('echo-api.amazon.com')) throw new Error('wrong certificate subject');
  const spki = fields[i + 5];
  const key = await crypto.subtle.importKey('spki', der.slice(spki.start, spki.end), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  certCache.set(certUrl, key);
  return key;
}

async function verify(request, body, env) {
  const certUrl = request.headers.get('SignatureCertChainUrl');
  const sig = request.headers.get('Signature-256');
  if (!certUrl || !sig || !certUrlOk(certUrl)) return 'bad signature headers';
  const key = await signingKey(certUrl);
  const sigBytes = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0));
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sigBytes, new TextEncoder().encode(body));
  if (!ok) return 'signature mismatch';
  const req = JSON.parse(body);
  if (Math.abs(Date.now() - Date.parse(req.request.timestamp)) > MAX_SKEW_MS) return 'stale request';
  const appId = req.session?.application?.applicationId || req.context?.System?.application?.applicationId;
  if (!env.ALEXA_SKILL_ID || appId !== env.ALEXA_SKILL_ID) return 'wrong skill';
  return null;
}

// ---------------------------------------------------------------- responses

function speak(text, end = true, reprompt) {
  console.log('alexa reply:', text, end ? '(end)' : '(listening)');
  const response = { outputSpeech: { type: 'PlainText', text }, shouldEndSession: end };
  if (reprompt) response.reprompt = { outputSpeech: { type: 'PlainText', text: reprompt } };
  return new Response(JSON.stringify({ version: '1.0', response }), { headers: { 'content-type': 'application/json' } });
}

// `api` calls the dashboard's own handlers, so Alexa and the frame share one source of truth.
export async function handleAlexa(request, env, api) {
  const body = await request.text();
  let problem;
  try { problem = await verify(request, body, env); } catch (e) { problem = String(e.message || e); }
  if (problem) return new Response(JSON.stringify({ error: problem }), { status: 400 });

  const req = JSON.parse(body).request;
  // What Alexa understood; visible with `wrangler tail` when debugging the voice model.
  console.log('alexa request:', req.type, req.intent?.name || '', JSON.stringify(Object.fromEntries(Object.entries(req.intent?.slots || {}).map(([k, v]) => [k, v.value]))), req.reason || '', req.error?.message || '');
  if (req.type === 'LaunchRequest') return speak('Desk is ready. What should I add?', false, 'You can say an item like milk, or ask about FPL, PSG or cricket.');
  if (req.type === 'SessionEndedRequest') return new Response('{}', { headers: { 'content-type': 'application/json' } });
  if (req.type !== 'IntentRequest') return speak('Sorry, I did not get that.');

  // Catch-all slots swallow the rest of the sentence ("milk to my list"), so trim list phrases off the end.
  const slot = (n) => req.intent.slots?.[n]?.value?.trim()
    .replace(/\s+(to|on|in)\s+(my|the)?\s*(grocery|groceries|shopping|to do|todo|to-do)?\s*(list)?$/i, '').trim();
  try {
    switch (req.intent.name) {
      case 'AddGroceryIntent': {
        const item = slot('item');
        if (!item) return speak('What should I add to groceries?', false);
        await api.listAdd('groceries', item);
        // Keep listening so a whole list can be said in one go ("eggs" ... "bread" ... "no").
        return speak(`Added ${item}. Anything else?`, false, 'Anything else for the grocery list?');
      }
      case 'AddTodoIntent': {
        const task = slot('task');
        if (!task) return speak('What should I add to your to do list?', false);
        await api.listAdd('todo', task);
        return speak(`Added ${task} to your to do list.`);
      }
      case 'ReadGroceriesIntent': {
        const items = (await api.lists()).groceries.filter((i) => !i.done).map((i) => i.text);
        return speak(items.length ? `You need ${items.slice(0, 10).join(', ')}.` : 'Your grocery list is empty.');
      }
      case 'WaterIntent': {
        const d = await api.water();
        return speak(`Logged. That's ${d.today.water} of ${d.water.goal} glasses today.`);
      }
      case 'SupplementIntent': {
        const name = (slot('supplement') || '').toLowerCase();
        const d = await api.takeSupplement(name);
        return speak(d ? `Marked ${d} as taken.` : 'I could not find that supplement.');
      }
      case 'FplIntent': {
        const f = await api.fpl();
        const t = f.team;
        const due = f.deadline ? new Date(f.deadline.time).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', hour: 'numeric', minute: '2-digit' }) : 'unknown';
        return speak(t
          ? `${t.name} has ${t.gwPoints} points this gameweek, rank ${Number(t.overallRank).toLocaleString('en-US')}. ${t.freeTransfers} free transfers and ${t.bank} million in the bank. The deadline is ${due}.${t.advice.captain ? ` Captain pick: ${t.advice.captain.name}.` : ''}`
          : `The next deadline is ${due}.`);
      }
      case 'PsgIntent': {
        const p = (await api.football()).psg;
        const m = p.live || p.next[0];
        if (p.live) return speak(`PSG are playing now. ${p.live.home.name} ${p.live.home.score}, ${p.live.away.name} ${p.live.away.score}.`);
        const last = p.last[0];
        const lastText = last ? ` Last result: ${last.home.name} ${last.home.score}, ${last.away.name} ${last.away.score}.` : '';
        return speak(m ? `PSG play ${m.home.name === 'PSG' ? m.away.name : m.home.name} on ${new Date(m.date).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', hour: 'numeric', minute: '2-digit' })}.${lastText}` : `No PSG match scheduled.${lastText}`);
      }
      case 'CricketIntent': {
        const m = (await api.cricket()).matches[0];
        if (!m) return speak('India have no matches right now.');
        const teams = m.teams.map((t) => `${t.name} ${t.score || ''}`.trim()).join(', ');
        return speak(m.state === 'pre' ? `Next up: ${m.title}.` : `${teams}. ${m.summary}`);
      }
      case 'ClaudeHiIntent': {
        const ok = await api.claudeHi();
        return speak(ok ? 'Saying hi to Claude. Your usage window starts in about a minute.' : 'The Claude button is not set up yet.');
      }
      case 'AMAZON.YesIntent':
        return speak('Go ahead, what should I add?', false, 'What should I add?');
      case 'AMAZON.FallbackIntent':
        return speak('Sorry, I didn\'t catch that. Try: add eggs, I drank water, or what is my FPL score.', false);
      case 'AMAZON.HelpIntent':
        return speak('Try: add milk to groceries, I drank water, what is my FPL score, or when do PSG play.', false);
      case 'AMAZON.NoIntent':
      case 'AMAZON.StopIntent':
      case 'AMAZON.CancelIntent':
        return speak('Okay.');
      default:
        return speak('Sorry, I can not do that yet.');
    }
  } catch (e) {
    return speak('Something went wrong talking to the desk.');
  }
}
