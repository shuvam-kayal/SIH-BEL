// Owner: Person 5. Real BlockchainService backed by the BEL registry
// contracts on an EVM-compatible permissioned chain (Person 4 owns the
// chain/consensus itself; this adapter only talks JSON-RPC).
//
// Signing (ADR-016: private keys stay on the managed device):
//   1. Production path — `tx.signature` is a serialized, signed EVM
//      transaction produced by the device wallet. The adapter verifies that
//      it was signed by `actorWallet`, targets the right contract, carries
//      exactly the calldata this envelope maps to, and is for this chain;
//      only then is it relayed. Devices get the unsigned fields from
//      `prepareTransaction(tx)`.
//   2. Development path — the backend signs with a key from
//      BEL_CHAIN_DEV_SIGNER_KEYS whose address equals `actorWallet`.
//      Refused in production by config.ts.
//
// Every write is simulated first (eth_call) so reverts come back decoded
// without spending gas, then sent and awaited for `confirmations`.

import {
  Contract,
  Interface,
  JsonRpcProvider,
  Transaction as EvmTransaction,
  Wallet as EvmWallet,
  getAddress,
  isAddress,
  type AbstractProvider,
  type Log,
  type TransactionReceipt,
} from "ethers";
import type { BlockchainService, BlockchainStatus, MockBlockchainResult } from "../../../shared/api";
import type { Asset, AuditEvent, Block, Identity, Job, Transaction, Validator, Wallet } from "../../../shared/types";
import { ROLES, type AssetStatus, type AuditEntityType, type JobStatus, type Role, type WalletStatus } from "../../../shared/enums";
import { NotImplementedError } from "../errors";
import { CONTRACT_NAMES, type ContractName, type EvmChainConfig } from "./config";
import { BlockchainError, type DecodedRevert } from "./errors";
import { buildCallPlan, type CallPlan, type ChainLookups } from "./payloads";

/** Validator/committee data comes from Person 4's consensus layer, not from contracts. */
export type ConsensusInfoSource = Pick<BlockchainService, "getValidators" | "getCommittee">;

/**
 * Off-chain fields the chain intentionally does not store (PII, asset type,
 * job priority, device id...). Optional; on-chain values always win for the
 * fields the chain does store.
 */
export interface OffChainMetadataProvider {
  identity?(identityId: string): Promise<Partial<Identity> | null>;
  wallet?(address: string): Promise<Partial<Wallet> | null>;
  asset?(assetId: string): Promise<Partial<Asset> | null>;
  job?(jobId: string): Promise<Partial<Job> | null>;
}

export type EvmAdapterOptions = {
  /** Inject a provider (tests); defaults to a JsonRpcProvider on config.rpcUrl. */
  provider?: AbstractProvider;
  consensus?: ConsensusInfoSource;
  metadata?: OffChainMetadataProvider;
};

export type ChainEvent = { contract: ContractName; name: string; args: Record<string, string | string[]>; logIndex: number };

export type PreparedTransaction = { from: string; to: string; data: string; chainId: number; contract: ContractName; method: string };

export type SubmitResult = MockBlockchainResult & {
  /** EVM transaction hash (absent when rejected in simulation). */
  hash?: string;
  blockNumber?: number;
  events: ChainEvent[];
  /** Present when status is REJECTED. */
  revert?: DecodedRevert;
  /** Convenience: token id from AssetMinted for ASSET_MINT. */
  nftId?: string;
  /** AuditRegistry txIds recorded by this transaction. */
  auditTxIds: string[];
};

const WALLET_STATUS: Record<number, WalletStatus | null> = { 0: null, 1: "PENDING", 2: "ACTIVE", 3: "REVOKED" };
const JOB_STATUS: Record<number, JobStatus | null> = {
  0: null, 1: "CREATED", 2: "ASSIGNED", 3: "IN_PROGRESS", 4: "COMPLETED", 5: "VERIFIED", 6: "REJECTED",
};
const ZERO = "0x0000000000000000000000000000000000000000";

function iso(seconds: bigint | number): string | null {
  const s = Number(seconds);
  return s > 0 ? new Date(s * 1000).toISOString() : null;
}

function plain(v: unknown): string | string[] {
  if (Array.isArray(v)) return v.map((x) => String(plain(x)));
  return typeof v === "bigint" ? v.toString() : String(v);
}

