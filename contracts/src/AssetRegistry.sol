// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./IAssetRegistry.sol";
import "./IIdentityRegistry.sol";
import "./IRoleRegistry.sol";

/// @notice Base-v1 asset NFT registry with custody and component hierarchy.
/// Sensitive asset documents remain off-chain; only identifiers are stored.
contract AssetRegistry is IAssetRegistry {
    IRoleRegistry public immutable roleRegistry;
    IIdentityRegistry public immutable identityRegistry;

    uint256 private _nextNftId = 1;
    mapping(uint256 => address) private _owners;
    mapping(uint256 => address) private _custodians;
    mapping(uint256 => uint256) private _parents;
    mapping(uint256 => uint256[]) private _components;
    mapping(uint256 => string) private _assetIds;
    mapping(uint256 => string) private _states;

    constructor(address roleRegistryAddress, address identityRegistryAddress) {
        require(roleRegistryAddress != address(0), "role registry is zero");
        require(identityRegistryAddress != address(0), "identity registry is zero");
        roleRegistry = IRoleRegistry(roleRegistryAddress);
        identityRegistry = IIdentityRegistry(identityRegistryAddress);
    }

    /// A revoked wallet cannot transact even when its persistent identity
    /// still has a permitted role. This modifier is deliberately first on
    /// every state-changing entry point.
    modifier activeWallet() {
        require(identityRegistry.isActiveWallet(msg.sender), "wallet inactive");
        _;
    }

    modifier assetWriter() {
        require(
            _hasRole(msg.sender, IRoleRegistry.Role.ADMIN) ||
                _hasRole(msg.sender, IRoleRegistry.Role.MANAGER) ||
                _hasRole(msg.sender, IRoleRegistry.Role.ENGINEER),
            "asset writer role required"
        );
        _;
    }

    function mintAsset(string calldata assetId, address owner)
        external
        override
        activeWallet
        returns (uint256 nftId)
    {
        require(
            _hasRole(msg.sender, IRoleRegistry.Role.ADMIN) ||
                _hasRole(msg.sender, IRoleRegistry.Role.MANAGER) ||
                _hasRole(msg.sender, IRoleRegistry.Role.ENGINEER) ||
                _hasRole(msg.sender, IRoleRegistry.Role.ISSUER),
            "mint role required"
        );
        require(bytes(assetId).length > 0, "asset id is empty");
        require(owner != address(0), "owner is zero");

        nftId = _nextNftId++;
        _owners[nftId] = owner;
        _custodians[nftId] = owner;
        _assetIds[nftId] = assetId;
        _states[nftId] = "ACTIVE";
        emit AssetMinted(nftId, assetId, owner);
    }

    function transferAsset(uint256 nftId, address newOwner) external override activeWallet {
        // The frozen interface has no grant reference. Engineer AUTH is
        // enforced by the backend until the team approves an interface update;
        // base-v1 on-chain transfer is therefore restricted to ADMIN/MANAGER.
        require(
            _hasRole(msg.sender, IRoleRegistry.Role.ADMIN) ||
                _hasRole(msg.sender, IRoleRegistry.Role.MANAGER),
            "transfer role required"
        );
        _requireExists(nftId);
        require(newOwner != address(0), "owner is zero");

        address previousOwner = _owners[nftId];
        _owners[nftId] = newOwner;
        _custodians[nftId] = newOwner;
        emit AssetTransferred(nftId, previousOwner, newOwner);
    }

    function changeAssetState(uint256 nftId, string calldata newState)
        external
        override
        activeWallet
        assetWriter
    {
        _requireExists(nftId);
        require(_validState(newState), "invalid asset state");
        string memory previousState = _states[nftId];
        _states[nftId] = newState;
        emit AssetStateChanged(nftId, previousState, newState);
    }

    function attachComponent(uint256 parentNftId, uint256 componentNftId)
        external
        override
        activeWallet
        assetWriter
    {
        _requireExists(parentNftId);
        _requireExists(componentNftId);
        require(parentNftId != componentNftId, "asset cannot parent itself");
        require(_parents[componentNftId] == 0, "component already attached");

        _parents[componentNftId] = parentNftId;
        _components[parentNftId].push(componentNftId);
        emit ComponentAttached(parentNftId, componentNftId);
    }

    function removeComponent(uint256 parentNftId, uint256 componentNftId)
        external
        override
        activeWallet
        assetWriter
    {
        _requireExists(parentNftId);
        _requireExists(componentNftId);
        require(_parents[componentNftId] == parentNftId, "component not attached");

        uint256[] storage children = _components[parentNftId];
        for (uint256 i = 0; i < children.length; i++) {
            if (children[i] == componentNftId) {
                children[i] = children[children.length - 1];
                children.pop();
                delete _parents[componentNftId];
                emit ComponentRemoved(parentNftId, componentNftId);
                return;
            }
        }
        revert("component index missing");
    }

    function parentOf(uint256 nftId) external view override returns (uint256) {
        _requireExists(nftId);
        return _parents[nftId];
    }

    function componentsOf(uint256 nftId) external view override returns (uint256[] memory) {
        _requireExists(nftId);
        return _components[nftId];
    }

    function ownerOfAsset(uint256 nftId) external view override returns (address) {
        _requireExists(nftId);
        return _owners[nftId];
    }

    function custodianOf(uint256 nftId) external view override returns (address) {
        _requireExists(nftId);
        return _custodians[nftId];
    }

    function _hasRole(address account, IRoleRegistry.Role role) internal view returns (bool) {
        return roleRegistry.hasRole(account, role);
    }

    function _requireExists(uint256 nftId) internal view {
        require(_owners[nftId] != address(0), "asset does not exist");
    }

    function _validState(string calldata state) internal pure returns (bool) {
        bytes32 value = keccak256(bytes(state));
        return
            value == keccak256("ACTIVE") ||
            value == keccak256("IN_MAINTENANCE") ||
            value == keccak256("DECOMMISSIONED");
    }
}
