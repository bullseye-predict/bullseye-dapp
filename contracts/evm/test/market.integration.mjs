import assert from 'node:assert/strict';
import test from 'node:test';
import ganache from 'ganache';
import { AbiCoder, BrowserProvider, Contract, ContractFactory, MaxUint256, TypedDataEncoder, Wallet, id } from 'ethers';
import { compile } from '../scripts/compile.mjs';
import { EvmChainGateway } from '../../../packages/adapters/evm/gateway.ts';
import { evmOrderId } from '../../../packages/adapters/evm/orders.ts';
import { encodeVaultRequestSignature, vaultRequestMessage, verifyVaultRequest } from '../../../packages/adapters/evm/vault-requests.ts';

const artifacts = compile({ write: false, test: true });
const SCALE = 1_000_000n;
const orderFields = [
  ['maker', 'address'], ['marketId', 'bytes32'], ['outcomeId', 'uint8'], ['side', 'uint8'],
  ['price', 'uint64'], ['quantity', 'uint128'], ['nonce', 'uint256'], ['expiry', 'uint64'],
].map(([name, type]) => ({ name, type }));
const resultFields = [
  ['matchId', 'bytes32'], ['marketId', 'bytes32'], ['winningOutcomeId', 'uint8'], ['voided', 'bool'],
  ['stateHash', 'bytes32'], ['finishedAt', 'uint64'], ['expiry', 'uint64'],
].map(([name, type]) => ({ name, type }));
const orderTuple = 'tuple(address maker,bytes32 marketId,uint8 outcomeId,uint8 side,uint64 price,uint128 quantity,uint256 nonce,uint64 expiry)';
const coder = AbiCoder.defaultAbiCoder();
const mined = async promise => (await promise).wait();
const reverts = async action => assert.rejects(async () => {
  const response = await action();
  if (response?.wait) await response.wait();
});

async function fixture(t, count = 3) {
  // These are generated local test accounts. No account configuration or user key is read.
  const server = ganache.server({
    chain: { chainId: 31337, hardfork: 'shanghai' },
    wallet: { deterministic: true, totalAccounts: 8 }, logging: { quiet: true },
  });
  await server.listen(0, '127.0.0.1');
  const rpc = server.provider;
  // Ethers caches failed gas estimates by request. Disable that cache when time/state change
  // between an expected rejection and the next identical operation in these tests.
  const provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1, pollingInterval: 10 });
  t.after(async () => { provider.destroy(); await server.close(); });
  const wallets = Object.values(rpc.getInitialAccounts()).map(account => new Wallet(account.secretKey));
  const signers = await Promise.all(wallets.map(wallet => provider.getSigner(wallet.address)));
  const deploy = async (name, args = [], signer = signers[0]) => {
    const artifact = artifacts[name];
    const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(...args);
    await contract.waitForDeployment();
    return contract;
  };
  const factory = await deploy('PredictionMarketFactory', [wallets[0].address, 16]);
  const market = new Contract(await factory.settlement(), artifacts.PredictionMarket.abi, signers[0]);
  const token = new Contract(await market.outcomeToken(), artifacts.OutcomeToken.abi, signers[0]);
  const collateral = await deploy('TestCollateral');
  const oracle = await deploy('ResultOracle', [wallets[0].address, wallets[4].address, market.target]);
  await mined(factory.setAllowedCollateral(collateral.target, true));
  await mined(factory.setAllowedOracle(oracle.target, true));
  const f = { rpc, provider, wallets, signers, deploy, factory, market, token, collateral, oracle, nextNonce: 0n, rpcUrl: `http://127.0.0.1:${server.address().port}` };
  f.now = async () => BigInt((await provider.send('eth_getBlockByNumber', ['latest', false])).timestamp);
  f.advance = async seconds => {
    await provider.send('evm_increaseTime', [Number(seconds)]);
    await provider.send('evm_mine', []);
  };
  f.matchId = id('SOLZ test match');
  f.created = await f.now();
  f.lockTime = f.created + 1_000n;
  f.expiry = f.created + 2_000n;
  await mined(factory.createMarket(f.matchId, collateral.target, Array.from({ length: count }, (_, i) => `OUTCOME_${i}`), f.lockTime, f.expiry, oracle.target));
  f.marketId = await factory.marketForMatch(f.matchId);
  f.orderDomain = { name: 'SOLZ Prediction Market', version: '1', chainId: 31337, verifyingContract: market.target };
  f.resultDomain = { name: 'SOLZ Result Oracle', version: '1', chainId: 31337, verifyingContract: oracle.target };
  for (let i = 0; i < 4; ++i) {
    await mined(collateral.mint(wallets[i].address, 1_000n * SCALE));
    await mined(collateral.connect(signers[i]).approve(market.target, MaxUint256));
    await mined(token.connect(signers[i]).setApprovalForAll(market.target, true));
  }
  // Ask the contract for IDs in balance reads so the test does not duplicate token-ID implementation.
  f.balance = async (index, outcome = 0, marketId = f.marketId) => token.balanceOf(wallets[index].address, await token.tokenId(marketId, outcome));
  f.makeOrder = (index, overrides = {}) => ({
    maker: wallets[index].address, marketId: f.marketId, outcomeId: 0, side: index === 1 ? 1 : 0,
    price: 500_000n, quantity: 10n * SCALE, nonce: f.nextNonce++, expiry: f.created + 900n, ...overrides,
  });
  f.signOrder = (order, index, domain = {}) => wallets[index].signTypedData({ ...f.orderDomain, ...domain }, { Order: orderFields }, order);
  f.fill = async (buy, sell, amount = buy.quantity, buySignature, sellSignature) => mined(market.fillOrders(
    buy, buySignature ?? await f.signOrder(buy, 2), sell, sellSignature ?? await f.signOrder(sell, 1), amount,
  ));
  f.makeResult = async overrides => ({
    matchId: f.matchId, marketId: f.marketId, winningOutcomeId: 0, voided: false,
    stateHash: id('authoritative final state'), finishedAt: await f.now(), expiry: (await f.now()) + 900n, ...overrides,
  });
  f.resolve = async (result, signer = 4, domain = {}) => mined(oracle.resolveMarket(
    result, await wallets[signer].signTypedData({ ...f.resultDomain, ...domain }, { Result: resultFields }, result),
  ));
  return f;
}

