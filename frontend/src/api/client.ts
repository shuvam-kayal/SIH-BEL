import type {
  ApiClient, ApiErrorCode, AssignJobRequest, AssignRoleRequest, ActivateWalletRequest,
  BlockchainStatus, CommitteeResponse, CompleteJobRequest, CreateAssetRequest,
  CreateJobRequest, CreateUserRequest, CreateUserResponse, InitializeAccountRequest,
  LoginProofRequest, PendingRegistration, ProvisioningChallengeRequest, RegisterDeviceRequest,
  RegisterWalletRequest, RejectJobRequest, Session, TransferAssetRequest,
  VerifyRegistrationRequest, WalletActionResponse,
} from "../../../shared/api";
import type { Asset, AuditEvent, Device, Identity, Job, ProvisioningChallenge, User, Validator, Wallet } from "../../../shared/types";

const configuredBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || "/api";
const API_BASE_URL = configuredBase.replace(/\/$/, "");
const SESSION_KEY = "bel.session.token";

export class HttpApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | "NETWORK_ERROR";
  constructor(status: number, code: ApiErrorCode | "NETWORK_ERROR", message: string) { super(message); this.name = "HttpApiError"; this.status = status; this.code = code; }
}

type SessionListener = () => void;
let sessionExpiredListener: SessionListener | undefined;
export function onSessionExpired(listener: SessionListener) { sessionExpiredListener = listener; return () => { if (sessionExpiredListener === listener) sessionExpiredListener = undefined; }; }

