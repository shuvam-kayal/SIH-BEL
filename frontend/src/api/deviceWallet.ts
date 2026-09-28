export type DeviceWalletIdentity = { deviceId: string; publicKey: string; walletAddress: string };
export type DeviceSigningOptions = { operation: string; requireUserVerification: true };
export type DeviceWalletSignature = { signature: string; userVerified: true };

export interface DeviceWalletBridge {
  getIdentity(): Promise<DeviceWalletIdentity>;
  /** The managed authenticator verifies the user locally before returning. */
  sign(challenge: string, options: DeviceSigningOptions): Promise<DeviceWalletSignature>;
}

declare global { interface Window { belDeviceWallet?: DeviceWalletBridge } }

export class DeviceWalletError extends Error {
  constructor(readonly reason: "CANCELLED" | "UNAVAILABLE" | "FAILED" | "UNVERIFIED", message: string) { super(message); this.name = "DeviceWalletError"; }
}

function bridge(): DeviceWalletBridge {
  if (!window.belDeviceWallet) throw new DeviceWalletError("UNAVAILABLE", "Secure device authentication is unavailable on this workstation.");
  return window.belDeviceWallet;
}

function mapSigningError(error: unknown): DeviceWalletError {
  if (error instanceof DeviceWalletError) return error;
  if (error instanceof DOMException && (error.name === "AbortError" || error.name === "NotAllowedError")) return new DeviceWalletError("CANCELLED", "Device verification was cancelled. The operation was not performed.");
  if (error instanceof Error && /cancel|abort|not allowed/i.test(error.message)) return new DeviceWalletError("CANCELLED", "Device verification was cancelled. The operation was not performed.");
  return new DeviceWalletError("FAILED", "Device verification failed. The operation was not performed.");
}

async function sign(challenge: string, options: DeviceSigningOptions): Promise<string> {
  if (!options.requireUserVerification) throw new DeviceWalletError("UNVERIFIED", "Secure device verification is required for this operation.");
  let result: DeviceWalletSignature;
  try { result = await bridge().sign(challenge, options); } catch (error) { throw mapSigningError(error); }
  if (!result || typeof result.signature !== "string" || result.signature.length === 0 || result.userVerified !== true) throw new DeviceWalletError("UNVERIFIED", "Secure device verification was not completed. The operation was not performed.");
  return result.signature;
}

export const deviceWallet = { getIdentity: () => bridge().getIdentity(), sign };