test('creation validates uniqueness, allowlists, roles, outcomes and timing', async t => {
  const f = await fixture(t);
  const config = await f.market.getMarket(f.marketId);
  assert.equal(config.outcomeCount, 3n);
  assert.equal(config.status, 1n);
  assert.equal(config.resultOracle, f.oracle.target);
  assert.deepEqual(Array.from(await f.factory.outcomeLabels(f.marketId)), ['OUTCOME_0', 'OUTCOME_1', 'OUTCOME_2']);
  const create = (match, outcomes, lock = f.lockTime, expiry = f.expiry, collateral = f.collateral.target) =>
    f.factory.createMarket(match, collateral, outcomes, lock, expiry, f.oracle.target);
  await reverts(() => create(f.matchId, ['A', 'B']));
  await reverts(() => create(id('one'), ['A']));
  await reverts(() => create(id('duplicate'), ['A', 'A']));
  await reverts(() => create(id('too many'), Array.from({ length: 17 }, (_, i) => `${i}`)));
  await reverts(() => create(id('past'), ['A', 'B'], f.created));
  await reverts(() => create(id('expiry'), ['A', 'B'], f.lockTime, f.lockTime));
  await reverts(() => create(id('asset'), ['A', 'B'], f.lockTime, f.expiry, f.wallets[5].address));
  await reverts(() => f.factory.connect(f.signers[5]).setAllowedCollateral(f.wallets[5].address, true));
  await reverts(() => f.market.connect(f.signers[5]).registerMarket(id('fake'), id('fake match'), f.collateral.target, 2, f.lockTime, f.expiry, f.oracle.target));
});

test('three-outcome split and merge conserve collateral; users cannot mint or burn others', async t => {
  const f = await fixture(t);
  const before = await f.collateral.balanceOf(f.wallets[1].address);
  await mined(f.market.connect(f.signers[1]).split(f.marketId, 20n * SCALE));
  for (let i = 0; i < 3; ++i) assert.equal(await f.balance(1, i), 20n * SCALE);
  assert.equal((await f.market.getMarket(f.marketId)).collateralLocked, 20n * SCALE);
  await mined(f.market.connect(f.signers[1]).merge(f.marketId, 7n * SCALE));
  for (let i = 0; i < 3; ++i) assert.equal(await f.balance(1, i), 13n * SCALE);
  assert.equal(await f.collateral.balanceOf(f.wallets[1].address), before - 13n * SCALE);
  await reverts(() => f.token.mintSet(f.wallets[2].address, f.marketId, 3, SCALE));
  await reverts(() => f.token.burn(f.wallets[1].address, f.marketId, 0, SCALE));
  await reverts(() => f.market.connect(f.signers[2]).merge(f.marketId, SCALE));
});

