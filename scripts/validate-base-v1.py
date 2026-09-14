"""Dependency-free structural validation for the shared base-v1 repository."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
required = [
    "README.md", ".gitignore", ".env.example", "package.json", "tsconfig.base.json",
    "shared/api.ts", "shared/index.ts", "shared/types/index.ts", "shared/enums/index.ts",
    "shared/rbac/index.ts", "shared/schemas/index.ts",
    "docs/SYSTEM_SPEC.md", "docs/DATA_MODEL.md", "docs/RBAC_MATRIX.md",
    "docs/API_SPEC.yaml", "docs/CONTRACT_SPEC.md", "docs/CONSENSUS_SPEC.md",
    "docs/BASELINE_FREEZE.md", "docs/DECISIONS.md", "docs/THREAT_MODEL.md",
    "backend/src/adapters/BlockchainService.ts", "mocks/mock-api/index.ts",
    "mocks/mock-blockchain/index.ts",
]
missing = [p for p in required if not (ROOT / p).exists()]
if missing:
    print("Missing required files:")
    print("\n".join(missing))
    sys.exit(1)

forbidden_dirs = {"node_modules", ".vite", "dist", "build", "out", "cache", "__pycache__", ".pytest_cache"}
found = []
for p in ROOT.rglob("*"):
    if p.is_dir() and p.name in forbidden_dirs:
        found.append(str(p.relative_to(ROOT)))
if found:
    print("Forbidden generated directories present:")
    print("\n".join(found))
    sys.exit(1)

contract = (ROOT / "docs/CONTRACT_SPEC.md").read_text()
enums = (ROOT / "shared/enums/index.ts").read_text()
for tx in re.findall(r"^- ([A-Z][A-Z_]+)$", contract, flags=re.M):
    if f'"{tx}"' not in enums:
        print(f"Transaction type missing from shared/enums: {tx}")
        sys.exit(1)

print("base-v1 structural validation: OK")
