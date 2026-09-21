// Person 1 integration: real UsersService -> EVM adapter -> Anvil -> Solidity
// -> PostgreSQL lifecycle. This suite skips explicitly when either required
// external service/artifact set is unavailable; it never replaces the chain
// with a successful mock.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ContractFactory, HDNodeWallet, JsonRpcProvider, NonceManager, SigningKey, Wallet as EvmWallet, Contract, hashMessage } from "ethers";
import { createContainer, type Container } from "../src/container";
import { EvmBlockchainAdapter, loadAbis, type EvmChainConfig } from "../src/blockchain";
import { waitForReceipt } from "../src/blockchain/evm-adapter";
import { BlockchainError } from "../src/blockchain/errors";
import { MemoryIntegrityAdapter } from "../src/integrity/integrity";
import { MockDeviceAttestationAdapter } from "../src/devices/device-attestation";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = resolve(ROOT, "contracts/out");
const MNEMONIC = "test test test test test test test test test test test junk";
const findAnvil = (): string | null => {
  const candidates = [process.env.ANVIL_BIN, resolve(homedir(), ".foundry/bin/anvil"), "anvil"].filter(Boolean) as string[];
  return candidates.find((candidate) => spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0) ?? null;
};
const anvilBin = findAnvil();
const haveArtifacts = existsSync(resolve(OUT, "JobManager.sol/JobManager.json"));
const hasPostgres = Boolean(process.env.DATABASE_URL);
const skipReason = !anvilBin ? "anvil not installed" : !haveArtifacts ? "contracts/out missing (run forge build)" : !hasPostgres ? "DATABASE_URL is not configured" : null;
if (skipReason) console.warn(`[users.evm.integration] SKIPPED: ${skipReason}`);