test('partially fills signed orders at sell price and rejects overfill or replay', async t => {
  const f = await fixture(t);
  await mined(f.market.connect(f.signers[1]).split(f.marketId, 10n * SCALE));
  const buy = f.makeOrder(2, { price: 600_000n });
  const sell = f.makeOrder(1, { price: 400_000n });
  const beforeBuyer = await f.collateral.balanceOf(buy.maker);
  const beforeSeller = await f.collateral.balanceOf(sell.maker);
  const receipt = await f.fill(buy, sell, 4n * SCALE);
  const trade = receipt.logs.map(log => { try { return f.market.interface.parseLog(log); } catch { return null; } }).find(log => log?.name === 'TradeExecuted');
  assert.equal(trade.args.price, 400_000n);
  assert.equal(trade.args.collateralAmount, 1_600_000n);
  assert.equal(await f.market.filledQuantity(await f.market.hashOrder(buy)), 4n * SCALE);
  assert.equal(await f.balance(2), 4n * SCALE);
  await reverts(() => f.fill(buy, sell, 7n * SCALE));
  await f.fill(buy, sell, 6n * SCALE);
  assert.equal(await f.collateral.balanceOf(buy.maker), beforeBuyer - 4n * SCALE);
  assert.equal(await f.collateral.balanceOf(sell.maker), beforeSeller + 4n * SCALE);
  assert.equal(await f.balance(2), 10n * SCALE);
  await reverts(() => f.fill(buy, sell, SCALE));
});

test('fills reject signature tampering, foreign domains, expired orders and invalid crosses', async t => {
  const f = await fixture(t);
  await mined(f.market.connect(f.signers[1]).split(f.marketId, 20n * SCALE));
  const buy = f.makeOrder(2);
  const sell = f.makeOrder(1);
  const signature = await f.signOrder(buy, 2);
  assert.equal(await f.market.hashOrder(buy), TypedDataEncoder.hash(f.orderDomain, { Order: orderFields }, buy));
  await reverts(() => f.fill({ ...buy, quantity: 11n * SCALE }, sell, SCALE, signature));
  await reverts(async () => f.fill(buy, sell, SCALE, await f.signOrder(buy, 2, { chainId: 1 })));
  await reverts(async () => f.fill(buy, sell, SCALE, await f.signOrder(buy, 2, { verifyingContract: f.oracle.target })));
  await reverts(() => f.fill({ ...buy, expiry: f.created }, sell, SCALE));
  await reverts(() => f.fill({ ...buy, price: 400_000n }, sell, SCALE));
  await reverts(() => f.fill(buy, { ...sell, outcomeId: 1 }, SCALE));
  await reverts(() => f.fill({ ...buy, price: 1_000_001n }, sell, SCALE));
  await reverts(() => f.fill(buy, { ...sell, price: 0n }, SCALE));
  assert.equal(await f.market.filledQuantity(await f.market.hashOrder(buy)), 0n);
});

