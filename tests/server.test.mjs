import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../server.mjs';
import { addDays } from '../engine.mjs';

const server = createServer();
let base;
before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
const today = new Date().toISOString().slice(0, 10);
const routeId = '56-0xc975a3eef2e49f8eddef585340c43f15300fcb82';
const wallet = '0x2222222222222222222222222222222222222222';
const scenario = {
  cash: '20000', floor: '3000', proposed: '4000', existingVault: '0', horizon: 30, redemptionLag: 3,
  obligations: [
    { id: 'payout', label: 'Partner payout', amount: '8000', due: addDays(today, 4), kind: 'scheduled' },
    { id: 'credit', label: 'Service credit', amount: '4000', due: addDays(today, 5), kind: 'performance' }
  ]
};
const storm = { ...scenario, obligations: [...scenario.obligations, { id: 'storm', label: 'What-if reserve', amount: '4000', due: addDays(today, 5), kind: 'event' }] };
async function post(path, body) {
  const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, value: await response.json() };
}

test('health reports dry-run and no stored key; page serves a restrictive CSP', async () => {
  const health = await fetch(base + '/api/health');
  assert.equal(health.status, 200);
  const data = await health.json();
  assert.equal(data.apiKeyStored, false);
  assert.match(data.mode, /no custody/);
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(await page.text(), /Keep promises liquid/);
  assert.equal((await fetch(base + '/server.mjs')).status, 404);
  assert.equal((await fetch(base + '/missing/index.html')).status, 404);
});

test('check endpoint is deterministic and validates scenarios as 422, not a generic 500', async () => {
  const pass = await post('/api/check', { scenario });
  assert.equal(pass.status, 200);
  assert.equal(pass.value.safeMaxCents, 500_000);
  const fail = await post('/api/check', { scenario: storm });
  assert.equal(fail.status, 200);
  assert.equal(fail.value.safeMaxCents, 100_000);
  assert.equal(fail.value.firstBreach.shortfallCents, 300_000);
  const invalid = await post('/api/check', { scenario: { ...scenario, floor: '-100' } });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.value.code, 'INVALID_SCENARIO');
  const empty = await post('/api/check', { scenario: { ...scenario, obligations: [] } });
  assert.equal(empty.status, 422); assert.equal(empty.value.code, 'REAL_LEDGER_REQUIRED');
  const noCash = await post('/api/check', { scenario: { ...scenario, cash: '' } });
  assert.equal(noCash.status, 422); assert.equal(noCash.value.code, 'REAL_INPUT_REQUIRED');
});

test('unsafe and out-of-window plans are blocked before making a remote IXS call', async () => {
  const blocked = await post('/api/prepare', { scenario: storm, amount: '4000', vaultId: routeId, ownerAddress: wallet });
  assert.equal(blocked.status, 409); assert.equal(blocked.value.code, 'REDLINE');
  const outside = await post('/api/prepare', { scenario: { ...scenario, horizon: 14, obligations: [...scenario.obligations, { id: 'later', label: 'Later obligation', amount: '1', due: addDays(today, 16) }] }, amount: '4000', vaultId: routeId, ownerAddress: wallet });
  assert.equal(outside.status, 409); assert.equal(outside.value.code, 'HORIZON');
  const empty = await post('/api/prepare', { scenario: { ...scenario, obligations: [] }, amount: '4000', vaultId: routeId, ownerAddress: wallet });
  assert.equal(empty.status, 409); assert.equal(empty.value.code, 'EMPTY_LEDGER');
  const sentinel = await post('/api/prepare', { scenario, amount: '4000', vaultId: routeId, ownerAddress: '0x0000000000000000000000000000000000000001' });
  assert.equal(sentinel.status, 422); assert.equal(sentinel.value.code, 'REAL_OWNER_REQUIRED');
  const noKey = await post('/api/interpret', { note: 'Pay 1000 USD on Friday next week.', key: '' });
  assert.equal(noKey.status, 422); assert.equal(noKey.value.code, 'SERV_KEY_REQUIRED');
});

