import { spawnSync } from "node:child_process";

function run(args) {
  console.log(`> docker compose ${args.join(" ")}`);
  const result = spawnSync("docker", ["compose", ...args], { stdio: "inherit" });
  if (result.error) {
    console.error(`Docker Compose is required for Solidity tests: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// The compose service uses the pinned Foundry image and mounts ./contracts,
// so Windows, macOS, Linux, and CI all execute the same real forge suite.
// Dependencies and build output are intentionally ignored by Git, therefore
// a clean checkout must bootstrap them inside the container first.
const forge = [
  "if [ ! -d lib/forge-std ]; then forge install foundry-rs/forge-std@v1.9.4 --no-git; fi;",
  "if [ ! -d lib/openzeppelin-contracts ]; then forge install OpenZeppelin/openzeppelin-contracts@v4.9.6 --no-git; fi;",
  "forge build && forge test -vv",
].join(" ");
run([
  "run",
  "--rm",
  "--no-deps",
  "--entrypoint",
  "sh",
  "evm-deploy",
  "-lc",
  forge,
]);