test('shared EVM gateway reads deployed tuple state and verifies the same signed order digest', async t => {
  const f = await fixture(t);
  const config = {
    family: 'EVM', venue: 'EVM', chainId: '31337', rpcUrl: f.rpcUrl,
    settlementAddress: f.market.target, factoryAddress: f.factory.target,
    oracleAddress: f.oracle.target, collateralToken: f.collateral.target, collateralDecimals: 6,
  };
  const gateway = new EvmChainGateway(config);
  const market = await gateway.getMarket(f.marketId);
  assert.equal(market.id, f.marketId);
  assert.equal(market.matchId, f.matchId);
  assert.equal(market.status, 'TRADING');
  assert.equal(market.outcomes.length, 3);
  assert.equal(market.tradingLocksAt, Number(f.lockTime) * 1_000);
  assert.equal(market.expiresAt, Number(f.expiry) * 1_000);
  assert.equal(market.paused, false);
  const chainOrder = f.makeOrder(2);
  const sharedOrder = {
    orderId: '', venue: 'EVM', chainId: '31337', maker: chainOrder.maker,
    marketId: f.marketId, outcomeId: chainOrder.outcomeId, side: 'BUY',
    price: chainOrder.price, quantity: chainOrder.quantity, nonce: chainOrder.nonce,
    expiresAt: Number(chainOrder.expiry) * 1_000, signature: await f.signOrder(chainOrder, 2),
  };
  sharedOrder.orderId = evmOrderId(sharedOrder, f.market.target);
  assert.equal(sharedOrder.orderId, await f.market.hashOrder(chainOrder));
  assert.equal(await gateway.verifyOrder(sharedOrder), true);
  await mined(f.market.connect(f.signers[2]).cancelOrder(sharedOrder.orderId));
  assert.equal(await gateway.verifyOrder(sharedOrder), false);
  assert.equal((await gateway.getBalance(sharedOrder.maker)).total, 1_000n * SCALE);
  await mined(f.market.setPaused(true));
  assert.equal((await new EvmChainGateway(config).getMarket(f.marketId)).paused, true);
  await reverts(() => new EvmChainGateway({ ...config, chainId: '1' }).getMarket(f.marketId));
  await reverts(() => new EvmChainGateway({ ...config, collateralDecimals: 9 }).getMarket(f.marketId));
});

test('rounding rejects dust exceeding a signed buy limit and accepts exactly funded fills', async t => {
  const f = await fixture(t);
  await mined(f.market.connect(f.signers[1]).split(f.marketId, 10n));
  const buy = f.makeOrder(2, { quantity: 2n });
  const sell = f.makeOrder(1, { quantity: 2n });
  await reverts(() => f.fill(buy, sell, 1n));
  await f.fill(buy, sell, 2n);
  assert.equal(await f.balance(2), 2n);
  const ceilingBuy = f.makeOrder(2, { quantity: 1n, price: SCALE });
  const ceilingSell = f.makeOrder(1, { quantity: 1n, price: 400_000n });
  await f.fill(ceilingBuy, ceilingSell);
  assert.equal(await f.market.quote(1n, 400_000n), 1n);
});

test('individual cancellations are maker-scoped and nonce advancement invalidates all older orders', async t => {
  const f = await fixture(t);
  await mined(f.market.connect(f.signers[1]).split(f.marketId, 20n * SCALE));
  const buy = f.makeOrder(2, { nonce: 3n });
  const sell = f.makeOrder(1);
  const hash = await f.market.hashOrder(buy);
  await mined(f.market.connect(f.signers[5]).cancelOrder(hash));
  await f.fill(buy, sell, SCALE);
  await mined(f.market.connect(f.signers[2]).cancelOrder(hash));
  await reverts(() => f.fill(buy, sell, SCALE));
  const old = f.makeOrder(2, { nonce: 4n });
  await mined(f.market.connect(f.signers[2]).cancelUpTo(5n));
  await reverts(() => f.fill(old, sell, SCALE));
  await reverts(() => f.market.connect(f.signers[2]).cancelUpTo(5n));
  const valid = f.makeOrder(2, { nonce: 5n });
  await f.fill(valid, sell, SCALE);
});

test('global and market pauses block new risk while merge and resolved redemption stay available', async t => {
  const f = await fixture(t);
  await mined(f.market.connect(f.signers[1]).split(f.marketId, 20n * SCALE));
  const buy = f.makeOrder(2);
  const sell = f.makeOrder(1);
  await mined(f.market.setMarketPaused(f.marketId, true));
  await reverts(() => f.fill(buy, sell));
  await reverts(() => f.market.connect(f.signers[2]).split(f.marketId, SCALE));
  await mined(f.market.connect(f.signers[1]).merge(f.marketId, SCALE));
  await mined(f.market.setMarketPaused(f.marketId, false));
  await mined(f.market.setPaused(true));
  await reverts(() => f.fill(buy, sell));
  await mined(f.market.connect(f.signers[1]).merge(f.marketId, SCALE));
  await f.resolve(await f.makeResult({ winningOutcomeId: 2 }));
  await mined(f.market.connect(f.signers[1]).redeem(f.marketId));
  assert.equal((await f.market.getMarket(f.marketId)).collateralLocked, 0n);
});

