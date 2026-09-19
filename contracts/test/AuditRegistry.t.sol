// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Vm } from "forge-std/Vm.sol";
import { BelFixture } from "./utils/BelFixture.sol";
import { AuditRegistry } from "../src/AuditRegistry.sol";
import { IRoleRegistry } from "../src/IRoleRegistry.sol";

contract AuditRegistryTest is BelFixture {
    function test_RegistriesRecordAttributedAuditTrail() public {
        uint256 nft = mint("PUMP-001", admin);
        vm.prank(manager);
        jobs.createJob("J-1", nft);
        vm.prank(manager);
        assets.transferAsset(nft, engineer);

        bytes32[] memory assetTrail = audit.getAuditTrail("PUMP-001");
        assertEq(assetTrail.length, 2);
        AuditRegistry.AuditRecord memory mintRec = audit.getAuditRecord(assetTrail[0]);
        assertEq(mintRec.entityType, "ASSET");
        assertEq(mintRec.action, "ASSET_MINT");
        assertEq(mintRec.actor, admin); // the user, not the registry contract
        assertEq(mintRec.recorder, address(assets));
        assertEq(audit.getAuditRecord(assetTrail[1]).action, "ASSET_TRANSFER");
        assertEq(audit.getAuditRecord(assetTrail[1]).actor, manager);

        bytes32[] memory jobTrail = audit.getAuditTrail("J-1");
        assertEq(jobTrail.length, 1);
        assertEq(audit.getAuditRecord(jobTrail[0]).action, "JOB_CREATE");
    }

    function test_IdentityAndWalletEventsAreAudited() public {
        // Fixture onboarding already recorded IDENTITY_CREATE + ROLE_ASSIGN.
        bytes32[] memory trail = audit.getAuditTrail("DID:BEL:TECH");
        assertEq(trail.length, 2);
        assertEq(audit.getAuditRecord(trail[0]).action, "IDENTITY_CREATE");
        assertEq(audit.getAuditRecord(trail[1]).action, "ROLE_ASSIGN");

        vm.prank(admin);
        identity.revokeWallet(technician, "lost");
        // Wallet entity ids are lowercase 0x-hex addresses.
        bytes32[] memory wTrail = audit.getAuditTrail(vm.toLowercase(vm.toString(technician)));
        assertEq(wTrail.length, 2);
        assertEq(audit.getAuditRecord(wTrail[0]).action, "WALLET_ACTIVATE");
        assertEq(audit.getAuditRecord(wTrail[1]).action, "WALLET_REVOKE");
    }

    function test_AuditRecordedEventEmitted() public {
        vm.recordLogs();
        mint("PUMP-001", admin);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("AuditRecorded(bytes32,string,string,string,address,uint256)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(audit) && logs[i].topics[0] == sig) {
                found = true;
                assertEq(logs[i].topics[2], bytes32(uint256(uint160(admin))));
            }
        }
        assertTrue(found);
    }

    function test_TxIdsAreUnique() public {
        mint("A", admin);
        mint("B", admin);
        assertTrue(audit.getAuditTrail("A")[0] != audit.getAuditTrail("B")[0]);
    }

    function test_AdminCanRecordManualLifecycleEvent() public {
        vm.prank(admin);
        bytes32 txId = audit.recordAudit("DEVICE", "BEL-DEV-001", "DEVICE_REVOKE");
        AuditRegistry.AuditRecord memory r = audit.getAuditRecord(txId);
        assertEq(r.actor, admin);
        assertEq(r.entityType, "DEVICE");
    }

    function test_RevertWhen_UnauthorizedWriter() public {
        vm.expectRevert(abi.encodeWithSelector(AuditRegistry.NotRecorder.selector, manager));
        vm.prank(manager);
        audit.recordAudit("ASSET", "A", "FAKE");

        vm.expectRevert(abi.encodeWithSelector(AuditRegistry.NotRecorder.selector, admin));
        vm.prank(admin);
        audit.recordAuditFor(manager, "ASSET", "A", "FAKE"); // cannot forge attribution
    }

    function test_RevokedAdminCannotRecord() public {
        vm.startPrank(admin);
        roles.assignRole(manager, IRoleRegistry.Role.ADMIN);
        vm.stopPrank();
        vm.prank(manager);
        identity.revokeWallet(admin, "rotated");
        vm.expectRevert(abi.encodeWithSelector(AuditRegistry.NotRecorder.selector, admin));
        vm.prank(admin);
        audit.recordAudit("DEVICE", "D", "X");
    }

    function test_RevertWhen_InvalidAuditFields() public {
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(AuditRegistry.InvalidEntityType.selector, "CAT"));
        audit.recordAudit("CAT", "A", "X");
        vm.expectRevert(AuditRegistry.InvalidEntityId.selector);
        audit.recordAudit("ASSET", "", "X");
        vm.expectRevert(AuditRegistry.InvalidAction.selector);
        audit.recordAudit("ASSET", "A", "");
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(AuditRegistry.RecordNotFound.selector, bytes32(0)));
        audit.getAuditRecord(bytes32(0));
    }
}
