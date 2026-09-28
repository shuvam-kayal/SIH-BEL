export type DeviceWalletIdentity = { deviceId: string; publicKey: string; walletAddress: string };
export interface DeviceWalletBridge {
  getIdentity(): Promise<DeviceWalletIdentity>;
  sign(challenge: string): Promise<string>;
}

declare global { interface Window { belDeviceWallet?: DeviceWalletBridge; } }

function bridge(): DeviceWalletBridge {
  if (!window.belDeviceWallet) throw new Error("BEL device-wallet integration is unavailable on this workstation.");
  return window.belDeviceWallet;
}
export const deviceWallet: DeviceWalletBridge = { getIdentity: () => bridge().getIdentity(), sign: (challenge) => bridge().sign(challenge) };
