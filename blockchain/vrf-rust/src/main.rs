use hex::decode;
use vrf_rfc9381::ec::p256::sswu::{
    EcVrfP256Sswu, EcVrfP256SswuPublicKey, EcVrfP256SswuSecretKey,
};
use vrf_rfc9381::{Prover, Verifier, VRF};

struct Vector {
    name: &'static str,
    message: &'static str,
    proof: &'static str,
    output: &'static str,
}

const SECRET_KEY: &str =
    "c9afa9d845ba75166c5b215767b1d6934e50c3db36e89b127b8a622b120f6721";
const PUBLIC_KEY: &str =
    "0360fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb6";

const VECTORS: &[Vector] = &[
    Vector {
        name: "Appendix B.2 example 13 (sample)",
        message: "73616d706c65",
        proof: "0331d984ca8fece9cbb9a144c0d53df3c4c7a33080c1e02ddb1a96a365394c7888782fffde7b842c38c20c08de6ec6c2e7027a97000f2c9fa4425d5c03e639fb48fde58114d755985498d7eb234cf4aed9",
        output: "21e66dc9747430f17ed9efeda054cf4a264b097b9e8956a1787526ed00dc664b",
    },
    Vector {
        name: "Appendix B.2 example 14 (test)",
        message: "74657374",
        proof: "03f814c0455d32dbc75ad3aea08c7e2db31748e12802db23640203aebf1fa8db2743aad348a3006dc1caad7da28687320740bf7dd78fe13c298867321ce3b36b79ec3093b7083ac5e4daf3465f9f43c627",
        output: "8e7185d2b420e4f4681f44ce313a26d05613323837da09a69f00491a83ad25dd",
    },
];

fn bytes(value: &str) -> Vec<u8> {
    decode(value).expect("test vector contains valid hexadecimal")
}

fn run_vector(vector: &Vector) {
    let secret_key = bytes(SECRET_KEY);
    let expected_public_key = bytes(PUBLIC_KEY);
    let message = bytes(vector.message);
    let expected_proof = bytes(vector.proof);
    let expected_output = bytes(vector.output);

    let prover = EcVrfP256SswuSecretKey::from_slice(&secret_key)
        .expect("RFC private key must be accepted");
    let derived_verifier = prover.verifier();
    let expected_verifier = EcVrfP256SswuPublicKey::from_slice(&expected_public_key)
        .expect("RFC public key must be accepted");
    assert_eq!(
        derived_verifier, expected_verifier,
        "{} private/public key derivation mismatch",
        vector.name
    );
    let verifier = expected_verifier;

    let vrf = EcVrfP256Sswu;
    let proof = vrf
        .prove(&prover, &message)
        .expect("proof generation must succeed");
    assert_eq!(proof, expected_proof, "{} proof mismatch", vector.name);

    let output = vrf
        .verify(&verifier, &message, &proof)
        .expect("proof verification must succeed");
    assert_eq!(output.as_slice(), expected_output.as_slice(), "{} output mismatch", vector.name);

    let mut modified_message = message.clone();
    modified_message[0] ^= 1;
    assert!(
        vrf.verify(&verifier, &modified_message, &proof).is_err(),
        "{} modified message must be rejected",
        vector.name
    );

    let mut modified_proof = proof.clone();
    let last = modified_proof.len() - 1;
    modified_proof[last] ^= 1;
    assert!(
        vrf.verify(&verifier, &message, &modified_proof).is_err(),
        "{} modified proof must be rejected",
        vector.name
    );

    let other_secret = vec![0u8; 31]
        .into_iter()
        .chain(std::iter::once(1u8))
        .collect::<Vec<_>>();
    let other_verifier = EcVrfP256SswuSecretKey::from_slice(&other_secret)
        .expect("alternate private key must be accepted")
        .verifier();
    assert!(
        vrf.verify(&other_verifier, &message, &proof).is_err(),
        "{} modified public key must be rejected",
        vector.name
    );

    let malformed_proof = vec![0u8; expected_proof.len() - 1];
    assert!(
        vrf.verify(&verifier, &message, &malformed_proof).is_err(),
        "{} malformed proof must be rejected",
        vector.name
    );

    println!("PASS: {}", vector.name);
}

fn main() {
    for vector in VECTORS {
        run_vector(vector);
    }
    println!("All RFC 9381 Appendix B.2 P-256-SHA256-SSWU checks passed.");
}
