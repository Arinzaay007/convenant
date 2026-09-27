import test from 'node:test';
import assert from 'node:assert/strict';
import health from '../api/health.mjs';
import check from '../api/check.mjs';
import { vercelHandler } from '../vercel-adapter.mjs';

function invoke(handler, { method = 'GET', url = '/incorrect?x=1', body } = {}) {
  const req = { method, url, headers: { 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' } };
  if (body !== undefined) Object.defineProperty(req, 'body', { get: typeof body === 'function' ? body : () => body });
  const result = { status: null, headers: {}, body: null, req };
  const res = {
    writeHead(status, headers) { result.status = status; result.headers = headers; return this; },
    end(value) { result.body = value || ''; return this; }
  };
  return Promise.resolve(handler(req, res)).then(() => result);
}

test('Vercel API wrappers do not depend on the incoming rewritten URL', async () => {
  const r = await invoke(health);
  assert.equal(r.req.url, '/api/health?x=1');
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).serverCanSign, false);
});

test('Vercel pre-parsed POST body still fails closed without real operator figures', async () => {
  const r = await invoke(check, { method: 'POST', body: {} });
  assert.equal(r.status, 422);
  assert.equal(JSON.parse(r.body).code, 'REAL_INPUT_REQUIRED');
});

test('Vercel malformed pre-parsed body is a client error, not an accidental 500', async () => {
  const r = await invoke(vercelHandler('/api/check'), { method: 'POST', body: () => { throw new SyntaxError('invalid JSON'); } });
  assert.equal(r.status, 400);
  assert.equal(JSON.parse(r.body).error, 'Invalid JSON.');
});
