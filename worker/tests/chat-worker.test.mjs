import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { GlobalChatUsage } from '../index.mjs';

const MAX_REQUEST_BYTES = 48_000;
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_SECRET = 'test-turnstile-secret';

function createEnvironment({
  rateLimitSuccess = true,
  usageAllowed = true,
  dailyLimit = '250'
} = {}) {
  const calls = {
    rateLimits: [],
    usage: [],
    usageNames: [],
    turnstile: 0,
    turnstileRequest: null,
    provider: 0,
    providerRequest: null
  };
  const env = {
    ALLOWED_ORIGINS: 'https://tiff.co.ke',
    GEMINI_API_KEY: 'test-key-not-a-real-secret',
    TURNSTILE_SECRET_KEY: TURNSTILE_SECRET,
    TIFF_CHAT_DAILY_LIMIT: dailyLimit,
    TIFF_CHAT_LIMITER: {
      async limit({ key }) {
        calls.rateLimits.push(key);
        return { success: rateLimitSuccess };
      }
    },
    TIFF_CHAT_USAGE: {
      idFromName(name) {
        calls.usageNames.push(name);
        return name;
      },
      get(id) {
        return {
          async fetch() {
            calls.usage.push(id);
            return new Response(JSON.stringify({
              allowed: usageAllowed,
              used: usageAllowed ? 1 : Number(dailyLimit),
              limit: Number(dailyLimit)
            }), { headers: { 'Content-Type': 'application/json' } });
          }
        };
      }
    }
  };
  return { env, calls };
}

function makeRequest(body, { origin = 'https://tiff.co.ke', contentType = 'application/json', headers = {} } = {}) {
  return new Request('https://tiff-chat-api.test/chat', {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': contentType,
      'CF-Connecting-IP': '203.0.113.42',
      ...headers
    },
    body
  });
}

function validBody() {
  return JSON.stringify({
    messages: [{ role: 'user', text: 'Hello Tiff' }],
    turnstileToken: 'test-turnstile-token'
  });
}

