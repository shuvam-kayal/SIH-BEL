// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { BelFixture } from "./utils/BelFixture.sol";
import { BelAccess } from "../src/BelAccess.sol";
import { BelRoles } from "../src/BelRoles.sol";
import { IRoleRegistry } from "../src/IRoleRegistry.sol";

/// Every permission boundary in docs/RBAC_MATRIX.md, checked for every role
/// against the deployed contracts (ADR-008/ADR-009, THREAT_MODEL T3/T4).
contract AccessControlTest is BelFixture {
    // Independent transcription of docs/RBAC_MATRIX.md (ALLOW cells only).
    // Deliberately NOT derived from src/BelRoles.sol, so a wrong mask in the
    // contracts fails these tests instead of silently agreeing with itself.
    uint256 private constant A = 1; // ADMIN
    uint256 private constant M = 2; // MANAGER
    uint256 private constant E = 4; // ENGINEER
    uint256 private constant T = 8; // TECHNICIAN
    uint256 private constant AU = 16; // AUDITOR
    uint256 private constant I = 32; // ISSUER
    uint256 private constant V = 64; // VERIFIER

    uint256 private constant CREATE_EMPLOYEE = A;
    uint256 private constant REVOKE_WALLET = A;
    uint256 private constant ACTIVATE_WALLET = A | I;
    uint256 private constant REGISTER_ASSET = A | M | E | I;
    uint256 private constant CREATE_JOB = M | E;
    uint256 private constant ASSIGN_TECHNICIAN = M | E;
    uint256 private constant PERFORM_MAINTENANCE = E | T;
    uint256 private constant VERIFY_MAINTENANCE = M | E | AU | V;
    uint256 private constant TRANSFER_ASSET = A | M; // ENGINEER is `auth` -> fails closed

    function test_ContractMasksMatchMatrix() public pure {
        assertEq(BelRoles.CREATE_EMPLOYEE, CREATE_EMPLOYEE);
        assertEq(BelRoles.REVOKE_WALLET, REVOKE_WALLET);
        assertEq(BelRoles.ACTIVATE_WALLET, ACTIVATE_WALLET);
        assertEq(BelRoles.REGISTER_ASSET, REGISTER_ASSET);
        assertEq(BelRoles.CREATE_JOB, CREATE_JOB);
        assertEq(BelRoles.ASSIGN_TECHNICIAN, ASSIGN_TECHNICIAN);
        assertEq(BelRoles.PERFORM_MAINTENANCE, PERFORM_MAINTENANCE);
        assertEq(BelRoles.VERIFY_MAINTENANCE, VERIFY_MAINTENANCE);
        assertEq(BelRoles.TRANSFER_ASSET, TRANSFER_ASSET);
    }

    uint256 private nonce;

    function _uid(string memory prefix) private returns (string memory) {
        nonce++;
        return string.concat(prefix, vm.toString(nonce));
    }

    function _expectUnauthorized(address caller, uint256 mask) private {
        vm.expectRevert(abi.encodeWithSelector(BelAccess.Unauthorized.selector, caller, mask));
    }

    function _allowed(uint256 mask, IRoleRegistry.Role r) private pure returns (bool) {
        return mask & (1 << uint8(r)) != 0;
    }

    function _pendingWallet() private returns (address w) {
        string memory did = _uid("DID:BEL:P");
        w = makeAddr(did);
        vm.prank(admin);
        identity.createIdentity(w, did);
    }

    // ------------------------------------------------------ full matrix

    function test_Matrix_CreateEmployee() public {
        for (uint8 i = 0; i < 7; i++) {
            IRoleRegistry.Role r = IRoleRegistry.Role(i);
            address caller = walletFor(r);
            string memory did = _uid("DID:BEL:N");
            if (!_allowed(CREATE_EMPLOYEE, r)) {
                _expectUnauthorized(caller, CREATE_EMPLOYEE);
            }
            vm.prank(caller);
            identity.createIdentity(makeAddr(did), did);
        }
    }

    function test_Matrix_RevokeWallet() public {
        for (uint8 i = 0; i < 7; i++) {
            IRoleRegistry.Role r = IRoleRegistry.Role(i);
            address caller = walletFor(r);
            address target = _pendingWallet();
            if (!_allowed(REVOKE_WALLET, r)) {
                _expectUnauthorized(caller, REVOKE_WALLET);
            }
            vm.prank(caller);
            identity.revokeWallet(target, "lost device");
        }
    }

    function test_Matrix_ActivateWallet() public {
        for (uint8 i = 0; i < 7; i++) {
            IRoleRegistry.Role r = IRoleRegistry.Role(i);
            address caller = walletFor(r);
            address target = _pendingWallet();
            if (!_allowed(ACTIVATE_WALLET, r)) {
                _expectUnauthorized(caller, ACTIVATE_WALLET);
            }
            vm.prank(caller);
            identity.activateWallet(target);
        }
    }

    function test_Matrix_RegisterAsset() public {
        for (uint8 i = 0; i < 7; i++) {
            IRoleRegistry.Role r = IRoleRegistry.Role(i);
            address caller = walletFor(r);
            if (!_allowed(REGISTER_ASSET, r)) {
                _expectUnauthorized(caller, REGISTER_ASSET);
            }
            vm.prank(caller);
            assets.mintAsset(_uid("ASSET-"), admin);
        }
    }

    function test_Matrix_CreateJob() public {
        uint256 nft = mint("ASSET-JOBS", admin);
        for (uint8 i = 0; i < 7; i++) {
            IRoleRegistry.Role r = IRoleRegistry.Role(i);
            address caller = walletFor(r);
            if (!_allowed(CREATE_JOB, r)) {
                _expectUnauthorized(caller, CREATE_JOB);
            }
            vm.prank(caller);
            jobs.createJob(_uid("JOB-"), nft);
        }
    }

    function test_Matrix_AssignTechnician() public {
        uint256 nft = mint("ASSET-ASSIGN", admin);
        for (uint8 i = 0; i < 7; i++) {
            IRoleRegistry.Role r = IRoleRegistry.Role(i);
            address caller = walletFor(r);
            string memory jobId = _uid("JOB-");
            vm.prank(manager);
            jobs.createJob(jobId, nft);
            if (!_allowed(ASSIGN_TECHNICIAN, r)) {
                _expectUnauthorized(caller, ASSIGN_TECHNICIAN);
            }
            vm.prank(caller);
            jobs.assignJob(jobId, technician);
        }
    }

    function test_Matrix_PerformMaintenance() public {
        uint256 nft = mint("ASSET-PERFORM", admin);
        for (uint8 i = 0; i < 7; i++) {
            IRoleRegistry.Role r = IRoleRegistry.Role(i);
            address caller = walletFor(r);
            bool ok = _allowed(PERFORM_MAINTENANCE, r);
            string memory jobId = _uid("JOB-");
            vm.startPrank(manager);
            jobs.createJob(jobId, nft);
            // Allowed roles are assigned the job themselves (OWN semantics);
            // denied roles cannot even be assignees, so assign the technician.
            jobs.assignJob(jobId, ok ? caller : technician);
            vm.stopPrank();
            if (!ok) _expectUnauthorized(caller, PERFORM_MAINTENANCE);
            vm.prank(caller);
            jobs.startJob(jobId);
        }
    }

    function test_Matrix_VerifyMaintenance() public {
        uint256 nft = mint("ASSET-VERIFY", admin);
        for (uint8 i = 0; i < 7; i++) {
            IRoleRegistry.Role r = IRoleRegistry.Role(i);
            address caller = walletFor(r);
            string memory jobId = _uid("JOB-");
            jobToCompleted(jobId, nft);
            if (!_allowed(VERIFY_MAINTENANCE, r)) {
                _expectUnauthorized(caller, VERIFY_MAINTENANCE);
            }
            vm.prank(caller);
            jobs.approveJob(jobId);
        }
    }

    function test_Matrix_TransferAsset() public {
        for (uint8 i = 0; i < 7; i++) {
            IRoleRegistry.Role r = IRoleRegistry.Role(i);
            address caller = walletFor(r);
            uint256 nft = mint(_uid("ASSET-T"), admin);
            if (!_allowed(TRANSFER_ASSET, r)) {
                _expectUnauthorized(caller, TRANSFER_ASSET);
            }
            vm.prank(caller);
            assets.transferAsset(nft, manager);
        }
    }

    // --------------------------- named boundaries from the original skeleton

    function test_TechnicianCannotTransferAsset() public {
        uint256 nft = mint("A-1", admin);
        _expectUnauthorized(technician, BelRoles.TRANSFER_ASSET);
        vm.prank(technician);
        assets.transferAsset(nft, manager);
    }

    function test_EngineerTransferFailsClosedWithoutGrantInterface() public {
        uint256 nft = mint("A-1", admin);
        _expectUnauthorized(engineer, BelRoles.TRANSFER_ASSET);
        vm.prank(engineer);
        assets.transferAsset(nft, manager);
    }

    function test_AuditorCannotModifyAsset() public {
        uint256 nft = mint("A-1", admin);
        vm.startPrank(auditor);
        _expectUnauthorized(auditor, BelRoles.REGISTER_ASSET);
        assets.mintAsset("A-2", admin);
        _expectUnauthorized(auditor, BelRoles.TRANSFER_ASSET);
        assets.transferAsset(nft, manager);
        _expectUnauthorized(auditor, BelRoles.MANAGE_ASSET);
        assets.changeAssetState(nft, "IN_MAINTENANCE");
        _expectUnauthorized(auditor, BelRoles.MANAGE_ASSET);
        assets.attachComponent(nft, nft);
        vm.stopPrank();
    }

    function test_TechnicianCannotAssignJob() public {
        uint256 nft = mint("A-1", admin);
        vm.prank(manager);
        jobs.createJob("J-1", nft);
        _expectUnauthorized(technician, BelRoles.ASSIGN_TECHNICIAN);
        vm.prank(technician);
        jobs.assignJob("J-1", technician);
    }

    function test_ManagerCanAssignTechnician() public {
        uint256 nft = mint("A-1", admin);
        vm.startPrank(manager);
        jobs.createJob("J-1", nft);
        jobs.assignJob("J-1", technician);
        vm.stopPrank();
    }

    function test_EngineerCanVerifyMaintenance() public {
        uint256 nft = mint("A-1", admin);
        jobToCompleted("J-1", nft);
        vm.prank(engineer);
        jobs.approveJob("J-1");
    }

    function test_RevokedWalletCannotTransact() public {
        vm.prank(admin);
        identity.revokeWallet(manager, "compromised");
        // Still holds MANAGER on its identity, but the wallet is dead.
        assertTrue(roles.hasRole(manager, IRoleRegistry.Role.MANAGER));
        vm.expectRevert(abi.encodeWithSelector(BelAccess.InactiveWallet.selector, manager));
        vm.prank(manager);
        assets.mintAsset("A-X", admin);
    }

    function test_PendingWalletCannotTransact() public {
        address w = _pendingWallet();
        vm.prank(admin);
        roles.assignRole(w, IRoleRegistry.Role.MANAGER);
        vm.expectRevert(abi.encodeWithSelector(BelAccess.InactiveWallet.selector, w));
        vm.prank(w);
        assets.mintAsset("A-X", admin);
    }

    function test_UnknownWalletCannotTransact() public {
        vm.expectRevert(abi.encodeWithSelector(BelAccess.InactiveWallet.selector, outsider));
        vm.prank(outsider);
        identity.createIdentity(makeAddr("x"), "DID:X");
    }

    function test_OnlyAdminCanCreateEmployee() public {
        for (uint8 i = 1; i < 7; i++) {
            address caller = walletFor(IRoleRegistry.Role(i));
            _expectUnauthorized(caller, BelRoles.CREATE_EMPLOYEE);
            vm.prank(caller);
            identity.createIdentity(makeAddr("x"), "DID:X");
        }
    }

    function test_OnlyAdminCanManageRoles() public {
        for (uint8 i = 1; i < 7; i++) {
            address caller = walletFor(IRoleRegistry.Role(i));
            _expectUnauthorized(caller, BelRoles.MANAGE_ROLES);
            vm.prank(caller);
            roles.assignRole(caller, IRoleRegistry.Role.ADMIN);
        }
    }
}
