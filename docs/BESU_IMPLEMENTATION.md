# BEL Besu implementation status

## Pinned toolchain

- Besu source: submodule commit `6880538b71b100824894abe0d3c605438b5b9e2a` (`feat/poa`)
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

## Reference implementations

Earlier Python and Rust VRF experiments were audited during development but are
not part of the submitted implementation. They are not imported by Besu and
must not be treated as production consensus code. The submitted integration
uses the Java VrfProvider boundary and the deterministic test provider
described below.
## Validator metadata RPC

The separate bel_getValidators RPC exposes backend-facing validator metadata
without changing bel_getCommittee. Its response contains height and
validators, where each entry has validatorId, publicKey, status, and
joinedAt.

The public-key registry is supplied through BEL_VALIDATOR_PUBLIC_KEYS_FILE
or defaults to config/validator-public-keys.json. It contains public
secp256k1 keys only, encoded as 0x plus 128 hexadecimal characters
(X || Y, without the 04 prefix). Besu validates that each key derives the
listed validator address. status is ACTIVE when the address is in the
underlying QBFT validator population for the requested block and INACTIVE
for a registered validator absent from that population. joinedAt is the UTC
ISO-8601 timestamp of the first canonical block in which the validator appears
in that underlying population; genesis validators use the genesis timestamp.
The BEL committee remains separate and is not used to determine status.
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
./gradlew :consensus:bel:test :consensus:qbft:test :besu:compileJava installDist
cd ..
```

The prototype launcher generates a four-validator QBFT configuration and starts
four active customized Besu nodes on RPC ports 8645-8648. The four validators
are the explicitly permitted prototype reduction; the process, BEL consensus
integration, QBFT, RPC, transaction execution, and contract path are still the
real implementation under test:

```bash
./scripts/run-besu-smoke.sh
./scripts/check-besu-bel-demo.sh .bel-demo/smoke-<timestamp> 4 8645
./scripts/stop-besu-bel-demo.sh .bel-demo/smoke-<timestamp>
```

For the complete local deployment-realism gate in Linux/WSL:

```bash
npm ci
npm run besu:build
docker run -d --name bel-postgres -p 5432:5432 -e POSTGRES_USER=bel -e POSTGRES_PASSWORD=bel -e POSTGRES_DB=bel postgres:16-alpine
docker run -d --name bel-ipfs -p 5001:5001 ipfs/kubo:v0.30.0
run_output="$(bash scripts/start-besu-prototype.sh)"
run_root="$(printf '%s\n' "$run_output" | sed -n 's/^Besu smoke network started: //p' | tail -n 1)"
source <(bash scripts/export-besu-test-env.sh "$run_root")
export DATABASE_URL=postgresql://bel:bel@127.0.0.1:5432/bel
export IPFS_API_URL=http://127.0.0.1:5001
export BEL_E2E_DEPLOYED=true
npm run prisma:generate
npm run db:migrate
bash scripts/deploy-besu-prototype.sh "$run_root"
npm run test:evm
npx vitest run backend/test/users.evm.integration.test.ts --testTimeout=120000
BEL_EVM_RPC_URL="$BEL_CHAIN_RPC_URL" npm run verify
bash scripts/stop-besu-bel-demo.sh "$run_root"
docker rm -f bel-ipfs bel-postgres
```

The exported variables make all three application names (`BEL_EVM_RPC_URL`,
`BEL_CHAIN_RPC_URL`, and `BEL_E2E_RPC_URL`) resolve to the same Besu RPC. The
exported validator addresses are derived from the generated Besu node keys.

The launcher also creates ephemeral funded application test accounts in the
ignored `.bel-demo/` runtime directory. Contract deployment derives validator
bootstrap addresses from the generated Besu node keys and writes a fresh
`contracts/deployments/besu-prototype.json` for that chain. Private keys,
Besu data, and logs must never be copied into Git.

The full production baseline remains N >= 70 validators. This prototype is not
production-ready and does not claim production-scale performance or finality.

## Test architecture

- Unit and contract tests validate individual components and Solidity behavior.
- The Python consensus suite validates the model/simulator only; it is not the
  Besu integration gate.
- The real integration gate builds the checked-in Besu submodule at the exact
  recorded commit, starts the prototype nodes, verifies client identity,
  chain ID, peers, block production, and synchronized height, then deploys the
  contracts to that same RPC endpoint.
- The full E2E uses that deployment with real PostgreSQL, a disposable Kubo
  service, the backend EVM adapter, authentication/RBAC, jobs/assets/evidence,
  audit, and validator/application state transitions.

Production uses the same application/Besu architecture. CI and local
development use the reduced prototype network only because a live 70-validator
deployment is computationally impractical in the current environment.
## Pinned Besu integration map

## Runtime limitation

The Besu source and BEL integration compile on the configured JDK 21 toolchain.
The supported real integration launcher is the Linux/WSL `run-besu-smoke.sh`
path because the current Besu native `gnark` packaging does not provide the
required Windows native library. A Windows developer should run the same
prototype workflow under WSL; this is a runtime packaging limitation, not a
permission to substitute Anvil.

The SIH-BEL submodule is pinned to commit `6880538b71b100824894abe0d3c605438b5b9e2a` on `feat/poa`.
The existing QBFT path
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

The production protocol baseline remains `N >= 70`. The checked-in prototype
execution profile intentionally uses four active QBFT validators and a matching
prototype contract minimum; this is the only CI/local simplification.
## Repository boundary

The customized Besu implementation is the `besu` Git submodule. CI checks out
the exact gitlink recorded by SIH-BEL, builds it with JDK 21, runs the BEL and
QBFT Java tests, and starts that resulting distribution. The smoke launcher
verifies RPC reachability, Besu client metadata, peer count, block production,
and height convergence. It accepts `NODE_IP`, `P2P_HOST`, `P2P_PORT`,
`RPC_HOST`, `RPC_PORT`, `BOOTNODE_HOST`, and `BOOTNODE_PORT` for
VPN/private-network use.
