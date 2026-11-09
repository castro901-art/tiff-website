const ALLOWED_ORIGINS = new Set([
  'https://tiff.co.ke',
  'https://www.tiff.co.ke'
]);
const MAX_BODY_BYTES = 4_096;
const RETENTION_SECONDS = 30 * 24 * 60 * 60;
const USED_UP_CODES = new Set(['meettiffbot']);

function jsonResponse(payload, status, origin) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Vary': 'Origin'
  });
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '86400');
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

function messageResponse(message, status, origin) {
  return jsonResponse({ message }, status, origin);
}

async function readJson(request, origin) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return { error: messageResponse('Please send a JSON request.', 415, origin) };
  }

  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return { error: messageResponse('That request is too large. Please try again.', 413, origin) };
  }

  let raw;
  try {
    raw = await request.text();
  } catch {
    return { error: messageResponse('We could not read that request. Please try again.', 400, origin) };
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return { error: messageResponse('That request is too large. Please try again.', 413, origin) };
  }

  try {
    return { body: JSON.parse(raw) };
  } catch {
    return { error: messageResponse('Please check the form and try again.', 400, origin) };
  }
}

async function applyRateLimit(request, route, env, origin) {
  if (!env.WAITLIST_LIMITER || typeof env.WAITLIST_LIMITER.limit !== 'function') {
    return messageResponse('The waitlist is temporarily unavailable. Please try again later.', 503, origin);
  }
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const result = await env.WAITLIST_LIMITER.limit({ key: `${route}:${ip}` });
    if (!result?.success) {
      return messageResponse('Too many tries. Please wait a minute and try again.', 429, origin);
    }
    return null;
  } catch {
    return messageResponse('The waitlist is temporarily unavailable. Please try again later.', 503, origin);
  }
}

async function handleInvite(body, origin) {
  const code = typeof body?.code === 'string' ? body.code.trim().toLowerCase() : '';
  if (!code || code.length > 80) {
    return messageResponse('Enter an invitation code to check it.', 400, origin);
  }
  if (USED_UP_CODES.has(code)) {
    return jsonResponse({ status: 'used_up', message: 'This invite code has been used up.' }, 200, origin);
  }
  return jsonResponse({
    status: 'not_recognised',
    message: 'We could not verify that invite code. Check it or join the waitlist.'
  }, 200, origin);
}

async function handleWaitlist(body, env, origin) {
  // A quiet honeypot lets simple form-filling bots exit without adding fake records.
  if (typeof body?.website === 'string' && body.website.trim()) {
    return jsonResponse({ status: 'received', message: 'Thanks for your interest in Tiffbot.' }, 202, origin);
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return messageResponse('Enter a valid email address to join the waitlist.', 400, origin);
  }
  if (!env.WAITLIST_DB) {
    return messageResponse('The waitlist is temporarily unavailable. Please try again later.', 503, origin);
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + RETENTION_SECONDS;
  try {
    const result = await env.WAITLIST_DB.prepare(
      'INSERT INTO tiffbot_waitlist (email, created_at, expires_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(email) DO UPDATE SET created_at = excluded.created_at, expires_at = excluded.expires_at ' +
      'WHERE tiffbot_waitlist.expires_at <= ?'
    ).bind(email, now, expiresAt, now).run();

    if (Number(result?.meta?.changes || 0) > 0) {
      return jsonResponse({
        status: 'joined',
        message: 'You’re on the Tiffbot waitlist. We’ll contact you about early access.'
      }, 201, origin);
    }
    return jsonResponse({
      status: 'already_joined',
      message: 'That email is already on the Tiffbot waitlist.'
    }, 200, origin);
  } catch {
    return messageResponse('We could not save your signup just now. Please try again later.', 503, origin);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    if (url.pathname === '/health' && request.method === 'GET') {
      return new Response('ok', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }

    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse({ message: 'This site is not allowed to use the waitlist service.' }, 403, null);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
          'Cache-Control': 'no-store',
          'Vary': 'Origin'
        }
      });
    }

    if (request.method !== 'POST') {
      return messageResponse('Method not allowed.', 405, origin);
    }

    const route = url.pathname === '/api/waitlist' ? 'waitlist'
      : url.pathname === '/api/invite' ? 'invite'
        : null;
    if (!route) return messageResponse('Not found.', 404, origin);

    const limited = await applyRateLimit(request, route, env, origin);
    if (limited) return limited;

    const parsed = await readJson(request, origin);
    if (parsed.error) return parsed.error;

    return route === 'invite'
      ? handleInvite(parsed.body, origin)
      : handleWaitlist(parsed.body, env, origin);
  },

  async scheduled(_event, env) {
    if (!env.WAITLIST_DB) throw new Error('WAITLIST_DB binding is required for retention cleanup.');
    const now = Math.floor(Date.now() / 1000);
    await env.WAITLIST_DB.prepare(
      'DELETE FROM tiffbot_waitlist WHERE expires_at <= ?'
    ).bind(now).run();
  }
};