test('authoritative lock time stops fills and splits without preventing complete-set exits', async t => {
  const f = await fixture(t);
  await mined(f.market.connect(f.signers[1]).split(f.marketId, SCALE));
  const buy = f.makeOrder(2, { expiry: f.expiry, quantity: SCALE });
  const sell = f.makeOrder(1, { expiry: f.expiry, quantity: SCALE });
  await f.advance(f.lockTime - await f.now());
  assert.equal((await f.market.getMarket(f.marketId)).status, 2n);
  await reverts(() => f.fill(buy, sell));
  await reverts(() => f.market.connect(f.signers[2]).split(f.marketId, SCALE));
  await mined(f.market.connect(f.signers[1]).merge(f.marketId, SCALE));
});

test('oracle verifies signer, match, market, domain, outcome and expiry; result cannot be replayed', async t => {
  const f = await fixture(t);
  await mined(f.market.connect(f.signers[1]).split(f.marketId, 20n * SCALE));
  await f.fill(f.makeOrder(2), f.makeOrder(1));
  const result = await f.makeResult();
  assert.equal(await f.oracle.hashResult(result), TypedDataEncoder.hash(f.resultDomain, { Result: resultFields }, result));
  await reverts(() => f.resolve(result, 5));
  await reverts(() => f.resolve({ ...result, matchId: id('wrong match') }));
  await reverts(() => f.resolve({ ...result, marketId: id('wrong market') }));
  await reverts(() => f.resolve({ ...result, winningOutcomeId: 3 }));
  await reverts(() => f.resolve({ ...result, expiry: f.created }));
  await reverts(() => f.resolve({ ...result, finishedAt: f.created - 1n }));
  await reverts(() => f.resolve(result, 4, { chainId: 1 }));
  await reverts(() => f.resolve(result, 4, { verifyingContract: f.market.target }));
  await reverts(() => f.market.finalize(result));
  await f.resolve(result);
  assert.equal((await f.market.getMarket(f.marketId)).status, 3n);
  const beforeBuyer = await f.collateral.balanceOf(f.wallets[2].address);
  await mined(f.market.connect(f.signers[2]).redeem(f.marketId));
  assert.equal(await f.collateral.balanceOf(f.wallets[2].address), beforeBuyer + 10n * SCALE);
  await mined(f.market.connect(f.signers[1]).redeem(f.marketId));
  assert.equal((await f.market.getMarket(f.marketId)).collateralLocked, 0n);
  await reverts(() => f.resolve(result));
  await reverts(() => f.market.connect(f.signers[2]).redeem(f.marketId));
  await reverts(() => f.market.voidExpiredMarket(f.marketId));
});

test('void refunds all collateral across fractional multi-outcome claims without stranded dust', async t => {
  const f = await fixture(t);
  await mined(f.market.connect(f.signers[1]).split(f.marketId, 2n));
  await mined(f.token.connect(f.signers[1]).safeTransferFrom(f.wallets[1].address, f.wallets[2].address, await f.token.tokenId(f.marketId, 0), 1n, '0x'));
  await mined(f.token.connect(f.signers[1]).safeTransferFrom(f.wallets[1].address, f.wallets[3].address, await f.token.tokenId(f.marketId, 1), 1n, '0x'));
  await f.resolve(await f.makeResult({ voided: true }));
  const before = await Promise.all([1, 2, 3].map(i => f.collateral.balanceOf(f.wallets[i].address)));
  await mined(f.market.connect(f.signers[2]).redeem(f.marketId));
  await mined(f.market.connect(f.signers[1]).redeem(f.marketId));
  await mined(f.market.connect(f.signers[3]).redeem(f.marketId));
  const after = await Promise.all([1, 2, 3].map(i => f.collateral.balanceOf(f.wallets[i].address)));
  assert.equal(after.reduce((sum, balance, i) => sum + balance - before[i], 0n), 2n);
  const market = await f.market.getMarket(f.marketId);
  assert.equal(market.voidSharesRedeemed, 6n);
  assert.equal(market.collateralLocked, 0n);
  assert.equal(await f.collateral.balanceOf(f.market.target), 0n);
});

