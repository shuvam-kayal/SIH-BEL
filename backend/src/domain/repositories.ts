import type { PrismaClient } from "@prisma/client";
import type { Asset, Job } from "../../../shared/types";

export interface AssetRepository {
  list(): Promise<Asset[]>;
  findById(assetId: string): Promise<Asset | null>;
  save(asset: Asset): Promise<void>;
}

export interface JobRepository {
  list(): Promise<Job[]>;
  findById(jobId: string): Promise<Job | null>;
  save(job: Job): Promise<void>;
}

export class MemoryAssetRepository implements AssetRepository {
  constructor(private readonly assets = new Map<string, Asset>()) {}
  async list() { return [...this.assets.values()].map((asset) => ({ ...asset })); }
  async findById(id: string) { const asset = this.assets.get(id); return asset ? { ...asset } : null; }
  async save(asset: Asset) { this.assets.set(asset.assetId, { ...asset }); }
}

export class MemoryJobRepository implements JobRepository {
  constructor(private readonly jobs = new Map<string, Job>()) {}
  async list() { return [...this.jobs.values()]; }
  async findById(id: string) { return this.jobs.get(id) ?? null; }
  async save(job: Job) { this.jobs.set(job.jobId, job); }
}

export class PrismaAssetRepository implements AssetRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async list() { return (await this.prisma.assetRecord.findMany({ orderBy: { assetId: "asc" } })).map(mapAsset); }
  async findById(assetId: string) { return mapAssetNullable(await this.prisma.assetRecord.findUnique({ where: { assetId } })); }
  async save(asset: Asset) {
    await this.prisma.assetRecord.upsert({ where: { assetId: asset.assetId }, create: assetData(asset), update: assetData(asset) });
  }
}

export class PrismaJobRepository implements JobRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async list() { return (await this.prisma.jobRecord.findMany({ orderBy: { createdAt: "asc" } })).map(mapJob); }
  async findById(jobId: string) { return mapJobNullable(await this.prisma.jobRecord.findUnique({ where: { jobId } })); }
  async save(job: Job) {
    await this.prisma.jobRecord.upsert({ where: { jobId: job.jobId }, create: jobData(job), update: jobData(job) });
  }
}

const assetData = (asset: Asset) => ({ assetId: asset.assetId, nftId: asset.nftId, assetType: asset.assetType, ownerId: asset.ownerId, custodianId: asset.custodianId, parentAssetId: asset.parentAssetId ?? null, status: asset.status });
const jobData = (job: Job) => ({ jobId: job.jobId, assetId: job.assetId, createdBy: job.createdBy, assignedTo: job.assignedTo || null, verifierId: job.verifierId ?? null, status: job.status, priority: job.priority, createdAt: new Date(job.createdAt), completedAt: job.completedAt ? new Date(job.completedAt) : null });
const mapAsset = (row: any): Asset => ({ assetId: row.assetId, nftId: row.nftId, assetType: row.assetType, ownerId: row.ownerId, custodianId: row.custodianId, parentAssetId: row.parentAssetId, status: row.status });
const mapAssetNullable = (row: any): Asset | null => row ? mapAsset(row) : null;
const mapJob = (row: any): Job => ({ jobId: row.jobId, assetId: row.assetId, createdBy: row.createdBy, assignedTo: row.assignedTo ?? "", verifierId: row.verifierId, status: row.status, priority: row.priority, createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null });
const mapJobNullable = (row: any): Job | null => row ? mapJob(row) : null;
