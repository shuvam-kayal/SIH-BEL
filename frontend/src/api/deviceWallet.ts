export type DeviceWalletIdentity = { deviceId: string; publicKey: string; walletAddress: string };
export type DeviceSigningOptions = { operation: string; requireUserVerification: true };
export type DeviceWalletSignature = { signature: string; userVerified?: boolean; developmentUserVerification?: true };
export type DeviceUnsignedTransaction = { to: string; data: string; chainId: number; nonce?: number; value?: string };

export interface DeviceWalletBridge {
  getIdentity(): Promise<DeviceWalletIdentity>;
  /** Production bridges perform local user verification before returning. */
  sign(challenge: string, options: DeviceSigningOptions): Promise<DeviceWalletSignature>;
  signTransaction?(transaction: DeviceUnsignedTransaction, options: DeviceSigningOptions): Promise<DeviceWalletSignature>;
}

declare global { interface Window { belDeviceWallet?: DeviceWalletBridge } }

export class DeviceWalletError extends Error {
  constructor(readonly reason: "CANCELLED" | "UNAVAILABLE" | "FAILED" | "UNVERIFIED", message: string) { super(message); this.name = "DeviceWalletError"; }
}

const devWalletBase = (import.meta.env.DEV ? (import.meta.env.VITE_BEL_DEV_WALLET_URL as string | undefined)?.trim().replace(/\/$/, "") : undefined);
export const isDevelopmentWalletEnabled = Boolean(devWalletBase);

async function unavailable(): Promise<never> { throw new DeviceWalletError("UNAVAILABLE", "Secure device authentication is unavailable on this workstation."); }
function bridge(): DeviceWalletBridge {
  if (window.belDeviceWallet) return window.belDeviceWallet;
  if (!devWalletBase) return { getIdentity: unavailable, sign: unavailable, signTransaction: unavailable };
  return {
    async getIdentity() {
      const response = await fetch(`${devWalletBase}/identity`);
      if (!response.ok) throw new DeviceWalletError("UNAVAILABLE", "The development device-wallet service is unavailable.");
      return await response.json() as DeviceWalletIdentity;
    },
    async sign(challenge, options) {
      const identity = await this.getIdentity();
      const response = await fetch(`${devWalletBase}/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId: identity.deviceId, challenge, options }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new DeviceWalletError("FAILED", typeof body.message === "string" ? body.message : "Development device-wallet signing failed.");
      return body as DeviceWalletSignature;
    },
    async signTransaction(transaction, options) {
      const identity = await this.getIdentity();
      const response = await fetch(`${devWalletBase}/sign-transaction`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId: identity.deviceId, transaction, options }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new DeviceWalletError("FAILED", typeof body.message === "string" ? body.message : "Development device-wallet signing failed.");
      return body as DeviceWalletSignature;
    },
  };
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
  const productionVerified = result?.userVerified === true;
  const explicitDevelopmentSigning = import.meta.env.DEV && result?.developmentUserVerification === true;
  if (!result || typeof result.signature !== "string" || result.signature.length === 0 || (!productionVerified && !explicitDevelopmentSigning)) throw new DeviceWalletError("UNVERIFIED", "Secure device verification was not completed. The operation was not performed.");
  return result.signature;
}

export const deviceWallet = { getIdentity: () => bridge().getIdentity(), sign };
export async function signDeviceTransaction(transaction: DeviceUnsignedTransaction): Promise<string> {
  const signTransaction = bridge().signTransaction;
  if (!signTransaction) throw new DeviceWalletError("UNAVAILABLE", "Secure device transaction signing is unavailable on this workstation.");
  const result = await signTransaction.call(bridge(), transaction, { operation: "BLOCKCHAIN_TRANSACTION", requireUserVerification: true });
  const verified = result?.userVerified === true || (import.meta.env.DEV && result?.developmentUserVerification === true);
  if (!result || typeof result.signature !== "string" || !verified) throw new DeviceWalletError("UNVERIFIED", "Secure device verification was not completed. The operation was not performed.");
  return result.signature;
}
