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
const NEXT_OK = new Set(['/', '/report', '/app', '/admin']);
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
    return json({ storage: true, showName: m?.showName === true, shareWithGershon: m?.shareWithGershon === true });
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const hasShow = typeof body?.showName === 'boolean';
  const hasShare = typeof body?.shareWithGershon === 'boolean';
  if (!hasShow && !hasShare) return json({ error: 'bad_request' }, 400);
  if (!kv) return json({ storage: false, error: 'storage_not_configured' }, 503);
  const [m] = await ensureMember(kv, s);
  if (hasShow) m.showName = body.showName;
  if (hasShare) {
    // Explicit consent for Gershon Consulting staff to see this member's name, email and scores
    // (Chrome Web Store Limited Use). Off by default; can be withdrawn at any time.
    m.shareWithGershon = body.shareWithGershon;
    m.shareAt = body.shareWithGershon ? new Date().toISOString() : null;
  }
  await putJson(kv, `member:${s.sub}`, m);
  return json({ storage: true, showName: m.showName === true, shareWithGershon: m.shareWithGershon === true });
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

// ---------------------------------------------------------------------------------------------
// Admin (/admin) and the daily internal report. Only Gershon Consulting accounts listed in
// ADMIN_EMAILS can open it. Names, emails and scores are shown ONLY for members who ticked
// "Share my result with Gershon Consulting" (member.shareWithGershon === true); everyone else is
// counted in anonymous totals only (Chrome Web Store Limited Use, see /privacy).
export const ADMIN_EMAILS_DEFAULT = ['olivier@gershonconsulting.com', 'oattia@gmail.com'];
export const REPORT_TO_DEFAULT = 'report@gershonconsulting.com';
const REPORT_FROM = 'Gauge <gauge@gershon.ai>';
const SITE = 'https://gauge.gershon.ai';
const MEMBER_SCAN_PAGES = 20; // 20 x 1000 keys

export function adminEmails(env) {
  const extra = String(env.ADMIN_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  return new Set([...ADMIN_EMAILS_DEFAULT, ...extra]);
}
const isAdmin = (s, env) => !!s && !!s.email && adminEmails(env).has(String(s.email).toLowerCase());

async function adminSession(request, env) {
  const s = await session(request, env);
  if (!s) return [null, json({ error: 'signed_out' }, 401)];
  if (!isAdmin(s, env)) return [null, json({ error: 'forbidden' }, 403)];
  return [s, null];
}

async function allMembers(kv) {
  const ids = [];
  let cursor;
  for (let page = 0; page < MEMBER_SCAN_PAGES; page++) {
    const r = await kv.list({ prefix: 'member:', cursor });
    for (const k of r.keys) ids.push(k.name);
    if (r.list_complete || !r.cursor) break;
    cursor = r.cursor;
  }
  return (await Promise.all(ids.map((k) => getJson(kv, k)))).filter(Boolean);
}

const letter = (g) => (g ? g[0] : null);

// Pure: totals for everyone, named rows for consenting members only. sinceMs marks "new".
export function summarize(members, sinceMs = 0) {
  const byId = new Map(members.map((m) => [m.id, m]));
  const graded = members.filter((m) => m.lastOverall != null);
  const grades = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const m of graded) grades[letter(gradeFor(m.lastOverall))]++;
  const t = (v) => (v ? Date.parse(v) : 0);
  const shared = members.filter((m) => m.shareWithGershon === true);
  const row = (m) => ({
    id: m.id, name: m.name || '', email: m.email || '', picture: m.picture || '',
    joined: m.createdAt || null, tests: m.tests || 0, overall: m.lastOverall ?? null,
    grade: gradeFor(m.lastOverall ?? null), prev: m.prevOverall ?? null, best: m.best ?? null, lastAt: m.lastAt || null,
    invitedBy: m.invitedBy ? (byId.get(m.invitedBy)?.shareWithGershon ? byId.get(m.invitedBy).name : 'a member') : null,
    isNew: t(m.createdAt) >= sinceMs, testedRecently: t(m.lastAt) >= sinceMs,
  });
  const recentAll = members.filter((m) => t(m.lastAt) >= sinceMs);
  return {
    totals: {
      signedIn: members.length,
      graded: graded.length,
      tests: members.reduce((a, m) => a + (m.tests || 0), 0),
      average: graded.length ? Math.round(graded.reduce((a, m) => a + m.lastOverall, 0) / graded.length) : null,
      grades,
      invited: members.filter((m) => m.invitedBy).length,
      shared: shared.length,
      anonymous: members.length - shared.length,
    },
    since: sinceMs ? new Date(sinceMs).toISOString() : null,
    recent: {
      signedIn: members.filter((m) => t(m.createdAt) >= sinceMs).length,
      tested: recentAll.length,
      average: recentAll.length ? Math.round(recentAll.reduce((a, m) => a + (m.lastOverall ?? 0), 0) / recentAll.length) : null,
    },
    people: shared.map(row).sort((a, b) => t(b.lastAt || b.joined) - t(a.lastAt || a.joined)),
  };
}

