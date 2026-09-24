import { afterEach, describe, expect, it } from "vitest";
import { createContainer } from "../src/container";
import { MemoryAssetRepository, MemoryJobRepository, PrismaAssetRepository, PrismaJobRepository } from "../src/domain/repositories";
import { MemoryEvidenceRepository } from "../src/evidence/evidence.repository";
import { createMemoryRepositories } from "../src/users/repository-implementations";
import { MockBlockchainAdapter } from "../../mocks/mock-blockchain";

const originalIntegration = process.env.BEL_RUN_INTEGRATION;
const originalDatabase = process.env.DATABASE_URL;

afterEach(() => {
  if (originalIntegration === undefined) delete process.env.BEL_RUN_INTEGRATION;
  else process.env.BEL_RUN_INTEGRATION = originalIntegration;
  if (originalDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabase;
});

describe("domain repository selection", () => {
  it("uses PostgreSQL repositories in integration mode with DATABASE_URL", () => {
    process.env.BEL_RUN_INTEGRATION = "true";
    process.env.DATABASE_URL = originalDatabase ?? "postgresql://bel:bel@localhost:5432/bel";
    const container = createContainer(new MockBlockchainAdapter());
    expect(container.assetRepository).toBeInstanceOf(PrismaAssetRepository);
    expect(container.jobRepository).toBeInstanceOf(PrismaJobRepository);
  });

  it("keeps lightweight containers on memory repositories", () => {
    delete process.env.BEL_RUN_INTEGRATION;
    delete process.env.DATABASE_URL;
    const container = createContainer(new MockBlockchainAdapter());
    expect(container.assetRepository).toBeInstanceOf(MemoryAssetRepository);
    expect(container.jobRepository).toBeInstanceOf(MemoryJobRepository);
  });

  it("keeps explicitly injected memory repositories isolated during the verification run", () => {
    process.env.BEL_RUN_INTEGRATION = "true";
    process.env.DATABASE_URL = originalDatabase ?? "postgresql://bel:bel@localhost:5432/bel";
    const container = createContainer(new MockBlockchainAdapter(), { repositories: createMemoryRepositories() });
    expect(container.prisma).toBeUndefined();
    expect(container.assetRepository).toBeInstanceOf(MemoryAssetRepository);
    expect(container.jobRepository).toBeInstanceOf(MemoryJobRepository);
    expect(container.evidenceRepository).toBeInstanceOf(MemoryEvidenceRepository);
  });
});