/** Walks an ethers/JSON-RPC error chain looking for revert data. */
export function extractRevertData(err: unknown, depth = 0): string | undefined {
  if (!err || typeof err !== "object" || depth > 6) return undefined;
  const e = err as Record<string, unknown>;
  if (typeof e.data === "string" && /^0x[0-9a-fA-F]*$/.test(e.data)) return e.data;
  for (const key of ["error", "info", "cause", "revert"]) {
    const found = extractRevertData(e[key], depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function isCallException(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "CALL_EXCEPTION";
}

/** Maps a transport-level failure to a BlockchainError. */
export function classifyError(err: unknown, context: string): BlockchainError {
  if (err instanceof BlockchainError) return err;
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  const message = err instanceof Error ? err.message : String(err);
  if (code === "TIMEOUT") return new BlockchainError("TIMEOUT", `${context}: timed out`, undefined, { cause: err });
  return new BlockchainError("NETWORK", `${context}: ${message.split("\n")[0]}`, { code }, { cause: err });
}

/**
 * Polls for a receipt until it has `confirmations` blocks or `timeoutMs`
 * elapses (then returns null). Deliberately not ethers' waitForTransaction:
 * that one checks once and then waits for a *new block* event, so on a chain
 * that only produces blocks on demand (anvil automine, an idle PoA network) a
 * transaction mined between the check and the subscription is never seen.
 */
export async function waitForReceipt(
  provider: Pick<AbstractProvider, "getTransactionReceipt" | "getBlockNumber">,
  hash: string,
  confirmations: number,
  timeoutMs: number,
  intervalMs: number,
): Promise<TransactionReceipt | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const receipt = await provider.getTransactionReceipt(hash);
    if (receipt) {
      if (confirmations <= 1) return receipt;
      const head = await provider.getBlockNumber();
      if (head - receipt.blockNumber + 1 >= confirmations) return receipt;
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(1, deadline - Date.now()))));
  }
}

export class EvmBlockchainAdapter implements BlockchainService {
  readonly provider: AbstractProvider;
  private readonly contracts: Record<ContractName, Contract>;
  private readonly interfaces: Record<ContractName, Interface>;
  private readonly byAddress = new Map<string, ContractName[]>();
  private readonly signers = new Map<string, EvmWallet>();
  /** Per-wallet send queue: nonce lookup + broadcast never interleave for one wallet. */
  private readonly sendQueues = new Map<string, Promise<unknown>>();
  private networkChecked?: Promise<void>;

  constructor(private readonly config: EvmChainConfig, private readonly options: EvmAdapterOptions = {}) {
    this.provider =
      options.provider ??
      new JsonRpcProvider(config.rpcUrl, config.deployment.chainId, {
        staticNetwork: true,
        pollingInterval: config.pollingIntervalMs ?? 1_000,
      });
    this.interfaces = {} as Record<ContractName, Interface>;
    this.contracts = {} as Record<ContractName, Contract>;
    for (const name of CONTRACT_NAMES) {
      const address = config.deployment.contracts[name];
      this.interfaces[name] = new Interface(config.abis[name]);
      this.contracts[name] = new Contract(address, this.interfaces[name], this.provider);
      const key = address.toLowerCase();
      this.byAddress.set(key, [...(this.byAddress.get(key) ?? []), name]);
    }
    for (const key of config.devSignerKeys) {
      const w = new EvmWallet(key, this.provider);
      this.signers.set(w.address.toLowerCase(), w);
    }
  }

  // ------------------------------------------------------------- writes

  async submitTransaction(tx: Transaction): Promise<MockBlockchainResult> {
    const r = await this.submitTransactionDetailed(tx);
    const validatorEvent = r.events.find((event) => event.contract === "ValidatorRegistry" && event.name.startsWith("Validator"));
    return { txId: r.txId, status: r.status, transactionHash: r.hash, blockNumber: r.blockNumber, event: validatorEvent?.name, revert: r.revert };
  }

  /** Unsigned call fields for the device wallet to sign (production path). */
  async prepareTransaction(tx: Transaction): Promise<PreparedTransaction> {
    const from = this.actorWallet(tx); // validate the envelope before any I/O
    await this.ensureNetwork();
    const plan = await this.plan(tx);
    return {
      from,
      to: this.config.deployment.contracts[plan.contract],
      data: this.interfaces[plan.contract].encodeFunctionData(plan.method, plan.args),
      chainId: this.config.deployment.chainId,
      contract: plan.contract,
      method: plan.method,
    };
  }