async function adminSummary(request, env) {
  const [, err] = await adminSession(request, env);
  if (err) return err;
  if (!env.GAUGE_KV) return noStorage();
  const sinceMs = Date.now() - 86400000;
  return json({ storage: true, emailReady: !!env.RESEND_API_KEY, lastReport: await env.GAUGE_KV.get('daily:last'),
    ...summarize(await allMembers(env.GAUGE_KV), sinceMs) });
}

async function adminMember(request, env) {
  const [, err] = await adminSession(request, env);
  if (err) return err;
  const kv = env.GAUGE_KV;
  if (!kv) return noStorage();
  const id = new URL(request.url).searchParams.get('id') || '';
  const m = await getJson(kv, `member:${id}`);
  if (!m || m.shareWithGershon !== true) return json({ error: 'not_shared' }, 404);
  return json({ storage: true, ...summarize([m]).people[0], history: (await getJson(kv, `hist:${id}`)) || [] });
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const etDay = (ms) => new Date(ms).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });

export function reportEmail(sum, sinceMs, nowMs) {
  const a = etDay(sinceMs), b = etDay(nowMs);
  const range = a === b ? b : `${a} – ${b}`;
  const T = sum.totals, R = sum.recent;
  const line = (k, v) => `<tr><td style="padding:4px 12px 4px 0;color:#555">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`;
  const recentPeople = sum.people.filter((p) => p.isNew || p.testedRecently);
  const people = recentPeople.length
    ? `<table style="border-collapse:collapse;font-size:14px"><tr style="text-align:left;color:#555"><th style="padding:4px 10px 4px 0">Name</th><th style="padding:4px 10px 4px 0">Email</th><th style="padding:4px 10px 4px 0">Score</th><th style="padding:4px 10px 4px 0">Tests</th><th>New?</th></tr>${recentPeople
        .map((p) => `<tr><td style="padding:4px 10px 4px 0">${esc(p.name)}</td><td style="padding:4px 10px 4px 0">${esc(p.email)}</td><td style="padding:4px 10px 4px 0">${p.overall == null ? '—' : `${p.overall}% (${esc(p.grade)})`}</td><td style="padding:4px 10px 4px 0">${p.tests}</td><td>${p.isNew ? 'new' : ''}</td></tr>`)
        .join('')}</table>`
    : '<p style="color:#555">No tester who shared their result was active in this period.</p>';
  const html = `<div style="font-family:Arial,sans-serif;color:#111;max-width:640px">
<h2 style="color:#FE1B04;margin:0 0 4px">Gauge daily report</h2><p style="color:#555;margin:0 0 16px">${esc(range)} (last 24 hours)</p>
<h3 style="margin:16px 0 4px">Last 24 hours</h3><table>${line('New sign-ins', R.signedIn)}${line('People who ran a test', R.tested)}${line('Their average score', R.average == null ? '—' : R.average + '%')}</table>
<h3 style="margin:16px 0 4px">Testers who shared their result</h3>${people}
<p style="color:#555;font-size:13px">${R.tested - recentPeople.filter((p) => p.testedRecently).length > 0 ? `${R.tested - recentPeople.filter((p) => p.testedRecently).length} other tester(s) did not share their result and are only counted.` : ''}</p>
<h3 style="margin:16px 0 4px">All time</h3><table>${line('Signed in', T.signedIn)}${line('Graded', T.graded)}${line('Tests run', T.tests)}${line('Average score', T.average == null ? '—' : T.average + '%')}${line('Grades A/B/C/D/F', `${T.grades.A}/${T.grades.B}/${T.grades.C}/${T.grades.D}/${T.grades.F}`)}${line('Came through an invite', T.invited)}${line('Shared with Gershon', T.shared)}</table>
<p style="margin-top:20px"><a href="${SITE}/admin" style="background:#FE1B04;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open the Gauge admin</a></p></div>`;
  return { subject: `Gauge Report — ${range}`, html };
}

