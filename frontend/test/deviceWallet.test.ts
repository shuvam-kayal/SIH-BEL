import { beforeEach, describe, expect, it, vi } from "vitest";
import { deviceWallet } from "../src/api/deviceWallet";
import { apiClient } from "../src/api/client";

describe("managed device-wallet user verification boundary", () => {
  beforeEach(() => {
    window.belDeviceWallet = { getIdentity: async () => ({ deviceId: "device", publicKey: "public", walletAddress: "0xwallet" }), sign: vi.fn(async () => ({ signature: "signature", userVerified: true as const })) };
  });

  it("requires verified signing and forwards the operation", async () => {
    const signature = await deviceWallet.sign("challenge", { operation: "JOB_VERIFY", requireUserVerification: true });
    expect(signature).toBe("signature");
    expect(window.belDeviceWallet?.sign).toHaveBeenCalledWith("challenge", { operation: "JOB_VERIFY", requireUserVerification: true });
  });

  it("fails closed when the bridge returns an unverified or legacy result", async () => {
    window.belDeviceWallet = { getIdentity: async () => ({ deviceId: "device", publicKey: "public", walletAddress: "0xwallet" }), sign: vi.fn(async () => ({ signature: "legacy" } as never)) };
    await expect(deviceWallet.sign("challenge", { operation: "ASSET_TRANSFER", requireUserVerification: true })).rejects.toMatchObject({ reason: "UNVERIFIED" });
  });

  it("does not convert authenticator cancellation into a signature", async () => {
    window.belDeviceWallet = { getIdentity: async () => ({ deviceId: "device", publicKey: "public", walletAddress: "0xwallet" }), sign: vi.fn(async () => { throw new DOMException("cancelled", "NotAllowedError"); }) };
    await expect(deviceWallet.sign("challenge", { operation: "AUTHENTICATION", requireUserVerification: true })).rejects.toMatchObject({ reason: "CANCELLED" });
  });

  it("does not send a protected operation after failed device verification", async () => {
    sessionStorage.setItem("bel.session.token", "session-token");
    window.belDeviceWallet = { getIdentity: async () => ({ deviceId: "device", publicKey: "public", walletAddress: "0xwallet" }), sign: vi.fn(async () => { throw new DOMException("cancelled", "NotAllowedError"); }) };
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ challengeId: "fresh-1", deviceId: "device", challenge: "fresh-challenge", purpose: "FRESH_AUTHENTICATION", expiresAt: new Date(Date.now() + 60000).toISOString(), usedAt: null }), { status: 201 }));
    await expect(apiClient.approveJob("JOB-1")).rejects.toMatchObject({ reason: "CANCELLED" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalledWith(expect.stringContaining("/jobs/JOB-1/approve"), expect.anything());
  });
});
