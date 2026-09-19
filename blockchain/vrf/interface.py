from abc import ABC, abstractmethod
from typing import Tuple

class VRFInterface(ABC):
    """Abstract base class for Verifiable Random Function (VRF) implementation."""

    @abstractmethod
    def prove(self, secret_key: bytes, alpha: bytes) -> Tuple[bytes, bytes]:
        """
        Generates a VRF proof and output.
        
        Args:
            secret_key: The secret key bytes.
            alpha: The input message bytes.
            
        Returns:
            A tuple of (output, proof).
        """
        pass

    @abstractmethod
    def verify(self, public_key: bytes, alpha: bytes, output: bytes, proof: bytes) -> bool:
        """
        Verifies a VRF proof.
        
        Args:
            public_key: The public key bytes.
            alpha: The input message bytes.
            output: The VRF output bytes.
            proof: The VRF proof bytes.
            
        Returns:
            True if the proof is valid, False otherwise.
        """
        pass

    @abstractmethod
    def proof_to_output(self, proof: bytes) -> bytes:
        """
        Extracts the VRF output from a VRF proof.
        
        Args:
            proof: The VRF proof bytes.
            
        Returns:
            The extracted VRF output bytes.
        """
        pass
