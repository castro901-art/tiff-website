const DEFAULT_ORIGINS = ['https://tiff.co.ke', 'https://www.tiff.co.ke'];
const MAX_REQUEST_BYTES = 48_000;
const MAX_MESSAGES = 16;
const MAX_USER_CHARS = 2_000;
const MAX_ASSISTANT_CHARS = 6_000;
const MAX_TOTAL_CHARS = 24_000;
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_ACTION = 'tiff_chat';
const GLOBAL_USAGE_OBJECT_NAME = 'tiff-chat-global';
const DEFAULT_DAILY_USAGE_LIMIT = 250;

function allowedOrigins(env) {
  const configured = typeof env.ALLOWED_ORIGINS === 'string' && env.ALLOWED_ORIGINS.trim()
    ? env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
    : DEFAULT_ORIGINS;
  return new Set(configured);
}

async function readLimitedRequestBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return { text: '' };

  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The request has already exceeded its limit; cancellation is best effort.
        }
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A stream that failed while being read may already have released its lock.
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { invalidEncoding: true };
  }
}

function jsonResponse(payload, status, origin, env) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin'
  });
  if (origin && allowedOrigins(env).has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '86400');
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGES) return false;
  if (messages[0]?.role !== 'user' || messages[messages.length - 1]?.role !== 'user') return false;

  let totalChars = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const item = messages[index];
    const expectedRole = index % 2 === 0 ? 'user' : 'assistant';
    if (!item || item.role !== expectedRole || typeof item.text !== 'string') return false;
    const text = item.text.trim();
    const limit = item.role === 'user' ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS;
    if (!text || text.length > limit) return false;
    totalChars += text.length;
  }
  return totalChars <= MAX_TOTAL_CHARS;
}

function dailyUsageLimit(env) {
  const configured = env.TIFF_CHAT_DAILY_LIMIT;
  const limit = configured === undefined || configured === null || configured === ''
    ? DEFAULT_DAILY_USAGE_LIMIT
    : Number(configured);
  return Number.isSafeInteger(limit) && limit > 0 ? limit : null;
}

async function verifyTurnstile(token, origin, request, env) {
  if (!env.TURNSTILE_SECRET_KEY) return { unavailable: true };

  const form = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token
  });
  const clientIp = request.headers.get('CF-Connecting-IP');
  if (clientIp) form.set('remoteip', clientIp);

  let response;
  try {
    response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(5_000)
    });
  } catch {
    return { unavailable: true };
  }
  if (!response.ok) return { unavailable: true };

  let result;
  try {
    result = await response.json();
  } catch {
    return { unavailable: true };
  }

  let hostname;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return { success: false };
  }
  return result?.success === true
    && result.hostname === hostname
    && result.action === TURNSTILE_ACTION
    ? { success: true }
    : { success: false };
}

async function claimGlobalUsage(env) {
  const limit = dailyUsageLimit(env);
  if (!limit || !env.TIFF_CHAT_USAGE) return { unavailable: true };

  try {
    const namespace = env.TIFF_CHAT_USAGE;
    const stub = namespace.get(namespace.idFromName(GLOBAL_USAGE_OBJECT_NAME));
    const response = await stub.fetch('https://tiff-chat-usage/claim', { method: 'POST' });
    if (!response.ok) return { unavailable: true };
    const result = await response.json();
    return typeof result?.allowed === 'boolean' ? result : { unavailable: true };
  } catch {
    return { unavailable: true };
  }
}

export class GlobalChatUsage {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/claim') return new Response('Not found.', { status: 404 });
    if (request.method !== 'POST') return new Response('Method not allowed.', { status: 405 });

    const limit = dailyUsageLimit(this.env);
    if (!limit) return new Response('Usage limit is not configured.', { status: 503 });

    const day = new Date().toISOString().slice(0, 10);
    try {
      const result = await this.state.storage.transaction(async (storage) => {
        const current = await storage.get('daily-usage');
        const used = current?.day === day && Number.isSafeInteger(current.count) && current.count > 0
          ? current.count
          : 0;
        if (used >= limit) return { allowed: false, used, limit, day };

        const next = used + 1;
        await storage.put('daily-usage', { day, count: next });
        return { allowed: true, used: next, limit, day };
      });
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    } catch {
      return new Response('Usage limit is unavailable.', { status: 503 });
    }
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = allowedOrigins(env);
    const url = new URL(request.url);