function endpoint(path: string) { return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`; }
function token() { return sessionStorage.getItem(SESSION_KEY); }
function saveToken(value: string | null) { if (value) sessionStorage.setItem(SESSION_KEY, value); else sessionStorage.removeItem(SESSION_KEY); }

async function request<T>(path: string, init: RequestInit = {}, authenticated = false): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  const currentToken = token();
  if (authenticated && currentToken) headers.set("Authorization", `Bearer ${currentToken}`);
  let response: Response;
  try { response = await fetch(endpoint(path), { ...init, headers }); }
  catch { throw new HttpApiError(0, "NETWORK_ERROR", "The BEL backend could not be reached."); }
  let body: unknown = null;
  if (response.status !== 204) { try { body = await response.json(); } catch { body = null; } }
  if (!response.ok) {
    const value = body as { code?: string; message?: string } | null;
    const code = (value?.code ?? (response.status === 501 ? "NOT_IMPLEMENTED" : "INTERNAL_ERROR")) as ApiErrorCode;
    if (response.status === 401 && authenticated) { saveToken(null); sessionExpiredListener?.(); }
    throw new HttpApiError(response.status, code, value?.message ?? `BEL backend request failed (${response.status}).`);
  }
  return body as T;
}
function json<T>(path: string, body: unknown, authenticated = false) { return request<T>(path, { method: "POST", body: JSON.stringify(body) }, authenticated); }
function post<T>(path: string, authenticated = false) { return request<T>(path, { method: "POST" }, authenticated); }
function get<T>(path: string, authenticated = true) { return request<T>(path, { method: "GET" }, authenticated); }

export const apiClient: ApiClient & { restoreSession(): Promise<Session | null>; clearSession(): void } = {
  async login(input: string | LoginProofRequest = "") { const session = await json<Session>("/auth/login", typeof input === "string" ? { deviceCredential: input } : input); saveToken(session.token); return session; },
  async requestProvisioningChallenge(input: ProvisioningChallengeRequest) { return json<ProvisioningChallenge>("/auth/provisioning-challenge", input); },
  async initializeAccount(input: InitializeAccountRequest) { return json<PendingRegistration>("/auth/initialize-account", input); },
  async requestAuthenticationChallenge(deviceId: string) { return json<ProvisioningChallenge>("/auth/login-challenge", { deviceId }); },
  async getPendingRegistrations() { return get<PendingRegistration[]>("/admin/registrations/pending"); },
  async verifyRegistration(id: string, input: VerifyRegistrationRequest) { return json<Identity>(`/admin/users/${encodeURIComponent(id)}/verify`, input, true); },
  async assignRole(id: string, input: AssignRoleRequest) { return json<User>(`/admin/users/${encodeURIComponent(id)}/role`, input, true); },
  async activateRegistration(id: string) { return post<PendingRegistration>(`/admin/users/${encodeURIComponent(id)}/activate`, true); },
  async registerDevice(userId: string, input: RegisterDeviceRequest) { return json<Device>(`/admin/users/${encodeURIComponent(userId)}/devices`, input, true); },
  async getDevices(userId: string) { return get<Device[]>(`/admin/users/${encodeURIComponent(userId)}/devices`); },
  async registerWallet(userId: string, input: RegisterWalletRequest) { return json<Wallet>(`/admin/users/${encodeURIComponent(userId)}/wallets`, input, true); },
  async getWallets(userId: string) { return get<Wallet[]>(`/admin/users/${encodeURIComponent(userId)}/wallets`); },
  async revokeDevice(deviceId: string) { return post<Device>(`/admin/devices/${encodeURIComponent(deviceId)}/revoke`, true); },
  async createUser(input: CreateUserRequest) { return json<CreateUserResponse>("/admin/users", input, true); },
  async revokeWallet(userId: string, reason: string) { return json<WalletActionResponse>(`/admin/users/${encodeURIComponent(userId)}/revoke-wallet`, { reason }, true); },
  async activateWallet(userId: string, input: ActivateWalletRequest) { return json<WalletActionResponse>(`/admin/users/${encodeURIComponent(userId)}/activate-wallet`, input, true); },
  async logout() { try { if (token()) await request<void>("/auth/logout", { method: "POST" }, true); } finally { saveToken(null); } },
  async getMe() { return get<User>("/users/me"); },
  async getUser(id: string) { try { return await get<User>(`/users/${encodeURIComponent(id)}`); } catch (error) { if (error instanceof HttpApiError && error.status === 404) return null; throw error; } },
  async getAssets() { return get<Asset[]>("/assets"); },
  async getAsset(id: string) { try { return await get<Asset>(`/assets/${encodeURIComponent(id)}`); } catch (error) { if (error instanceof HttpApiError && error.status === 404) return null; throw error; } },
  async createAsset(input: CreateAssetRequest) { return json<Asset>("/assets", input, true); },
  async transferAsset(id: string, input: TransferAssetRequest) { return json<Asset>(`/assets/${encodeURIComponent(id)}/transfer`, input, true); },
  async getJobs() { return get<Job[]>("/jobs"); },
  async getJob(id: string) { try { return await get<Job>(`/jobs/${encodeURIComponent(id)}`); } catch (error) { if (error instanceof HttpApiError && error.status === 404) return null; throw error; } },
  async createJob(input: CreateJobRequest) { return json<Job>("/jobs", input, true); },
  async assignJob(id: string, input: AssignJobRequest) { return json<Job>(`/jobs/${encodeURIComponent(id)}/assign`, input, true); },
  async startJob(id: string) { return post<Job>(`/jobs/${encodeURIComponent(id)}/start`, true); },
  async completeJob(id: string, input: CompleteJobRequest) { return json<Job>(`/jobs/${encodeURIComponent(id)}/complete`, input, true); },
  async approveJob(id: string) { return post<Job>(`/jobs/${encodeURIComponent(id)}/approve`, true); },
  async rejectJob(id: string, input: RejectJobRequest) { return json<Job>(`/jobs/${encodeURIComponent(id)}/reject`, input, true); },
  async getAssetAuditTrail(assetId: string) { return get<AuditEvent[]>(`/audit/assets/${encodeURIComponent(assetId)}`); },
  async getBlockchainStatus() { return get<BlockchainStatus>("/blockchain/status", false); },
  async getValidators() { return get<Validator[]>("/blockchain/validators"); },
  async getCommittee(height: number) { return get<CommitteeResponse>(`/blockchain/committee/${height}`); },
  async restoreSession() { const current = token(); if (!current) return null; try { return { user: await this.getMe(), token: current }; } catch (error) { if (error instanceof HttpApiError && error.status === 401) return null; throw error; } },
  clearSession() { saveToken(null); },
};
