const MAX_REQUEST_BYTES = 48_000;
const MAX_MESSAGES = 16;
const MAX_USER_CHARS = 2_000;
const MAX_ASSISTANT_CHARS = 6_000;
const MAX_TOTAL_CHARS = 24_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 8;
const MODEL = 'gemini-3.6-flash';
const rateBuckets = new Map();

function json(res, status, payload, origin = null) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Origin');
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  return res.status(status).json(payload);
}

function allowedPreviewOrigins() {
  const origins = new Set();
  for (const value of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const host = value.trim().replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    if (/^[a-z0-9.-]+\.vercel\.app$/.test(host)) origins.add(`https://${host}`);
  }
  return origins;
}

function validMessages(messages) {
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

const SAFE_DIAGNOSTIC_CATEGORIES = new Set([
  'upstream_retry', 'upstream_failure', 'network_retry', 'network_failure',
  'timeout_retry', 'timeout_failure', 'invalid_json', 'empty_reply'
]);

function safeUpstreamDiagnostic(requestId, upstreamStatus, category) {
  if (!SAFE_DIAGNOSTIC_CATEGORIES.has(category)) return;
  console.error(JSON.stringify({
    requestId,
    upstreamStatus: Number.isInteger(upstreamStatus) ? upstreamStatus : null,
    category
  }));
}

function withinRateLimit(request) {
  const forwarded = request.headers['x-forwarded-for'];
  const key = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : 'unknown';
  const now = Date.now();
  const recent = (rateBuckets.get(key) || []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    rateBuckets.set(key, recent);
    return false;
  }
  recent.push(now);
  rateBuckets.set(key, recent);
  for (const [ip, timestamps] of rateBuckets) {
    if (!timestamps.some((timestamp) => now - timestamp < RATE_WINDOW_MS)) rateBuckets.delete(ip);
  }
  return true;
}

module.exports = async function handler(req, res) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return json(res, 404, { error: 'Not found.' });
  }

  const origin = req.headers.origin;
  const origins = allowedPreviewOrigins();
  if (typeof origin !== 'string' || !origins.has(origin)) {
    return json(res, 403, { error: 'This preview site is not allowed to use the chat service.' });
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' }, origin);
  if (!req.headers['content-type']?.toLowerCase().includes('application/json')) {
    return json(res, 415, { error: 'Send a JSON request.' }, origin);
  }
  const length = Number(req.headers['content-length'] || 0);
  if (length > MAX_REQUEST_BYTES) {
    return json(res, 413, { error: 'That message is too large. Please shorten it and try again.' }, origin);
  }
  if (!process.env.GEMINI_API_KEY) return json(res, 503, { error: 'Tiff Chat is not available right now.' }, origin);

  let body = req.body;
  if (Buffer.isBuffer(body)) {
    try {
      body = JSON.parse(body.toString('utf8'));
    } catch {
      return json(res, 400, { error: 'The request could not be read. Please try again.' }, origin);
    }
  } else if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return json(res, 400, { error: 'The request could not be read. Please try again.' }, origin);
    }
  }
  if (!body || typeof body !== 'object' || Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_REQUEST_BYTES) {
    return json(res, 413, { error: 'That message is too large. Please shorten it and try again.' }, origin);
  }
  if (!validMessages(body.messages)) {
    return json(res, 400, { error: 'Please send a shorter message and try again.' }, origin);
  }
  if (!withinRateLimit(req)) {
    return json(res, 429, { error: 'You have sent several messages. Please wait a minute and try again.' }, origin);
  }

  const contents = body.messages.map(({ role, text }) => ({
    role: role === 'assistant' ? 'model' : 'user',
    parts: [{ text: text.trim() }]
  }));
  const apiBody = JSON.stringify({
    systemInstruction: {
      parts: [{ text: 'You are Tiff, a helpful AI assistant from Trendify Labs. Be clear, friendly, and useful. Be honest about uncertainty and limitations. Do not claim to be human or to have taken actions you did not take. Do not request passwords, payment credentials, or highly sensitive personal information. When relevant, be considerate of Kenyan and East African context without assuming every user is there.' }]
    },
    contents,
    generationConfig: { maxOutputTokens: 500 }
  });

  const diagnosticRequestId = require('node:crypto').randomUUID();
  let upstream;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY
        },
          body: apiBody,
          signal: AbortSignal.timeout(15_000)
        });
    } catch (error) {
      const retrying = attempt < 1;
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      safeUpstreamDiagnostic(
        diagnosticRequestId,
        null,
        timedOut ? (retrying ? 'timeout_retry' : 'timeout_failure') : (retrying ? 'network_retry' : 'network_failure')
      );
      if (attempt === 1) return json(res, 502, { error: 'Tiff could not connect to its AI service. Please try again.' }, origin);
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (2 ** attempt)));
      continue;
    }
    const retryable = upstream.status === 408 || upstream.status === 429 || upstream.status >= 500;
    if (!upstream.ok) {
      safeUpstreamDiagnostic(diagnosticRequestId, upstream.status, retryable && attempt < 1 ? 'upstream_retry' : 'upstream_failure');
    }
    if (upstream.ok || !retryable || attempt === 1) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000 * (2 ** attempt)));
  }

  if (!upstream?.ok) {
    const status = upstream?.status === 429 ? 429 : 502;
    const error = status === 429
      ? 'Tiff is receiving too many requests right now. Please wait a moment and try again.'
      : 'Tiff could not respond just now. Please try again later.';
    return json(res, status, { error }, origin);
  }

  let result;
  try {
    result = await upstream.json();
  } catch {
    safeUpstreamDiagnostic(diagnosticRequestId, upstream.status, 'invalid_json');
    return json(res, 502, { error: 'Tiff could not read the AI response. Please try again.' }, origin);
  }
  const reply = result?.candidates?.[0]?.content?.parts
    ?.map((part) => typeof part.text === 'string' ? part.text : '')
    .join('')
    .trim();
  if (!reply) {
    safeUpstreamDiagnostic(diagnosticRequestId, upstream.status, 'empty_reply');
    return json(res, 502, { error: 'Tiff could not form a reply to that message. Please try another way.' }, origin);
  }
  return json(res, 200, { reply }, origin);
};

module.exports.config = { api: { bodyParser: { sizeLimit: '48kb' } } };
