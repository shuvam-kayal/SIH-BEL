// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { BelFixture } from "./utils/BelFixture.sol";
import { AssetRegistry } from "../src/AssetRegistry.sol";
import { IAssetRegistry } from "../src/IAssetRegistry.sol";

contract AssetRegistryTest is BelFixture {
    // ---------------------------------------------------------------- mint

    function test_MintSetsOwnerCustodianAndState() public {
        vm.expectEmit(true, false, true, true, address(assets));
        emit AssetMinted(1, "PUMP-001", manager);
        vm.prank(engineer);
        uint256 id = assets.mintAsset("PUMP-001", manager);

        assertEq(id, 1);
        assertEq(assets.ownerOfAsset(id), manager);
        assertEq(assets.ownerOf(id), manager); // ERC-721 view
        assertEq(assets.balanceOf(manager), 1);
        assertEq(assets.custodianOf(id), manager);
        assertEq(assets.stateOf(id), "ACTIVE");
        assertEq(assets.nftIdOf("PUMP-001"), id);
        assertEq(assets.parentOf(id), 0);
        assertEq(assets.getAsset(id).assetId, "PUMP-001");
        assertEq(assets.totalMinted(), 1);
    }

    function test_SupportsErc721Interface() public view {
        assertTrue(assets.supportsInterface(0x80ac58cd));
    }

    function test_RevertWhen_DuplicateAssetId() public {
        mint("PUMP-001", admin);
        vm.expectRevert(
            abi.encodeWithSelector(AssetRegistry.AssetAlreadyExists.selector, "PUMP-001")
        );
        vm.prank(admin);
        assets.mintAsset("PUMP-001", admin);
    }

    function test_RevertWhen_InvalidMintInput() public {
        vm.startPrank(admin);
        vm.expectRevert(AssetRegistry.InvalidAssetId.selector);
        assets.mintAsset("", admin);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.InvalidRecipient.selector, address(0)));
        assets.mintAsset("A", address(0));
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.InvalidRecipient.selector, outsider));
        assets.mintAsset("A", outsider);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ transfer

    function test_TransferMovesOwnershipAndCustody() public {
        uint256 id = mint("PUMP-001", admin);
        vm.expectEmit(true, true, true, true, address(assets));
        emit AssetTransferred(id, admin, engineer);
        vm.prank(manager);
        assets.transferAsset(id, engineer);
        assertEq(assets.ownerOfAsset(id), engineer);
        assertEq(assets.custodianOf(id), engineer);
        // Provenance: owning identity is resolvable from the token owner.
        assertEq(identity.identityOf(assets.ownerOf(id)), "DID:BEL:ENGINEER");
    }

    function test_RevertWhen_TransferToRevokedOrSameOwner() public {
        uint256 id = mint("PUMP-001", admin);
        vm.prank(admin);
        identity.revokeWallet(engineer, "gone");
        vm.startPrank(manager);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.InvalidRecipient.selector, engineer));
        assets.transferAsset(id, engineer);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.InvalidRecipient.selector, admin));
        assets.transferAsset(id, admin);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.AssetNotFound.selector, 99));
        assets.transferAsset(99, manager);
        vm.stopPrank();
    }

    function test_DirectErc721TransfersAreDisabled() public {
        uint256 id = mint("PUMP-001", manager);
        vm.startPrank(manager);
        vm.expectRevert(AssetRegistry.DirectTransferDisabled.selector);
        assets.transferFrom(manager, engineer, id);
        vm.expectRevert(AssetRegistry.DirectTransferDisabled.selector);
        assets.safeTransferFrom(manager, engineer, id);
        vm.expectRevert(AssetRegistry.DirectTransferDisabled.selector);
        assets.safeTransferFrom(manager, engineer, id, "");
        vm.expectRevert(AssetRegistry.DirectTransferDisabled.selector);
        assets.approve(engineer, id);
        vm.expectRevert(AssetRegistry.DirectTransferDisabled.selector);
        assets.setApprovalForAll(engineer, true);
        vm.stopPrank();
        assertEq(assets.ownerOf(id), manager);
    }

    // ----------------------------------------------------------- lifecycle

    function test_StateLifecycle() public {
        uint256 id = mint("PUMP-001", admin);
        vm.startPrank(engineer);
        vm.expectEmit(true, false, false, true, address(assets));
        emit AssetStateChanged(id, "ACTIVE", "IN_MAINTENANCE");
        assets.changeAssetState(id, "IN_MAINTENANCE");
        assets.changeAssetState(id, "ACTIVE");
        assets.changeAssetState(id, "DECOMMISSIONED");
        vm.stopPrank();
        assertEq(assets.stateOf(id), "DECOMMISSIONED");
    }

    function test_RevertWhen_InvalidStateChange() public {
        uint256 id = mint("PUMP-001", admin);
        vm.startPrank(engineer);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.UnknownState.selector, "BROKEN"));
        assets.changeAssetState(id, "BROKEN");
        vm.expectRevert(
            abi.encodeWithSelector(
                AssetRegistry.InvalidStateTransition.selector,
                id,
                AssetRegistry.AssetState.ACTIVE,
                AssetRegistry.AssetState.ACTIVE
            )
        );
        assets.changeAssetState(id, "ACTIVE");
        assets.changeAssetState(id, "DECOMMISSIONED");
        vm.expectRevert(
            abi.encodeWithSelector(
                AssetRegistry.InvalidStateTransition.selector,
                id,
                AssetRegistry.AssetState.DECOMMISSIONED,
                AssetRegistry.AssetState.ACTIVE
            )
        );
        assets.changeAssetState(id, "ACTIVE");
        vm.stopPrank();
    }

    function test_DecommissionedAssetCannotBeTransferred() public {
        uint256 id = mint("PUMP-001", admin);
        vm.prank(engineer);
        assets.changeAssetState(id, "DECOMMISSIONED");
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.AssetDecommissioned.selector, id));
        vm.prank(admin);
        assets.transferAsset(id, manager);
    }

    // ---------------------------------------------------------- components

    function test_AttachAndRemoveComponents() public {
        uint256 parent = mint("ENGINE-1", admin);
        uint256 c1 = mint("VALVE-1", admin);
        uint256 c2 = mint("VALVE-2", admin);
        uint256 c3 = mint("VALVE-3", admin);

        vm.startPrank(engineer);
        vm.expectEmit(true, true, false, false, address(assets));
        emit ComponentAttached(parent, c1);
        assets.attachComponent(parent, c1);
        assets.attachComponent(parent, c2);
        assets.attachComponent(parent, c3);
        assertEq(assets.parentOf(c2), parent);
        assertEq(assets.componentsOf(parent).length, 3);

        vm.expectEmit(true, true, false, false, address(assets));
        emit ComponentRemoved(parent, c1);
        assets.removeComponent(parent, c1); // swap-and-pop keeps the rest intact
        vm.stopPrank();

        uint256[] memory left = assets.componentsOf(parent);
        assertEq(left.length, 2);
        assertEq(left[0], c3);
        assertEq(left[1], c2);
        assertEq(assets.parentOf(c1), 0);

        vm.startPrank(engineer);
        assets.removeComponent(parent, c2);
        assets.removeComponent(parent, c3);
        vm.stopPrank();
        assertEq(assets.componentsOf(parent).length, 0);
    }

    function test_RevertWhen_InvalidComponentOps() public {
        uint256 a = mint("A", admin);
        uint256 b = mint("B", admin);
        uint256 c = mint("C", admin);
        vm.startPrank(engineer);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.SelfAttachment.selector, a));
        assets.attachComponent(a, a);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.AssetNotFound.selector, 42));
        assets.attachComponent(a, 42);

        assets.attachComponent(a, b);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.AlreadyAttached.selector, b, a));
        assets.attachComponent(c, b);

        assets.attachComponent(b, c); // a -> b -> c
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.CyclicHierarchy.selector, c, a));
        assets.attachComponent(c, a);

        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.NotAttached.selector, a, c));
        assets.removeComponent(a, c);
        vm.stopPrank();

        // An attached component must be detached before it changes hands.
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.ComponentIsAttached.selector, b));
        vm.prank(admin);
        assets.transferAsset(b, manager);
    }

    function test_RevertWhen_AttachDecommissioned() public {
        uint256 a = mint("A", admin);
        uint256 b = mint("B", admin);
        vm.startPrank(engineer);
        assets.changeAssetState(b, "DECOMMISSIONED");
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.AssetDecommissioned.selector, b));
        assets.attachComponent(a, b);
        vm.stopPrank();
    }

    function testFuzz_MintManyUniqueIds(uint8 n) public {
        n = uint8(bound(n, 1, 30));
        for (uint256 i = 1; i <= n; i++) {
            uint256 id = mint(string.concat("F-", vm.toString(i)), admin);
            assertEq(id, i);
        }
        assertEq(assets.balanceOf(admin), n);
    }
}