test('SERV structured output requires a matching source quote and operator review (stubbed upstream)', async () => {
  const originalFetch = globalThis.fetch;
  const key = 'test-access-key-123456';
  const note = 'If dispatch is missed, customers receive service credits of up to 2000 USDC by 2026-09-27.';
  let modelReply = { obligations: [{ label: 'Service-credit refund', amountUsd: 2000, dueDate: '2026-09-27', kind: 'performance', confidence: 'medium', evidence: '2000 USDC by 2026-09-27' }], warnings: [] };
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith(base)) return originalFetch(url, options);
    assert.equal(String(url), 'https://inference-api.openserv.ai/v1/chat/completions');
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    const sent = JSON.parse(options.body);
    assert.equal(sent.model, 'gpt-5.4-mini');
    assert.equal(sent.response_format.type, 'json_schema');
    assert.equal(sent.response_format.json_schema.strict, true);
    assert.equal(sent.messages[0].role, 'system');
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(modelReply) } }], model: 'gpt-5.4-mini' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const pass = await post('/api/interpret', { note, key });
    assert.equal(pass.status, 200);
    assert.equal(pass.value.mode, 'live-serv');
    assert.equal(pass.value.obligations.length, 1);
    assert.equal(pass.value.obligations[0].amount, '2000.00');
    assert.equal(pass.value.obligations[0].provenance, 'SERV');
    assert.equal(pass.value.noteStored, false);
    assert.equal(JSON.stringify(pass.value).includes(key), false);
    modelReply = { obligations: [{ label: 'Fabricated', amountUsd: 9000, dueDate: '2026-09-27', kind: 'scheduled', confidence: 'high', evidence: 'not in the note' }], warnings: [] };
    const rejected = await post('/api/interpret', { note, key });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.value.obligations.length, 0);
    assert.ok(rejected.value.warnings.length);
  } finally { globalThis.fetch = originalFetch; }
});

test('live-IXS protocol adapter uses SSE and returns verified unsigned steps, never signs (stubbed upstream)', async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  const sse = value => new Response(`event: message\ndata: ${JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify(value) }] }, jsonrpc: '2.0', id: 1 })}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith(base)) return originalFetch(url, options);
    if (String(url) === 'https://api-v2.ixs.finance/vaults') return new Response(JSON.stringify({ items: [{
      routeId, name: 'IX High Yield Bond (USDC)', symbol: 'IXHYB', chainId: 56, chainName: 'BSC Mainnet',
      network: 'bsc-mainnet', status: 'active', requiresWhitelist: false,
      underlyingAsset: { symbol: 'USDC', decimals: 18 }, contractAddress: '0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82'
    }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(url) === 'https://api-v2.ixs.finance/mcp') {
      const req = JSON.parse(options.body);
      assert.match(options.headers.Accept, /text\/event-stream/);
      seen.push(req.params.name);
      if (req.params.name === 'vault_get') return sse({ ok: true, settlement: 'sync', pricing: { pricePerShare: '1.0 USDC' } });
      const { vaultId, ownerAddress, assetAmount } = req.params.arguments;
      return sse({ ok: true, settlement: 'sync', chainId: 56, vault: { id: vaultId }, ownerAddress,
        amount: { baseUnits: assetAmount }, steps: [{ type: 'erc20_approve_exact', description: 'Approve', tx: { to: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', data: '0x095ea7b3', value: '0' } }, { type: 'vault_deposit', description: 'Deposit', tx: { to: '0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82', data: '0x6e553f65', value: '0' } }] });
    }
    throw new Error(`Unexpected outbound URL: ${url}`);
  };
  try {
    const vaultsResponse = await originalFetch(base + '/api/vaults?refresh=1');
    assert.equal(vaultsResponse.status, 200);
    const vaults = await vaultsResponse.json();
    assert.equal(vaults.vaults[0].depositProbe.status, 'not_checked');
    assert.equal(seen.includes('vault_build_request_deposit'), false, 'discovery must not draft calldata for a dummy wallet');
    assert.equal(vaults.vaults[0].settlement, 'sync');
    const result = await post('/api/prepare', { scenario, amount: '4000', vaultId: routeId, ownerAddress: wallet });
    assert.equal(result.status, 200);
    assert.equal(result.value.mode, 'live-ixs-unsigned');
    assert.equal(result.value.amount, '4000.00');
    assert.equal(result.value.steps.length, 2);
    assert.match(result.value.steps[0].tx.data, /^0x/);
    assert.deepEqual(seen, ['vault_get','vault_get','vault_build_request_deposit']);
    assert.equal(result.value.vault.chainId, 56);
    assert.equal(result.value.ownerAddress, wallet);
    assert.equal(result.value.steps.some(x => x.signed || x.hash), false);
  } finally { globalThis.fetch = originalFetch; }
});
