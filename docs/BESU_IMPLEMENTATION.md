# BEL Besu implementation status

## Pinned toolchain

- Besu source tag: `24.8.0`
- JDK: Eclipse Temurin `21.0.12.1` (LTS)
- Java runtime: `21.0.12.1`
- Java compiler: `javac 21.0.12.1`

The Besu build must use the JDK 21 installation at:

```text
C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot
```

The current Codex shell inherited Java 8, so build commands explicitly set
`JAVA_HOME` to this path. A newly opened developer terminal should expose the
same `JAVA_HOME` value.

## VRF investigation

BEL requires exactly `ECVRF-P256-SHA256-SSWU` from RFC 9381. No suitable,
maintained Java/Maven implementation was found in the pinned Besu source,
its dependencies, or the library investigation performed for this work.

| Candidate | Result |
|---|---|
| Besu crypto modules | Provide secp256k1/secp256r1 signing primitives, not RFC 9381 ECVRF. |
| Bouncy Castle | Provides elliptic-curve primitives, but no verified complete BEL ECVRF-P256-SHA256-SSWU provider was found. P-256 support alone is insufficient. |
| `reyzin/ecvrf` | C++ reference implementation used to generate RFC vectors; its README explicitly warns that it is insecure, inefficient, and not for actual cryptography. Not a Java dependency. |
| `pigmocom/ecvrf-certification` | Documents an Ed25519 ELL2 implementation, not P-256 SSWU, and is not a Java provider. |
| General VRF/crypto packages | Either use another curve/suite, provide signatures rather than VRFs, or lack evidence of RFC 9381 P-256 SSWU conformance. |

RFC 9381 Appendix B.2 test vectors are the required conformance source. They
must be run for both `prove` and `verify` before the provider is enabled in
consensus. Until then, the Java consensus layer depends only on the isolated
`VrfProvider` abstraction and has no hash-based or signature-based fallback.

## Rust crate investigation result

The requested candidate was inspected and pinned in the standalone harness at
`blockchain/vrf-rust/Cargo.toml`:

```toml
vrf-rfc9381 = { version = "=0.0.7", features = ["p256"] }
```

Version `0.0.7` exposes `EcVrfP256Sswu`, `EcVrfP256SswuSecretKey`, and
`EcVrfP256SswuPublicKey`. Its crate documentation claims ECVRF support and
the exact P-256 TAI/SSWU suites, but also describes the project as work in
progress and unaudited. The project license is MIT OR Apache-2.0.

The harness uses the official RFC 9381 Appendix B.2 examples 13 and 14. It
compiled with Rust 1.98.1, but strict execution fails before provider
integration: the crate's `prove` path derives compressed public key
`0292493a26ac0f9d159cb92eb000027151115f4368e79d81825f6232b290192aa8`
from the RFC secret scalar, while RFC 9381 requires
`0360fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb6`.
Its generated proof therefore also does not match the RFC vector. In a
diagnostic run, verification of the published proof using the published public
key did succeed, but that does not satisfy the required prove/verify
interoperability contract.

Status: **blocked; do not integrate `vrf-rfc9381` 0.0.7 into Besu yet**.
The intended security description, if a conforming backend is later found, is:

> RFC 9381-compatible prototype backend validated against RFC test vectors; not independently audited.

## Provider boundary

The provider must expose:

```java
VrfProof prove(VrfPrivateKey privateKey, byte[] message);
VrfResult verify(VrfPublicKey publicKey, byte[] message, VrfProof proof);
```

A careful Java port of the RFC reference implementation is technically
feasible, but it is not a two-day production-cryptography change. It requires
P-256 point encoding/decoding, RFC 9380 XMD/SHA-256 SSWU hash-to-curve,
deterministic nonce generation, proof encoding, verification, RFC vectors, and
negative tests. A port would be prototype-only, require independent review,
and must never be described as audited or production-grade.

## Current status

The `besu/consensus/bel` module contains deterministic seed, leader, committee,
and quorum primitives plus the `VrfProvider` boundary. The hackathon provider is
now connected to Besu's QBFT execution path through `BftContext`.

`BelValidatorProvider` wraps the normal Besu validator provider, derives the
committee for the requested height, verifies the complete deterministic test
evidence set, and exposes the resulting committee to the existing QBFT code.
`BelProposerSelector` derives the same seed and committee and selects the leader
from `(seed, height, round, canonicalCommittee)`.

