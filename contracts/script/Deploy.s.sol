// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Script, console2 } from "forge-std/Script.sol";
import { IdentityRegistry } from "../src/IdentityRegistry.sol";
import { RoleRegistry } from "../src/RoleRegistry.sol";
import { AssetRegistry } from "../src/AssetRegistry.sol";
import { JobManager } from "../src/JobManager.sol";
import { AuditRegistry } from "../src/AuditRegistry.sol";
import { ValidatorRegistry } from "../src/ValidatorRegistry.sol";

/// Deploys and wires the registry set in docs/CONTRACT_SPEC.md order and
/// writes contracts/deployments/<BEL_NETWORK>.json for the backend adapter.
///
/// Required env:
///   BEL_BOOTSTRAP_ADMIN_WALLET  public address of the first ADMIN wallet
///   BEL_BOOTSTRAP_ADMIN_DID     its persistent identity, e.g. DID:BEL:ADMIN
/// Optional env:
///   BEL_NETWORK                 deployment file name (default "local")
///
/// The signing key is supplied to forge (--private-key / --account /
/// --ledger); it is never read or stored by this script.
contract DeployScript is Script {
    struct Deployment {
        IdentityRegistry identity;
        RoleRegistry roles;
        AssetRegistry assets;
        JobManager jobs;
        AuditRegistry audit;
        ValidatorRegistry validators;
    }

    function run() external returns (Deployment memory d) {
        address bootstrapAdmin = vm.envAddress("BEL_BOOTSTRAP_ADMIN_WALLET");
        string memory bootstrapDid = vm.envString("BEL_BOOTSTRAP_ADMIN_DID");
        string memory network = vm.envOr("BEL_NETWORK", string("local"));
        uint256 startBlock = block.number;
        uint256 bootstrapCount = vm.envOr("BEL_BOOTSTRAP_VALIDATOR_COUNT", uint256(70));
        if (bootstrapCount < 70) revert("BEL requires at least 70 bootstrap validators");
        address[] memory bootstrapValidators = new address[](bootstrapCount);
        for (uint256 i = 0; i < bootstrapCount; i++) {
            bootstrapValidators[i] = vm.envAddress(string.concat("BEL_BOOTSTRAP_VALIDATOR_", vm.toString(i)));
        }

        vm.startBroadcast();
        d = deployWithBootstrap(bootstrapAdmin, bootstrapDid, bootstrapValidators);
        vm.stopBroadcast();

        _write(network, d, bootstrapAdmin, startBlock);
    }

    function deployWithBootstrap(address bootstrapAdmin, string memory bootstrapDid, address[] memory bootstrap)
        public
        returns (Deployment memory d)
    {
        if (bootstrap.length < 70) revert("BEL requires at least 70 bootstrap validators");
        d.identity = new IdentityRegistry(bootstrapAdmin, bootstrapDid);
        d.roles = new RoleRegistry(address(d.identity), bootstrapAdmin);
        d.assets = new AssetRegistry();
        d.jobs = new JobManager(address(d.assets));

        d.validators = new ValidatorRegistry(70, bootstrap);

        address[] memory recorders = new address[](5);
        recorders[0] = address(d.identity);
        recorders[1] = address(d.roles);
        recorders[2] = address(d.assets);
        recorders[3] = address(d.jobs);
        recorders[4] = address(d.validators);
        d.audit = new AuditRegistry(address(d.identity), address(d.roles), recorders);

        d.identity.wire(address(d.identity), address(d.roles), address(d.audit));
        d.roles.wire(address(d.identity), address(d.roles), address(d.audit));
        d.assets.wire(address(d.identity), address(d.roles), address(d.audit));
        d.jobs.wire(address(d.identity), address(d.roles), address(d.audit));
        d.validators.wire(address(d.identity), address(d.roles), address(d.audit));
    }

    function _write(string memory network, Deployment memory d, address admin, uint256 startBlock)
        private
    {
        string memory c = "contracts";
        vm.serializeAddress(c, "ValidatorRegistry", address(d.validators));
        vm.serializeAddress(c, "IdentityRegistry", address(d.identity));
        vm.serializeAddress(c, "RoleRegistry", address(d.roles));
        vm.serializeAddress(c, "AssetRegistry", address(d.assets));
        vm.serializeAddress(c, "JobManager", address(d.jobs));
        string memory contractsJson = vm.serializeAddress(c, "AuditRegistry", address(d.audit));

        string memory root = "deployment";
        vm.serializeString(root, "network", network);
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeAddress(root, "deployer", d.identity.deployer());
        vm.serializeAddress(root, "bootstrapAdminWallet", admin);
        vm.serializeUint(root, "blockNumber", startBlock);
        string memory json = vm.serializeString(root, "contracts", contractsJson);

        string memory path = string.concat(vm.projectRoot(), "/deployments/", network, ".json");
        vm.writeJson(json, path);
        console2.log("Deployment written to", path);
    }
}






