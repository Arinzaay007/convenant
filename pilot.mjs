// Hard-pinned, one-USDC mainnet pilot policy. This module never signs or submits.
// Its existence is NOT proof that the vault currently accepts deposits.
export const PILOT = Object.freeze({
  chainId: 56,
  routeId: '56-0xc975a3eef2e49f8eddef585340c43f15300fcb82',
  vault: '0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82',
  token: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  tokenDecimals: 18,
  usdc: '1.00',
  cents: 100,
  baseUnits: '1000000000000000000',
  rpcPrimary: 'https://bsc-dataseed.bnbchain.org',
  rpcBackup: 'https://bsc-rpc.publicnode.com',
  explorer: 'https://bscscan.com/tx/'
});
export const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const same = (a, b) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();

export function addressWord(address) {
  if (!EVM_ADDRESS.test(address)) throw new Error('Invalid public EVM address.');
  return address.slice(2).toLowerCase().padStart(64, '0');
}
export function uintWord(value) {
  const amount = BigInt(value);
  if (amount < 0n || amount >= 2n ** 256n) throw new Error('Invalid uint256 amount.');
  return amount.toString(16).padStart(64, '0');
}
export function parseUint256(hex) {
  if (typeof hex !== 'string' || !/^0x[\da-fA-F]{64}$/.test(hex)) throw new Error('RPC returned malformed uint256 data.');
  return BigInt(hex);
}
export function parseAddressWord(hex) {
  if (typeof hex !== 'string' || !/^0x[\da-fA-F]{64}$/.test(hex)) throw new Error('RPC returned malformed address data.');
  return `0x${hex.slice(-40)}`;
}
export function safeUSDCFromUnits(units) {
  const raw = BigInt(units);
  if (raw < 0n) throw new Error('Negative token balance is invalid.');
  const cents = raw / 10n ** 16n; // truncate (never overstate wallet cash)
  if (cents > 99_999_999_999n) throw new Error('Token balance exceeds the supported scenario range.');
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

export function validatePilotDraft(result, owner) {
  if (!EVM_ADDRESS.test(owner)) throw new Error('Enter a public EVM wallet address.');
  if (result?.ok !== true || result.chainId !== PILOT.chainId || result.settlement !== 'sync' ||
      !same(result.vault?.id, PILOT.routeId) || !same(result.vault?.address, PILOT.vault) ||
      !same(result.ownerAddress, owner) || !same(result.asset?.address, PILOT.token) ||
      result.asset?.decimals !== PILOT.tokenDecimals || result.amount?.baseUnits !== PILOT.baseUnits ||
      !Array.isArray(result.steps) || result.steps.length !== 2) {
    throw new Error('IXS draft does not match the pinned $1 BNB Chain route.');
  }
  const [approval, deposit] = result.steps;
  const expectedApprove = `0x095ea7b3${addressWord(PILOT.vault)}${uintWord(PILOT.baseUnits)}`;
  const expectedDeposit = `0x6e553f65${uintWord(PILOT.baseUnits)}${addressWord(owner)}`;
  if (approval.type !== 'erc20_approve_exact' || deposit.type !== 'vault_deposit' ||
      !same(approval.tx?.to, PILOT.token) || !same(deposit.tx?.to, PILOT.vault) ||
      !same(approval.tx?.data, expectedApprove) || !same(deposit.tx?.data, expectedDeposit) ||
      String(approval.tx?.value) !== '0' || String(deposit.tx?.value) !== '0') {
    throw new Error('IXS calldata failed exact spender, receiver, amount or target verification.');
  }
  return [approval, deposit].map(s => ({ type: s.type, description: s.description, tx: { to: s.tx.to, data: s.tx.data, value: '0x0' } }));
}