test('anyone can void at timeout if the oracle is unavailable, including while paused', async t => {
  const f = await fixture(t);
  await mined(f.market.connect(f.signers[1]).split(f.marketId, 3n));
  await reverts(() => f.market.connect(f.signers[5]).voidExpiredMarket(f.marketId));
  await f.advance(f.expiry - await f.now());
  assert.ok(await f.now() >= f.expiry);
  await mined(f.market.setPaused(true));
  await mined(f.market.connect(f.signers[5]).voidExpiredMarket(f.marketId));
  await mined(f.market.connect(f.signers[1]).redeem(f.marketId));
  assert.equal((await f.market.getMarket(f.marketId)).collateralLocked, 0n);
});

test('fee-on-transfer collateral cannot create unbacked positions or silently underpay a seller', async t => {
  const f = await fixture(t);
  await mined(f.collateral.setChargeFee(true));
  await reverts(() => f.market.connect(f.signers[1]).split(f.marketId, SCALE));
  assert.equal((await f.market.getMarket(f.marketId)).collateralLocked, 0n);
  assert.equal(await f.balance(1), 0n);
  await mined(f.collateral.setChargeFee(false));
  await mined(f.market.connect(f.signers[1]).split(f.marketId, 10n * SCALE));
  await mined(f.collateral.setChargeFee(true));
  const buy = f.makeOrder(2);
  await reverts(() => f.fill(buy, f.makeOrder(1)));
  assert.equal(await f.market.filledQuantity(await f.market.hashOrder(buy)), 0n);
  assert.equal(await f.balance(2), 0n);
});

test('ERC1155 receiver reentry cannot exit during a split callback', async t => {
  const f = await fixture(t);
  const receiver = await f.deploy('ReentrantReceiver', [f.market.target]);
  await mined(f.collateral.mint(receiver.target, 10n * SCALE));
  await mined(receiver.split(f.marketId, f.collateral.target, 10n * SCALE));
  assert.equal(await receiver.reentrySucceeded(), false);
  assert.equal((await f.market.getMarket(f.marketId)).collateralLocked, 10n * SCALE);
  assert.equal(await f.token.balanceOf(receiver.target, await f.token.tokenId(f.marketId, 0)), 10n * SCALE);
});

async function vaultFixture(t, overrides = {}) {
  const f = await fixture(t);
  f.vault = await f.deploy('AgentVault', [f.wallets[2].address, f.collateral.target, f.market.target], f.signers[2]);
  await mined(f.collateral.connect(f.signers[2]).approve(f.vault.target, MaxUint256));
  await mined(f.vault.deposit(100n * SCALE));
  await mined(f.vault.setMarketAllowed(f.marketId, true));
  f.policy = {
    operator: f.wallets[3].address, maxCapital: 20n * SCALE, maxOrderSize: 10n * SCALE,
    maxExposure: 40n * SCALE, expiresAt: f.created + 950n, enabled: true, ...overrides,
  };
  await mined(f.vault.authorizeAgent(f.policy));
  await mined(f.market.connect(f.signers[1]).split(f.marketId, 100n * SCALE));
  f.agentEnvelope = async (order, { epoch, signer = 3, owner = false } = {}) => {
    epoch ??= await f.vault.policyNonce();
    const orderHash = await f.market.hashOrder(order);
    const signature = owner ? await f.signOrder(order, 2) : await f.wallets[signer].signTypedData(
      { name: 'SOLZ Agent Vault', version: '1', chainId: 31337, verifyingContract: f.vault.target },
      { AgentOrder: [{ name: 'orderHash', type: 'bytes32' }, { name: 'policyNonce', type: 'uint256' }] },
      { orderHash, policyNonce: epoch },
    );
    return coder.encode([orderTuple, 'uint256', 'bytes'], [order, epoch, signature]);
  };
  f.vaultBuy = overrides => f.makeOrder(2, { maker: f.vault.target, ...overrides });
  f.fillVault = async (buy, sell = f.makeOrder(1, { quantity: buy.quantity }), envelope) =>
    f.fill(buy, sell, buy.quantity, envelope ?? await f.agentEnvelope(buy));
  return f;
}

