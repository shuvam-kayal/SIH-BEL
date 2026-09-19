import hashlib
from blockchain.vrf.ecvrf import ECVRF

# Domain Separators
COMMITTEE_VRF_DOMAIN = b"BEL-COMMITTEE-VRF"
LEADER_VRF_DOMAIN = b"BEL-LEADER-VRF"

def compute_committee_vrf_input(seed: bytes, height: int, validator_id: bytes) -> bytes:
    """
    Computes the VRF input for committee selection.
    
    Args:
        seed: The beacon seed for the current epoch (S_h).
        height: The block height.
        validator_id: The validator's public key bytes.
        
    Returns:
        The SHA-256 hash of the committee VRF input string.
    """
    hasher = hashlib.sha256()
    hasher.update(COMMITTEE_VRF_DOMAIN)
    hasher.update(seed)
    hasher.update(height.to_bytes(8, 'big'))
    hasher.update(validator_id)
    return hasher.digest()

def compute_leader_vrf_input(seed: bytes, height: int, round: int, validator_id: bytes) -> bytes:
    """
    Computes the VRF input for leader selection.
    
    Args:
        seed: The beacon seed for the current epoch (S_h).
        height: The block height.
        round: The consensus round.
        validator_id: The validator's public key bytes.
        
    Returns:
        The SHA-256 hash of the leader VRF input string.
    """
    hasher = hashlib.sha256()
    hasher.update(LEADER_VRF_DOMAIN)
    hasher.update(seed)
    hasher.update(height.to_bytes(8, 'big'))
    hasher.update(round.to_bytes(8, 'big'))
    hasher.update(validator_id)
    return hasher.digest()

def verify_committee_vrf(public_key: bytes, seed: bytes, height: int, validator_id: bytes, vrf_output: bytes, vrf_proof: bytes, chain_id: int) -> bool:
    """
    Verifies a committee VRF proof.
    
    Args:
        public_key: The validator's VRF public key.
        seed: The beacon seed.
        height: The block height.
        validator_id: The validator's public key.
        vrf_output: The claimed VRF output.
        vrf_proof: The VRF proof.
        chain_id: The chain identifier (not directly part of the standard input, but kept for signature).
        
    Returns:
        True if the proof is valid.
    """
    alpha = compute_committee_vrf_input(seed, height, validator_id)
    ecvrf = ECVRF()
    return ecvrf.verify(public_key, alpha, vrf_output, vrf_proof)

def verify_leader_vrf(public_key: bytes, seed: bytes, height: int, round: int, validator_id: bytes, vrf_output: bytes, vrf_proof: bytes) -> bool:
    """
    Verifies a leader VRF proof.
    
    Args:
        public_key: The validator's VRF public key.
        seed: The beacon seed.
        height: The block height.
        round: The consensus round.
        validator_id: The validator's public key.
        vrf_output: The claimed VRF output.
        vrf_proof: The VRF proof.
        
    Returns:
        True if the proof is valid.
    """
    alpha = compute_leader_vrf_input(seed, height, round, validator_id)
    ecvrf = ECVRF()
    return ecvrf.verify(public_key, alpha, vrf_output, vrf_proof)
