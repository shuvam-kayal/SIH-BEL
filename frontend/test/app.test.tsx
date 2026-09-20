import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";

const user = { employeeId: "EMP001", identityId: "DID:BEL:001", walletAddress: "0xWallet", role: "ENGINEER", department: "MAINTENANCE", status: "ACTIVE" };
const asset = { assetId: "AST-001", nftId: "1", assetType: "AIRCRAFT_PART", ownerId: user.identityId, custodianId: user.identityId, parentAssetId: null, status: "ACTIVE" };
const job = { jobId: "JOB-001", assetId: "AST-001", createdBy: user.identityId, assignedTo: user.identityId, verifierId: null, status: "CREATED", priority: "MEDIUM", createdAt: new Date().toISOString(), completedAt: null };

beforeEach(() => {
  sessionStorage.clear();
  window.belDeviceWallet = { getIdentity: async () => ({ deviceId: "BEL-DEVICE-001", publicKey: "public-key", walletAddress: user.walletAddress }), sign: async () => "signature" };
  globalThis.fetch = vi.fn(async (input) => {
    const path = String(input);
    if (path.endsWith("/auth/login-challenge")) return new Response(JSON.stringify({ challengeId: "challenge-1", deviceId: "BEL-DEVICE-001", challenge: "challenge", purpose: "AUTHENTICATION", expiresAt: new Date(Date.now() + 60000).toISOString(), usedAt: null }), { status: 201 });
    if (path.endsWith("/auth/login")) return new Response(JSON.stringify({ user, token: "test-token" }), { status: 200 });
    if (path.endsWith("/users/me")) return new Response(JSON.stringify(user), { status: 200 });
    if (path.endsWith("/assets/AST-001")) return new Response(JSON.stringify(asset), { status: 200 });
    if (path.endsWith("/assets")) return new Response(JSON.stringify([asset]), { status: 200 });
    if (path.endsWith("/jobs")) return new Response(JSON.stringify([job]), { status: 200 });
    return new Response(JSON.stringify({ code: "NOT_FOUND", message: "Not found" }), { status: 404 });
  });
});

describe("App shell", () => {
  it("shows the managed-device gate before sign-in", async () => { render(<App />); await waitFor(() => expect(screen.getByText(/Secure access to the BEL enterprise platform/i)).toBeTruthy()); expect(screen.getByText(/device-wallet bridge/i)).toBeTruthy(); });
  it("hides Employees from a non-admin role after real API sign-in", async () => { render(<App />); await waitFor(() => screen.getByRole("button", { name: /sign in/i })); await userEvent.click(screen.getByRole("button", { name: /sign in/i })); await waitFor(() => expect(screen.getByText(/Welcome back, EMP001/i)).toBeTruthy()); expect(screen.queryByRole("button", { name: "Employees" })).toBeNull(); expect(screen.getByRole("button", { name: /Assets/ })).toBeTruthy(); });
  it("navigates from the asset list into asset detail through the API client", async () => { render(<App />); await waitFor(() => screen.getByRole("button", { name: /sign in/i })); await userEvent.click(screen.getByRole("button", { name: /sign in/i })); await userEvent.click(await screen.findByRole("button", { name: /Assets/ })); const row = await screen.findByRole("button", { name: /AST-001/ }); await userEvent.click(row); await waitFor(() => expect(screen.getByText(/Asset identity/i)).toBeTruthy()); });
});
