# infra/docker/blockchain.Dockerfile
# Runs the consensus simulator continuously for local dev. Swap CMD for
# the real node entrypoint once Person 4's node prototype exists
# (Phase 12, step 9: "Consensus integration").
FROM python:3.11-slim

WORKDIR /app/blockchain
COPY blockchain ./

# The simulator is bounded per-run (see --rounds); loop it here so the
# container behaves like a long-running service during local dev.
CMD ["sh", "-c", "while true; do python3 simulator/consensus_simulator.py --rounds 20; sleep 2; done"]
