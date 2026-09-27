// Person 1 integration: real UsersService -> EVM adapter -> customized Besu
// -> Solidity -> PostgreSQL lifecycle. Ordinary unit runs skip this suite;
// the mandatory integration workflow supplies the live Besu endpoint.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { JsonRpcProvider, SigningKey, Wallet as EvmWallet, Contract, hashMessage } from "ethers";
import { createContainer, type Container } from "../src/container";
import { EvmBlockchainAdapter, loadChainConfigFromEnv, type EvmChainConfig } from "../src/blockchain";
import { BlockchainError } from "../src/blockchain/errors";
import { MemoryIntegrityAdapter } from "../src/integrity/integrity";
import { MockDeviceAttestationAdapter } from "../src/devices/device-attestation";

const configuredRpcUrl = process.env.BEL_EVM_RPC_URL?.trim() || process.env.BEL_CHAIN_RPC_URL?.trim();
const hasPostgres = Boolean(process.env.DATABASE_URL);
const configuredKeys = (process.env.BEL_E2E_PRIVATE_KEYS ?? process.env.BEL_CHAIN_DEV_SIGNER_KEYS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const integrationRun = process.env.BEL_RUN_INTEGRATION === "true";

describe.skipIf(!integrationRun)("Person 1 registration lifecycle on customized Besu and PostgreSQL", () => {
  vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });
  const key = (index: number) => configuredKeys[index];
  const wallet = (index: number) => new EvmWallet(key(index));
  // Keep the integration identities/wallets disjoint from the repository's
  // long-lived bootstrap admin and from each other. This suite cleans up its
  // own rows, but must not collide with the real E2E bootstrap account.
  // The Besu deployment/bootstrap script funds and authorizes account 0 as the
  // real bootstrap admin. This suite must use that same live identity rather
  // than inventing an Anvil-only administrator.
  const ADMIN = wallet(0);
  const BAD_ACTOR = wallet(10);
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
  let provider: JsonRpcProvider;
  let adapter: EvmBlockchainAdapter;
  let container: Container;
  let config: EvmChainConfig;
  const previousBlockchain = process.env.BEL_BLOCKCHAIN;
  const previousEnvironment = process.env.BEL_ENV;
  const badActorDid = "DID:BEL:P1-BAD-ACTOR";
  const runId = Date.now().toString(36);
  const adminDid = process.env.BEL_BOOTSTRAP_ADMIN_DID || "DID:BEL:ADMIN";
  const adminEmployee = process.env.BEL_E2E_ADMIN_EMPLOYEE_ID || "ADMIN-001";
  const badActorEmployee = `P1-EVM-BAD-${runId}`;
  const targetEmployee = `P1-EVM-TARGET-${runId}`;
  const targetDevice = `P1-EVM-DEVICE-${runId}`;
  const badActorDevice = `P1-EVM-BAD-DEVICE-${runId}`;
  const targetIdentityIds: string[] = [];
  const targetEmployeeIds: string[] = [];
  const targetDeviceIds: string[] = [];

  async function createPendingRegistration(index: number, employeeId: string, deviceId: string): Promise<{ identityId: string; walletAddress: string }> {
    const targetWallet = wallet(index);
    const challenge = await container.users.requestProvisioningChallenge({ deviceId, deviceMetadata: { managedDevice: true, onBelNetwork: true } });
    const digest = hashMessage(challenge.challenge);
    const signature = new SigningKey(key(index)).sign(digest);
    const compactSignature = `0x${signature.yParity.toString(16).padStart(2, "0")}${signature.r.slice(2)}${signature.s.slice(2)}`;
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
    if (!configuredRpcUrl) throw new Error("BEL_EVM_RPC_URL/BEL_CHAIN_RPC_URL is required for the Besu integration suite");
    if (!hasPostgres) throw new Error("DATABASE_URL is required for the PostgreSQL integration suite");
    if (configuredKeys.length < 15) throw new Error("BEL_E2E_PRIVATE_KEYS/BEL_CHAIN_DEV_SIGNER_KEYS must contain at least fifteen Besu-funded keys");
    const rpcUrl = configuredRpcUrl;
    config = loadChainConfigFromEnv({ ...process.env, BEL_BLOCKCHAIN: "evm", BEL_CHAIN_RPC_URL: rpcUrl, BEL_CHAIN_DEPLOYMENT: process.env.BEL_CHAIN_DEPLOYMENT || "besu-prototype", BEL_CHAIN_DEV_SIGNER_KEYS: configuredKeys.join(",") });
    provider = new JsonRpcProvider(rpcUrl, config.deployment.chainId, { staticNetwork: true, pollingInterval: 50 });
    for (let attempt = 0; ; attempt++) {
      try {
        const chainId = await provider.send("eth_chainId", []);
        if (BigInt(chainId) !== BigInt(config.deployment.chainId)) throw new Error(`RPC chain id ${chainId} does not match deployment ${config.deployment.chainId}`);
        const client = await provider.send("web3_clientVersion", []);
        if (!String(client).toLowerCase().includes("besu")) throw new Error(`expected Besu RPC client, got ${client}`);
        break;
      }
      catch (error) { if (attempt > 50) throw new Error(`Besu did not start: ${String(error)}`); await new Promise((resolveDelay) => setTimeout(resolveDelay, 100)); }
    }
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

    const bootstrapAdmin = await container.users.getById(adminEmployee);
    if (!bootstrapAdmin) throw new Error("Bootstrap admin is missing; run scripts/bootstrap-dev.ts against this Besu deployment before the users integration suite");
    if (bootstrapAdmin.identityId !== adminDid || bootstrapAdmin.walletAddress.toLowerCase() !== ADMIN.address.toLowerCase()) {
      throw new Error(`Bootstrap admin does not match the current Besu deployment: database=${bootstrapAdmin.identityId}/${bootstrapAdmin.walletAddress}, expected=${adminDid}/${ADMIN.address}`);
    }
  }, 90_000);

  afterAll(async () => {
    if (container?.prisma) {
      const identityIds = [badActorDid, ...targetIdentityIds];
      const employeeIds = [badActorEmployee, ...targetEmployeeIds];
      const deviceIds = [`P1-EVM-ADMIN-DEVICE-${runId}`, badActorDevice, ...targetDeviceIds];
      await container.prisma.session.deleteMany({ where: { identityId: { in: identityIds } } });
      await container.prisma.credential.deleteMany({ where: { deviceId: { in: deviceIds } } });
      await container.prisma.wallet.deleteMany({ where: { identityId: { in: identityIds } } });
      await container.prisma.device.deleteMany({ where: { deviceId: { in: deviceIds } } });
      await container.prisma.user.deleteMany({ where: { OR: [{ employeeId: { in: employeeIds } }, { identityId: { in: identityIds } }] } });
      await container.prisma.identity.deleteMany({ where: { identityId: { in: identityIds } } });
      await container.prisma.$disconnect();
    }
    if (previousBlockchain === undefined) delete process.env.BEL_BLOCKCHAIN;
    else process.env.BEL_BLOCKCHAIN = previousBlockchain;
    if (previousEnvironment === undefined) delete process.env.BEL_ENV;
    else process.env.BEL_ENV = previousEnvironment;
  });

  it("confirms IDENTITY_CREATE -> ROLE_ASSIGN -> WALLET_ACTIVATE before PostgreSQL ACTIVE", async () => {
    const pending = await createPendingRegistration(11, targetEmployee, targetDevice);
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
    const pending = await createPendingRegistration(12, `${targetEmployee}-REVOKE`, `${targetDevice}-REVOKE`);
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
    await container.repositories.devices.save({ deviceId: badActorDevice, identityId: badActorDid, status: "ACTIVE", registeredAt: new Date().toISOString(), activatedAt: new Date().toISOString(), revokedAt: null, publicKey: publicKey(key(10)), metadata: null });
    await container.repositories.wallets.save({ address: BAD_ACTOR.address, identityId: badActorDid, deviceId: badActorDevice, status: "ACTIVE", activatedAt: new Date().toISOString(), revokedAt: null, revokedReason: null, publicKey: publicKey(key(10)) });

    const pending = await createPendingRegistration(13, `${targetEmployee}-FAIL`, `${targetDevice}-FAIL`);
    await expect(container.users.activateRegistration(badActorDid, pending.identityId)).rejects.toBeInstanceOf(BlockchainError);
    expect(await container.users.getIdentity(pending.identityId)).toMatchObject({ status: "PENDING", role: "ENGINEER" });
    expect((await container.users.listWallets(pending.identityId))[0].status).toBe("PENDING");

    // The same real unauthorized actor must not be able to revoke an active
    // wallet. The adapter returns the contract rejection and PostgreSQL stays
    // ACTIVE because revokeDevice submits before persisting local state.
    const active = await createPendingRegistration(14, `${targetEmployee}-REVOKE-FAIL`, `${targetDevice}-REVOKE-FAIL`);
    await container.users.activateRegistration(adminDid, active.identityId);
    await expect(container.users.revokeDevice(`${targetDevice}-REVOKE-FAIL`, badActorDid)).rejects.toMatchObject({ kind: "REVERTED" });
    expect((await container.users.listDevices(active.identityId))[0].status).toBe("ACTIVE");
    expect((await container.users.listWallets(active.identityId))[0]).toMatchObject({ address: active.walletAddress, status: "ACTIVE" });
    expect(await adapter.getWallet(active.walletAddress)).toMatchObject({ address: active.walletAddress, status: "ACTIVE" });
  }, 45_000);
});
