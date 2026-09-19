import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from nacl.signing import SigningKey, VerifyKey

from blockchain.consensus.types import ValidatorStatus
from blockchain.vrf import VRFKeyPair

@dataclass
class ValidatorIdentity:
    validator_id: bytes          # = public signing key bytes (32 bytes)
    signing_key: SigningKey       # pynacl Ed25519 signing key
    verify_key: VerifyKey         # pynacl Ed25519 verify key
    vrf_keypair: VRFKeyPair       # VRF key pair
    status: ValidatorStatus = ValidatorStatus.ACTIVE
    joined_at: str = ""          # ISO-8601

    @classmethod
    def generate(cls, seed: bytes | None = None) -> "ValidatorIdentity":
        """Generate a new validator identity. Deterministic if seed is provided."""
        if seed:
            signing_key = SigningKey(seed[:32].ljust(32, b'\0'))  # First 32 bytes for signing
            vrf_seed = seed[32:64] if len(seed) >= 64 else hashlib.sha256(seed + b'vrf').digest()
            vrf_kp = VRFKeyPair.generate(vrf_seed)
        else:
            signing_key = SigningKey.generate()
            vrf_kp = VRFKeyPair.generate()
            
        verify_key = signing_key.verify_key
        validator_id = bytes(verify_key)
        
        return cls(
            validator_id=validator_id,
            signing_key=signing_key,
            verify_key=verify_key,
            vrf_keypair=vrf_kp,
            status=ValidatorStatus.ACTIVE,
            joined_at=datetime.now(timezone.utc).isoformat()
        )
    
    def sign(self, message: bytes) -> bytes:
        """Sign a message with Ed25519."""
        return bytes(self.signing_key.sign(message).signature)
    
    @staticmethod
    def verify_signature(public_key: bytes, message: bytes, signature: bytes) -> bool:
        """Verify an Ed25519 signature."""
        try:
            verify_key = VerifyKey(public_key)
            verify_key.verify(message, signature)
            return True
        except Exception:
            return False
