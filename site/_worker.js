// Gauge — gauge.gershon.ai
// Cloudflare Pages advanced-mode worker: LinkedIn sign-in + session, static assets for the rest.
// Secrets (set in Cloudflare, never in this repo): LINKEDIN_CLIENT_SECRET, SESSION_SECRET.

const DEFAULTS = {
  LINKEDIN_CLIENT_ID: '86rofazxdl07cq', // public identifier, not a secret
  REDIRECT_URI: 'https://gauge.gershon.ai/api/auth/linkedin/callback',
  // Sign-in only. Gauge never posts, so w_member_social is deliberately NOT requested.
  SCOPE: 'openid profile email',
};
const SESSION_COOKIE = 'gauge_session';
const STATE_COOKIE = 'gauge_oauth_state';
const NEXT_COOKIE = 'gauge_next';
const NEXT_OK = new Set(['/', '/report', '/app']);
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
const STATE_TTL = 600; // 10 minutes

const enc = new TextEncoder();
const dec = new TextDecoder();

// Only one secret has to be set by hand (LINKEDIN_CLIENT_SECRET). The session signing key is
// derived from it unless SESSION_SECRET is set explicitly.
async function cfg(env) {
  const clientSecret = env.LINKEDIN_CLIENT_SECRET || '';
  let sessionSecret = env.SESSION_SECRET || '';
  if (!sessionSecret && clientSecret) {
    const key = await crypto.subtle.importKey('raw', enc.encode(clientSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    sessionSecret = b64url(await crypto.subtle.sign('HMAC', key, enc.encode('gauge-session-v1')));
  }
  return {
    clientId: env.LINKEDIN_CLIENT_ID || DEFAULTS.LINKEDIN_CLIENT_ID,
    clientSecret,
    sessionSecret,
    redirectUri: env.LINKEDIN_REDIRECT_URI || DEFAULTS.REDIRECT_URI,
  };
}

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signSession(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}
export async function readSession(token, secret) {
  if (!token || !secret) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(unb64url(body)));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function cookies(request) {
  const out = {};
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function setCookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}
function redirect(location, cookieList = []) {
  const h = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const c of cookieList) h.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers: h });
}
const fail = (code) => redirect(`/?error=${encodeURIComponent(code)}`, [setCookie(STATE_COOKIE, '', 0)]);

async function start(request, env) {
  const c = await cfg(env);
  if (!c.clientSecret || !c.sessionSecret) return redirect('/?error=not_configured');
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const u = new URL('https://www.linkedin.com/oauth/v2/authorization');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', c.clientId);
  u.searchParams.set('redirect_uri', c.redirectUri);
  u.searchParams.set('state', state);
  u.searchParams.set('scope', DEFAULTS.SCOPE);
  const next = new URL(request.url).searchParams.get('next');
  const list = [setCookie(STATE_COOKIE, state, STATE_TTL)];
  if (NEXT_OK.has(next)) list.push(setCookie(NEXT_COOKIE, next, STATE_TTL));
  return redirect(u.toString(), list);
}

