from typing import Dict, List, Optional
from blockchain.validator.identity import ValidatorIdentity
from blockchain.consensus.types import ValidatorStatus

class ValidatorRegistry:
    def __init__(self) -> None:
        self._validators: Dict[bytes, ValidatorIdentity] = {}  # validator_id -> identity
    
    def register(self, identity: ValidatorIdentity) -> None:
        """Register a new validator."""
        self._validators[identity.validator_id] = identity

    def unregister(self, validator_id: bytes) -> None:
        """Unregister a validator."""
        if validator_id in self._validators:
            del self._validators[validator_id]

    def get(self, validator_id: bytes) -> Optional[ValidatorIdentity]:
        """Get validator by id."""
        return self._validators.get(validator_id)

    def get_active_set(self, height: int) -> List[ValidatorIdentity]:
        """
        Get active validators for the given height.
        Per §2.1, the validator set used to finalize block h is determined at end of block h-1.
        """
        return [v for v in self._validators.values() if v.status == ValidatorStatus.ACTIVE]

    def get_vrf_public_key(self, validator_id: bytes) -> Optional[bytes]:
        """Get VRF public key for validator."""
        val = self.get(validator_id)
        if val:
            return val.vrf_keypair.public_key
        return None

    def get_verify_key(self, validator_id: bytes) -> Optional[bytes]:
        """Get Ed25519 verify key bytes for validator."""
        val = self.get(validator_id)
        if val:
            return bytes(val.verify_key)
        return None

    def size(self) -> int:
        """Return total number of validators."""
        return len(self._validators)
    
    @classmethod
    def create_test_registry(cls, n: int, seed: int = 42) -> "ValidatorRegistry":
        """Create a deterministic registry of n validators for testing."""
        registry = cls()
        for i in range(n):
            s = f"test-validator-{seed}-{i}".encode('utf-8')
            registry.register(ValidatorIdentity.generate(seed=s))
        return registry
