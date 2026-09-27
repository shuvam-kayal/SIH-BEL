/**
 * Client boundary for a protected platform credential. Implementations must
 * perform local user verification before returning a signature. The private
 * key, PIN, and biometric data never cross this boundary.
 *
 * WebAuthn/passkey assertions are deliberately not silently converted into
 * the BEL EVM wallet signature: they are separate credential types until a
 * protocol adapter is agreed with the identity/blockchain contracts.
 */
export type SignedChallenge = {
  publicKey: string;
  signature: string;
};

export interface PlatformAuthenticator {
  signChallenge(challenge: string): Promise<SignedChallenge>;
  signFreshChallenge(challenge: string): Promise<SignedChallenge>;
}

/** Explicit production placeholder. It prevents a fake login fallback. */
export class UnconfiguredPlatformAuthenticator implements PlatformAuthenticator {
  async signChallenge(_challenge: string): Promise<SignedChallenge> {
    throw new Error("No platform authenticator is configured for this client");
  }

  async signFreshChallenge(_challenge: string): Promise<SignedChallenge> {
    throw new Error("No platform authenticator is configured for this client");
  }
}

export function createPlatformAuthenticator(): PlatformAuthenticator {
  // A native/WebAuthn adapter will be injected here once the client protocol
  // is selected. Never substitute localStorage, a password, or a JS private key.
  return new UnconfiguredPlatformAuthenticator();
}
