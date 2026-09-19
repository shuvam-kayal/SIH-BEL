# ADR-024: Frozen Wallet Cryptographic Wire Specification

**Status:** Accepted / Frozen  
**Scope:** Device-wallet provisioning proof and authentication proof across Person 1 (backend), Person 5 (Solidity/EVM), and Person 6 (device wallet).  
**Does not define:** Ethereum raw-transaction serialization/signing used by an EVM client. The application Transaction.signature field must not be interpreted as this proof format.

## Decision

### 1. Key material

- Curve: secp256k1.
- Private key: 32-byte scalar in the valid secp256k1 range; generated and retained only on the managed device.
- Public key canonical wire form: 64 raw bytes = X || Y, big-endian 32-byte X followed by 32-byte Y.
- The SEC1 uncompressed prefix 0x04 is not part of the wire representation.
- JSON/API representation of public key: canonical 0x-prefixed 128-hex-character string. New clients must emit this form. The existing backend parser currently tolerates an omitted 0x prefix for compatibility.

### 2. Wallet address

addressBytes = last20(Keccak-256(X || Y))

- No SEC1 prefix is hashed.
- Solidity/EVM uses the native 20-byte address type.
- JSON/API representation: 0x-prefixed 40-hex-character Ethereum address.
- Canonical presentation/output: EIP-55 checksum casing.
- Consumers may normalize valid all-lower/all-upper input to the checksum form; mixed-case input with an invalid checksum is rejected.
- The submitted wallet address MUST equal the address derived from the submitted public key before wallet activation.

### 3. Challenge bytes that are signed

The current production-proof path signs the backend-issued challenge string only.

Challenge generation:
- 32 cryptographically random bytes.
- Encode with Base64URL without padding.
- This produces a 43-character ASCII string.
- The exact returned challenge string is the message. Do not JSON-serialize it and do not append challengeId, deviceId, purpose, walletAddress, or publicKey to the signed payload.

Therefore:

M = UTF-8(challenge)

For the current challenge format, M is exactly 43 bytes.

### 4. Hashing / domain separation

The proof uses Ethereum EIP-191 personal-message hashing; it is not a raw-message signature and is not EIP-712.

D = Keccak-256(
  0x19 ||
  ASCII("Ethereum Signed Message:\\n") ||
  ASCII(decimal_byte_length(M)) ||
  M
)

For the current 43-byte challenge:

D = Keccak-256(
  0x19 ||
  "Ethereum Signed Message:\\n43" ||
  challenge_utf8_bytes
)

The secp256k1 ECDSA signature is computed over the 32-byte digest D.

There is no additional SHA-256, Keccak, JSON canonicalization, or custom application prefix.

Equivalent client operation: Ethereum signMessage(challenge) / personal_sign semantics over the UTF-8 challenge bytes.

### 5. Signature wire format

Canonical wire format:

0x || yParity(1 byte) || r(32 bytes) || s(32 bytes)

Total: 65 bytes / 130 hex characters after 0x.

- yParity: exactly 0x00 or 0x01.
- r: 32-byte big-endian unsigned integer.
- s: 32-byte big-endian unsigned integer.
- EVM recovery value is v = 27 + yParity when converted to Ethereum-style {r,s,v}.
- Signature serialization is fixed-width; no DER encoding.

### 6. Canonical ECDSA requirements

Reject the signature unless:

1 <= r < n
1 <= s <= floor(n/2)

where n is the secp256k1 curve order.

Thus low-s canonicalization is mandatory; high-s signatures are invalid.

### 7. Malformed-input rules

Reject the request/proof when any of the following holds:

- public key is not exactly 64 bytes;
- public-key coordinates do not form a valid secp256k1 point;
- signature is not exactly 65 bytes;
- yParity is not 0 or 1;
- r or s is zero or outside the curve-order range;
- s is high-s;
- address is not a valid 20-byte EVM address;
- derived address != submitted wallet address;
- submitted public key != registered device public key;
- challenge is unknown, expired, already consumed, or bound to another device/purpose;
- signature does not recover the registered wallet address.

Never accept private keys, seed phrases, mnemonics, or backup material through the API.

## Integration mapping

**Person 6:** generate secp256k1 keypair locally; send only public key, derived address, challengeId, and signature. Sign the exact challenge string using EIP-191/personal_sign semantics.

**Person 1:** verify public-key/address binding, challenge lifecycle, EIP-191 digest, compact signature, low-s, and recovered address. Store public material only.

**Person 5:** treat the wallet identity as the normal EVM address. Solidity does not need to decode this compact proof format for the current contracts. Contract authorization remains based on msg.sender / wallet address.

## Existing implementation note

The repository already follows the EIP-191 challenge path in backend/src/blockchain/crypto.ts via ethers hashMessage() + secp256k1 recovery, and address derivation uses X||Y without the 0x04 prefix.

**One enforcement gap to close before treating the EVM proof path as production-complete:** the current compact-signature parser checks length and yParity but does not yet reject high-s values. The low-s rule above is part of this frozen specification and must be enforced by the backend verifier.