test('Hermes signs vault orders and aggregate execution-time spending cannot exceed allocation', async t => {
  const f = await vaultFixture(t, { maxCapital: 9n * SCALE, maxOrderSize: 5n * SCALE });
  const first = f.vaultBuy();
  const second = f.vaultBuy();
  // Both are validly signed before either fills. Aggregate checks must run in the fill hook.
  const secondSignature = await f.agentEnvelope(second);
  await f.fillVault(first);
  assert.equal(await f.vault.spentCapital(), 5n * SCALE);
  assert.equal(await f.vault.grossExposure(), 10n * SCALE);
  await reverts(() => f.fillVault(second, undefined, secondSignature));
  assert.equal(await f.vault.spentCapital(), 5n * SCALE);
  assert.equal(await f.market.filledQuantity(await f.market.hashOrder(second)), 0n);
  assert.equal(await f.collateral.balanceOf(f.vault.target), 95n * SCALE);
});

test('vault enforces order size, market allowlist, policy expiry and acquired-share exposure', async t => {
  const f = await vaultFixture(t, { maxExposure: 15n * SCALE, maxOrderSize: 5n * SCALE });
  await reverts(() => f.fillVault(f.vaultBuy({ quantity: 11n * SCALE })));
  await reverts(() => f.fillVault(f.vaultBuy({ expiry: f.policy.expiresAt + 1n })));
  await f.fillVault(f.vaultBuy());
  await reverts(() => f.fillVault(f.vaultBuy()));
  await mined(f.vault.setMarketAllowed(f.marketId, false));
  await mined(f.vault.authorizeAgent(f.policy));
  await reverts(() => f.fillVault(f.vaultBuy({ quantity: 2n * SCALE })));
});

test('agent cannot withdraw, change policy or call the fill hook; owner can exit during all pauses', async t => {
  const f = await vaultFixture(t);
  await reverts(() => f.vault.connect(f.signers[3]).withdraw(SCALE));
  await reverts(() => f.vault.connect(f.signers[3]).authorizeAgent({ ...f.policy, maxCapital: 1_000n * SCALE }));
  await reverts(() => f.vault.connect(f.signers[3]).setMarketAllowed(f.marketId, true));
  await reverts(() => f.vault.connect(f.signers[3]).withdrawPosition(f.marketId, 0, SCALE));
  const buy = f.vaultBuy();
  await reverts(async () => f.vault.connect(f.signers[3]).onOrderFilled(buy, await f.agentEnvelope(buy), SCALE, 500_000n));
  await mined(f.market.setPaused(true));
  await mined(f.vault.pauseAgent());
  const before = await f.collateral.balanceOf(f.wallets[2].address);
  await mined(f.vault.withdraw(100n * SCALE));
  assert.equal(await f.collateral.balanceOf(f.wallets[2].address), before + 100n * SCALE);
  assert.equal(await f.collateral.balanceOf(f.vault.target), 0n);
  assert.equal((await f.vault.policy()).enabled, false);
});

test('revocation and policy changes invalidate old agent signatures even when operator is reauthorized', async t => {
  const f = await vaultFixture(t);
  const buy = f.vaultBuy();
  const oldEnvelope = await f.agentEnvelope(buy);
  await mined(f.vault.revokeAgent());
  await reverts(() => f.fillVault(buy, undefined, oldEnvelope));
  await mined(f.vault.authorizeAgent(f.policy));
  await reverts(() => f.fillVault(buy, undefined, oldEnvelope));
  const [, , oldSignature] = coder.decode([orderTuple, 'uint256', 'bytes'], oldEnvelope);
  const rewritten = coder.encode([orderTuple, 'uint256', 'bytes'], [buy, await f.vault.policyNonce(), oldSignature]);
  await reverts(() => f.fillVault(buy, undefined, rewritten));
  await f.fillVault(buy);
});

test('vault can sell, cancel and redeem while proceeds remain bound to its owner', async t => {
  const f = await vaultFixture(t);
  await f.fillVault(f.vaultBuy());
  const sell = f.makeOrder(2, { maker: f.vault.target, side: 1, quantity: 4n * SCALE });
  const buyer = f.makeOrder(1, { side: 0, quantity: 4n * SCALE });
  await f.fill(buyer, sell, 4n * SCALE, await f.signOrder(buyer, 1), await f.agentEnvelope(sell));
  assert.equal(await f.vault.grossExposure(), 6n * SCALE);
  assert.equal(await f.vault.spentCapital(), 5n * SCALE);
  const cancelled = f.vaultBuy();
  await mined(f.vault.connect(f.signers[3]).cancelOrder(await f.market.hashOrder(cancelled)));
  await reverts(() => f.fillVault(cancelled));
  await f.resolve(await f.makeResult());
  await mined(f.vault.connect(f.signers[5]).redeem(f.marketId));
  assert.equal(await f.vault.grossExposure(), 0n);
  assert.equal(await f.collateral.balanceOf(f.vault.target), 103n * SCALE);
  await reverts(() => f.vault.connect(f.signers[3]).withdraw(103n * SCALE));
  await mined(f.vault.withdraw(103n * SCALE));
});