  async submitTransactionDetailed(tx: Transaction): Promise<SubmitResult> {
    const prepared = await this.prepareTransaction(tx);
    const raw = this.parseSignedTransaction(tx.signature);
    if (raw) this.verifySignedTransaction(raw, prepared);
    const signer = raw ? undefined : this.signerFor(prepared.from);

    const revert = await this.simulate(prepared);
    if (revert) return { txId: tx.txId, status: "REJECTED", events: [], revert, auditTxIds: [] };

    let hash: string;
    try {
      if (raw) {
        hash = (await this.provider.broadcastTransaction(tx.signature)).hash;
      } else {
        hash = await this.sendAs(signer!, prepared.to, prepared.data);
      }
    } catch (err) {
      const decoded = this.decodeRevertFrom(err);
      if (decoded) return { txId: tx.txId, status: "REJECTED", events: [], revert: decoded, auditTxIds: [] };
      throw classifyError(err, `${tx.type} submission failed`);
    }
    return this.awaitResult(tx, hash);
  }

  // -------------------------------------------------------------- reads

  async getIdentity(identityId: string): Promise<Identity | null> {
    const wallets: string[] = await this.read(() => this.contracts.IdentityRegistry.walletsOf(identityId));
    if (wallets.length === 0) return null;
    const mask = BigInt(await this.read(() => this.contracts.RoleRegistry.rolesOfIdentity(identityId)));
    const onChainRole = ROLES.find((_, i) => (mask >> BigInt(i)) & 1n) as Role | undefined;
    const records = await Promise.all(wallets.map((w) => this.read(() => this.contracts.IdentityRegistry.getWallet(w))));
    const statuses = records.map((r) => WALLET_STATUS[Number(r.status)]);
    const meta = (await this.options.metadata?.identity?.(identityId)) ?? {};
    // The frozen Identity type requires a role; an identity with no verified
    // role on-chain is still pending and is reported as not (yet) an Identity.
    if (!onChainRole) return null;
    return {
      employeeId: "",
      fullName: "",
      department: "",
      ...meta,
      identityId,
      role: onChainRole,
      // Identity-level SUSPENDED/REVOKED are tracked off-chain; the chain only knows wallets.
      status: meta.status ?? (statuses.includes("ACTIVE") ? "ACTIVE" : "PENDING"),
      createdAt: iso(records[0].registeredAt) ?? new Date(0).toISOString(),
    };
  }

  async getWallet(address: string): Promise<Wallet | null> {
    if (!isAddress(address)) return null;
    const addr = getAddress(address);
    const r = await this.read(() => this.contracts.IdentityRegistry.getWallet(addr));
    const status = WALLET_STATUS[Number(r.status)];
    if (!status) return null;
    const identityId: string = await this.read(() => this.contracts.IdentityRegistry.identityOf(addr));
    const meta = (await this.options.metadata?.wallet?.(addr)) ?? {};
    return {
      deviceId: "",
      ...meta,
      address: addr,
      identityId,
      status,
      activatedAt: iso(r.activatedAt),
      revokedAt: iso(r.revokedAt),
      revokedReason: r.revokedReason ? String(r.revokedReason) : null,
    };
  }

  async getAsset(id: string): Promise<Asset | null> {
    const nftId = BigInt(await this.read(() => this.contracts.AssetRegistry.nftIdOf(id)));
    if (nftId === 0n) return null;
    const [record, owner, state] = await Promise.all([
      this.read(() => this.contracts.AssetRegistry.getAsset(nftId)),
      this.read(() => this.contracts.AssetRegistry.ownerOfAsset(nftId)),
      this.read(() => this.contracts.AssetRegistry.stateOf(nftId)),
    ]);
    const parentId = BigInt(record.parent);
    const parentAssetId = parentId === 0n
      ? null
      : String((await this.read(() => this.contracts.AssetRegistry.getAsset(parentId))).assetId);
    const [ownerId, custodianId] = await Promise.all([this.identityOrAddress(owner), this.identityOrAddress(record.custodian)]);
    const meta = (await this.options.metadata?.asset?.(id)) ?? {};
    return {
      assetType: "", // off-chain (ADR-005)
      ...meta,
      assetId: id,
      nftId: nftId.toString(),
      ownerId,
      custodianId,
      parentAssetId,
      status: state as AssetStatus,
    };
  }

