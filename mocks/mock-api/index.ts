import type {
  ApiClient,
  AssignJobRequest,
  AssignRoleRequest,
  ActivateWalletRequest,
  BlockchainStatus,
  CommitteeResponse,
  CompleteJobRequest,
  CreateAssetRequest,
  CreateJobRequest,
  CreateUserRequest,
  CreateUserResponse,
  InitializeAccountRequest,
  LoginProofRequest,
  PendingRegistration,
  ProvisioningChallengeRequest,
  RegisterDeviceRequest,
  RegisterWalletRequest,
  RejectJobRequest,
  Session,
  TransferAssetRequest,
  VerifyRegistrationRequest,
  WalletActionResponse
} from "../../shared/api";

import type {
  AuditEvent,
  Asset,
  Device,
  Identity,
  Job,
  PendingIdentity,
  ProvisioningChallenge,
  User,
  Validator,
  Wallet
} from "../../shared/types";

const now = () => new Date().toISOString();

const seedIdentity: Identity = {
  identityId: "DID:BEL:001",
  employeeId: "EMP001",
  fullName: "Demo Engineer",
  role: "ENGINEER",
  department: "MAINTENANCE",
  status: "ACTIVE",
  createdAt: now()
};

const seedWallet: Wallet = {
  address: "0xMockWallet001",
  identityId: seedIdentity.identityId,
  deviceId: "BEL-DEV-001",
  status: "ACTIVE",
  activatedAt: now(),
  revokedAt: null,
  revokedReason: null
};

const seedUser: User = {
  employeeId: seedIdentity.employeeId,
  identityId: seedIdentity.identityId,
  walletAddress: seedWallet.address,
  role: seedIdentity.role,
  department: seedIdentity.department,
  status: seedIdentity.status
};

const adminIdentity: Identity = {
  identityId: "DID:BEL:002",
  employeeId: "EMP002",
  fullName: "Demo Admin",
  role: "ADMIN",
  department: "ADMINISTRATION",
  status: "ACTIVE",
  createdAt: now()
};

const adminWallet: Wallet = {
  address: "0xMockWallet002",
  identityId: adminIdentity.identityId,
  deviceId: "BEL-DEV-002",
  status: "ACTIVE",
  activatedAt: now(),
  revokedAt: null,
  revokedReason: null
};

const adminUser: User = {
  employeeId: adminIdentity.employeeId,
  identityId: adminIdentity.identityId,
  walletAddress: adminWallet.address,
  role: adminIdentity.role,
  department: adminIdentity.department,
  status: adminIdentity.status
};

let identities: Array<Identity | PendingIdentity> = [
  seedIdentity,
  adminIdentity
];

let devices: Device[] = [
  {
    deviceId: seedWallet.deviceId,
    identityId: seedIdentity.identityId,
    publicKey: "mock-public-key",
    status: "ACTIVE",
    registeredAt: now(),
    revokedAt: null
  },
  {
    deviceId: adminWallet.deviceId,
    identityId: adminIdentity.identityId,
    publicKey: "mock-admin-public-key",
    status: "ACTIVE",
    registeredAt: now(),
    revokedAt: null
  }
];

let wallets: Wallet[] = [
  seedWallet,
  adminWallet
];

let users: User[] = [
  seedUser,
  adminUser
];

let challenges: ProvisioningChallenge[] = [];

let assets: Asset[] = [
  {
    assetId: "AST-001",
    nftId: "1",
    assetType: "AIRCRAFT_PART",
    ownerId: seedIdentity.identityId,
    custodianId: seedIdentity.identityId,
    parentAssetId: null,
    status: "ACTIVE"
  }
];

let jobs: Job[] = [
  {
    jobId: "JOB-001",
    assetId: "AST-001",
    createdBy: seedIdentity.identityId,
    assignedTo: seedIdentity.identityId,
    verifierId: null,
    status: "CREATED",
    priority: "MEDIUM",
    createdAt: now(),
    completedAt: null
  }
];

