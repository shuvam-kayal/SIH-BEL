from dataclasses import dataclass
from typing import Optional
import os
from blockchain.vrf.ecvrf import ECVRF

@dataclass(frozen=True)
class VRFKeyPair:
    """Represents a VRF key pair."""
    secret_key: bytes  # 32 bytes seed
    public_key: bytes  # 32 bytes public key

    @classmethod
    def generate(cls, seed: Optional[bytes] = None) -> 'VRFKeyPair':
        """
        Generates a new VRF key pair.
        
        Args:
            seed: Optional 32-byte seed. If not provided, os.urandom is used.
            
        Returns:
            A new VRFKeyPair.
        """
        ecvrf = ECVRF()
        sk, pk = ecvrf.generate_keypair(seed)
        return cls(secret_key=sk, public_key=pk)

    @classmethod
    def from_seed(cls, seed: bytes) -> 'VRFKeyPair':
        """
        Deterministic key generation from a seed.
        
        Args:
            seed: A 32-byte seed.
            
        Returns:
            A new VRFKeyPair.
        """
        return cls.generate(seed)
