import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.mjs';

function createEnvironment() {
  const rows = new Map();
  const env = {
    WAITLIST_DB: {
      prepare(sql) {
        return {
          values: [],
          bind(...values) {
            this.values = values;
            return this;
          },
          async run() {
            if (sql.startsWith('INSERT INTO tiffbot_waitlist')) {
              const [email, createdAt, expiresAt, now] = this.values;
              const current = rows.get(email);
              if (current && current.expiresAt > now) return { meta: { changes: 0 } };
              rows.set(email, { createdAt, expiresAt });
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith('DELETE FROM tiffbot_waitlist')) {
              const [now] = this.values;
              let changes = 0;
              for (const [email, row] of rows.entries()) {
                if (row.expiresAt <= now) {
                  rows.delete(email);
                  changes += 1;
                }
              }
              return { meta: { changes } };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
          }
        };
      }
    },
    WAITLIST_LIMITER: { async limit() { return { success: true }; } }
  };
  return { env, rows };
}

function makeRequest(path, body, origin = 'https://tiff.co.ke') {
  return new Request(`https://tiffbot-waitlist.test${path}`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.42'
    },
    body: JSON.stringify(body)
  });
}

async function readResponse(response) {
  return { status: response.status, body: await response.json() };
}

test('meettiffbot is reported as used up', async () => {
  const { env } = createEnvironment();
  const response = await worker.fetch(makeRequest('/api/invite', { code: '  MeetTiffbot  ' }), env);
  const result = await readResponse(response);
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'used_up');
  assert.equal(result.body.message, 'This invite code has been used up.');
});

test('unrecognised invite codes return a clear, non-success result', async () => {
  const { env } = createEnvironment();
  const response = await worker.fetch(makeRequest('/api/invite', { code: 'not-a-code' }), env);
  const result = await readResponse(response);
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'not_recognised');
});

test('valid waitlist signup stores a normalized email with a 30-day expiry', async () => {
  const { env, rows } = createEnvironment();
  const before = Math.floor(Date.now() / 1000);
  const response = await worker.fetch(makeRequest('/api/waitlist', { email: '  User@Example.com  ' }), env);
  const result = await readResponse(response);
  const row = rows.get('user@example.com');
  assert.equal(result.status, 201);
  assert.equal(result.body.status, 'joined');
  assert.ok(row.createdAt >= before && row.createdAt <= before + 2);
  assert.equal(row.expiresAt - row.createdAt, 30 * 24 * 60 * 60);
});

test('duplicate active email does not create a second signup', async () => {
  const { env, rows } = createEnvironment();
  const first = await worker.fetch(makeRequest('/api/waitlist', { email: 'user@example.com' }), env);
  const second = await worker.fetch(makeRequest('/api/waitlist', { email: 'USER@example.com' }), env);
  assert.equal(first.status, 201);
  const result = await readResponse(second);
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'already_joined');
  assert.equal(rows.size, 1);
});

test('honeypot submission is acknowledged without saving an entry', async () => {
  const { env, rows } = createEnvironment();
  const response = await worker.fetch(makeRequest('/api/waitlist', { email: 'bot@example.com', website: 'spam' }), env);
  assert.equal(response.status, 202);
  assert.equal(rows.size, 0);
});

test('requests from an unapproved origin are rejected', async () => {
  const { env } = createEnvironment();
  const response = await worker.fetch(makeRequest('/api/invite', { code: 'meettiffbot' }, 'https://attacker.example'), env);
  assert.equal(response.status, 403);
});

test('scheduled cleanup removes expired entries', async () => {
  const { env, rows } = createEnvironment();
  rows.set('expired@example.com', { createdAt: 1, expiresAt: Math.floor(Date.now() / 1000) - 1 });
  rows.set('active@example.com', { createdAt: Math.floor(Date.now() / 1000), expiresAt: Math.floor(Date.now() / 1000) + 10_000 });
  await worker.scheduled({}, env);
  assert.equal(rows.has('expired@example.com'), false);
  assert.equal(rows.has('active@example.com'), true);
});
