# COVENANT — honest submission kit

**Target:** [OpenServ Edition 01](https://www.openserv.ai/hackathon), **RWA Vaults** track. Submission closes **28 September 2026 at 00:00 UTC / 01:00 WAT**. The public rules do not say definitively whether a signed deposit is mandatory. Do **not** claim organiser-confirmed eligibility.

## One-sentence pitch

> COVENANT is the treasury second opinion for service marketplaces: it finds the first date and dollar amount a proposed IXS vault allocation would break an operator-entered promise, before any real money can be committed.

## What is real—and what isn't

- **Real live data:** IXS REST/MCP vault discovery and settlement reads, Open-Meteo weather, BNB Chain capacity/balance checks for a **supplied address**. The site never probes a dummy wallet or drafts a deposit during discovery; its **main treasury** builder requires a passing operator-supplied review/address. A separate read-only diagnostic validated IXS's exact-$1 **unsigned** draft for the supplied public address on 27 Sep ~19:50 UTC. No signed deposit or verified wallet ownership.
- **Real operator decisions:** the site starts with **no cash, no obligations, no decision**. The operator must supply amounts and dates; a bank/payroll feed is **not** connected, so claims based on these entries remain conditional. Hypothetical weather reserve is optional and clearly labelled.
- **SERV implementation:** real OpenServ inference API is wired with schema and source-quote validation; a valid-key successful request is still **unverified** until the operator enters a key **in the trusted site**. The key is not held by the server or safe to send in chat.
- **Optional $1 wallet path:** hard-pinned BNB Chain USDC (18 decimals) and vault, exact approval/deposit calldata, two independent capacity RPC reads, floor and no-obligation attestation, separate user-wallet confirmations, receipt/share verification and a browser repeat lock. Browser success has been simulated **only in an automated test with a fake provider**—it is **not proof that real funds moved**. Do not claim a real deposit without a confirmed explorer link.
- **Historical $20k/$5k/$1k/$3k calculations:** deterministic **test fixtures and old demo graphics only**; they are **not** prefilled into the current website and must not be presented as a customer treasury result.

## Film a truthful demo

1. Show the **blank real-input start**: no green decision or mocked wallet balances. Enter *authorised actual* cash, reserve, proposed allocation, existing position (0 if none) and at least one dated obligation. If actual business figures aren't available, **do not invent them for a claimed real-data run**.
2. Run the deterministic dated-cash test. Explain the first breach and maximum safe allocation from **those operator-entered figures only**. If you choose a hypothetical disruption reserve, say **“what-if”** and enter its date/amount yourself. Weather is a signal, not an insurance claim or a vault exit.
3. Inspect **live** IXS catalog/settlement details and live Open-Meteo forecast. No dummy wallet or unsigned deposit is generated on page load. Show how an unsafe ledger blocks calldata and how an operator's real public address is required before any main unsigned IXS request.
4. If you have a valid SERV key, enter it **in your own trusted HTTPS deployment**, run a benign dated note, inspect/accept a quoted candidate and rerun the math. If you don't, say **“SERV extraction is wired but successful inference awaits a valid key”**; never claim it ran live.
5. For the real-$1 pilot, connect **your own dedicated** BNB Chain wallet for a **read-only** account-specific limit and balance check. If blocked, stop and show the guard; if every guard passes and you consciously decide to proceed, **you** approve exactly $1 and **separately** sign the $1 deposit, then verify the real receipt/share change on BscScan before claiming anything. BNB gas extra and $1 principal could be lost. No manual USDC transfer to the vault address.

## X post draft — insert genuine evidence only

Attach [current blank-state screenshot](assets/live-inputs-required.png) and **only genuine** live-data/receipt captures made after checking them. Historic images require captions with their dates and labels: [scenario fixture](assets/scenario-comparison.png) = **hypothetical**, [24 Sep IXS draft](assets/ixs-intent-closeup.png) = **unsigned**, [25 Sep zero-cap view](assets/mainnet-zero-cap.png) = **historical**, [27 Sep sampled cap](assets/mainnet-capacity-current.png) = **not wallet-specific**. Replace placeholders with real public URLs.

> Built **COVENANT** for @openservai: real-input treasury guardrails before IXS vault actions. It pinpoints the first dated cash shortfall and maximum safe allocation; SERV can suggest quoted obligations; deterministic code decides. Live IXS, Open-Meteo and wallet-specific BNB checks are integrated. Demo: [PUBLIC_DEMO_URL] Code: [PUBLIC_REPO_URL]

If a genuine SERV run and real deposit have *actually* been confirmed, add verifiable evidence separately; otherwise do not claim either. Never write “guaranteed yield,” “insurance payout,” “bond posted,” “funds escrowed,” “deposit completed,” or “SERV processed this note live” unless independently true.

## Real-$1 stop/go protocol

- [ ] Confirm your **own public BNB Chain wallet address**, chain ID **56**, token [`0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`](https://bscscan.com/token/0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d) and vault [`0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82`](https://bscscan.com/address/0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82). No seeds/passwords/API keys in chat. No wallet connected to this instance yet.
- [ ] **Recheck live after connecting your own wallet:** `maxDeposit(your address)`, USDC balance, BNB balance, allowance, shares, paused/token/precision on chain. If under $1, inconsistent, or unreachable, **stop without approval**. A read-only spot check for the supplied public address passed on 27 Sep ~19:50 UTC (three RPCs reported an unbounded `maxDeposit`; two reported 2 USDC and 0.001 BNB), but it can change and **does not prove wallet ownership**.
- [ ] Use a separate wallet with no other 30-day obligations beyond the declared USDC floor. Only exact **1.00 USDC** principal, **BNB gas extra**; accept potential loss and uncertain withdrawals.
- [ ] Review the two-minute unsigned IXS plan; verify exact token, spender/vault, $1 amount and receiver. An unsigned plan isn't a deposit. Do not use your wallet's ordinary **Send** function to transfer USDC directly to the vault.
- [ ] If you deliberately choose to proceed and the fresh checks pass, confirm **exact-$1 approval** yourself. Wait for a successful receipt/allowance; approval alone spends gas and may remain if deposit closes.
- [ ] Click/confirm the **separate exact-$1 deposit** yourself after another live preflight. Verify on-chain receipt and an increase in vault shares. If no receipt or failure, never retry blindly. A share balance does not guarantee redemption timing or value.

Sample-address `maxDeposit` was **0 on 25 September** and `uint256` maximum on **27 September ~19:26 UTC** from two RPCs. The separate operator-supplied public address also passed a read-only three-RPC capacity check **~19:50 UTC on 27 September**, and an exact-$1 unsigned IXS draft passed validation. The approximate approval gas estimate was **54,235 gas at 0.05 gwei**; deposit gas remains unestimated because allowance is currently zero. None of these observations is a connected-wallet consent or a transaction. Recheck everything before each wallet prompt. No real wallet transaction has occurred here.

## Last-mile submission, in priority order

1. **Get a durable public HTTPS site** using [DEPLOY.md](DEPLOY.md). The Arena iframe isn't a wallet-enabled permanent URL. You must log into your own GitHub/hosting account; this agent has no authority or credentials to publish for you.
2. Enable OpenServ organisation **data collection** at <https://console.openserv.ai/settings/organization>; test actual SERV inference with a valid key **only on the trusted deployment**, and keep the note/key private.
3. Check IXS/weather/on-chain reads and the **blank input fail-closed state** on desktop and mobile; `npm run check` passes **19 offline tests**, including mocked failure and fake-provider paths. These tests are not real transaction evidence.
4. Publish an X post with name, concept, images, working demo/code links and `@openservai`, then submit via the [official top-of-page Typeform](https://form.typeform.com/to/A475N331), which showed a START screen on 27 Sep. The FAQ's alternative form was closed when previously checked. **Submit before 28 Sep 00:00 UTC / 01:00 WAT**, even if the optional real-$1 attempt cannot be completed.
5. Ask organisers if an unsigned-only guarded workflow qualifies for RWA Vaults; public rules don't explicitly settle the signed-hash issue. Never invent a policy answer.

**Current verification boundary, 27 September 2026:** real IXS, BNB Chain (including preliminary checks for an operator-supplied public address) and weather reads succeeded; valid-key SERV success, operator-specific business cash/obligation data, durable public hosting, proof of wallet ownership and real wallet approval/deposit are **still pending**. No funds moved. COVENANT is not legal escrow, a bond, insurance, investment advice or a guarantee of withdrawals or returns.