async function callback(request, env) {
  const c = await cfg(env);
  if (!c.clientSecret || !c.sessionSecret) return fail('not_configured');
  const url = new URL(request.url);
  if (url.searchParams.get('error')) return fail('cancelled');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = cookies(request)[STATE_COOKIE];
  if (!code || !state || !expected || state !== expected) return fail('state_mismatch');

  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: c.clientId,
      client_secret: c.clientSecret,
      redirect_uri: c.redirectUri,
    }),
  });
  if (!tokenRes.ok) return fail('token_exchange_failed');
  const token = await tokenRes.json();
  if (!token.access_token) return fail('token_exchange_failed');

  const meRes = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!meRes.ok) return fail('profile_failed');
  const me = await meRes.json();
  if (!me.sub) return fail('profile_failed');

  // The LinkedIn access token is discarded here: Gauge only needs to know who signed in.
  const session = await signSession(
    {
      sub: me.sub,
      name: me.name || '',
      picture: me.picture || '',
      email: me.email || '',
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL,
    },
    c.sessionSecret,
  );
  if (env.GAUGE_KV) {
    try {
      const [member, created] = await ensureMember(env.GAUGE_KV, { sub: me.sub, name: me.name, picture: me.picture, email: me.email });
      if (created) await attribute(env.GAUGE_KV, member, cookies(request)[REF_COOKIE]);
    } catch {} // storage trouble must never block sign-in
  }
  const next = cookies(request)[NEXT_COOKIE];
  return redirect(NEXT_OK.has(next) ? next : '/', [
    setCookie(SESSION_COOKIE, session, SESSION_TTL),
    setCookie(STATE_COOKIE, '', 0),
    setCookie(NEXT_COOKIE, '', 0),
    setCookie(REF_COOKIE, '', 0),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Storage (KV namespace bound as GAUGE_KV). Everything below degrades to a clear
// "storage_not_configured" answer when it is not bound. Keys per member <id> (LinkedIn "sub"):
//   member:<id>   profile from sign-in, settings, invite code, inviter, last/prev/best overall
//   latest:<id>   latest scores (same record main has always written)
//   hist:<id>     array of tests (scores and date only), newest last, capped at HISTORY_CAP
//   invites:<id>  { signedIn: [ids], graded: [ids] } people this member invited (capped)
//   ref:<code>    -> member id, for invite links
//   rate:<id>:<YYYY-MM-DD>  saves today (rate limit)
//   stats:global  { users, hist: [21 buckets of 5 points] } so the percentile needs no scan
const TTL = 60 * 60 * 24 * 730; // 24 months
export const HISTORY_CAP = 100;
export const INVITES_CAP = 200;
export const CIRCLE_CAP = 50;
export const SAVES_PER_DAY = 20;
export const MIN_USERS_FOR_PERCENTILE = 20;
const REF_COOKIE = 'gauge_ref';
const REF_TTL = 60 * 60 * 24 * 30;
const REF_RE = /^[a-z2-9]{8}$/;

const score = (v) => (Number.isInteger(v) && v >= 0 && v <= 100 ? v : null);
const LEVER_IDS = ['inmail', 'invites', 'savedAccounts', 'savedLeads', 'groups', 'find', 'engage', 'lists'];

// Same bands as site/score.js gradeFor (kept here so this worker stays a single file; a test checks they agree).
export function gradeFor(v) {
  if (v == null) return null;
  for (const [g, min] of [['A', 85], ['B', 70], ['C', 55], ['D', 40]]) if (v >= min) return g === 'A' || v < min + 10 ? g : g + '+';
  return 'F';
}
export const bucketOf = (v) => Math.min(20, Math.floor(v / 5));

// Share of the other members whose latest overall is below yours (half of those in your 5-point bucket
// count as below). null until at least MIN_USERS_FOR_PERCENTILE members have a test.
export function percentile(stats, overall) {
  if (!stats || !Array.isArray(stats.hist) || overall == null) return null;
  const users = stats.users || 0;
  if (users < MIN_USERS_FOR_PERCENTILE) return null;
  const b = bucketOf(overall);
  let below = 0;
  for (let i = 0; i < b; i++) below += stats.hist[i] || 0;
  const same = Math.max(0, (stats.hist[b] || 0) - 1);
  return Math.max(0, Math.min(100, Math.round((100 * (below + same / 2)) / (users - 1))));
}

async function getJson(kv, key) {
  const v = await kv.get(key);
  if (v == null) return null;
  try { return JSON.parse(v); } catch { return null; }
}
const putJson = (kv, key, value) => kv.put(key, JSON.stringify(value), { expirationTtl: TTL });

function newCode() {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (const b of crypto.getRandomValues(new Uint8Array(8))) out += abc[b % abc.length];
  return out;
}

// Create or refresh the member record from the session. Returns [member, created].
async function ensureMember(kv, s) {
  let m = await getJson(kv, `member:${s.sub}`);
  const created = !m;
  if (!m) {
    let code = newCode();
    for (let i = 0; i < 3 && (await kv.get(`ref:${code}`)); i++) code = newCode();
    m = { id: s.sub, code, invitedBy: null, showName: false, createdAt: new Date().toISOString(),
      tests: 0, lastOverall: null, lastAt: null, prevOverall: null, best: null };
    await kv.put(`ref:${code}`, s.sub, { expirationTtl: TTL });
  }
  const fresh = { name: s.name || '', picture: s.picture || '', email: s.email || '' };
  const changed = created || Object.keys(fresh).some((k) => m[k] !== fresh[k]);
  Object.assign(m, fresh);
  if (changed) await putJson(kv, `member:${s.sub}`, m); // reads do not write unless the profile changed
  return [m, created];
}

// Invite attribution: only for a member created by this sign-in, only once, never to oneself,
// and only to an inviter who exists. The first ref cookie set wins (see the landing-page handler).
export async function attribute(kv, member, code) {
  if (!code || !REF_RE.test(code) || member.invitedBy) return false;
  const inviter = await kv.get(`ref:${code}`);
  if (!inviter || inviter === member.id) return false;
  if (!(await kv.get(`member:${inviter}`))) return false;
  member.invitedBy = inviter;
  await putJson(kv, `member:${member.id}`, member);
  const inv = (await getJson(kv, `invites:${inviter}`)) || { signedIn: [], graded: [] };
  if (!inv.signedIn.includes(member.id)) inv.signedIn = [...inv.signedIn, member.id].slice(-INVITES_CAP);
  await putJson(kv, `invites:${inviter}`, inv);
  return true;
}

async function session(request, env) {
  return readSession(cookies(request)[SESSION_COOKIE], (await cfg(env)).sessionSecret);
}
const noStorage = (extra = {}) => json({ storage: false, error: 'storage_not_configured', ...extra });

// Accept a client test date only if it is a valid date within the last 7 days; otherwise use now.
function testDate(v) {
  const now = Date.now();
  const t = typeof v === 'number' ? v : typeof v === 'string' && v.length <= 40 ? Date.parse(v) : NaN;
  return new Date(Number.isFinite(t) && t <= now && t >= now - 7 * 86400000 ? t : now).toISOString();
}

// Save the user's scores (never the raw LinkedIn figures). Stored only when GAUGE_KV is bound;
// the privacy policy lists exactly these fields.
export async function saveGrade(request, env) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const s = await session(request, env);
  if (!s) return json({ error: 'signed_out' }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const overall = score(body?.overall);
  if (overall == null || typeof body?.grade !== 'string' || body.grade !== gradeFor(overall)) return json({ error: 'bad_request' }, 400);
  const levers = {};
  for (const id of LEVER_IDS) if (score(body.levers?.[id]) != null) levers[id] = body.levers[id];
  const at = testDate(body.at);
  const record = {
    memberId: s.sub, name: s.name, email: s.email,
    overall, fill: score(body.fill), work: score(body.work), grade: gradeFor(overall), levers,
    at,
  };
  const kv = env.GAUGE_KV;
  if (!kv) return json({ saved: false, reason: 'storage_not_configured' });

  const day = new Date().toISOString().slice(0, 10);
  const rateKey = `rate:${s.sub}:${day}`;
  const count = parseInt((await kv.get(rateKey)) || '0', 10) || 0;
  if (count >= SAVES_PER_DAY) return json({ saved: false, error: 'rate_limited' }, 429);
  await kv.put(rateKey, String(count + 1), { expirationTtl: 60 * 60 * 48 });

  const [m] = await ensureMember(kv, s);
  const hist = (await getJson(kv, `hist:${s.sub}`)) || [];
  const entry = { at, overall, fill: record.fill, work: record.work, grade: record.grade, levers };
  const personalBest = hist.every((h) => overall > h.overall);
  hist.push(entry);
  hist.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  await putJson(kv, `hist:${s.sub}`, hist.slice(-HISTORY_CAP));
  await putJson(kv, `latest:${s.sub}`, record);

  // Global aggregate (approximate under concurrent writes; KV has no transactions).
  const stats = (await getJson(kv, 'stats:global')) || { users: 0, hist: Array(21).fill(0) };
  const firstTest = m.lastOverall == null;
  if (firstTest) stats.users++;
  else stats.hist[bucketOf(m.lastOverall)] = Math.max(0, (stats.hist[bucketOf(m.lastOverall)] || 0) - 1);
  stats.hist[bucketOf(overall)] = (stats.hist[bucketOf(overall)] || 0) + 1;
  await kv.put('stats:global', JSON.stringify(stats));

  m.prevOverall = m.lastOverall;
  m.lastOverall = overall;
  m.lastAt = at;
  m.best = Math.max(m.best ?? 0, overall);
  m.tests = (m.tests || 0) + 1;
  await putJson(kv, `member:${s.sub}`, m);

  if (firstTest && m.invitedBy) {
    const inv = (await getJson(kv, `invites:${m.invitedBy}`)) || { signedIn: [], graded: [] };
    if (!inv.graded.includes(s.sub)) {
      inv.graded = [...inv.graded, s.sub].slice(-INVITES_CAP);
      await putJson(kv, `invites:${m.invitedBy}`, inv);
    }
  }
  return json({ saved: true, personalBest, tests: m.tests });
}

async function history(request, env) {
  const s = await session(request, env);
  if (!s) return json({ error: 'signed_out' }, 401);
  if (!env.GAUGE_KV) return noStorage({ items: [] });
  const hist = (await getJson(env.GAUGE_KV, `hist:${s.sub}`)) || [];
  return json({ storage: true, items: hist.slice(-HISTORY_CAP).reverse() });
}

async function settings(request, env) {
  const s = await session(request, env);
  if (!s) return json({ error: 'signed_out' }, 401);
  const kv = env.GAUGE_KV;
  if (request.method === 'GET') {
    if (!kv) return noStorage({ showName: false });
    const m = await getJson(kv, `member:${s.sub}`);
    return json({ storage: true, showName: m?.showName === true });
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  if (typeof body?.showName !== 'boolean') return json({ error: 'bad_request' }, 400);
  if (!kv) return json({ storage: false, error: 'storage_not_configured' }, 503);
  const [m] = await ensureMember(kv, s);
  m.showName = body.showName;
  await putJson(kv, `member:${s.sub}`, m);
  return json({ storage: true, showName: m.showName });
}

async function invite(request, env) {
  const s = await session(request, env);
  if (!s) return json({ error: 'signed_out' }, 401);
  if (!env.GAUGE_KV) return noStorage();
  const [m] = await ensureMember(env.GAUGE_KV, s);
  const inv = (await getJson(env.GAUGE_KV, `invites:${s.sub}`)) || { signedIn: [], graded: [] };
  return json({ storage: true, code: m.code, link: `https://gauge.gershon.ai/?ref=${m.code}`,
    signedIn: inv.signedIn.length, graded: inv.graded.length });
}

// What other members may see of someone: name and photo only with the opt-in, never the email.
function publicView(m, me) {
  const show = m.showName === true;
  return {
    you: m.id === me, name: show ? m.name || 'Member' : 'Anonymous member', picture: show ? m.picture || '' : '',
    overall: m.lastOverall, prevOverall: m.prevOverall, lastAt: m.lastAt,
  };
}
const rank = (rows, key) => {
  const sorted = [...rows].sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1));
  return new Map(sorted.map((r, i) => [r, i + 1]));
};

async function compare(request, env) {
  const s = await session(request, env);
  if (!s) return json({ error: 'signed_out' }, 401);
  const kv = env.GAUGE_KV;
  if (!kv) return noStorage();
  const [me] = await ensureMember(kv, s);
  const inv = (await getJson(kv, `invites:${s.sub}`)) || { signedIn: [], graded: [] };
  const ids = [...new Set([s.sub, me.invitedBy, ...inv.signedIn.slice(-CIRCLE_CAP)].filter(Boolean))];
  const members = (await Promise.all(ids.map((id) => (id === s.sub ? me : getJson(kv, `member:${id}`))))).filter(Boolean);
  const rows = members.map((m) => ({ ...publicView(m, s.sub), invitedYou: m.id === me.invitedBy, invitedByYou: m.invitedBy === s.sub && m.id !== s.sub }));
  const graded = rows.filter((r) => r.overall != null);
  const now = rank(graded, 'overall');
  const before = rank(graded.map((r) => ({ r, v: r.prevOverall ?? r.overall })).map((x) => Object.assign(x.r, { _p: x.v })), '_p');
  const circle = graded
    .map((r) => {
      const hadPrev = r.prevOverall != null;
      const out = { ...r, rank: now.get(r), movement: hadPrev ? before.get(r) - now.get(r) : null, change: hadPrev ? r.overall - r.prevOverall : null };
      delete out._p;
      return out;
    })
    .sort((a, b) => a.rank - b.rank);
  const pending = rows.filter((r) => r.overall == null).length;
  const stats = await getJson(kv, 'stats:global');
  return json({ storage: true, circle, pendingInCircle: pending,
    global: { users: stats?.users || 0, minUsers: MIN_USERS_FOR_PERCENTILE, percentile: percentile(stats, me.lastOverall) } });
}

// Delete every record of the member, remove them from invite lists and the global aggregate, sign out.
export async function deleteMe(request, env) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const s = await session(request, env);
  if (!s) return json({ error: 'signed_out' }, 401);
  const out = { 'Set-Cookie': setCookie(SESSION_COOKIE, '', 0) };
  const kv = env.GAUGE_KV;
  if (!kv) return json({ deleted: true, storage: false }, 200, out);
  const id = s.sub;
  const m = await getJson(kv, `member:${id}`);
  const inv = await getJson(kv, `invites:${id}`);
  if (m?.invitedBy) {
    const up = await getJson(kv, `invites:${m.invitedBy}`);
    if (up) {
      up.signedIn = up.signedIn.filter((x) => x !== id);
      up.graded = up.graded.filter((x) => x !== id);
      await putJson(kv, `invites:${m.invitedBy}`, up);
    }
  }
  for (const other of inv?.signedIn || []) {
    const om = await getJson(kv, `member:${other}`);
    if (om && om.invitedBy === id) { om.invitedBy = null; await putJson(kv, `member:${other}`, om); }
  }
  if (m?.lastOverall != null) {
    const stats = await getJson(kv, 'stats:global');
    if (stats) {
      const b = bucketOf(m.lastOverall);
      stats.hist[b] = Math.max(0, (stats.hist[b] || 0) - 1);
      stats.users = Math.max(0, (stats.users || 0) - 1);
      await kv.put('stats:global', JSON.stringify(stats));
    }
  }
  const keys = [`member:${id}`, `latest:${id}`, `hist:${id}`, `invites:${id}`];
  if (m?.code) keys.push(`ref:${m.code}`);
  for (const prefix of [`grade:${id}:`, `rate:${id}:`]) {
    let cursor;
    for (let page = 0; page < 20; page++) {
      const r = await kv.list({ prefix, cursor });
      for (const k of r.keys) keys.push(k.name);
      if (r.list_complete || !r.cursor) break;
      cursor = r.cursor;
    }
  }
  for (const k of keys) await kv.delete(k);
  return json({ deleted: true, storage: true }, 200, out);
}