    if (!origin || !allowed.has(origin)) {
      return jsonResponse({ error: 'This site is not allowed to use the chat service.' }, 403, null, env);
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

    if (url.pathname !== '/chat') {
      return jsonResponse({ error: 'Not found.' }, 404, origin, env);
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed.' }, 405, origin, env);
    }
    const contentType = request.headers.get('Content-Type') || '';
    if (contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return jsonResponse({ error: 'Send a JSON request.' }, 415, origin, env);
    }

    const declaredLength = request.headers.get('Content-Length');
    if (declaredLength !== null) {
      if (!/^\d+$/.test(declaredLength)) {
        return jsonResponse({ error: 'The request could not be read. Please try again.' }, 400, origin, env);
      }
      if (BigInt(declaredLength) > BigInt(MAX_REQUEST_BYTES)) {
        return jsonResponse({ error: 'That message is too large. Please shorten it and try again.' }, 413, origin, env);
      }
    }
    if (!env.GEMINI_API_KEY) {
      return jsonResponse({ error: 'Tiff Chat is not available right now.' }, 503, origin, env);
    }

    let bodyRead;
    try {
      bodyRead = await readLimitedRequestBody(request);
    } catch {
      return jsonResponse({ error: 'The request could not be read. Please try again.' }, 400, origin, env);
    }
    if (bodyRead.tooLarge) {
      return jsonResponse({ error: 'That message is too large. Please shorten it and try again.' }, 413, origin, env);
    }
    if (bodyRead.invalidEncoding) {
      return jsonResponse({ error: 'The request could not be read. Please try again.' }, 400, origin, env);
    }

    let body;
    try {
      body = JSON.parse(bodyRead.text);
    } catch {
      return jsonResponse({ error: 'The request could not be read. Please try again.' }, 400, origin, env);
    }
    if (!validateMessages(body?.messages)) {
      return jsonResponse({ error: 'Please send a shorter message and try again.' }, 400, origin, env);
    }
    if (typeof body.turnstileToken !== 'string' || !body.turnstileToken.trim() || body.turnstileToken.length > 4_096) {
      return jsonResponse({ error: 'Please complete the security check and try again.' }, 403, origin, env);
    }

    let rateLimit;
    try {
      rateLimit = await env.TIFF_CHAT_LIMITER.limit({
        key: request.headers.get('CF-Connecting-IP') || 'unknown'
      });
    } catch {
      return jsonResponse({ error: 'Tiff Chat is not available right now.' }, 503, origin, env);
    }
    if (!rateLimit?.success) {
      return jsonResponse({ error: 'You have sent several messages. Please wait a minute and try again.' }, 429, origin, env);
    }

    const challenge = await verifyTurnstile(body.turnstileToken, origin, request, env);
    if (challenge.unavailable) {
      return jsonResponse({ error: 'Tiff Chat is not available right now.' }, 503, origin, env);
    }
    if (!challenge.success) {
      return jsonResponse({ error: 'Please complete the security check and try again.' }, 403, origin, env);
    }

    const usage = await claimGlobalUsage(env);
    if (usage.unavailable) {
      return jsonResponse({ error: 'Tiff Chat is not available right now.' }, 503, origin, env);
    }
    if (!usage.allowed) {
      return jsonResponse({ error: 'Tiff has reached today’s global chat limit. Please try again after the daily reset.' }, 429, origin, env);
    }

    const contents = body.messages.map(({ role, text }) => ({
      role: role === 'assistant' ? 'model' : 'user',
      parts: [{ text: text.trim() }]
    }));
    const model = typeof env.GEMINI_MODEL === 'string' && /^[a-zA-Z0-9._-]+$/.test(env.GEMINI_MODEL)
      ? env.GEMINI_MODEL
      : 'gemini-3.6-flash';

    const apiBody = JSON.stringify({
      systemInstruction: {
        parts: [{ text: 'You are Tiff, a helpful AI assistant from Trendify Labs. Be clear, friendly, and useful. Be honest about uncertainty and limitations. Do not claim to be human or to have taken actions you did not take. Do not request passwords, payment credentials, or highly sensitive personal information. When relevant, be considerate of Kenyan and East African context without assuming every user is there.' }]
      },
      contents,
      generationConfig: { maxOutputTokens: 500 }
    });

    let upstream;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': env.GEMINI_API_KEY
          },
          body: apiBody,
          signal: AbortSignal.timeout(15_000)
        });
      } catch {
        if (attempt === 1) {
          return jsonResponse({ error: 'Tiff could not connect to its AI service. Please try again.' }, 502, origin, env);
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000 * (2 ** attempt) + Math.random() * 250));
        continue;
      }

      const retryable = upstream.status === 408 || upstream.status === 429 || upstream.status >= 500;
      if (upstream.ok || !retryable || attempt === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (2 ** attempt) + Math.random() * 250));
    }

    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : 502;
      const error = status === 429
        ? 'Tiff is receiving too many requests right now. Please wait a moment and try again.'
        : 'Tiff could not respond just now. Please try again later.';
      return jsonResponse({ error }, status, origin, env);
    }

    let result;
    try {
      result = await upstream.json();
    } catch {
      return jsonResponse({ error: 'Tiff could not read the AI response. Please try again.' }, 502, origin, env);
    }

    const reply = result?.candidates?.[0]?.content?.parts
      ?.map((part) => typeof part.text === 'string' ? part.text : '')
      .join('')
      .trim();
    if (!reply) {
      return jsonResponse({ error: 'Tiff could not form a reply to that message. Please try another way.' }, 502, origin, env);
    }

    return jsonResponse({ reply }, 200, origin, env);
  }
};
