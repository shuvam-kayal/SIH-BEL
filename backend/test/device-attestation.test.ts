import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { MockBlockchainAdapter } from "../../mocks/mock-blockchain";
import { createContainer } from "../src/container";
import { MemoryIntegrityAdapter } from "../src/integrity/integrity";
import { MockDeviceAttestationAdapter, type DeviceAttestationAdapter, type DeviceAttestationResult } from "../src/devices/device-attestation";
import { clearIdentityStore, identityStore } from "../src/users/identity.store";
import { createMemoryRepositories } from "../src/users/repository-implementations";

const originalEnvironment = { ...process.env };

afterEach(() => {
  clearIdentityStore();
  for (const key of Object.keys(process.env)) if (!(key in originalEnvironment)) delete process.env[key];
  for (const [key, value] of Object.entries(originalEnvironment)) process.env[key] = value;
});

function result(overrides: Partial<DeviceAttestationResult> = {}): DeviceAttestationResult {
  return {
    verified: true,
    managedDevice: true,
    networkApproved: true,
    provider: "test-authoritative-provider",
    deviceId: "ATTEST-DEVICE",
    evidenceId: "evidence-001",
    ...overrides,
  };
}

function provider(attestation: DeviceAttestationResult): DeviceAttestationAdapter {
  return { attest: async () => attestation };
}

describe("managed-device attestation boundary", () => {
  it("rejects a mock adapter in production", () => {
    process.env.BEL_ENV = "production";
    process.env.DATABASE_URL = "postgresql://bel:bel@localhost:5432/bel";
    process.env.BEL_DEVICE_ATTESTATION_PROVIDER = "managed";
    expect(() => createContainer(new MockBlockchainAdapter(), {
      integrity: new MemoryIntegrityAdapter(),
      attestation: new MockDeviceAttestationAdapter(["ATTEST-DEVICE"]),
    })).toThrow(/authoritative device-attestation adapter/);
  });

  it("requires explicit production provider configuration", () => {
    process.env.BEL_ENV = "production";
    process.env.DATABASE_URL = "postgresql://bel:bel@localhost:5432/bel";
    delete process.env.BEL_DEVICE_ATTESTATION_PROVIDER;
    expect(() => createContainer(new MockBlockchainAdapter(), {
      integrity: new MemoryIntegrityAdapter(),
      attestation: provider(result()),
    })).toThrow(/BEL_DEVICE_ATTESTATION_PROVIDER=managed/);
  });

  it("accepts an explicitly injected authoritative provider in production", async () => {
    process.env.BEL_ENV = "production";
    process.env.DATABASE_URL = "postgresql://bel:bel@localhost:5432/bel";
    process.env.BEL_DEVICE_ATTESTATION_PROVIDER = "managed";
    const authoritative = provider(result());
    const container = createContainer(new MockBlockchainAdapter(), {
      integrity: new MemoryIntegrityAdapter(),
      attestation: authoritative,
    });
    expect(container.attestation).toBe(authoritative);
    await container.prisma?.$disconnect();
  });

  it("does not let client managed/network flags bypass failed attestation", async () => {
    const container = createContainer(new MockBlockchainAdapter(), {
      repositories: createMemoryRepositories(identityStore),
      attestation: provider(result({ verified: false, managedDevice: false, networkApproved: false, reason: "provider denied device" })),
    });
    await expect(container.users.requestProvisioningChallenge({
      deviceId: "ATTEST-DEVICE",
      deviceMetadata: { managedDevice: true, onBelNetwork: true, hostname: "BEL-LAPTOP-001", ip: "10.0.0.1" },
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("accepts a valid authoritative result and creates a pending registration", async () => {
    const repositories = createMemoryRepositories(identityStore);
    const container = createContainer(new MockBlockchainAdapter(), { repositories, attestation: provider(result()) });
    const keys = generateKeyPairSync("ed25519");
    const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    const challenge = await container.users.requestProvisioningChallenge({ deviceId: "ATTEST-DEVICE", deviceMetadata: { managedDevice: false, onBelNetwork: false } });
    const registration = await container.users.initializeAccount({
      fullName: "Attested Employee",
      employeeId: "ATTEST-EMPLOYEE",
      department: "ENGINEERING",
      deviceId: "ATTEST-DEVICE",
      publicKey,
      walletAddress: "0xATTEST-WALLET",
      challengeId: challenge.challengeId,
      signature: sign(null, Buffer.from(challenge.challenge), keys.privateKey).toString("base64"),
      deviceMetadata: { managedDevice: false, onBelNetwork: false },
    });
    expect(registration.identity.status).toBe("PENDING");
    expect(registration.device.metadata).toMatchObject({ managedDevice: true, networkApproved: true });
  });

  it.each([
    ["unverified", { verified: false }],
    ["unmanaged", { managedDevice: false }],
    ["network denied", { networkApproved: false }],
  ])("blocks provisioning when the provider result is %s", async (_label, flags) => {
    const container = createContainer(new MockBlockchainAdapter(), {
      repositories: createMemoryRepositories(identityStore),
      attestation: provider(result(flags)),
    });
    await expect(container.users.requestProvisioningChallenge({ deviceId: "ATTEST-DEVICE", deviceMetadata: {} }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
