import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("development wallet identity handoff", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_BEL_DEV_WALLET_URL", "http://127.0.0.1:8787");
    vi.stubEnv("VITE_BEL_DEV_DEVICE_ID", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses the wallet service identity and returned device ID for signing", async () => {
    const identity = { deviceId: "BEL-DEV-EMPLOYEE-001", publicKey: "0xpublic", walletAddress: "0xwallet" };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(identity), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(identity), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ signature: "0xsignature", developmentUserVerification: true }), { status: 200 }));
    const { deviceWallet } = await import("../src/api/deviceWallet");

    await expect(deviceWallet.getIdentity()).resolves.toEqual(identity);
    await expect(deviceWallet.sign("challenge", { operation: "AUTHENTICATION", requireUserVerification: true })).resolves.toBe("0xsignature");
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/identity");
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({ deviceId: identity.deviceId, challenge: "challenge" });
  });
});
