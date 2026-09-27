/* Optional $1 BNB Chain proof. Only the USER'S injected wallet can sign/send.
   This script will not request a transaction automatically or on page load. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const VAULT = '0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82';
  const TOKEN = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
  const ONE = 1000000000000000000n;
  const EXPLORER = 'https://bscscan.com/tx/';
  const same = (a, b) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
  const wordAddress = a => a.slice(2).toLowerCase().padStart(64, '0');
  const addrPattern = /^0x[\da-fA-F]{40}$/;
  const hashPattern = /^0x[\da-fA-F]{64}$/;
  const state = {
    provider: null, address: null, chainId: null, capacity: null,
    intent: null, busy: false, approved: false, sharesBefore: null,
    approvalHash: null, depositHash: null, completed: false, listenersOn: false
  };
  window.covenantPilotReceipt = null;
  // Persist only public attempt metadata, never a secret. Block repeat sends after a
  // deposit wallet prompt even across reloads on this origin (pending != failed).
  const lockKey = () => `covenant-pilot-56-${state.address?.toLowerCase()}`;
  function pilotLock() {
    if (!state.address) return null;
    try { return localStorage.getItem(lockKey()); }
    catch { return 'Browser storage unavailable; cannot enforce the one-attempt guard.'; }
  }
  function setPilotLock(value) { localStorage.setItem(lockKey(), JSON.stringify(value)); }
  function clearPilotLock() { localStorage.removeItem(lockKey()); }

  function money(units, decimals = 18, places = 4) {
    const n = BigInt(units), base = 10n ** BigInt(decimals);
    const fraction = String(n % base).padStart(decimals, '0').slice(0, places).replace(/0+$/, '');
    return `${n / base}${fraction ? '.' + fraction : ''}`;
  }
  function floorCents() {
    const s = $('pilot-floor').value;
    if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(s)) throw new Error('Enter a non-negative wallet cash floor with at most two decimals.');
    const [whole, decimals = ''] = s.split('.');
    return BigInt(whole) * 100n + BigInt(decimals.padEnd(2, '0') || '0');
  }
  function safeError(error) {
    if (error?.code === 4001) return 'You rejected the wallet request. No transaction was sent by this app.';
    return String(error?.message || error || 'Unknown error.').slice(0, 280);
  }
  function planMessage(message, tone = '') {
    $('pilot-plan').className = `pilot-plan${tone ? ' ' + tone : ''}`;
    $('pilot-plan').textContent = message;
  }
  function progress(message, tone = '') {
    const node = $('pilot-progress'); node.className = `pilot-progress${tone ? ' ' + tone : ''}`; node.textContent = message;
  }
  function addTxLink(node, hash, label) {
    if (!hashPattern.test(hash)) return;
    const link = document.createElement('a'); link.href = EXPLORER + hash;
    link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = label;
    node.append(document.createTextNode(' '), link);
  }
  function invalidate(message) {
    state.intent = null; state.approved = false; state.sharesBefore = null;
    $('pilot-actions').hidden = true;
    if (message) planMessage(message);
    updateButtons();
  }
  function updateButtons() {
    const readyWallet = !!state.address && state.chainId === 56;
    const floorDeclared = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test($('pilot-floor').value);
    const allowed = readyWallet && state.capacity?.ready === true && floorDeclared &&
      $('pilot-dedicated').checked && $('pilot-risk').checked && !state.busy && !state.completed && !state.depositHash && !pilotLock();
    $('pilot-prepare').disabled = !allowed;
    const intentActive = state.intent && state.capacity?.ready && !state.depositHash && !pilotLock() && Date.now() < Date.parse(state.intent.expiresAt);
    $('pilot-approve').disabled = !intentActive || state.approved || state.busy || !readyWallet;
    $('pilot-deposit').disabled = !intentActive || !state.approved || state.busy || !readyWallet || state.completed;
    $('pilot-connect').disabled = state.busy;
    for (const id of ['pilot-floor', 'pilot-dedicated', 'pilot-risk']) $(id).disabled = state.busy;
  }
  function showCapacity(data) {
    const node = $('pilot-capacity');
    if (data.maxDepositUnits === '0') {
      node.className = 'pilot-capacity blocked';
      node.innerHTML = '<strong>ON-CHAIN DEPOSIT LIMIT: 0 USDC</strong>';
      node.append(document.createTextNode(`IXS may still draft unsigned steps, but the contract reports maxDeposit = 0${data.sampleAddressOnly ? ' for a sampled address' : ' for your wallet'}. No approval or deposit will be offered while this is true.`));
    } else if (!data.ready && !data.sampleAddressOnly) {
      node.className = 'pilot-capacity blocked';
      node.innerHTML = '<strong>WALLET-SPECIFIC PILOT BLOCKED</strong>';
      node.append(document.createTextNode(data.reasons?.join(' ') || 'On-chain guardrail did not pass.'));
    } else {
      node.className = 'pilot-capacity';
      node.innerHTML = `<strong>${data.sampleAddressOnly ? 'SAMPLE' : 'WALLET-SPECIFIC'} maxDeposit: ${data.maxDepositUnlimited ? 'NO NUMERIC CAP' : `${data.maxDepositUSDC} USDC`}</strong>`;
      node.append(document.createTextNode(data.sampleAddressOnly ? 'This sampled address is not your eligibility result. Connect to verify your own limit, USDC and BNB; the contract may still reject a deposit.' : `Wallet balance ${data.walletUSDC} USDC · ${money(data.walletBNBWei)} BNB. Capacity can change before signing.`));
    }
    window.dispatchEvent(new CustomEvent('covenant:pilot-capacity', { detail: data }));
  }
  async function requestJSON(path, options) {
    const response = await fetch(path, { ...options, cache: 'no-store' });
    let body;
    try { body = await response.json(); }
    catch { throw new Error('Read-only chain check returned an unreadable response.'); }
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
    return body;
  }
  async function refreshCapacity() {
    if (!state.address) throw new Error('Connect your own public wallet before checking deposit capacity.');
    state.capacity = null; updateButtons();
    $('pilot-capacity').className = 'pilot-capacity unknown';
    $('pilot-capacity').textContent = 'Reading the vault and token contracts from two BNB Chain RPCs…';
    try {
      const path = `/api/pilot/capacity?address=${encodeURIComponent(state.address)}`;
      const data = await requestJSON(path);
      if (state.address && !same(data.ownerAddress, state.address)) throw new Error('Chain response belongs to another wallet.');
      state.capacity = data; showCapacity(data); updateButtons();
      if (state.address) {
        $('pilot-wallet').textContent = `${state.address} · ${data.walletUSDC} USDC · ${money(data.walletBNBWei)} BNB${data.ready ? ' · on-chain checks pass' : ' · blocked'}`;
        if (pilotLock()) planMessage('A deposit attempt was recorded for this wallet on this site (or browser storage is unavailable). Repeat transactions are disabled. Inspect wallet history and BscScan.', 'error');
        else if (!data.ready) planMessage(`Pilot BLOCKED for your wallet: ${data.reasons.join(' ')} No approval or deposit will be requested.`, 'error');
        else planMessage('This wallet passes the read-only chain check. Confirm your separate-wallet and risk acknowledgements, then prepare the exact $1 unsigned plan; capacity may change.', 'ready');
      }
      return data;
    } catch (error) {
      $('pilot-capacity').className = 'pilot-capacity unknown';
      $('pilot-capacity').textContent = `On-chain status unverified: ${safeError(error)} Signing stays locked.`;
      planMessage('No reliable on-chain status; do not attempt a transaction.', 'error');
      updateButtons();
      throw error;
    }
  }
  async function verifiedWallet() {
    if (!state.provider || !state.address) throw new Error('Connect your own wallet first.');
    const [chain, accounts] = await Promise.all([
      state.provider.request({ method: 'eth_chainId' }),
      state.provider.request({ method: 'eth_accounts' })
    ]);
    if (BigInt(chain) !== 56n || !Array.isArray(accounts) || !accounts.some(a => same(a, state.address))) {
      invalidate('Wallet account or network changed. Reconnect and run the checks again.');
      throw new Error('The connected wallet must remain on BNB Chain (chain ID 56).');
    }
    return state.address;
  }
  function validateIntent(intent) {
    if (!same(intent.ownerAddress, state.address) || intent.chainId !== 56 || intent.amount !== '1.00' ||
        !same(intent.vault, VAULT) || !same(intent.token, TOKEN) || !Array.isArray(intent.steps) || intent.steps.length !== 2 ||
        intent.mode !== 'user-wallet-only-mainnet-pilot') throw new Error('The prepared intent is not the pinned $1 route.');
    const [approve, deposit] = intent.steps;
    const amount = ONE.toString(16).padStart(64, '0');
    if (approve.type !== 'erc20_approve_exact' || deposit.type !== 'vault_deposit' ||
        !same(approve.tx?.to, TOKEN) || !same(deposit.tx?.to, VAULT) ||
        !same(approve.tx?.data, `0x095ea7b3${wordAddress(VAULT)}${amount}`) ||
        !same(deposit.tx?.data, `0x6e553f65${amount}${wordAddress(state.address)}`) ||
        BigInt(approve.tx?.value ?? '-1') !== 0n || BigInt(deposit.tx?.value ?? '-1') !== 0n) {
      throw new Error('The returned calldata is not an exact $1 approval and deposit to the pinned contracts.');
    }
    if (Date.now() >= Date.parse(intent.expiresAt) || Date.parse(intent.expiresAt) - Date.now() > 125_000) throw new Error('The intent is stale or has an invalid expiry. Prepare it again.');
  }
  async function walletCall(to, data) {
    const result = await state.provider.request({ method: 'eth_call', params: [{ to, data }, 'latest'] });
    if (!/^0x[\da-fA-F]{64}$/.test(result)) throw new Error('Wallet RPC returned malformed contract data.');
    return BigInt(result);
  }
  const maxDeposit = addr => walletCall(VAULT, `0x402d267d${wordAddress(addr)}`);
  const tokenBalance = addr => walletCall(TOKEN, `0x70a08231${wordAddress(addr)}`);
  const shareBalance = addr => walletCall(VAULT, `0x70a08231${wordAddress(addr)}`);
  const allowance = addr => walletCall(TOKEN, `0xdd62ed3e${wordAddress(addr)}${wordAddress(VAULT)}`);
  async function connect() {
    const provider = window.ethereum;
    if (!provider?.request) { planMessage('No injected wallet found. Install a reputable EVM wallet and open this HTTPS app in a normal browser tab. Never paste a seed phrase here.', 'error'); return; }
    state.provider = provider;
    try {
      let accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (!Array.isArray(accounts) || !addrPattern.test(accounts[0] || '')) throw new Error('Wallet did not return a public address.');
      let chain = await provider.request({ method: 'eth_chainId' });
      if (BigInt(chain) !== 56n) {
        planMessage('Requesting a network switch to BNB Chain (chain ID 56). Your wallet must confirm it; no transaction will be sent.');
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] });
        chain = await provider.request({ method: 'eth_chainId' });
      }
      if (BigInt(chain) !== 56n) throw new Error('Please select BNB Chain mainnet (chain ID 56) in your wallet.');
      state.address = accounts[0]; state.chainId = 56; state.completed = false;
      invalidate('Wallet connected. Running wallet-specific on-chain checks before permitting any approval.');
      $('pilot-connect').firstChild.textContent = 'Refresh wallet & on-chain checks ';
      $('pilot-wallet').className = 'pilot-wallet ready';
      if (!state.listenersOn && provider.on) {
        provider.on('accountsChanged', onAccountChange);
        provider.on('chainChanged', onChainChange);
        state.listenersOn = true;
      }
      await refreshCapacity();
    } catch (error) { planMessage(`Wallet connection stopped: ${safeError(error)}`, 'error'); updateButtons(); }
  }
  function onAccountChange(accounts) {
    state.address = null; state.capacity = null; state.intent = null; state.approved = false;
    $('pilot-wallet').className = 'pilot-wallet'; $('pilot-wallet').textContent = `Wallet account changed (${accounts?.length ? 'reconnect to review it' : 'disconnected'}).`;
    invalidate('Wallet changed. Reconnect and re-run every check before any new action.');
    $('pilot-capacity').className = 'pilot-capacity unknown';
    $('pilot-capacity').textContent = 'No wallet checked. Reconnect to read the new address-specific limit.';
    window.dispatchEvent(new CustomEvent('covenant:pilot-capacity', { detail: null }));
  }
  function onChainChange() {
    state.chainId = null; state.capacity = null;
    invalidate('Network changed. Reconnect on BNB Chain before preparing or sending anything.');
    $('pilot-wallet').textContent = 'Network changed; reconnect to verify BNB Chain.';
    $('pilot-capacity').className = 'pilot-capacity unknown';
    $('pilot-capacity').textContent = 'No live check for this network. Reconnect on BNB Chain mainnet.';
    window.dispatchEvent(new CustomEvent('covenant:pilot-capacity', { detail: null }));
  }
  async function prepare() {
    if ($('pilot-prepare').disabled) return;
    state.busy = true; updateButtons();
    try {
      await verifiedWallet();
      if (pilotLock()) throw new Error('A previous deposit attempt or unavailable browser storage locks this wallet to avoid exceeding $1. Inspect it in your wallet instead of retrying.');
      const cap = await refreshCapacity();
      if (!cap.ready) throw new Error(`Chain preflight failed: ${cap.reasons.join(' ')}`);
      const floor = floorCents();
      if (BigInt(cap.walletUSDCUnits) < ONE + floor * 10n ** 16n) throw new Error('Wallet balance would not leave the specified USDC cash floor.');
      const intent = await requestJSON('/api/pilot/prepare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerAddress: state.address, amount: '1.00', floor: $('pilot-floor').value, dedicatedWallet: $('pilot-dedicated').checked, riskAccepted: $('pilot-risk').checked })
      });
      validateIntent(intent);
      const walletMax = await maxDeposit(state.address);
      const walletUSDC = await tokenBalance(state.address);
      const currentAllowance = await allowance(state.address);
      if (walletMax < ONE || walletUSDC < ONE) throw new Error('Wallet RPC now reports less than $1 capacity or balance. Do not approve.');
      if (currentAllowance > ONE) throw new Error('This wallet has more than $1 previously approved for this vault. Review/revoke that separate approval in your wallet before using the $1-capped pilot.');
      const previousShares = await shareBalance(state.address);
      if (previousShares !== 0n) throw new Error('This wallet already holds shares in the pinned vault. Use an empty dedicated test wallet; the pilot will not risk a second allocation.');
      state.intent = intent; state.sharesBefore = previousShares;
      state.approved = currentAllowance >= ONE; state.completed = false;
      $('pilot-actions').hidden = false;
      $('pilot-approve').textContent = state.approved ? '1 / Existing exact $1 allowance verified — no new approval' : '1 / Approve exactly $1 USDC in wallet ↗';
      planMessage(`Prepared only for ${state.address}: exact 1.00 USDC on BNB Chain. Current maxDeposit ${cap.maxDepositUnlimited ? 'has no numeric cap' : cap.maxDepositUSDC + ' USDC'}; wallet ${cap.walletUSDC} USDC. Review pinned token ${TOKEN} and vault ${VAULT}. Intent expires in 2 minutes.`, 'ready');
      progress(state.approved ? 'A $1 allowance already exists. Deposit still requires a separate click and wallet confirmation.' : 'No transaction requested. Click approval only if you accept the exact $1 allowance and BNB gas.');
      window.covenantPilotReceipt = { mode: 'wallet-pilot-prepared-not-sent', ownerAddress: state.address, amount: '1.00', chainId: 56, preparedAt: intent.createdAt, approvalHash: null, depositHash: null };
    } catch (error) { invalidate(`Pilot not prepared: ${safeError(error)}`); $('pilot-plan').classList.add('error'); }
    finally { state.busy = false; updateButtons(); }
  }
  async function preSend(kind) {
    const intent = state.intent; if (!intent) throw new Error('Run the $1 preflight again.');
    validateIntent(intent); await verifiedWallet();
    if (pilotLock()) throw new Error('A deposit attempt is already recorded; do not submit a second $1 transaction.');
    if (!$('pilot-dedicated').checked || !$('pilot-risk').checked) throw new Error('Both operator confirmations must still be checked.');
    const current = await refreshCapacity();
    if (!current.ready || BigInt(current.maxDepositUnits) < ONE) throw new Error('The on-chain deposit limit has fallen below $1. Nothing will be submitted.');
    if (BigInt(current.walletUSDCUnits) < ONE + floorCents() * 10n ** 16n) throw new Error('Wallet USDC no longer covers $1 plus your cash floor.');
    if (await maxDeposit(state.address) < ONE || await tokenBalance(state.address) < ONE) throw new Error('Your wallet RPC reports insufficient capacity or USDC.');
    if (await shareBalance(state.address) !== 0n) throw new Error('This wallet already has vault shares; no second pilot deposit is allowed.');
    const allowed = await allowance(state.address);
    if (allowed > ONE) throw new Error('An approval above $1 exists; pilot refuses to continue. Revoke it separately if appropriate.');
    if (kind === 'deposit' && allowed < ONE) throw new Error('Exact $1 allowance is not confirmed on-chain. Approve first.');
    if (kind === 'approve' && allowed >= ONE) throw new Error('A $1 allowance already exists. Do not pay to approve twice.');
    const tx = intent.steps[kind === 'approve' ? 0 : 1].tx;
    const params = { from: state.address, to: tx.to, data: tx.data, value: '0x0' };
    const [gas, gasPrice, bnb] = await Promise.all([
      state.provider.request({ method: 'eth_estimateGas', params: [params] }),
      state.provider.request({ method: 'eth_gasPrice' }),
      state.provider.request({ method: 'eth_getBalance', params: [state.address, 'latest'] })
    ]);
    if (BigInt(gas) > 1_000_000n || BigInt(bnb) < BigInt(gas) * BigInt(gasPrice) * 2n) throw new Error('Estimated BNB gas is unusually high or the wallet lacks a 2× gas buffer. No wallet prompt opened.');
    return params;
  }
  async function waitReceipt(hash, tx) {
    for (let i = 0; i < 60; i++) {
      const receipt = await state.provider.request({ method: 'eth_getTransactionReceipt', params: [hash] });
      if (receipt) {
        if (BigInt(receipt.status || '0x0') !== 1n) throw new Error('Transaction reverted. Gas may have been spent; check the explorer before retrying.');
        const onchainTx = await state.provider.request({ method: 'eth_getTransactionByHash', params: [hash] });
        if (!same(receipt.from, state.address) || !same(receipt.to, tx.to) ||
            !same(onchainTx?.from, state.address) || !same(onchainTx?.to, tx.to) ||
            !same(onchainTx?.input, tx.data) || BigInt(onchainTx?.value ?? '-1') !== 0n) {
          throw new Error('Confirmed transaction does not match the reviewed wallet, target, zero value and calldata. Inspect the explorer.');
        }
        return receipt;
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    throw new Error('Transaction is still pending or the wallet RPC timed out. Inspect its hash before doing anything else.');
  }
  async function send(kind) {
    if (state.busy || !state.intent) return;
    if (kind === 'approve' && state.approved || kind === 'deposit' && !state.approved) return;
    state.busy = true; updateButtons(); let hash = null, lockedForPrompt = false;
    try {
      const tx = await preSend(kind); // no wallet prompt until the fresh independent checks pass
      progress(`All preflight checks passed. Your wallet will request a separate confirmation for the ${kind === 'approve' ? 'exact $1 approval' : 'exact $1 deposit'}.`);
      if (kind === 'deposit') {
        setPilotLock({ status: 'wallet-prompt-initiated', at: new Date().toISOString() });
        lockedForPrompt = true; // block duplicate deposit attempts even across reloads before the wallet returns a hash
      }
      hash = await state.provider.request({ method: 'eth_sendTransaction', params: [tx] });
      if (!hashPattern.test(hash)) throw new Error('Wallet did not return a valid transaction hash. Check wallet history before retrying.');
      if (kind === 'approve') { state.approvalHash = hash; window.covenantPilotReceipt.approvalHash = hash; }
      else { state.depositHash = hash; window.covenantPilotReceipt.depositHash = hash; setPilotLock({ status: 'submitted', hash, at: new Date().toISOString() }); }
      progress(`${kind === 'approve' ? 'Approval' : 'Deposit'} submitted by your wallet; waiting for a confirmed receipt. Do not click again.`);
      addTxLink($('pilot-progress'), hash, 'View transaction on BscScan ↗');
      await waitReceipt(hash, tx);
      if (kind === 'approve') {
        const allowed = await allowance(state.address);
        if (allowed !== ONE) throw new Error('Approval transaction confirmed, but allowance is not exactly $1. Stop and inspect it.');
        state.approved = true;
        window.covenantPilotReceipt.approvalConfirmed = true;
        progress('Exact $1 approval confirmed. No deposit was sent. Review the second button and click it separately to proceed.');
        addTxLink($('pilot-progress'), hash, 'Approval receipt ↗');
      } else {
        const sharesAfter = await shareBalance(state.address);
        state.completed = true;
        window.covenantPilotReceipt.depositConfirmed = true;
        window.covenantPilotReceipt.shareBalanceIncreased = sharesAfter > state.sharesBefore;
        window.covenantPilotReceipt.confirmedAt = new Date().toISOString();
        setPilotLock({ status: 'confirmed', hash, at: window.covenantPilotReceipt.confirmedAt });
        if (sharesAfter > state.sharesBefore) {
          progress(`Mainnet deposit CONFIRMED on BNB Chain; vault shares increased from ${money(state.sharesBefore)} to ${money(sharesAfter)}. This does not guarantee future value or withdrawal time.`);
        } else progress('Deposit transaction succeeded, but a share increase was NOT verified. Do not claim settled shares; inspect the vault and transaction.');
        addTxLink($('pilot-progress'), hash, 'Confirmed deposit receipt ↗');
      }
    } catch (error) {
      if (kind === 'deposit' && lockedForPrompt && !hash && error?.code === 4001) clearPilotLock(); // explicit wallet rejection only
      progress(`${kind === 'approve' ? 'Approval' : 'Deposit'} stopped: ${safeError(error)}${hash ? ' A hash exists—check it before retrying.' : lockedForPrompt && error?.code !== 4001 ? ' A deposit prompt may have been sent: inspect wallet history; repeats remain locked.' : ' No transaction hash was returned.'}`, 'error');
      if (hash) addTxLink($('pilot-progress'), hash, 'Inspect hash ↗');
      if (hash || pilotLock()) { state.intent = null; $('pilot-approve').disabled = true; $('pilot-deposit').disabled = true; }
    } finally { state.busy = false; updateButtons(); }
  }

  $('pilot-connect').addEventListener('click', connect);
  $('pilot-prepare').addEventListener('click', prepare);
  $('pilot-approve').addEventListener('click', () => send('approve'));
  $('pilot-deposit').addEventListener('click', () => send('deposit'));
  for (const id of ['pilot-floor', 'pilot-dedicated', 'pilot-risk']) $(id).addEventListener(id === 'pilot-floor' ? 'input' : 'change', () => {
    if (state.intent) invalidate('Pilot inputs changed. Run the wallet-specific on-chain checks and prepare a new intent.');
    updateButtons();
  });
  updateButtons(); // no sample address, wallet permission, or transaction on page load
})();
