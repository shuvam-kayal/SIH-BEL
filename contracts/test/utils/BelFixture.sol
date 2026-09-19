// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Test } from "forge-std/Test.sol";
import { BelEvents } from "./BelEvents.sol";
import { IdentityRegistry } from "../../src/IdentityRegistry.sol";
import { RoleRegistry } from "../../src/RoleRegistry.sol";
import { AssetRegistry } from "../../src/AssetRegistry.sol";
import { JobManager } from "../../src/JobManager.sol";
import { AuditRegistry } from "../../src/AuditRegistry.sol";
import { IRoleRegistry } from "../../src/IRoleRegistry.sol";

/// Deploys and wires the full registry set exactly as script/Deploy.s.sol
/// does, and provides one ACTIVE wallet per role.
abstract contract BelFixture is Test, BelEvents {
    IdentityRegistry internal identity;
    RoleRegistry internal roles;
    AssetRegistry internal assets;
    JobManager internal jobs;
    AuditRegistry internal audit;

    address internal admin = makeAddr("admin");
    address internal manager;
    address internal engineer;
    address internal technician;
    address internal auditor;
    address internal issuer;
    address internal verifier;
    address internal outsider = makeAddr("outsider"); // no identity at all

    string internal constant ADMIN_DID = "DID:BEL:ADMIN";

    function setUp() public virtual {
        identity = new IdentityRegistry(admin, ADMIN_DID);
        roles = new RoleRegistry(address(identity), admin);
        assets = new AssetRegistry();
        jobs = new JobManager(address(assets));
        address[] memory recorders = new address[](4);
        recorders[0] = address(identity);
        recorders[1] = address(roles);
        recorders[2] = address(assets);
        recorders[3] = address(jobs);
        audit = new AuditRegistry(address(identity), address(roles), recorders);

        identity.wire(address(identity), address(roles), address(audit));
        roles.wire(address(identity), address(roles), address(audit));
        assets.wire(address(identity), address(roles), address(audit));
        jobs.wire(address(identity), address(roles), address(audit));

        manager = onboard("DID:BEL:MANAGER", IRoleRegistry.Role.MANAGER);
        engineer = onboard("DID:BEL:ENGINEER", IRoleRegistry.Role.ENGINEER);
        technician = onboard("DID:BEL:TECH", IRoleRegistry.Role.TECHNICIAN);
        auditor = onboard("DID:BEL:AUDITOR", IRoleRegistry.Role.AUDITOR);
        issuer = onboard("DID:BEL:ISSUER", IRoleRegistry.Role.ISSUER);
        verifier = onboard("DID:BEL:VERIFIER", IRoleRegistry.Role.VERIFIER);
    }

    /// Full admin onboarding: register PENDING wallet, assign role, activate.
    function onboard(string memory did, IRoleRegistry.Role role) internal returns (address w) {
        w = makeAddr(did);
        vm.startPrank(admin);
        identity.createIdentity(w, did);
        roles.assignRole(w, role);
        identity.activateWallet(w);
        vm.stopPrank();
    }

    function walletFor(IRoleRegistry.Role role) internal view returns (address) {
        if (role == IRoleRegistry.Role.ADMIN) return admin;
        if (role == IRoleRegistry.Role.MANAGER) return manager;
        if (role == IRoleRegistry.Role.ENGINEER) return engineer;
        if (role == IRoleRegistry.Role.TECHNICIAN) return technician;
        if (role == IRoleRegistry.Role.AUDITOR) return auditor;
        if (role == IRoleRegistry.Role.ISSUER) return issuer;
        return verifier;
    }

    function mint(string memory assetId, address owner) internal returns (uint256 id) {
        vm.prank(admin);
        id = assets.mintAsset(assetId, owner);
    }

    /// Drives a job to COMPLETED with `technician` doing the work.
    function jobToCompleted(string memory jobId, uint256 nftId) internal {
        vm.prank(manager);
        jobs.createJob(jobId, nftId);
        vm.prank(manager);
        jobs.assignJob(jobId, technician);
        vm.prank(technician);
        jobs.startJob(jobId);
        vm.prank(technician);
        jobs.completeJob(jobId, keccak256("evidence"));
    }
}
