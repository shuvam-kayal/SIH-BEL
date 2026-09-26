# networking/

Owner: Person 4.

Peer discovery, gossip/broadcast of proposals and votes, and the
message encoding.

The Phase 8 benchmark must measure real message counts here. The Besu QBFT
transport is the runtime networking layer. The four-node launcher validates
peer connectivity and, when the external runtime is present, block production
and height convergence; it does not validate BEL committee finality.
The Besu QBFT transport is the runtime networking layer. The four-node launcher is infrastructure-only and does not validate BEL committee finality.
