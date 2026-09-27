import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../server.mjs';
import { PILOT, addressWord, uintWord } from '../pilot.mjs';

const server = createServer();
let base;
before(async () => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise(resolve => server.close(resolve)); });
const owner = '0x2222222222222222222222222222222222222222';
const pilotRequest = { ownerAddress: owner, amount: '1.00', floor: '0.50', dedicatedWallet: true, riskAccepted: true };
const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
const sse = value => new Response(`event: message\ndata: ${JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify(value) }] }, jsonrpc: '2.0', id: 1 })}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
async function post(path, body) { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; }

test('real-money path is blocked by actual maxDeposit=0 before any IXS draft or wallet prompt; opens only with exact $1 checks (mocked chain)', async () => {
  const nativeFetch = globalThis.fetch;
  let open = false, tamper = false, backupClosed = false;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith(base)) return nativeFetch(url, options);
    const req = options?.body ? JSON.parse(options.body) : {};
    requests.push({ url: String(url), method: req.method, name: req.params?.name });
    if ([PILOT.rpcPrimary, PILOT.rpcBackup].includes(String(url))) {
      let result;
      if (req.method === 'eth_chainId') result = '0x38';
      else if (req.method === 'eth_getCode') result = '0x60806040526000805560016000f3';
      else if (req.method === 'eth_getBalance') result = '0x2386f26fc10000'; // 0.01 BNB
      else if (req.method === 'eth_call') {
        const { to, data } = req.params[0]; const selector = data.slice(0, 10).toLowerCase();
        if (selector === '0x38d52e0f') result = `0x${addressWord(PILOT.token)}`;
        else if (selector === '0x313ce567') result = `0x${uintWord(18)}`;
        else if (selector === '0x402d267d') result = `0x${uintWord(open && !(backupClosed && String(url) === PILOT.rpcBackup) ? 10n ** 21n : 0n)}`;
        else if (selector === '0x70a08231' && to.toLowerCase() === PILOT.token.toLowerCase()) result = `0x${uintWord(5n * 10n ** 18n)}`;
        else if (selector === '0x5c975abb') result = `0x${uintWord(0)}`;
        else throw new Error(`Unexpected contract call ${selector}`);
      } else throw new Error(`Unexpected RPC ${req.method}`);
      return json({ jsonrpc: '2.0', id: req.id, result });
    }
    if (String(url) === 'https://api-v2.ixs.finance/vaults') return json({ items: [{
      routeId: PILOT.routeId, name: 'IX High Yield Bond (USDC)', symbol: 'ixv1', chainId: 56, chainName: 'bsc',
      network: 'bsc', status: 'active', requiresWhitelist: false,
      underlyingAsset: { symbol: 'USDC', decimals: 18, address: PILOT.token }, contractAddress: PILOT.vault
    }] });
    if (String(url) === 'https://api-v2.ixs.finance/mcp') {
      const { name, arguments: args } = req.params;
      if (name === 'vault_get') return sse({ ok: true, settlement: 'sync' });
      if (name !== 'vault_build_request_deposit') throw new Error(`Unexpected MCP tool ${name}`);
      const step = { ok: true, settlement: 'sync', chainId: 56, vault: { id: PILOT.routeId, address: PILOT.vault }, ownerAddress: args.ownerAddress,
        asset: { symbol: 'USDC', decimals: 18, address: PILOT.token }, amount: { baseUnits: args.assetAmount },
        steps: [{ type: 'erc20_approve_exact', description: 'Approve', tx: { to: PILOT.token, data: `0x095ea7b3${addressWord(PILOT.vault)}${uintWord(args.assetAmount)}`, value: '0' } },
          { type: 'vault_deposit', description: 'Deposit', tx: { to: PILOT.vault, data: `0x6e553f65${uintWord(args.assetAmount)}${addressWord(args.ownerAddress)}`, value: '0' } }] };
      if (tamper && args.assetAmount === PILOT.baseUnits) step.steps[0].tx.data = step.steps[0].tx.data.slice(0, -1) + '2';
      return sse(step);
    }
    throw new Error(`Unexpected outbound URL: ${url}`);
  };
  try {
    const sampleR = await nativeFetch(base + '/api/pilot/capacity');
    const sample = await sampleR.json();
    assert.equal(sampleR.status, 200, JSON.stringify(sample));
    assert.equal(sample.sampleAddressOnly, true);
    assert.equal(sample.maxDepositUnits, '0');
    assert.equal(sample.ready, false);
    const blocked = await post('/api/pilot/prepare', pilotRequest);
    assert.equal(blocked.status, 409); assert.equal(blocked.body.code, 'PILOT_BLOCKED');
    assert.equal(requests.some(r => r.url.includes('ixs.finance')), false, 'closed vault must not even request an IXS draft');
    const invalid = await post('/api/pilot/prepare', { ...pilotRequest, amount: '1.01' });
    assert.equal(invalid.status, 422); assert.equal(invalid.body.code, 'PILOT_CONSENT');
    const notConsented = await post('/api/pilot/prepare', { ...pilotRequest, riskAccepted: false });
    assert.equal(notConsented.status, 422);
    open = true; backupClosed = true;
    const disagreement = await post('/api/pilot/prepare', pilotRequest);
    assert.equal(disagreement.status, 409); assert.equal(disagreement.body.code, 'PILOT_BLOCKED');
    backupClosed = false;
    const floorBlocked = await post('/api/pilot/prepare', { ...pilotRequest, floor: '4.50' });
    assert.equal(floorBlocked.status, 409); assert.equal(floorBlocked.body.code, 'PILOT_REDLINE');
    const pass = await post('/api/pilot/prepare', pilotRequest);
    assert.equal(pass.status, 200, JSON.stringify(pass.body));
    assert.equal(pass.body.mode, 'user-wallet-only-mainnet-pilot');
    assert.equal(pass.body.amount, '1.00'); assert.equal(pass.body.steps.length, 2);
    assert.equal(pass.body.chainStatus.walletUSDC, '5.00');
    assert.equal(pass.body.chainStatus.maxDepositUSDC, '1000.00');
    assert.equal(pass.body.decision.status, 'safe_under_assumptions');
    assert.equal('privateKey' in pass.body, false);
    assert.equal('txHash' in pass.body, false);
    tamper = true;
    const wrongCalldata = await post('/api/pilot/prepare', pilotRequest);
    assert.equal(wrongCalldata.status, 409); assert.equal(wrongCalldata.body.code, 'PILOT_CALLDATA');
  } finally { globalThis.fetch = nativeFetch; }
});
