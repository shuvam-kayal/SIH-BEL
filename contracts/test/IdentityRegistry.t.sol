// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { BelFixture } from "./utils/BelFixture.sol";
import { BelAccess } from "../src/BelAccess.sol";
import { IdentityRegistry } from "../src/IdentityRegistry.sol";
import { RoleRegistry } from "../src/RoleRegistry.sol";
import { IRoleRegistry } from "../src/IRoleRegistry.sol";

contract IdentityRegistryTest is BelFixture {
    address private newWallet = makeAddr("new");

    function test_BootstrapAdminIsActiveWithAdminRole() public view {
        assertTrue(identity.isActiveWallet(admin));
        assertEq(identity.identityOf(admin), ADMIN_DID);
        assertTrue(roles.hasRole(admin, IRoleRegistry.Role.ADMIN));
        assertEq(roles.adminCount(), 1);
    }

    function test_CreateIdentityRegistersPendingWallet() public {
        vm.expectEmit(true, false, false, true, address(identity));
        emit IdentityCreated(newWallet, "DID:BEL:100");
        vm.prank(admin);
        identity.createIdentity(newWallet, "DID:BEL:100");

        assertEq(
            uint8(identity.walletStatus(newWallet)), uint8(IdentityRegistry.WalletStatus.PENDING)
        );
        assertFalse(identity.isActiveWallet(newWallet));
        assertEq(identity.identityOf(newWallet), "DID:BEL:100");
        assertTrue(identity.identityExists("DID:BEL:100"));
    }

    function test_ActivateWalletLifecycle() public {
        vm.startPrank(admin);
        identity.createIdentity(newWallet, "DID:BEL:100");
        vm.expectEmit(true, false, false, true, address(identity));
        emit WalletActivated(newWallet, "DID:BEL:100");
        identity.activateWallet(newWallet);
        vm.stopPrank();
        assertTrue(identity.isActiveWallet(newWallet));
        assertGt(identity.getWallet(newWallet).activatedAt, 0);
    }

    function test_IssuerCanActivateWallet() public {
        vm.prank(admin);
        identity.createIdentity(newWallet, "DID:BEL:100");
        vm.prank(issuer);
        identity.activateWallet(newWallet);
        assertTrue(identity.isActiveWallet(newWallet));
    }

    function test_RevokeWalletKeepsIdentityAndRoles() public {
        vm.expectEmit(true, false, false, true, address(identity));
        emit WalletRevoked(technician, "device lost");
        vm.prank(admin);
        identity.revokeWallet(technician, "device lost");

        assertFalse(identity.isActiveWallet(technician));
        assertEq(identity.identityOf(technician), "DID:BEL:TECH");
        assertTrue(roles.hasRole(technician, IRoleRegistry.Role.TECHNICIAN));
        IdentityRegistry.WalletRecord memory w = identity.getWallet(technician);
        assertEq(w.revokedReason, "device lost");
        assertGt(w.revokedAt, 0);
    }

    function test_ReplacementWalletInheritsIdentityAndRoles() public {
        address replacement = makeAddr("tech-replacement");
        vm.startPrank(admin);
        identity.revokeWallet(technician, "replaced");
        identity.createIdentity(replacement, "DID:BEL:TECH"); // WALLET_REGISTER
        identity.activateWallet(replacement);
        vm.stopPrank();

        assertEq(identity.identityOf(replacement), "DID:BEL:TECH");
        assertTrue(roles.hasRole(replacement, IRoleRegistry.Role.TECHNICIAN));
        address[] memory ws = identity.walletsOf("DID:BEL:TECH");
        assertEq(ws.length, 2);
        assertEq(ws[0], technician);
        assertEq(ws[1], replacement);
    }

    // ------------------------------------------------------- invalid input

    function test_RevertWhen_DuplicateWallet() public {
        vm.startPrank(admin);
        identity.createIdentity(newWallet, "DID:BEL:100");
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.WalletAlreadyRegistered.selector, newWallet)
        );
        identity.createIdentity(newWallet, "DID:BEL:101");
        vm.stopPrank();
    }

    function test_RevertWhen_RevokedWalletReRegistered() public {
        vm.startPrank(admin);
        identity.revokeWallet(technician, "gone");
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.WalletAlreadyRegistered.selector, technician)
        );
        identity.createIdentity(technician, "DID:BEL:TECH");
        vm.stopPrank();
    }

    function test_RevertWhen_ZeroWalletOrEmptyDid() public {
        vm.startPrank(admin);
        vm.expectRevert(IdentityRegistry.InvalidWallet.selector);
        identity.createIdentity(address(0), "DID:BEL:1");
        vm.expectRevert(IdentityRegistry.InvalidDid.selector);
        identity.createIdentity(newWallet, "");
        string memory tooLong = string(new bytes(129));
        vm.expectRevert(IdentityRegistry.InvalidDid.selector);
        identity.createIdentity(newWallet, tooLong);
        vm.stopPrank();
    }

    function test_RevertWhen_ActivateUnknownOrActiveOrRevoked() public {
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(IdentityRegistry.WalletNotFound.selector, newWallet));
        identity.activateWallet(newWallet);

        vm.expectRevert(
            abi.encodeWithSelector(
                IdentityRegistry.InvalidWalletStatus.selector,
                manager,
                IdentityRegistry.WalletStatus.ACTIVE
            )
        );
        identity.activateWallet(manager);

        identity.revokeWallet(manager, "gone");
        vm.expectRevert(
            abi.encodeWithSelector(
                IdentityRegistry.InvalidWalletStatus.selector,
                manager,
                IdentityRegistry.WalletStatus.REVOKED
            )
        );
        identity.activateWallet(manager);
        vm.stopPrank();
    }

    function test_RevertWhen_RevokeTwiceOrWithoutReason() public {
        vm.startPrank(admin);
        vm.expectRevert(IdentityRegistry.InvalidReason.selector);
        identity.revokeWallet(manager, "");
        identity.revokeWallet(manager, "gone");
        vm.expectRevert(
            abi.encodeWithSelector(
                IdentityRegistry.InvalidWalletStatus.selector,
                manager,
                IdentityRegistry.WalletStatus.REVOKED
            )
        );
        identity.revokeWallet(manager, "again");
        vm.expectRevert(abi.encodeWithSelector(IdentityRegistry.WalletNotFound.selector, newWallet));
        identity.revokeWallet(newWallet, "never existed");
        vm.stopPrank();
    }

    function test_PendingWalletCanBeRevoked() public {
        vm.startPrank(admin);
        identity.createIdentity(newWallet, "DID:BEL:100");
        identity.revokeWallet(newWallet, "rejected registration");
        vm.stopPrank();
        assertEq(
            uint8(identity.walletStatus(newWallet)), uint8(IdentityRegistry.WalletStatus.REVOKED)
        );
    }

    // -------------------------------------------------------------- wiring

    function test_RevertWhen_NotWired() public {
        IdentityRegistry fresh = new IdentityRegistry(admin, ADMIN_DID);
        vm.expectRevert(BelAccess.NotWired.selector);
        vm.prank(admin);
        fresh.createIdentity(newWallet, "DID:BEL:1");
    }

    function test_RevertWhen_WireTwiceOrByStranger() public {
        vm.expectRevert(BelAccess.AlreadyWired.selector);
        identity.wire(address(identity), address(roles), address(audit));

        IdentityRegistry fresh = new IdentityRegistry(admin, ADMIN_DID);
        vm.expectRevert(BelAccess.NotDeployer.selector);
        vm.prank(admin);
        fresh.wire(address(identity), address(roles), address(audit));

        vm.expectRevert(BelAccess.ZeroAddress.selector);
        fresh.wire(address(0), address(roles), address(audit));
    }
}