  async getJob(id: string): Promise<Job | null> {
    const exists: boolean = await this.read(() => this.contracts.JobManager.jobExists(id));
    if (!exists) return null;
    const j = await this.read(() => this.contracts.JobManager.getJob(id));
    const asset = await this.read(() => this.contracts.AssetRegistry.getAsset(j.assetNftId));
    const [createdBy, assignedTo, verifierId] = await Promise.all([
      this.identityOrAddress(j.createdBy),
      j.technician === ZERO ? Promise.resolve("") : this.identityOrAddress(j.technician),
      j.verifier === ZERO ? Promise.resolve(null) : this.identityOrAddress(j.verifier),
    ]);
    const meta = (await this.options.metadata?.job?.(id)) ?? {};
    return {
      // Priority is not stored on-chain; MEDIUM is a placeholder unless the
      // off-chain metadata provider supplies the real value.
      priority: "MEDIUM",
      ...meta,
      jobId: id,
      assetId: String(asset.assetId),
      createdBy,
      assignedTo,
      verifierId: verifierId ?? meta.verifierId ?? null,
      status: JOB_STATUS[Number(j.status)]!,
      createdAt: iso(j.createdAt)!,
      completedAt: iso(j.completedAt),
    };
  }

  /**
   * Append-only on-chain audit trail for an entity (THREAT_MODEL T9), in
   * recording order. Not part of the frozen BlockchainService: intended for
   * the AuditService implementation. Asset/job ids are used as-is, identities
   * by DID, wallets by lowercase 0x address.
   */
  async getAuditTrail(entityId: string): Promise<AuditEvent[]> {
    const txIds: string[] = await this.read(() => this.contracts.AuditRegistry.getAuditTrail(entityId));
    return Promise.all(
      txIds.map(async (txId) => {
        const r = await this.read(() => this.contracts.AuditRegistry.getAuditRecord(txId));
        return {
          eventId: txId,
          txId,
          entityType: String(r.entityType) as AuditEntityType,
          entityId: String(r.entityId),
          action: String(r.action),
          actorIdentityId: await this.identityOrAddress(r.actor),
          timestamp: iso(r.timestamp)!,
        };
      }),
    );
  }

  async getValidators(): Promise<Validator[]> {
    if (!this.options.consensus) throw new NotImplementedError("EvmBlockchainAdapter.getValidators() (needs Person 4 consensus source)");
    return this.options.consensus.getValidators();
  }

  async getCommittee(height: number): Promise<string[]> {
    if (!this.options.consensus) throw new NotImplementedError("EvmBlockchainAdapter.getCommittee() (needs Person 4 consensus source)");
    return this.options.consensus.getCommittee(height);
  }

  async getBlock(height: number): Promise<Block | null> {
    if (!Number.isInteger(height) || height < 0) return null;
    const block = await this.read(() => this.provider.getBlock(height));
    if (!block) return null;
    const committee = this.options.consensus ? await this.options.consensus.getCommittee(height) : [];
    return {
      height: block.number,
      leaderId: block.miner,
      committee,
      transactions: [...block.transactions],
      finalizedAt: iso(block.timestamp) ?? new Date(0).toISOString(),
    };
  }

  /** Never throws: an unreachable chain is reported as unhealthy. */
  async getStatus(): Promise<BlockchainStatus> {
    try {
      const height = await this.provider.getBlockNumber();
      let finalized = height;
      try {
        const b = await this.provider.getBlock("finalized");
        if (b) finalized = b.number;
      } catch {
        // Chains without the "finalized" tag (e.g. instant-finality PoA) finalize at head.
      }
      return { height, healthy: true, finalityLag: Math.max(0, height - finalized), lastFinalizedHeight: finalized };
    } catch {
      return { height: 0, healthy: false, finalityLag: 0, lastFinalizedHeight: 0 };
    }
  }

  // ----------------------------------------------------------- internals

  /** Confirms the RPC endpoint is the chain the deployment file describes. */
  private ensureNetwork(): Promise<void> {
    this.networkChecked ??= (async () => {
      let chainId: bigint;
      try {
        const rpc = this.provider as unknown as { send?: (method: string, params: unknown[]) => Promise<string> };
        chainId = typeof rpc.send === "function"
          ? BigInt(await rpc.send("eth_chainId", []))
          : (await this.provider.getNetwork()).chainId;
      } catch (err) {
        this.networkChecked = undefined; // allow retry once the node is back
        throw classifyError(err, "Cannot reach blockchain RPC");
      }
      if (chainId !== BigInt(this.config.deployment.chainId)) {
        this.networkChecked = undefined;
        throw new BlockchainError(
          "CONFIG",
          `RPC chainId ${chainId} does not match deployment "${this.config.deployment.network}" (chainId ${this.config.deployment.chainId})`,
        );
      }
    })();
    return this.networkChecked;
  }