test('owner-signed vault orders and position withdrawals remain available after agent revocation', async t => {
  const f = await vaultFixture(t);
  await mined(f.vault.revokeAgent());
  const buy = f.vaultBuy();
  await f.fillVault(buy, undefined, await f.agentEnvelope(buy, { owner: true }));
  await mined(f.vault.withdrawPosition(f.marketId, 0, 10n * SCALE));
  assert.equal(await f.balance(2), 10n * SCALE);
  assert.equal(await f.vault.grossExposure(), 0n);
});

test('vault request authority permits scoped session cancellation and rejects revocation replay or configuration changes', async t => {
  const f = await vaultFixture(t);
  const config = {
    family: 'EVM', venue: 'EVM', chainId: '31337', rpcUrl: f.rpcUrl,
    settlementAddress: f.market.target, factoryAddress: f.factory.target,
    oracleAddress: f.oracle.target, collateralToken: f.collateral.target, collateralDecimals: 6,
  };
  const client = new EvmChainGateway(config).client;
  const message = `SOLZ_PREDICTION_REQUEST_V1\nlocal-test\nDELETE\n/orders/test?venue=EVM&chainId=31337\nEVM\n31337\n${f.vault.target}\nunique-test-request-nonce\n${Number(f.created) * 1000 + 30000}\nbody-hash`;
  const cancellation = { method: 'DELETE', pathname: '/orders/test' };
  const now = Number(await f.now()) * 1000;
  const epoch = await f.vault.policyNonce();
  const inner = await f.wallets[3].signMessage(vaultRequestMessage(message, epoch));
  const envelope = encodeVaultRequestSignature(epoch, inner);
  const verify = (signature = envelope, request = cancellation, requestMessage = message, configuration = config, at = now) =>
    verifyVaultRequest(client, configuration, f.vault.target, requestMessage, signature, request, at);
  assert.equal(await verify(), true);
  assert.equal(await verify(envelope, { method: 'POST', pathname: '/orders/cancel-all' }), true);
  assert.equal(await verify(envelope, { method: 'PUT', pathname: '/hermes/config' }), false);
  assert.equal(await verify(envelope, { method: 'POST', pathname: '/hermes/start' }), false);
  assert.equal(await verify(envelope, cancellation, `${message}-tampered`), false);
  assert.equal(await verify(envelope, cancellation, message, { ...config, settlementAddress: f.oracle.target }), false);
  assert.equal(await verify(envelope, cancellation, message, { ...config, collateralToken: f.token.target }), false);
  assert.equal(await verify('0x1234'), false);
  assert.equal(await verify(envelope, cancellation, message, config, Number(f.policy.expiresAt) * 1000), false);
  const ownerEnvelope = encodeVaultRequestSignature(epoch, await f.wallets[2].signMessage(vaultRequestMessage(message, epoch)));
  assert.equal(await verify(ownerEnvelope, { method: 'PUT', pathname: '/hermes/config' }), true);
  assert.equal(await verify(encodeVaultRequestSignature(epoch, await f.wallets[5].signMessage(vaultRequestMessage(message, epoch)))), false);
  await mined(f.vault.revokeAgent());
  assert.equal(await verify(), false);
  await mined(f.vault.authorizeAgent(f.policy));
  assert.equal(await verify(), false);
  assert.equal(await verify(encodeVaultRequestSignature(await f.vault.policyNonce(), inner)), false);
  const renewed = await f.vault.policyNonce();
  const renewedEnvelope = encodeVaultRequestSignature(renewed, await f.wallets[3].signMessage(vaultRequestMessage(message, renewed)));
  assert.equal(await verify(renewedEnvelope), true);
  // General API request signatures must not become valid settlement order signatures.
  const order = f.vaultBuy();
  await reverts(() => f.fillVault(order, undefined, renewedEnvelope));
});