The RFC-compatible provider remains isolated and is not enabled because the
tested `vrf-rfc9381` implementation fails RFC 9381 Appendix B.2
interoperability tests.

The connected path is:

```text
QbftBesuControllerBuilder
  -> BftContext(BelValidatorProvider)
  -> BelProposerSelector
  -> QBFT ProposalValidator
  -> QBFT PREPARE/COMMIT validators and RoundState
  -> QBFT RoundChangeManager
  -> BftCommitSealsValidationRule
  -> Besu block importer / canonical chain
```

The current integration uses `DeterministicTestVrfProvider` only for the
hackathon demonstration. It is test-only, not RFC 9381 cryptography, and not
production-grade.

## Reproducible demo workflow

From the repository root, build the BEL module and the Besu distribution with
JDK 21:

```bash
cd besu
./gradlew :consensus:bel:test :besu:compileJava :besu:installDist
cd ..
```

The 4-node launcher generates a 70-validator configuration, starts four active
QBFT nodes on RPC ports 8645-8648, and is explicitly infrastructure-only:

```bash
./scripts/run-besu-smoke.sh
./scripts/check-besu-bel-demo.sh .bel-demo/smoke-<timestamp> 4 8645
./scripts/stop-besu-bel-demo.sh .bel-demo/smoke-<timestamp>
```

The 70-validator launcher is available on Windows and Linux. It generates
private keys and runtime data below ignored `.bel-demo/`; do not copy those
files into Git. The generated network is a reproducibility/configuration demo,
not a claim of live 70-validator BEL finality.
## Pinned Besu integration map

## Hackathon runtime limitation

The Besu source and BEL integration compile on the configured JDK 21 toolchain.
The provided Windows distribution cannot currently start a live node because
Besu's `gnark-0.9.4` artifact contains Linux and macOS native libraries but no
Windows `gnark_eip_196.dll`; startup therefore fails while loading the native
EIP-196 library. WSL is not installed on the development host. This is a
platform/runtime packaging limitation, not a BEL consensus result, and must be
resolved by running the same build on Linux (or by using an official Windows
native artifact) before claiming a live multi-node Besu finality demonstration.

The reproducible local launcher is:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-besu-bel-demo.ps1 -ValidatorCount 70
```

It generates all validator keys and node data below `.bel-demo/`, which is
ignored by Git. The launcher uses the test-only deterministic VRF provider
through the Java integration and never places generated private keys in source
control.

The pinned source is Besu `24.8.0`, commit `ac9f8bbd9`. The existing QBFT path
already provides the transport and execution hooks required by the BEL demo:

| BEL responsibility | Existing Besu integration point |
|---|---|
| Controller dispatch | `org.hyperledger.besu.consensus.qbft.statemachine.QbftController` |
| Height lifecycle | `QbftBlockHeightManagerFactory` and `QbftBlockHeightManager` |
| Round state | `QbftRound`, `QbftRoundFactory`, `RoundChangeManager` |
| Network broadcast | `QbftMessageTransmitter`, `ValidatorMulticaster`, `BftProtocolManager` |
| Message encoding | `MessageFactory`, `ProposalMessageData`, `PrepareMessageData`, `CommitMessageData`, `RoundChangeMessageData` |
| Message validation | `MessageValidatorFactory` and QBFT payload validators |
| Block creation/execution | `QbftBlockCreatorFactory` and Besu block processor |
| Controller construction | `org.hyperledger.besu.controller.QbftBesuControllerBuilder` |

## Integration files

BEL files connected to Besu:

- `consensus/bel/BelValidatorProvider.java`
- `consensus/bel/BelProposerSelector.java`
- `consensus/bel/BelCommitteeEvidence.java`
- `besu/src/main/java/org/hyperledger/besu/controller/QbftBesuControllerBuilder.java`

The existing QBFT implementation remains responsible for wire message formats,
signing, transport, timeout and round-change events, block execution, commit
seal attachment, and canonical block import. BEL supplies the consensus-facing
validator set, leader, and quorum inputs through the existing interfaces.

The end-to-end demonstration profile defaults to 70 logical validators. This keeps
the frozen normal rule `N >= 70` and permits the minimum-70 committee fallback.
It must not be reduced to four validators without changing the protocol profile.