// Landing page with ?ref=<code>: remember the inviter for 30 days in a first-party cookie.
// The first inviter wins: an existing ref cookie is never replaced.
async function landing(request, env) {
  const res = await env.ASSETS.fetch(request);
  const ref = new URL(request.url).searchParams.get('ref');
  if (!ref || !REF_RE.test(ref) || cookies(request)[REF_COOKIE]) return res;
  const out = new Response(res.body, res);
  out.headers.append('Set-Cookie', setCookie(REF_COOKIE, ref, REF_TTL));
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p === '/api/health') {
      const c = await cfg(env);
      return json({ ok: true, app: 'gauge', linkedinSecretSet: !!c.clientSecret, sessionKeyReady: !!c.sessionSecret });
    }
    if (p === '/api/auth/linkedin/start') return start(request, env);
    if (p === '/api/auth/linkedin/callback') return callback(request, env);
    if (p === '/api/me') {
      const s = await readSession(cookies(request)[SESSION_COOKIE], (await cfg(env)).sessionSecret);
      if (!s) return json({ signedIn: false }, 401);
      return json({ signedIn: true, name: s.name, picture: s.picture, email: s.email });
    }
    if (p === '/api/grade') return saveGrade(request, env);
    if (p === '/api/history') return history(request, env);
    if (p === '/api/settings') return settings(request, env);
    if (p === '/api/invite') return invite(request, env);
    if (p === '/api/compare') return compare(request, env);
    if (p === '/api/delete-me') return deleteMe(request, env);
    if (p === '/api/auth/logout') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return json({ ok: true }, 200, { 'Set-Cookie': setCookie(SESSION_COOKIE, '', 0) });
    }
    if (p.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    if (p === '/' && request.method === 'GET') return landing(request, env);
    return env.ASSETS.fetch(request);
  },
};
