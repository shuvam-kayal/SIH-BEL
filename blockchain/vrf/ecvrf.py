import os
import hashlib
from typing import Optional, Tuple
from blockchain.vrf.interface import VRFInterface

# Ed25519 constants
P = 2**255 - 19
D = -121665 * pow(121666, -1, P) % P
Q_ORDER = 2**252 + 27742317777372353535851937790883648493
I = pow(2, (P - 1) // 4, P)
B_Y = 4 * pow(5, -1, P) % P
B_X = 15112221349535400772501151409588531511454012693041857206046113283949847762202
B_POINT = (B_X, B_Y, 1, B_X * B_Y % P)
COFACTOR = 8

# VRF Suite
SUITE_STRING = b"\x04"


def point_add(P1, P2):
    X1, Y1, Z1, T1 = P1
    X2, Y2, Z2, T2 = P2
    A = (Y1 - X1) * (Y2 - X2) % P
    B = (Y1 + X1) * (Y2 + X2) % P
    C = (T1 * 2 * D * T2) % P
    D_val = (Z1 * 2 * Z2) % P
    E = (B - A) % P
    F = (D_val - C) % P
    G = (D_val + C) % P
    H = (B + A) % P
    X3 = (E * F) % P
    Y3 = (G * H) % P
    T3 = (E * H) % P
    Z3 = (F * G) % P
    return (X3, Y3, Z3, T3)

def scalar_mult(P_point, k: int):
    Q_point = (0, 1, 1, 0)
    for bit in bin(k)[2:]:
        Q_point = point_add(Q_point, Q_point)
        if bit == '1':
            Q_point = point_add(Q_point, P_point)
    return Q_point

def decode_point(b: bytes):
    if len(b) != 32: raise ValueError("Invalid point length")
    y = int.from_bytes(b, 'little')
    x_sign = y >> 255
    y &= (1 << 255) - 1
    if y >= P: raise ValueError("y coordinate >= P")
    y2 = y * y % P
    x2 = (y2 - 1) * pow(D * y2 + 1, -1, P) % P
    if x2 == 0:
        if x_sign: raise ValueError("Invalid x_sign for x2=0")
        return (0, y, 1, 0)
    x = pow(x2, (P + 3) // 8, P)
    if (x * x % P) != x2:
        x = x * I % P
    if (x * x % P) != x2:
        raise ValueError("Point not on curve")
    if (x & 1) != x_sign:
        x = P - x
    return (x, y, 1, x * y % P)

def encode_point(P_point):
    X, Y, Z, T = P_point
    z_inv = pow(Z, -1, P)
    x = X * z_inv % P
    y = Y * z_inv % P
    res = bytearray(y.to_bytes(32, 'little'))
    if x & 1:
        res[31] |= 0x80
    return bytes(res)

class ECVRF(VRFInterface):
    """ECVRF-EDWARDS25519-SHA512-ELL2 equivalent VRF implementation."""

    def __init__(self):
        self.suite_string = SUITE_STRING
        
    def _encode_to_curve_try_and_increment(self, Y_bytes: bytes, alpha_string: bytes):
        ctr = 0
        while ctr < 256:
            ctr_byte = bytes([ctr])
            hash_input = self.suite_string + b"\x01" + Y_bytes + alpha_string + ctr_byte + b"\x00"
            H_bytes = hashlib.sha512(hash_input).digest()[:32]
            try:
                H_point = decode_point(H_bytes)
                return scalar_mult(H_point, COFACTOR)
            except ValueError:
                ctr += 1
        raise ValueError("Failed to hash to curve")
        
    def _ecvrf_challenge_generation(self, Y, H, Gamma, U, V):
        hasher = hashlib.sha512()
        hasher.update(self.suite_string)
        hasher.update(b"\x02")
        hasher.update(encode_point(Y))
        hasher.update(encode_point(H))
        hasher.update(encode_point(Gamma))
        hasher.update(encode_point(U))
        hasher.update(encode_point(V))
        hasher.update(b"\x00")
        digest = hasher.digest()
        return int.from_bytes(digest[:16], 'little')
        
    def _ecvrf_nonce_generation(self, sk: bytes, h_point) -> int:
        hasher = hashlib.sha512()
        hasher.update(sk)
        hasher.update(encode_point(h_point))
        digest = hasher.digest()
        return int.from_bytes(digest, 'little') % Q_ORDER

    def generate_keypair(self, seed: Optional[bytes] = None) -> Tuple[bytes, bytes]:
        if seed is None:
            seed = os.urandom(32)
        hasher = hashlib.sha512(seed).digest()
        sk = bytearray(hasher[:32])
        sk[0] &= 248
        sk[31] &= 127
        sk[31] |= 64
        sk_scalar = int.from_bytes(sk, 'little')
        Y = scalar_mult(B_POINT, sk_scalar)
        pk = encode_point(Y)
        return seed[:32], pk

    def _derive_scalar(self, secret_key: bytes) -> Tuple[int, bytes]:
        hasher = hashlib.sha512(secret_key).digest()
        sk = bytearray(hasher[:32])
        sk[0] &= 248
        sk[31] &= 127
        sk[31] |= 64
        sk_scalar = int.from_bytes(sk, 'little')
        return sk_scalar, encode_point(scalar_mult(B_POINT, sk_scalar))

    def prove(self, secret_key: bytes, alpha: bytes) -> Tuple[bytes, bytes]:
        sk_scalar, Y_bytes = self._derive_scalar(secret_key)
        Y = decode_point(Y_bytes)
        H = self._encode_to_curve_try_and_increment(Y_bytes, alpha)
        Gamma = scalar_mult(H, sk_scalar)
        k = self._ecvrf_nonce_generation(secret_key, H)
        kB = scalar_mult(B_POINT, k)
        kH = scalar_mult(H, k)
        c = self._ecvrf_challenge_generation(Y, H, Gamma, kB, kH)
        s = (k + c * sk_scalar) % Q_ORDER
        pi_string = encode_point(Gamma) + c.to_bytes(16, 'little') + s.to_bytes(32, 'little')
        beta_string = self.proof_to_output(pi_string)
        return beta_string, pi_string

    def verify(self, public_key: bytes, alpha: bytes, output: bytes, proof: bytes) -> bool:
        if len(proof) != 80:
            return False
        try:
            Gamma = decode_point(proof[:32])
            c = int.from_bytes(proof[32:48], 'little')
            s = int.from_bytes(proof[48:], 'little')
            if s >= Q_ORDER:
                return False
            Y = decode_point(public_key)
            H = self._encode_to_curve_try_and_increment(public_key, alpha)
            sB = scalar_mult(B_POINT, s)
            cY = scalar_mult(Y, Q_ORDER - c)
            U = point_add(sB, cY)
            sH = scalar_mult(H, s)
            cGamma = scalar_mult(Gamma, Q_ORDER - c)
            V = point_add(sH, cGamma)
            c_prime = self._ecvrf_challenge_generation(Y, H, Gamma, U, V)
            if c != c_prime:
                return False
            derived_output = self.proof_to_output(proof)
            return derived_output == output
        except ValueError:
            return False

    def proof_to_output(self, proof: bytes) -> bytes:
        if len(proof) != 80:
            raise ValueError("Invalid proof length")
        gamma_bytes = proof[:32]
        Gamma = decode_point(gamma_bytes)
        cofactor_Gamma = scalar_mult(Gamma, COFACTOR)
        hasher = hashlib.sha512()
        hasher.update(self.suite_string)
        hasher.update(b"\x03")
        hasher.update(encode_point(cofactor_Gamma))
        hasher.update(b"\x00")
        return hasher.digest()[:32]
