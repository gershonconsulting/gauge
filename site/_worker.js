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
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
const STATE_TTL = 600; // 10 minutes

const enc = new TextEncoder();
const dec = new TextDecoder();

function cfg(env) {
  return {
    clientId: env.LINKEDIN_CLIENT_ID || DEFAULTS.LINKEDIN_CLIENT_ID,
    clientSecret: env.LINKEDIN_CLIENT_SECRET || '',
    sessionSecret: env.SESSION_SECRET || '',
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

async function start(env) {
  const c = cfg(env);
  if (!c.clientSecret || !c.sessionSecret) return redirect('/?error=not_configured');
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const u = new URL('https://www.linkedin.com/oauth/v2/authorization');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', c.clientId);
  u.searchParams.set('redirect_uri', c.redirectUri);
  u.searchParams.set('state', state);
  u.searchParams.set('scope', DEFAULTS.SCOPE);
  return redirect(u.toString(), [setCookie(STATE_COOKIE, state, STATE_TTL)]);
}

async function callback(request, env) {
  const c = cfg(env);
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
  return redirect('/', [setCookie(SESSION_COOKIE, session, SESSION_TTL), setCookie(STATE_COOKIE, '', 0)]);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p === '/api/health') {
      const c = cfg(env);
      return json({ ok: true, app: 'gauge', linkedinSecretSet: !!c.clientSecret, sessionSecretSet: !!c.sessionSecret });
    }
    if (p === '/api/auth/linkedin/start') return start(env);
    if (p === '/api/auth/linkedin/callback') return callback(request, env);
    if (p === '/api/me') {
      const s = await readSession(cookies(request)[SESSION_COOKIE], cfg(env).sessionSecret);
      if (!s) return json({ signedIn: false }, 401);
      return json({ signedIn: true, name: s.name, picture: s.picture, email: s.email });
    }
    if (p === '/api/auth/logout') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return json({ ok: true }, 200, { 'Set-Cookie': setCookie(SESSION_COOKIE, '', 0) });
    }
    if (p.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
