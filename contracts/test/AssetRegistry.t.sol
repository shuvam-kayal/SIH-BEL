// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../src/AssetRegistry.sol";

/// Dependency-free Foundry-style tests. They use low-level calls for revert
/// assertions so this file remains buildable before forge-std is installed.
contract AssetRegistryTest {
    MockRoleRegistry private roles;
    MockIdentityRegistry private identities;
    AssetRegistry private registry;

    function setUp() public {
        roles = new MockRoleRegistry();
        identities = new MockIdentityRegistry();
        registry = new AssetRegistry(address(roles), address(identities));
        identities.setActive(address(this), true);
        roles.setRole(address(this), IRoleRegistry.Role.ADMIN, true);
    }

    function testMintTransferStateAndComponentLifecycle() public {
        setUp();
        uint256 parent = registry.mintAsset("AIRFRAME-1", address(this));
        uint256 component = registry.mintAsset("ENGINE-1", address(this));

        identities.setActive(address(0xBEEF), true);
        registry.transferAsset(parent, address(0xBEEF));
        require(registry.ownerOfAsset(parent) == address(0xBEEF), "owner not transferred");
        require(registry.custodianOf(parent) == address(0xBEEF), "custody not transferred");

        registry.changeAssetState(parent, "IN_MAINTENANCE");
        registry.attachComponent(parent, component);
        require(registry.parentOf(component) == parent, "parent not attached");
        require(registry.componentsOf(parent).length == 1, "component missing");

        registry.removeComponent(parent, component);
        require(registry.parentOf(component) == 0, "parent not removed");
        require(registry.componentsOf(parent).length == 0, "component not removed");
    }

    function testTechnicianCannotTransferAsset() public {
        setUp();
        uint256 nftId = registry.mintAsset("TOOL-1", address(this));
        roles.setRole(address(this), IRoleRegistry.Role.ADMIN, false);
        roles.setRole(address(this), IRoleRegistry.Role.TECHNICIAN, true);

        (bool ok,) = address(registry).call(
            abi.encodeWithSelector(registry.transferAsset.selector, nftId, address(0xBEEF))
        );
        require(!ok, "technician transfer unexpectedly succeeded");
    }

    function testAuditorCannotModifyAsset() public {
        setUp();
        uint256 nftId = registry.mintAsset("TOOL-2", address(this));
        roles.setRole(address(this), IRoleRegistry.Role.ADMIN, false);
        roles.setRole(address(this), IRoleRegistry.Role.AUDITOR, true);

        (bool ok,) = address(registry).call(
            abi.encodeWithSelector(registry.changeAssetState.selector, nftId, "DECOMMISSIONED")
        );
        require(!ok, "auditor modification unexpectedly succeeded");
    }

    function testRevokedWalletCannotTransact() public {
        setUp();
        uint256 nftId = registry.mintAsset("TOOL-3", address(this));
        identities.setActive(address(this), false);

        (bool ok,) = address(registry).call(
            abi.encodeWithSelector(registry.changeAssetState.selector, nftId, "DECOMMISSIONED")
        );
        require(!ok, "revoked wallet transacted");
    }

    function testStateTransitionsAndHierarchyCycleAreRejected() public {
        setUp();
        uint256 stateAsset = registry.mintAsset("STATE", address(this));

        registry.changeAssetState(stateAsset, "IN_MAINTENANCE");
        registry.changeAssetState(stateAsset, "ACTIVE");
        registry.changeAssetState(stateAsset, "DECOMMISSIONED");

        (bool sameState,) = address(registry).call(
            abi.encodeWithSelector(registry.changeAssetState.selector, stateAsset, "ACTIVE")
        );
        require(!sameState, "decommissioned state changed");

        uint256 parent = registry.mintAsset("PARENT", address(this));
        uint256 child = registry.mintAsset("CHILD", address(this));
        uint256 grandchild = registry.mintAsset("GRANDCHILD", address(this));
        registry.attachComponent(parent, child);
        registry.attachComponent(child, grandchild);
        (bool cycle,) = address(registry).call(
            abi.encodeWithSelector(registry.attachComponent.selector, grandchild, parent)
        );
        require(!cycle, "hierarchy cycle unexpectedly succeeded");
    }
}

contract MockRoleRegistry is IRoleRegistry {
    mapping(address => mapping(Role => bool)) private roles;

    function setRole(address identity, Role role, bool enabled) external {
        roles[identity][role] = enabled;
    }

    function assignRole(address identity, Role role) external override {
        roles[identity][role] = true;
    }

    function revokeRole(address identity, Role role) external override {
        roles[identity][role] = false;
    }

    function hasRole(address identity, Role role) external view override returns (bool) {
        return roles[identity][role];
    }
}

contract MockIdentityRegistry is IIdentityRegistry {
    mapping(address => bool) private active;

    function setActive(address wallet, bool enabled) external {
        active[wallet] = enabled;
    }

    function createIdentity(address, string calldata) external override {}
    function activateWallet(address wallet) external override { active[wallet] = true; }
    function revokeWallet(address wallet, string calldata) external override { active[wallet] = false; }
    function isActiveWallet(address wallet) external view override returns (bool) { return active[wallet]; }
    function identityOf(address) external pure override returns (string memory) { return "DID:TEST"; }
}