contract RoleRegistryTest is BelFixture {
    function test_AssignAndRevokeRole() public {
        vm.startPrank(admin);
        vm.expectEmit(true, false, false, true, address(roles));
        emit RoleAssigned(technician, IRoleRegistry.Role.AUDITOR);
        roles.assignRole(technician, IRoleRegistry.Role.AUDITOR);
        assertTrue(roles.hasRole(technician, IRoleRegistry.Role.AUDITOR));
        assertTrue(roles.hasRole(technician, IRoleRegistry.Role.TECHNICIAN));

        vm.expectEmit(true, false, false, true, address(roles));
        emit RoleRevoked(technician, IRoleRegistry.Role.AUDITOR);
        roles.revokeRole(technician, IRoleRegistry.Role.AUDITOR);
        vm.stopPrank();
        assertFalse(roles.hasRole(technician, IRoleRegistry.Role.AUDITOR));
    }

    function test_RolesBelongToIdentityNotWallet() public view {
        assertEq(roles.rolesOfIdentity("DID:BEL:TECH"), roles.rolesOf(technician));
    }

    function test_RevertWhen_DuplicateOrMissingRole() public {
        vm.startPrank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                RoleRegistry.RoleAlreadyAssigned.selector, technician, IRoleRegistry.Role.TECHNICIAN
            )
        );
        roles.assignRole(technician, IRoleRegistry.Role.TECHNICIAN);
        vm.expectRevert(
            abi.encodeWithSelector(
                RoleRegistry.RoleNotAssigned.selector, technician, IRoleRegistry.Role.ADMIN
            )
        );
        roles.revokeRole(technician, IRoleRegistry.Role.ADMIN);
        vm.stopPrank();
    }

    function test_RevertWhen_UnknownIdentity() public {
        vm.expectRevert(abi.encodeWithSelector(RoleRegistry.UnknownIdentity.selector, outsider));
        vm.prank(admin);
        roles.assignRole(outsider, IRoleRegistry.Role.MANAGER);
        assertFalse(roles.hasRole(outsider, IRoleRegistry.Role.MANAGER));
    }

    function test_CannotRemoveLastAdmin() public {
        vm.startPrank(admin);
        vm.expectRevert(RoleRegistry.LastAdmin.selector);
        roles.revokeRole(admin, IRoleRegistry.Role.ADMIN);

        roles.assignRole(manager, IRoleRegistry.Role.ADMIN);
        assertEq(roles.adminCount(), 2);
        roles.revokeRole(admin, IRoleRegistry.Role.ADMIN);
        vm.stopPrank();
        assertEq(roles.adminCount(), 1);
        assertFalse(roles.hasRole(admin, IRoleRegistry.Role.ADMIN));
    }

    function test_RevertWhen_BootstrapWalletUnknown() public {
        vm.expectRevert(abi.encodeWithSelector(RoleRegistry.UnknownIdentity.selector, outsider));
        new RoleRegistry(address(identity), outsider);
    }
}