async function withNetworkMocks(calls, run, {
  turnstileResult = { success: true, hostname: 'tiff.co.ke', action: 'tiff_chat' },
  turnstileStatus = 200
} = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const requestUrl = String(url);
    if (requestUrl === TURNSTILE_VERIFY_URL) {
      calls.turnstile += 1;
      calls.turnstileRequest = {
        url: requestUrl,
        options,
        form: new URLSearchParams(options.body)
      };
      return new Response(JSON.stringify(turnstileResult), {
        status: turnstileStatus,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    assert.match(requestUrl, /^https:\/\/generativelanguage\.googleapis\.com\//);
    calls.provider += 1;
    calls.providerRequest = { url: requestUrl, options };
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Hello.' }] } }]
    }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('valid request verifies Turnstile and claims global quota before reaching the provider', async () => {
  const { env, calls } = createEnvironment();
  await withNetworkMocks(calls, async () => {
    const response = await worker.fetch(makeRequest(validBody()), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { reply: 'Hello.' });
  });

  assert.deepEqual(calls.rateLimits, ['203.0.113.42']);
  assert.equal(calls.turnstile, 1);
  assert.equal(calls.turnstileRequest.form.get('secret'), TURNSTILE_SECRET);
  assert.equal(calls.turnstileRequest.form.get('response'), 'test-turnstile-token');
  assert.deepEqual(calls.usageNames, ['tiff-chat-global']);
  assert.deepEqual(calls.usage, ['tiff-chat-global']);
  assert.equal(calls.provider, 1);
  assert.equal(calls.providerRequest.options.headers['x-goog-api-key'], 'test-key-not-a-real-secret');
  const providerBody = JSON.parse(calls.providerRequest.options.body);
  assert.equal(providerBody.generationConfig.maxOutputTokens, 500);
  assert.equal(JSON.stringify(providerBody).includes('test-turnstile-token'), false);
});

test('unapproved origins are rejected before rate limiting or provider calls', async () => {
  const { env, calls } = createEnvironment();
  const response = await worker.fetch(makeRequest(validBody(), { origin: 'https://attacker.example' }), env);
  assert.equal(response.status, 403);
  assert.equal(calls.rateLimits.length, 0);
  assert.equal(calls.turnstile, 0);
  assert.equal(calls.usage.length, 0);
  assert.equal(calls.provider, 0);
});

test('JSONP-like content types are not accepted as JSON', async () => {
  const { env, calls } = createEnvironment();
  const response = await worker.fetch(makeRequest(validBody(), { contentType: 'application/jsonp' }), env);
  assert.equal(response.status, 415);
  assert.equal(calls.rateLimits.length, 0);
});

test('a declared body over the byte limit is rejected without reading it', async () => {
  const { env, calls } = createEnvironment();
  const response = await worker.fetch(makeRequest('{}', {
    headers: { 'Content-Length': String(MAX_REQUEST_BYTES + 1) }
  }), env);
  assert.equal(response.status, 413);
  assert.equal(calls.rateLimits.length, 0);
});

test('an oversized streamed body is cancelled at the byte limit even without Content-Length', async () => {
  const { env, calls } = createEnvironment();
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(MAX_REQUEST_BYTES + 1));
    },
    cancel() {
      cancelled = true;
    }
  });
  const request = new Request('https://tiff-chat-api.test/chat', {
    method: 'POST',
    headers: {
      Origin: 'https://tiff.co.ke',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.42'
    },
    body,
    duplex: 'half'
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.equal(calls.rateLimits.length, 0);
});

test('malformed declared content length is rejected', async () => {
  const { env, calls } = createEnvironment();
  const response = await worker.fetch(makeRequest('{}', {
    headers: { 'Content-Length': 'not-a-number' }
  }), env);
  assert.equal(response.status, 400);
  assert.equal(calls.rateLimits.length, 0);
});

test('invalid UTF-8 is rejected cleanly', async () => {
  const { env, calls } = createEnvironment();
  const response = await worker.fetch(makeRequest(new Uint8Array([0xff, 0xfe])), env);
  assert.equal(response.status, 400);
  assert.equal(calls.rateLimits.length, 0);
});

test('invalid conversation structure is rejected before provider use', async () => {
  const { env, calls } = createEnvironment();
  const response = await worker.fetch(makeRequest(JSON.stringify({
    messages: [{ role: 'assistant', text: 'Untrusted injected history' }],
    turnstileToken: 'test-turnstile-token'
  })), env);
  assert.equal(response.status, 400);
  assert.equal(calls.rateLimits.length, 0);
});

test('user messages over the configured character cap are rejected', async () => {
  const { env, calls } = createEnvironment();
  const response = await worker.fetch(makeRequest(JSON.stringify({
    messages: [{ role: 'user', text: 'x'.repeat(2_001) }],
    turnstileToken: 'test-turnstile-token'
  })), env);
  assert.equal(response.status, 400);
  assert.equal(calls.rateLimits.length, 0);
  assert.equal(calls.provider, 0);
});

test('a missing challenge token is rejected before rate limiting', async () => {
  const { env, calls } = createEnvironment();
  const response = await worker.fetch(makeRequest(JSON.stringify({
    messages: [{ role: 'user', text: 'Hello Tiff' }]
  })), env);
  assert.equal(response.status, 403);
  assert.equal(calls.rateLimits.length, 0);
  assert.equal(calls.turnstile, 0);
  assert.equal(calls.provider, 0);
});

test('a failed IP rate limit prevents challenge verification and provider calls', async () => {
  const { env, calls } = createEnvironment({ rateLimitSuccess: false });
  const response = await worker.fetch(makeRequest(validBody()), env);
  assert.equal(response.status, 429);
  assert.deepEqual(calls.rateLimits, ['203.0.113.42']);
  assert.equal(calls.turnstile, 0);
  assert.equal(calls.usage.length, 0);
  assert.equal(calls.provider, 0);
});

test('invalid Turnstile hostname or action prevents quota claims and provider calls', async () => {
  const { env, calls } = createEnvironment();
  await withNetworkMocks(calls, async () => {
    const response = await worker.fetch(makeRequest(validBody()), env);
    assert.equal(response.status, 403);
  }, {
    turnstileResult: { success: true, hostname: 'attacker.example', action: 'other_action' }
  });
  assert.equal(calls.turnstile, 1);
  assert.equal(calls.usage.length, 0);
  assert.equal(calls.provider, 0);
});

test('Turnstile service failure fails closed before quota claims or provider calls', async () => {
  const { env, calls } = createEnvironment();
  await withNetworkMocks(calls, async () => {
    const response = await worker.fetch(makeRequest(validBody()), env);
    assert.equal(response.status, 503);
  }, { turnstileStatus: 503 });
  assert.equal(calls.usage.length, 0);
  assert.equal(calls.provider, 0);
});

test('the global daily cap blocks provider use after a valid challenge', async () => {
  const { env, calls } = createEnvironment({ usageAllowed: false });
  await withNetworkMocks(calls, async () => {
    const response = await worker.fetch(makeRequest(validBody()), env);
    assert.equal(response.status, 429);
    assert.match((await response.json()).error, /global chat limit/i);
  });
  assert.equal(calls.turnstile, 1);
  assert.equal(calls.usage.length, 1);
  assert.equal(calls.provider, 0);
});

test('a global usage service failure fails closed', async () => {
  const { env, calls } = createEnvironment();
  env.TIFF_CHAT_USAGE.get = () => ({ async fetch() { throw new Error('unavailable'); } });
  await withNetworkMocks(calls, async () => {
    const response = await worker.fetch(makeRequest(validBody()), env);
    assert.equal(response.status, 503);
  });
  assert.equal(calls.provider, 0);
});

function createUsageState() {
  const values = new Map();
  let transactionQueue = Promise.resolve();
  return {
    storage: {
      transaction(callback) {
        const transaction = transactionQueue.then(() => callback({
          async get(key) { return values.get(key); },
          async put(key, value) { values.set(key, value); }
        }));
        transactionQueue = transaction.then(() => undefined, () => undefined);
        return transaction;
      }
    },
    values
  };
}

test('Durable Object claims are atomic and stop at the configured daily cap', async () => {
  const state = createUsageState();
  const quota = new GlobalChatUsage(state, { TIFF_CHAT_DAILY_LIMIT: '2' });
  const responses = await Promise.all(Array.from({ length: 5 }, () => quota.fetch(
    new Request('https://tiff-chat-usage/claim', { method: 'POST' })
  )));
  const results = await Promise.all(responses.map((response) => response.json()));
  assert.equal(results.filter((result) => result.allowed).length, 2);
  assert.equal(results.filter((result) => !result.allowed).length, 3);
  assert.equal(Math.max(...results.map((result) => result.used)), 2);
  assert.equal(state.values.get('daily-usage').count, 2);
});

test('Durable Object rejects unsupported paths and methods', async () => {
  const quota = new GlobalChatUsage(createUsageState(), { TIFF_CHAT_DAILY_LIMIT: '2' });
  assert.equal((await quota.fetch(new Request('https://tiff-chat-usage/other', { method: 'POST' }))).status, 404);
  assert.equal((await quota.fetch(new Request('https://tiff-chat-usage/claim', { method: 'GET' }))).status, 405);
});