const STORAGE_KEY = "bel-mock-api-state-v1";

type PersistedState = {
  identities: Array<Identity | PendingIdentity>;
  devices: Device[];
  wallets: Wallet[];
  users: User[];
  challenges: ProvisioningChallenge[];
  assets: Asset[];
  jobs: Job[];
};

const getStorage = (): Storage | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const saveState = () => {
  const storage = getStorage();
  if (!storage) return;

  const state: PersistedState = {
    identities,
    devices,
    wallets,
    users,
    challenges,
    assets,
    jobs
  };

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors; the mock API can still work in memory.
  }
};

const loadState = () => {
  const storage = getStorage();
  if (!storage) return;

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return;

    const saved = JSON.parse(raw) as Partial<PersistedState>;

    if (Array.isArray(saved.identities)) identities = saved.identities;
    if (Array.isArray(saved.devices)) devices = saved.devices;
    if (Array.isArray(saved.wallets)) wallets = saved.wallets;
    if (Array.isArray(saved.users)) users = saved.users;
    if (Array.isArray(saved.challenges)) challenges = saved.challenges;
    if (Array.isArray(saved.assets)) assets = saved.assets;
    if (Array.isArray(saved.jobs)) jobs = saved.jobs;
  } catch {
    // Invalid saved data is ignored and seed data is used.
  }
};

loadState();

const auditLog: Record<string, AuditEvent[]> = {
  "AST-001": [
    {
      eventId: "AUDIT-001",
      txId: "TX-001",
      entityType: "ASSET",
      entityId: "AST-001",
      action: "ASSET_REGISTERED",
      actorIdentityId: "DID:BEL:001",
      timestamp: now()
    },
    {
      eventId: "AUDIT-002",
      txId: "TX-002",
      entityType: "ASSET",
      entityId: "AST-001",
      action: "ASSET_VERIFIED",
      actorIdentityId: "DID:BEL:001",
      timestamp: now()
    }
  ]
};

const validators: Validator[] = [0, 1, 2, 3].map((i) => ({
  validatorId: `val_${i}`,
  publicKey: `0xMockPubKey${i}`,
  status: "ACTIVE",
  joinedAt: now()
}));

const requireUser = (id: string) => {
  const user = users.find(
    (u) => u.employeeId === id || u.identityId === id
  );

  if (!user) {
    throw new Error(`User ${id} not found`);
  }

  return user;
};

const requireJob = (id: string) => {
  const job = jobs.find((j) => j.jobId === id);

  if (!job) {
    throw new Error(`Job ${id} not found`);
  }

  return job;
};

const challenge = (
  deviceId: string,
  purpose: ProvisioningChallenge["purpose"]
): ProvisioningChallenge => {
  const value = {
    challengeId: `mock-${purpose}-${deviceId}`,
    deviceId,
    purpose,
    challenge: `challenge-${deviceId}`,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    usedAt: null
  };

  challenges = [
    ...challenges.filter(
      (c) => c.challengeId !== value.challengeId
    ),
    value
  ];

  saveState();

  return value;
};

const registration = (
  identityId: string
): PendingRegistration => {
  const identity = identities.find(
    (i) => i.identityId === identityId
  );

  const device = devices.find(
    (d) => d.identityId === identityId
  );

  const wallet = wallets.find(
    (w) => w.identityId === identityId
  );

  if (!identity || !device || !wallet) {
    throw new Error(`Registration ${identityId} not found`);
  }

  return {
    identity,
    device,
    wallet
  };
};