// POST /api/admin/daily — called once a day by the GitHub Actions schedule (no secret needed:
// it only ever mails the fixed internal address, at most once every 20 hours). A signed-in admin
// can add ?preview=1 (no send) or ?force=1 (send now).
async function adminDaily(request, env) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const kv = env.GAUGE_KV;
  if (!kv) return noStorage();
  const q = new URL(request.url).searchParams;
  const admin = isAdmin(await session(request, env), env);
  const now = Date.now();
  const last = Date.parse((await kv.get('daily:last')) || '') || 0;
  if (!(admin && q.get('force') === '1') && !(admin && q.get('preview') === '1') && last && now - last < 20 * 3600000) {
    return json({ sent: false, skipped: 'already_sent', last: new Date(last).toISOString() });
  }
  const since = now - 86400000;
  const mail = reportEmail(summarize(await allMembers(kv), since), since, now);
  if (admin && q.get('preview') === '1') return json({ sent: false, preview: true, ...mail });
  if (!env.RESEND_API_KEY) return json({ sent: false, error: 'email_not_configured', subject: mail.subject });
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: REPORT_FROM, to: [env.REPORT_TO || REPORT_TO_DEFAULT], subject: mail.subject, html: mail.html }),
  });
  if (!r.ok) return json({ sent: false, error: 'send_failed', status: r.status }, 502);
  await kv.put('daily:last', new Date(now).toISOString());
  return json({ sent: true, subject: mail.subject, to: env.REPORT_TO || REPORT_TO_DEFAULT });
}

const forbiddenPage = (email) => new Response(`<!doctype html><meta charset="utf-8"><title>Gauge admin</title><link rel="stylesheet" href="/gauge.css"><main style="max-width:560px;margin:80px auto;font-family:sans-serif"><h1>Admin only</h1><p>You are signed in as ${esc(email || 'an account without an email')}, which is not a Gauge admin account.</p><p><a href="/app">Back to Gauge</a></p></main>`,
  { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

async function adminPage(request, env) {
  const s = await session(request, env);
  if (!s) return redirect('/api/auth/linkedin/start?next=/admin');
  if (!isAdmin(s, env)) return forbiddenPage(s.email);
  const res = await env.ASSETS.fetch(new Request(new URL('/admin', request.url), { headers: request.headers }));
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'no-store');
  out.headers.set('X-Robots-Tag', 'noindex');
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
    if (p === '/api/admin/summary') return adminSummary(request, env);
    if (p === '/api/admin/member') return adminMember(request, env);
    if (p === '/api/admin/daily') return adminDaily(request, env);
    if (p.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    if (p === '/admin' || p === '/admin/' || p === '/admin.html') return adminPage(request, env);
    if (p === '/' && request.method === 'GET') return landing(request, env);
    return env.ASSETS.fetch(request);
  },
};
