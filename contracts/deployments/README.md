# deployments/

One JSON file per network (`local.json`, `testnet.json`, ...) recording
the deployed address of each registry, the deployer, and the block
number.

`script/Deploy.s.sol` writes these. The backend reads them rather than
hardcoding addresses, so redeploying doesn't require a code change.