export const mockApi: ApiClient & {
  login(): Promise<Session>;
  loginWithEmployeeId(employeeId: string): Promise<Session>;
} = {

  async requestProvisioningChallenge(input: ProvisioningChallengeRequest) {
    return challenge(
      input.deviceId,
      "WALLET_INITIALIZATION"
    );
  },

  async initializeAccount(input: InitializeAccountRequest) {
    const identity: PendingIdentity = {
      identityId: `DID:BEL:P${identities.length + 1}`,
      employeeId: input.employeeId ?? null,
      fullName: input.fullName,
      role: null,
      department: input.department ?? null,
      status: "PENDING",
      createdAt: now()
    };

    devices = [
      ...devices,
      {
        deviceId: input.deviceId,
        identityId: identity.identityId,
        publicKey: input.publicKey,
        metadata: input.deviceMetadata,
        status: "PENDING",
        registeredAt: now(),
        revokedAt: null
      }
    ];

    wallets = [
      ...wallets,
      {
        address: input.walletAddress,
        identityId: identity.identityId,
        deviceId: input.deviceId,
        publicKey: input.publicKey,
        status: "PENDING",
        activatedAt: null,
        revokedAt: null,
        revokedReason: null
      }
    ];

    identities = [...identities, identity];

    saveState();

    return registration(identity.identityId);
  },

  async requestAuthenticationChallenge(deviceId: string) {
    return challenge(deviceId, "AUTHENTICATION");
  },

  async login(
    input: string | LoginProofRequest = "mock-device-credential"
  ) {
    const device =
      typeof input === "string"
        ? undefined
        : devices.find(
            (d) =>
              d.deviceId === input.deviceId &&
              d.publicKey === input.publicKey &&
              d.status === "ACTIVE"
          );

    if (typeof input !== "string" && !device) {
      throw new Error("Invalid device proof");
    }

    const user = device
      ? users.find(
          (candidate) =>
            candidate.identityId === device.identityId
        ) ?? seedUser
      : seedUser;

    return {
      user: { ...user },
      token: "mock-session-token"
    };
  },

  async loginWithEmployeeId(employeeId: string) {
    const user = users.find(
      (u) => u.employeeId === employeeId
    );

    if (!user) {
      throw new Error(
        `Employee ID ${employeeId} not found`
      );
    }

    return {
      user: { ...user },
      token: "mock-session-token"
    };
  },

  async getPendingRegistrations() {
    return identities
      .filter((i) => i.status === "PENDING")
      .map((i) => registration(i.identityId));
  },

  async verifyRegistration(
    id: string,
    input: VerifyRegistrationRequest
  ) {
    const identity = identities.find(
      (i) => i.identityId === id
    );

    if (!identity) {
      throw new Error(`Identity ${id} not found`);
    }

    identity.employeeId = input.employeeId;
    identity.department = input.department;

    saveState();

    return identity;
  },

  async assignRole(
    id: string,
    input: AssignRoleRequest
  ) {
    const identity = identities.find(
      (i) => i.identityId === id
    );

    if (
      !identity ||
      !identity.employeeId ||
      !identity.department
    ) {
      throw new Error(`Identity ${id} is not verified`);
    }

    identity.role = input.role;

    const user: User = {
      employeeId: identity.employeeId,
      identityId: id,
      walletAddress:
        wallets.find(
          (w) => w.identityId === id
        )?.address ?? "",
      role: input.role,
      department: identity.department,
      status: identity.status
    };

    users = [
      ...users.filter((u) => u.identityId !== id),
      user
    ];

    saveState();

    return user;
  },

  async activateRegistration(id: string) {
    const identity = identities.find(
      (i) => i.identityId === id
    );

    const device = devices.find(
      (d) => d.identityId === id
    );

    const wallet = wallets.find(
      (w) => w.identityId === id
    );

    if (
      !identity ||
      !device ||
      !wallet ||
      !identity.employeeId ||
      !identity.department ||
      !identity.role
    ) {
      throw new Error(
        `Registration ${id} is incomplete`
      );
    }

    identity.status = "ACTIVE";
    device.status = "ACTIVE";
    wallet.status = "ACTIVE";
    wallet.activatedAt = now();

    const user: User = {
      employeeId: identity.employeeId,
      identityId: id,
      walletAddress: wallet.address,
      role: identity.role,
      department: identity.department,
      status: "ACTIVE"
    };

    users = [
      ...users.filter((u) => u.identityId !== id),
      user
    ];

    saveState();

    return registration(id);
  },

  async registerDevice(
    userId: string,
    input: RegisterDeviceRequest
  ) {
    const user = requireUser(userId);

    const device: Device = {
      deviceId: input.deviceId,
      identityId: user.identityId,
      publicKey: input.publicKey,
      status: "PENDING",
      registeredAt: now(),
      revokedAt: null
    };

    devices = [...devices, device];

    saveState();

    return device;
  },

  async getDevices(userId: string) {
    const user = requireUser(userId);

    return devices.filter(
      (d) => d.identityId === user.identityId
    );
  },

  async registerWallet(
    userId: string,
    input: RegisterWalletRequest
  ) {
    const user = requireUser(userId);

    const device = devices.find(
      (d) =>
        d.deviceId === input.deviceId &&
        d.identityId === user.identityId &&
        d.status === "ACTIVE"
    );

    if (!device || !input.walletAddress) {
      throw new Error(
        "An active device and existing wallet address are required"
      );
    }

    const wallet: Wallet = {
      address: input.walletAddress,
      identityId: user.identityId,
      deviceId: input.deviceId,
      publicKey: device.publicKey,
      status: "PENDING",
      activatedAt: null,
      revokedAt: null,
      revokedReason: null
    };

    wallets = [...wallets, wallet];

    saveState();

    return wallet;
  },

  async getWallets(userId: string) {
    const user = requireUser(userId);

    return wallets.filter(
      (w) => w.identityId === user.identityId
    );
  },

  async activateWallet(
    userId: string,
    input: ActivateWalletRequest
  ): Promise<WalletActionResponse> {
    const user = requireUser(userId);

    const wallet = wallets.find(
      (w) =>
        w.identityId === user.identityId &&
        w.deviceId === input.deviceId &&
        w.address === input.walletAddress &&
        w.status === "PENDING"
    );

    if (!wallet) {
      throw new Error(
        "Only an existing pending wallet can be activated"
      );
    }

    wallet.status = "ACTIVE";
    wallet.activatedAt = now();
    user.walletAddress = wallet.address;

    saveState();

    return {
      wallet: { ...wallet }
    };
  },

  async revokeWallet(
    userId: string,
    reason: string
  ) {
    const user = requireUser(userId);

    const wallet = wallets.find(
      (w) =>
        w.identityId === user.identityId &&
        w.address === user.walletAddress
    );

    if (!wallet) {
      throw new Error("Wallet not found");
    }

    wallet.status = "REVOKED";
    wallet.revokedAt = now();
    wallet.revokedReason = reason;

    saveState();

    return {
      wallet: { ...wallet }
    };
  },

  async revokeDevice(deviceId: string): Promise<Device> {
    const device = devices.find(
      (d) => d.deviceId === deviceId
    );

    if (!device) {
      throw new Error(
        `Device ${deviceId} not found`
      );
    }

    device.status = "REVOKED";
    device.revokedAt = now();

    saveState();

    return { ...device };
  },

  async logout() {
    return undefined;
  },

  // --------------------------------------------------
  // CREATE EMPLOYEE
  // --------------------------------------------------

  async createUser(
    input: CreateUserRequest
  ): Promise<CreateUserResponse> {

    const identity: Identity = {
      identityId: `DID:BEL:${identities.length + 1}`,
      employeeId: input.employeeId,
      fullName: input.fullName,
      role: input.role,
      department: input.department,
      status: "ACTIVE",
      createdAt: now()
    };

    // Create a mock wallet for the new employee
    const wallet: Wallet = {
      address: `0xMockWallet00${identities.length + 1}`,
      identityId: identity.identityId,
      deviceId: `BEL-DEV-00${identities.length + 1}`,
      status: "ACTIVE",
      activatedAt: now(),
      revokedAt: null,
      revokedReason: null
    };

    const user: User = {
      employeeId: identity.employeeId,
      identityId: identity.identityId,
      walletAddress: wallet.address,
      role: identity.role,
      department: identity.department,
      status: identity.status
    };

    identities = [
      ...identities,
      identity
    ];

    users = [
      ...users,
      user
    ];

    wallets = [
      ...wallets,
      wallet
    ];

    saveState();

    return {
      identity,
      user
    };
  },

  async getMe() {
    return { ...seedUser };
  },

  async getUser(id: string) {
    return (
      users.find(
        (u) =>
          u.employeeId === id ||
          u.identityId === id
      ) ?? null
    );
  },

  async getAssets() {
    return assets.map((a) => ({ ...a }));
  },

  async getAsset(id: string) {
    return (
      assets.find(
        (a) => a.assetId === id
      ) ?? null
    );
  },

  async createAsset(
    input: CreateAssetRequest
  ) {
    const asset: Asset = {
      assetId:
        input.assetId ??
        `AST-${assets.length + 1}`,
      nftId: String(assets.length + 1),
      assetType: input.assetType,
      ownerId: input.ownerId,
      custodianId: input.custodianId,
      parentAssetId:
        input.parentAssetId ?? null,
      status: "ACTIVE"
    };

    assets = [
      ...assets,
      asset
    ];

    saveState();

    return asset;
  },

  async transferAsset(
    id: string,
    input: TransferAssetRequest
  ) {
    const asset = assets.find(
      (a) => a.assetId === id
    );

    if (!asset) {
      throw new Error(
        `Asset ${id} not found`
      );
    }

    asset.ownerId = input.newOwnerId;
    asset.custodianId =
      input.newCustodianId ??
      input.newOwnerId;

    saveState();

    return { ...asset };
  },

  async getJobs() {
    return jobs.map((j) => ({ ...j }));
  },

  async getJob(id: string) {
    return (
      jobs.find(
        (j) => j.jobId === id
      ) ?? null
    );
  },

  async createJob(
    input: CreateJobRequest
  ) {
    const job: Job = {
      jobId: `JOB-${jobs.length + 1}`,
      assetId: input.assetId,
      createdBy: seedIdentity.identityId,
      assignedTo: "",
      verifierId:
        input.verifierId ?? null,
      status: "CREATED",
      priority: input.priority,
      createdAt: now(),
      completedAt: null
    };

    jobs = [
      ...jobs,
      job
    ];

    saveState();

    return job;
  },

  async assignJob(
    id: string,
    input: AssignJobRequest
  ) {
    const job = requireJob(id);

    job.assignedTo =
      input.technicianId;

    job.status = "ASSIGNED";

    saveState();

    return { ...job };
  },

  async startJob(id: string) {
    const job = requireJob(id);

    job.status = "IN_PROGRESS";

    saveState();

    return { ...job };
  },

  async completeJob(
    id: string,
    _input: CompleteJobRequest
  ) {
    const job = requireJob(id);

    job.status = "COMPLETED";
    job.completedAt = now();

    saveState();

    return { ...job };
  },

  async approveJob(id: string) {
    const job = requireJob(id);

    job.status = "VERIFIED";

    saveState();

    return { ...job };
  },

  async rejectJob(
    id: string,
    _input: RejectJobRequest
  ) {
    const job = requireJob(id);

    job.status = "REJECTED";

    saveState();

    return { ...job };
  },

  async getAssetAuditTrail(
    assetId: string
  ) {
    return [
      ...(auditLog[assetId] ?? [])
    ];
  },

  async getBlockchainStatus(): Promise<BlockchainStatus> {
    return {
      height: 42,
      healthy: true,
      finalityLag: 0,
      lastFinalizedHeight: 42
    };
  },

  async getValidators() {
    return validators.map(
      (v) => ({ ...v })
    );
  },

  async getCommittee(
    height: number
  ): Promise<CommitteeResponse> {
    return {
      height,
      validatorIds: validators
        .map((v) => v.validatorId)
        .slice(0, 1)
    };
  }
};

export type MockApi = typeof mockApi;