  private actorWallet(tx: Transaction): string {
    if (!tx || typeof tx !== "object") throw new BlockchainError("INVALID_PAYLOAD", "Transaction envelope is required");
    if (typeof tx.actorWallet !== "string" || !isAddress(tx.actorWallet)) {
      throw new BlockchainError("INVALID_PAYLOAD", `${tx.type}: actorWallet must be an EVM address`);
    }
    return getAddress(tx.actorWallet);
  }

  private plan(tx: Transaction): Promise<CallPlan> {
    const lookups: ChainLookups = {
      nftIdOf: async (assetId) => BigInt(await this.read(() => this.contracts.AssetRegistry.nftIdOf(assetId))),
      walletOfIdentity: async (did, requireActive) => {
        const wallets: string[] = await this.read(() => this.contracts.IdentityRegistry.walletsOf(did));
        for (let i = wallets.length - 1; i >= 0; i--) { // newest first: replacements win
          if (!requireActive) return getAddress(wallets[i]);
          if (await this.read(() => this.contracts.IdentityRegistry.isActiveWallet(wallets[i]))) return getAddress(wallets[i]);
        }
        return null;
      },
    };
    return buildCallPlan(tx, lookups);
  }

  private parseSignedTransaction(signature: string): EvmTransaction | null {
    if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{100,}$/.test(signature)) return null;
    try {
      const parsed = EvmTransaction.from(signature);
      return parsed.signature ? parsed : null;
    } catch {
      return null;
    }
  }

  /** A relayed device-signed transaction must be exactly what the envelope claims. */
  private verifySignedTransaction(raw: EvmTransaction, prepared: PreparedTransaction): void {
    const problems: string[] = [];
    if (!raw.from || raw.from.toLowerCase() !== prepared.from.toLowerCase()) problems.push("signer is not actorWallet");
    if (!raw.to || raw.to.toLowerCase() !== prepared.to.toLowerCase()) problems.push(`target is not ${prepared.contract}`);
    if (raw.data.toLowerCase() !== prepared.data.toLowerCase()) problems.push(`calldata does not match ${prepared.method}(payload)`);
    if (raw.chainId !== BigInt(prepared.chainId)) problems.push("wrong chainId");
    if (raw.value !== 0n) problems.push("value must be 0");
    if (problems.length) {
      throw new BlockchainError("SIGNER", `Signed transaction rejected: ${problems.join("; ")}`, { problems });
    }
  }

  /**
   * Development-path send. The nonce is read straight from the node for every
   * transaction (JSON-RPC `send`, bypassing ethers' short-lived request cache,
   * which can hand back a stale count), and sends from one wallet are queued so
   * two concurrent requests can never claim the same nonce.
   */
  private async sendAs(wallet: EvmWallet, to: string, data: string): Promise<string> {
    const key = wallet.address.toLowerCase();
    const previous = this.sendQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => turn);
    this.sendQueues.set(key, tail);
    await previous.catch(() => undefined);
    try {
      const rpc = this.provider as unknown as { send?: (method: string, params: unknown[]) => Promise<string> };
      const nonce = typeof rpc.send === "function"
        ? Number(BigInt(await rpc.send("eth_getTransactionCount", [wallet.address, "pending"])))
        : await this.provider.getTransactionCount(wallet.address, "pending");
      return (await wallet.sendTransaction({ to, data, nonce })).hash;
    } finally {
      release();
      if (this.sendQueues.get(key) === tail) this.sendQueues.delete(key); // nothing queued behind us
    }
  }

  private signerFor(address: string): EvmWallet {
    const signer = this.signers.get(address.toLowerCase());
    if (!signer) {
      throw new BlockchainError(
        "SIGNER",
        `No signature for ${address}: submit a device-signed raw transaction in tx.signature (see prepareTransaction)`,
      );
    }
    return signer;
  }

  /** eth_call dry run. Returns the decoded revert, or undefined if it would succeed. */
  private async simulate(p: PreparedTransaction): Promise<DecodedRevert | undefined> {
    try {
      await this.provider.call({ from: p.from, to: p.to, data: p.data });
      return undefined;
    } catch (err) {
      const decoded = this.decodeRevertFrom(err);
      if (decoded) return decoded;
      throw classifyError(err, `Simulating ${p.method} failed`);
    }
  }

  private decodeRevertFrom(err: unknown): DecodedRevert | undefined {
    const data = extractRevertData(err);
    if (data === undefined && !isCallException(err)) return undefined;
    return this.decodeRevert(data ?? "0x");
  }

  decodeRevert(data: string): DecodedRevert {
    if (data.startsWith("0x08c379a0")) {
      const reason = String(Interface.from(["error Error(string)"]).decodeErrorResult("Error", data)[0]);
      return { name: "Error", args: [reason], message: reason };
    }
    for (const name of CONTRACT_NAMES) {
      try {
        const parsed = this.interfaces[name].parseError(data);
        if (parsed) {
          const args = parsed.args.map((a: unknown) => String(plain(a)));
          return { name: parsed.name, args, message: `${parsed.name}(${args.join(", ")})` };
        }
      } catch {
        // not this contract's error
      }
    }
    return { name: "UnknownRevert", args: data === "0x" ? [] : [data], message: `Reverted${data === "0x" ? "" : ` with ${data}`}` };
  }

  private async awaitResult(tx: Transaction, hash: string): Promise<SubmitResult> {
    let receipt: TransactionReceipt | null;
    try {
      receipt = await waitForReceipt(
        this.provider,
        hash,
        this.config.confirmations,
        this.config.txTimeoutMs,
        this.config.pollingIntervalMs ?? 250,
      );
    } catch (err) {
      throw classifyError(err, `Waiting for ${tx.type} (${hash})`);
    }
    if (!receipt) {
      const why = await this.diagnoseMissingReceipt(hash).catch(() => "could not query the node for details");
      throw new BlockchainError("TIMEOUT", `No receipt for ${tx.type} (${hash}) within ${this.config.txTimeoutMs}ms: ${why}`, { hash, why });
    }
    if (receipt.status !== 1) {
      return {
        txId: tx.txId, status: "REJECTED", hash, blockNumber: receipt.blockNumber, events: [], auditTxIds: [],
        revert: { name: "ExecutionReverted", args: [], message: "Transaction reverted on-chain after passing simulation" },
      };
    }
    const events = this.parseEvents(receipt.logs);
    const minted = events.find((e) => e.name === "AssetMinted");
    return {
      txId: tx.txId,
      status: "SUCCESS",
      hash,
      blockNumber: receipt.blockNumber,
      events,
      nftId: minted ? String(minted.args.nftId) : undefined,
      auditTxIds: events.filter((e) => e.name === "AuditRecorded").map((e) => String(e.args.txId)),
    };
  }

  /** Explains a receipt timeout so operators can tell "slow chain" from "stuck transaction". */
  private async diagnoseMissingReceipt(hash: string): Promise<string> {
    const t = await this.provider.getTransaction(hash);
    if (!t) return "the node does not know this transaction (dropped or never broadcast)";
    if (t.blockNumber != null) return `mined in block ${t.blockNumber} but the receipt was not returned in time`;
    const next = await this.provider.getTransactionCount(t.from, "latest");
    if (t.nonce > next) return `still pending with nonce ${t.nonce}, but ${t.from} has only mined up to nonce ${next - 1} (nonce gap: an earlier transaction is missing)`;
    return `still pending with nonce ${t.nonce} (not yet included in a block; is the chain producing blocks?)`;
  }

  parseEvents(logs: readonly Log[]): ChainEvent[] {
    const out: ChainEvent[] = [];
    for (const log of logs) {
      const contracts = this.byAddress.get(log.address.toLowerCase());
      if (!contracts) continue;
      for (const contract of contracts) {
        try {
          const parsed = this.interfaces[contract].parseLog({ topics: [...log.topics], data: log.data });
          if (!parsed) continue;
          const args: Record<string, string | string[]> = {};
          parsed.fragment.inputs.forEach((input, i) => { args[input.name || String(i)] = plain(parsed.args[i]); });
          out.push({ contract, name: parsed.name, args, logIndex: log.index });
          break;
        } catch {
          // The same address can intentionally stand in for multiple configured
          // contracts in local tests (for example, an undeployed validator registry).
        }
      }
    }
    return out;
  }

  private async identityOrAddress(address: string): Promise<string> {
    const did: string = await this.read(() => this.contracts.IdentityRegistry.identityOf(address));
    return did || getAddress(address);
  }

  private async read<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isCallException(err)) {
        throw new BlockchainError("NOT_FOUND", `On-chain read failed: ${this.decodeRevertFrom(err)?.message ?? "reverted"}`, undefined, { cause: err });
      }
      throw classifyError(err, "Blockchain read failed");
    }
  }
}
