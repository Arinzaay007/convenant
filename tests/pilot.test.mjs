import test from 'node:test';
import assert from 'node:assert/strict';
import { PILOT, addressWord, uintWord, parseUint256, parseAddressWord, safeUSDCFromUnits, validatePilotDraft } from '../pilot.mjs';

const owner = '0x1111111111111111111111111111111111111111';
const valid = () => ({ ok: true, settlement: 'sync', chainId: 56,
  vault: { id: PILOT.routeId, address: PILOT.vault }, ownerAddress: owner,
  asset: { symbol: 'USDC', decimals: 18, address: PILOT.token },
  amount: { baseUnits: PILOT.baseUnits }, steps: [
    { type: 'erc20_approve_exact', description: 'Exact approval', tx: { to: PILOT.token, data: `0x095ea7b3${addressWord(PILOT.vault)}${uintWord(PILOT.baseUnits)}`, value: '0' } },
    { type: 'vault_deposit', description: 'Vault deposit', tx: { to: PILOT.vault, data: `0x6e553f65${uintWord(PILOT.baseUnits)}${addressWord(owner)}`, value: '0' } }
  ]
});

test('pilot hard pins BNB Chain, exact one-USDC base units and real token/vault addresses', () => {
  assert.equal(PILOT.chainId, 56); assert.equal(PILOT.baseUnits, '1000000000000000000');
  assert.equal(PILOT.usdc, '1.00');
  assert.match(PILOT.routeId, /^56-0x/);
  assert.equal(parseAddressWord(`0x${addressWord(PILOT.token)}`).toLowerCase(), PILOT.token.toLowerCase());
  assert.equal(parseUint256(`0x${uintWord(PILOT.baseUnits)}`), 10n ** 18n);
  assert.equal(safeUSDCFromUnits(1999999999999999999n), '1.99'); // truncate; do not overstate liquid cash
});

test('only exact approve-1 and deposit-1 calldata with correct receiver, targets, chain and zero BNB are accepted', () => {
  const steps = validatePilotDraft(valid(), owner);
  assert.deepEqual(steps.map(s => s.type), ['erc20_approve_exact','vault_deposit']);
  assert.equal(steps[0].tx.value, '0x0'); assert.equal(steps[1].tx.value, '0x0');
  for (const mutation of [
    x => { x.chainId = 43114; },
    x => { x.amount.baseUnits = '2000000000000000000'; },
    x => { x.asset.address = PILOT.vault; },
    x => { x.settlement = 'async-erc7540'; },
    x => { x.steps[0].tx.value = '1'; },
    x => { x.steps[0].tx.to = PILOT.vault; },
    x => { x.steps[0].tx.data = x.steps[0].tx.data.slice(0, -1) + '2'; },
    x => { x.steps[1].tx.data = x.steps[1].tx.data.slice(0, -1) + '2'; },
    x => { x.steps.push(x.steps[1]); },
    x => { x.ownerAddress = PILOT.vault; }
  ]) { const draft = valid(); mutation(draft); assert.throws(() => validatePilotDraft(draft, owner)); }
});

test('malformed RPC outputs and dangerous values fail closed', () => {
  for (const bad of ['0x0','0x','not-a-number']) assert.throws(() => parseUint256(bad));
  assert.throws(() => addressWord('0xdead'));
  assert.throws(() => uintWord(-1));
  assert.throws(() => uintWord(2n ** 256n));
  assert.throws(() => safeUSDCFromUnits(-1n));
});