const key = (index: number) => HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`).privateKey;
const wallet = (index: number) => new EvmWallet(key(index));
const ADMIN = wallet(0);
const BAD_ACTOR = wallet(8);
const publicKey = (privateKey: string) => `0x${SigningKey.computePublicKey(privateKey, false).slice(4)}`;
const tx = (type: "IDENTITY_CREATE" | "WALLET_ACTIVATE", actorWallet: string, actorIdentity: string, payload: Record<string, unknown>) => ({
  txId: `p1-${type}-${Date.now()}-${Math.random()}`,
  type,
  actorWallet,
  actorIdentity,
  payload,
  timestamp: new Date().toISOString(),
  signature: "development",
} as const);

describe.skipIf(skipReason !== null)("Person 1 registration lifecycle on EVM and PostgreSQL", () => {
  let anvil: ChildProcess;
  let provider: JsonRpcProvider;
  let adapter: EvmBlockchainAdapter;
  let container: Container;
  let config: EvmChainConfig;
  const previousBlockchain = process.env.BEL_BLOCKCHAIN;
  const previousEnvironment = process.env.BEL_ENV;
  const adminDid = "DID:BEL:ADMIN";
  const badActorDid = "DID:BEL:P1-BAD-ACTOR";
  const runId = Date.now().toString(36);
  const adminEmployee = `P1-EVM-ADMIN-${runId}`;
  const badActorEmployee = `P1-EVM-BAD-${runId}`;
  const targetEmployee = `P1-EVM-TARGET-${runId}`;
  const targetDevice = `P1-EVM-DEVICE-${runId}`;
  const badActorDevice = `P1-EVM-BAD-DEVICE-${runId}`;
  const targetIdentityIds: string[] = [];
  const targetEmployeeIds: string[] = [];
  const targetDeviceIds: string[] = [];

  async function mined(hash: string): Promise<void> {
    if (!(await waitForReceipt(provider, hash, 1, 20_000, 25))) throw new Error(`transaction ${hash} was not confirmed`);
  }

  async function deployContracts(port: number): Promise<EvmChainConfig> {
    const deployer = new NonceManager(new EvmWallet(key(0), provider));
    const artifact = (name: string) => JSON.parse(readFileSync(resolve(OUT, `${name}.sol/${name}.json`), "utf8"));
    const deploy = async (name: string, ...args: unknown[]) => {
      const a = artifact(name);
      const contract = await new ContractFactory(a.abi, a.bytecode.object, deployer).deploy(...args);
      await mined(contract.deploymentTransaction()!.hash);
      return contract;
    };
    const identity = await deploy("IdentityRegistry", ADMIN.address, adminDid);
    const roles = await deploy("RoleRegistry", await identity.getAddress(), ADMIN.address);
    const assets = await deploy("AssetRegistry");
    const jobs = await deploy("JobManager", await assets.getAddress());
    const addresses = await Promise.all([identity, roles, assets, jobs].map((contract) => contract.getAddress()));
    const audit = await deploy("AuditRegistry", addresses[0], addresses[1], addresses);
    const auditAddress = await audit.getAddress();
    for (const contract of [identity, roles, assets, jobs]) await mined((await contract.getFunction("wire")(addresses[0], addresses[1], auditAddress)).hash);
    return {
      rpcUrl: `http://127.0.0.1:${port}`,
      deployment: { network: "p1-vitest", chainId: 31337, contracts: { IdentityRegistry: addresses[0], RoleRegistry: addresses[1], AssetRegistry: addresses[2], JobManager: addresses[3], AuditRegistry: auditAddress, ValidatorRegistry: auditAddress } },
      abis: loadAbis(), confirmations: 1, txTimeoutMs: 20_000, pollingIntervalMs: 25,
      devSignerKeys: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(key),
    };
  }

  async function createPendingRegistration(index = 9, employeeId = targetEmployee, deviceId = targetDevice): Promise<{ identityId: string; walletAddress: string }> {
    const targetWallet = wallet(index);
    const challenge = await container.users.requestProvisioningChallenge({ deviceId, deviceMetadata: { managedDevice: true, onBelNetwork: true } });
    const digest = hashMessage(challenge.challenge);
    const signature = new SigningKey(key(index)).sign(digest);
    const compactSignature = `0x${signature.yParity}${signature.r.slice(2)}${signature.s.slice(2)}`;
    const pending = await container.users.initializeAccount({
      fullName: "P1 EVM Target", employeeId, department: "ENGINEERING", deviceId,
      publicKey: publicKey(key(index)), walletAddress: targetWallet.address, challengeId: challenge.challengeId, signature: compactSignature,
      deviceMetadata: { managedDevice: true, onBelNetwork: true },
    });
    targetIdentityIds.push(pending.identity.identityId);
    targetEmployeeIds.push(employeeId);
    targetDeviceIds.push(deviceId);
    await container.users.verifyRegistration(adminDid, pending.identity.identityId, { employeeId, department: "ENGINEERING" });
    await container.users.assignRole(adminDid, pending.identity.identityId, "ENGINEER");
    return { identityId: pending.identity.identityId, walletAddress: targetWallet.address };
  }

  beforeAll(async () => {
    const port = 19545 + Math.floor(Math.random() * 1000);
    anvil = spawn(anvilBin!, ["--port", String(port), "--silent"], { stdio: "ignore" });
    provider = new JsonRpcProvider(`http://127.0.0.1:${port}`, 31337, { staticNetwork: true, pollingInterval: 50 });
    for (let attempt = 0; ; attempt++) {
      try { await provider.send("eth_chainId", []); break; }
      catch { if (attempt > 50) throw new Error("anvil did not start"); await new Promise((resolveDelay) => setTimeout(resolveDelay, 100)); }
    }
    config = await deployContracts(port);
    adapter = new EvmBlockchainAdapter(config, { provider });
    process.env.BEL_BLOCKCHAIN = "evm";
    process.env.BEL_ENV = "development";
    container = createContainer(adapter, {
      integrity: new MemoryIntegrityAdapter(),
      attestation: new MockDeviceAttestationAdapter([
        targetDevice,
        `${targetDevice}-FAIL`,
        `${targetDevice}-REVOKE`,
        `${targetDevice}-REVOKE-FAIL`,
      ]),
    });
    await container.prisma!.$connect();

    await container.users.createUser({ employeeId: adminEmployee, identityId: adminDid, fullName: "P1 EVM Admin", role: "ADMIN", department: "PLATFORM" });
    await container.users.registerDevice(adminEmployee, `P1-EVM-ADMIN-DEVICE-${runId}`, "p1-evm-admin-credential", publicKey(key(0)));
    await container.users.registerWallet(adminEmployee, `P1-EVM-ADMIN-DEVICE-${runId}`, ADMIN.address);
    await container.users.activateWallet(adminEmployee, `P1-EVM-ADMIN-DEVICE-${runId}`, ADMIN.address);
  }, 90_000);

  afterAll(async () => {
    if (container?.prisma) {
      const identityIds = [adminDid, badActorDid, ...targetIdentityIds];
      const employeeIds = [adminEmployee, badActorEmployee, ...targetEmployeeIds];
      const deviceIds = [`P1-EVM-ADMIN-DEVICE-${runId}`, badActorDevice, ...targetDeviceIds];
      await container.prisma.session.deleteMany({ where: { identityId: { in: identityIds } } });
      await container.prisma.credential.deleteMany({ where: { deviceId: { in: deviceIds } } });
      await container.prisma.wallet.deleteMany({ where: { identityId: { in: identityIds } } });
      await container.prisma.device.deleteMany({ where: { deviceId: { in: deviceIds } } });
      await container.prisma.user.deleteMany({ where: { employeeId: { in: employeeIds } } });
      await container.prisma.identity.deleteMany({ where: { identityId: { in: identityIds } } });
      await container.prisma.$disconnect();
    }
    anvil?.kill();
    if (previousBlockchain === undefined) delete process.env.BEL_BLOCKCHAIN;
    else process.env.BEL_BLOCKCHAIN = previousBlockchain;
    if (previousEnvironment === undefined) delete process.env.BEL_ENV;
    else process.env.BEL_ENV = previousEnvironment;
  });

  it("confirms IDENTITY_CREATE -> ROLE_ASSIGN -> WALLET_ACTIVATE before PostgreSQL ACTIVE", async () => {
    const pending = await createPendingRegistration(9, targetEmployee, targetDevice);
    expect(await container.users.getIdentity(pending.identityId)).toMatchObject({ status: "PENDING", role: "ENGINEER" });
    expect((await container.users.listWallets(pending.identityId))[0]).toMatchObject({ status: "PENDING", address: pending.walletAddress });

    const activated = await container.users.activateRegistration(adminDid, pending.identityId);
    expect(activated.identity.status).toBe("ACTIVE");
    expect(activated.device.status).toBe("ACTIVE");
    expect(activated.wallet.status).toBe("ACTIVE");
    expect(await container.users.getById(pending.identityId)).toMatchObject({ status: "ACTIVE", role: "ENGINEER", walletAddress: pending.walletAddress });

    const onChainIdentity = new Contract(config.deployment.contracts.IdentityRegistry, config.abis.IdentityRegistry, provider);
    const onChainRoles = new Contract(config.deployment.contracts.RoleRegistry, config.abis.RoleRegistry, provider);
    expect(await onChainIdentity.identityOf(pending.walletAddress)).toBe(pending.identityId);
    expect(await onChainIdentity.isActiveWallet(pending.walletAddress)).toBe(true);
    expect(await onChainRoles.hasRole(pending.walletAddress, 2)).toBe(true); // ENGINEER, shared ROLES index 2
  }, 45_000);

  it("confirms WALLET_REVOKE on-chain before revoking the device and wallet in PostgreSQL", async () => {
    const pending = await createPendingRegistration(6, `${targetEmployee}-REVOKE`, `${targetDevice}-REVOKE`);
    await container.users.activateRegistration(adminDid, pending.identityId);

    await container.users.revokeDevice(`${targetDevice}-REVOKE`, adminDid);

    expect((await container.users.listDevices(pending.identityId))[0]).toMatchObject({ status: "REVOKED" });
    expect((await container.users.listWallets(pending.identityId))[0]).toMatchObject({ address: pending.walletAddress, status: "REVOKED", revokedReason: "Device revoked" });
    expect(await adapter.getWallet(pending.walletAddress)).toMatchObject({ address: pending.walletAddress, status: "REVOKED" });

    const onChainIdentity = new Contract(config.deployment.contracts.IdentityRegistry, config.abis.IdentityRegistry, provider);
    expect(await onChainIdentity.identityOf(pending.walletAddress)).toBe(pending.identityId);
    expect(await onChainIdentity.isActiveWallet(pending.walletAddress)).toBe(false);
  }, 45_000);

  it("leaves PostgreSQL pending when an unauthorized blockchain actor fails activation", async () => {
    await adapter.submitTransaction(tx("IDENTITY_CREATE", ADMIN.address, adminDid, { identityId: badActorDid, walletAddress: BAD_ACTOR.address }));
    await adapter.submitTransaction(tx("WALLET_ACTIVATE", ADMIN.address, adminDid, { address: BAD_ACTOR.address }));
    await container.repositories.identities.save({ identityId: badActorDid, employeeId: badActorEmployee, fullName: "Bad Actor", role: "ADMIN", department: "TEST", status: "ACTIVE", createdAt: new Date().toISOString(), verifiedAt: null, verifiedBy: null });
    await container.repositories.users.save({ employeeId: badActorEmployee, identityId: badActorDid, walletAddress: BAD_ACTOR.address, role: "ADMIN", department: "TEST", status: "ACTIVE" });
    await container.repositories.devices.save({ deviceId: badActorDevice, identityId: badActorDid, status: "ACTIVE", registeredAt: new Date().toISOString(), activatedAt: new Date().toISOString(), revokedAt: null, publicKey: publicKey(key(8)), metadata: null });
    await container.repositories.wallets.save({ address: BAD_ACTOR.address, identityId: badActorDid, deviceId: badActorDevice, status: "ACTIVE", activatedAt: new Date().toISOString(), revokedAt: null, revokedReason: null, publicKey: publicKey(key(8)) });

    const pending = await createPendingRegistration(7, `${targetEmployee}-FAIL`, `${targetDevice}-FAIL`);
    await expect(container.users.activateRegistration(badActorDid, pending.identityId)).rejects.toBeInstanceOf(BlockchainError);
    expect(await container.users.getIdentity(pending.identityId)).toMatchObject({ status: "PENDING", role: "ENGINEER" });
    expect((await container.users.listWallets(pending.identityId))[0].status).toBe("PENDING");

    // The same real unauthorized actor must not be able to revoke an active
    // wallet. The adapter returns the contract rejection and PostgreSQL stays
    // ACTIVE because revokeDevice submits before persisting local state.
    const active = await createPendingRegistration(5, `${targetEmployee}-REVOKE-FAIL`, `${targetDevice}-REVOKE-FAIL`);
    await container.users.activateRegistration(adminDid, active.identityId);
    await expect(container.users.revokeDevice(`${targetDevice}-REVOKE-FAIL`, badActorDid)).rejects.toMatchObject({ kind: "REVERTED" });
    expect((await container.users.listDevices(active.identityId))[0].status).toBe("ACTIVE");
    expect((await container.users.listWallets(active.identityId))[0]).toMatchObject({ address: active.walletAddress, status: "ACTIVE" });
    expect(await adapter.getWallet(active.walletAddress)).toMatchObject({ address: active.walletAddress, status: "ACTIVE" });
  }, 45_000);
});
