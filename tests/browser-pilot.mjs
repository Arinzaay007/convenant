// Optional interactive smoke: npm install --no-save --package-lock=false playwright
// npx playwright install chromium; npm start in another terminal; node tests/browser-pilot.mjs
// ONLY a fake EIP-1193 provider is used. No real wallet transaction is possible in this test.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PILOT, addressWord, uintWord } from '../pilot.mjs';
const origin = 'http://127.0.0.1:3000';
const owner = '0x2222222222222222222222222222222222222222';
const ONE = 10n ** 18n;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const errors = [];
try {
  // Real-input default: no invented ledger, no anonymous sample wallet, no transaction.
  const live = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  live.on('pageerror', error => errors.push(error.message));
  let postedCheck = false;
  live.on('request', request => { if (request.url().includes('/api/check')) postedCheck = true; });
  await live.goto(origin, { waitUntil: 'domcontentloaded' });
  await live.locator('#pilot-capacity').getByText('No wallet checked', { exact: false }).waitFor();
  assert.equal((await live.locator('#metric-safe').textContent()).trim(), '—');
  assert.equal((await live.locator('#metric-cash').textContent()).trim(), '—');
  assert.match(await live.locator('#obligation-list').textContent(), /No commitments entered/);
  assert.equal(postedCheck, false, 'never compute a cash verdict from missing operator data');
  assert.equal(await live.locator('#pilot-prepare').isDisabled(), true);
  assert.equal(await live.locator('#pilot-actions').isHidden(), true);
  await live.waitForFunction(() => !document.getElementById('weather-value').textContent.includes('Loading') && !document.getElementById('live-connection').textContent.includes('Checking'), null, { timeout: 45000 }).catch(() => {});
  await live.screenshot({ path: 'assets/live-inputs-required.png', fullPage: true });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await mobile.goto(origin, { waitUntil: 'domcontentloaded' });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true, 'mobile must not overflow horizontally');
  await mobile.waitForFunction(() => !document.getElementById('weather-value').textContent.includes('Loading') && !document.getElementById('live-connection').textContent.includes('Checking'), null, { timeout: 45000 }).catch(() => {});
  await mobile.screenshot({ path: 'assets/live-inputs-required-mobile.png', fullPage: true });
  await mobile.close(); await live.close();

  // Simulated open vault: intercept ONLY this browser page's API and inject a fake wallet.
  // Assert approval and deposit require SEPARATE clicks; validate exact values and repeat lock.
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ owner, vault, token }) => {
    const ONE = 10n ** 18n;
    window.__sent = []; window.__allowance = 0n; window.__shares = 0n; window.__max = 10n * ONE;
    const word = n => '0x' + n.toString(16).padStart(64, '0');
    window.ethereum = {
      on() {},
      async request({ method, params = [] }) {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [owner];
        if (method === 'eth_chainId') return '0x38';
        if (method === 'eth_gasPrice') return '0x3b9aca00';
        if (method === 'eth_getBalance') return '0x2386f26fc10000';
        if (method === 'eth_estimateGas') return '0x30d40';
        if (method === 'eth_call') {
          const { to, data } = params[0]; const selector = data.slice(0, 10).toLowerCase();
          if (selector === '0x402d267d') return word(window.__max);
          if (selector === '0xdd62ed3e') return word(window.__allowance);
          if (selector === '0x70a08231' && to.toLowerCase() === token.toLowerCase()) return word(5n * ONE);
          if (selector === '0x70a08231' && to.toLowerCase() === vault.toLowerCase()) return word(window.__shares);
          throw new Error(`Unexpected eth_call ${selector}`);
        }
        if (method === 'eth_sendTransaction') {
          const tx = params[0]; window.__sent.push(tx);
          if (tx.to.toLowerCase() === token.toLowerCase()) window.__allowance = ONE;
          if (tx.to.toLowerCase() === vault.toLowerCase()) window.__shares = ONE;
          return '0x' + String(window.__sent.length).repeat(64);
        }
        if (method === 'eth_getTransactionReceipt' || method === 'eth_getTransactionByHash') {
          const index = Number(params[0].slice(2, 3)) - 1, tx = window.__sent[index];
          if (!tx) return null;
          return method === 'eth_getTransactionReceipt' ? { status: '0x1', from: tx.from, to: tx.to } :
            { from: tx.from, to: tx.to, input: tx.data, value: tx.value };
        }
        throw new Error(`Unexpected wallet request ${method}`);
      }
    };
  }, { owner, vault: PILOT.vault, token: PILOT.token });
  let capacityOpen = false; // deterministic simulated zero-cap test, even if live sample has reopened
  await page.route('**/api/pilot/capacity*', async route => {
    const sample = !new URL(route.request().url()).searchParams.has('address');
    await route.fulfill({ json: {
      source: 'MOCKED for browser safety test', checkedAt: new Date().toISOString(),
      chainId: 56, ownerAddress: sample ? null : owner, token: PILOT.token, vault: PILOT.vault, paused: false,
      maxDepositUnits: String(capacityOpen ? 10n * ONE : 0n), maxDepositUSDC: capacityOpen ? '10.00' : '0.00',
      walletUSDCUnits: sample ? null : String(5n * ONE), walletUSDC: sample ? null : '5.00',
      walletBNBWei: sample ? null : '10000000000000000',
      ready: !sample && capacityOpen, reasons: capacityOpen ? [] : ['maxDeposit is zero.'], sampleAddressOnly: sample
    } });
  });
  await page.route('**/api/pilot/prepare', async route => {
    const body = route.request().postDataJSON();
    assert.equal(body.amount, '1.00'); assert.equal(body.floor, '1.00');
    await route.fulfill({ json: {
      mode: 'user-wallet-only-mainnet-pilot', chainId: 56, amount: '1.00', ownerAddress: owner,
      vault: PILOT.vault, token: PILOT.token, createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 115_000).toISOString(),
      steps: [
        { type: 'erc20_approve_exact', tx: { to: PILOT.token, data: `0x095ea7b3${addressWord(PILOT.vault)}${uintWord(ONE)}`, value: '0x0' } },
        { type: 'vault_deposit', tx: { to: PILOT.vault, data: `0x6e553f65${uintWord(ONE)}${addressWord(owner)}`, value: '0x0' } }
      ]
    } });
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#pilot-connect').click();
  await page.locator('#pilot-wallet').getByText(owner, { exact: false }).waitFor();
  await page.locator('#pilot-floor').fill('1.00');
  await page.locator('#pilot-dedicated').check(); await page.locator('#pilot-risk').check();
  assert.equal(await page.locator('#pilot-prepare').isDisabled(), true, 'mock maxDeposit=0 must block all wallet actions');
  assert.equal(await page.evaluate(() => window.__sent.length), 0);
  capacityOpen = true;
  await page.locator('#pilot-connect').click(); // new wallet-specific read after simulated reopening
  await page.waitForFunction(() => !document.getElementById('pilot-prepare').disabled);
  assert.equal(await page.locator('#pilot-prepare').isDisabled(), false);
  await page.locator('#pilot-prepare').click();
  await page.locator('#pilot-plan').getByText('Prepared only for', { exact: false }).waitFor();
  assert.equal(await page.locator('#pilot-approve').isDisabled(), false);
  assert.equal(await page.locator('#pilot-deposit').isDisabled(), true);
  assert.equal(await page.evaluate(() => window.__sent.length), 0);
  await page.locator('#pilot-approve').click();
  await page.locator('#pilot-progress').getByText('Exact $1 approval confirmed', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.__sent.length), 1);
  assert.equal(await page.locator('#pilot-deposit').isDisabled(), false);
  capacityOpen = false; // vault closes after the approval: NO deposit prompt must be sent
  await page.locator('#pilot-deposit').click();
  await page.locator('#pilot-progress').getByText('Deposit stopped', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.__sent.length), 1, 'zero capacity after approval must veto deposit');
  assert.equal(await page.locator('#pilot-deposit').isDisabled(), true);
  capacityOpen = true;
  await page.locator('#pilot-connect').click(); // refresh capacity; new two-minute intent required
  await page.locator('#pilot-prepare').click();
  await page.locator('#pilot-plan').getByText('Prepared only for', { exact: false }).waitFor();
  assert.equal(await page.locator('#pilot-approve').isDisabled(), true, 'rechecked exact existing allowance skips second approval');
  assert.equal(await page.locator('#pilot-deposit').isDisabled(), false);
  await page.locator('#pilot-deposit').click();
  await page.locator('#pilot-progress').getByText('Mainnet deposit CONFIRMED', { exact: false }).waitFor();
  const sent = await page.evaluate(() => window.__sent);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].to.toLowerCase(), PILOT.token.toLowerCase());
  assert.equal(sent[1].to.toLowerCase(), PILOT.vault.toLowerCase());
  assert.equal(sent[0].data, `0x095ea7b3${addressWord(PILOT.vault)}${uintWord(ONE)}`);
  assert.equal(sent[1].data, `0x6e553f65${uintWord(ONE)}${addressWord(owner)}`);
  assert.equal(await page.locator('#pilot-prepare').isDisabled(), true);
  assert.equal(await page.locator('#pilot-deposit').isDisabled(), true);
  const lock = await page.evaluate(owner => localStorage.getItem(`covenant-pilot-56-${owner.toLowerCase()}`), owner);
  assert.ok(lock?.includes('confirmed'));
  await page.reload();
  await page.locator('#pilot-connect').click();
  await page.locator('#pilot-risk').check(); await page.locator('#pilot-dedicated').check();
  assert.equal(await page.locator('#pilot-prepare').isDisabled(), true, 'one-attempt lock persists after reload');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Browser smoke passed: blank real-input start with no green verdict; mocked zero-cap fails closed; simulated wallet approval/deposit require separate clicks and exact $1 calldata; mid-flow closure and repeat lock verified.');
  console.log('Evidence: assets/live-inputs-required.png and assets/live-inputs-required-mobile.png (no fake balances).');
} finally { await browser.close(); }
