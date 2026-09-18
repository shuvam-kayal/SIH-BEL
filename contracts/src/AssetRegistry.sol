// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./IAssetRegistry.sol";
import "./IIdentityRegistry.sol";
import "./IRoleRegistry.sol";

/// @notice Asset NFT identity, custody, lifecycle state and hierarchy.
/// Asset metadata/documents remain off-chain; only the public asset reference
/// and wallet relationships are stored here.
contract AssetRegistry is IAssetRegistry {
    enum AssetState {
        NONE,
        ACTIVE,
        IN_MAINTENANCE,
        DECOMMISSIONED
    }

    struct AssetRecord {
        string assetId;
        address custodian;
        uint256 parent;
        AssetState state;
        uint64 mintedAt;
    }

    error AssetAlreadyExists(string assetId);
    error AssetNotFound(uint256 nftId);
    error InvalidAssetId();
    error InvalidRecipient(address account);
    error UnknownState(string state);
    error InvalidStateTransition(uint256 nftId, AssetState from, AssetState to);
    error AssetDecommissioned(uint256 nftId);
    error SelfAttachment(uint256 nftId);
    error AlreadyAttached(uint256 componentNftId, uint256 currentParent);
    error NotAttached(uint256 parentNftId, uint256 componentNftId);
    error CyclicHierarchy(uint256 parentNftId, uint256 componentNftId);
    error ComponentIsAttached(uint256 nftId);

    uint256 public constant MAX_ASSET_ID_LENGTH = 128;

    IRoleRegistry public immutable roleRegistry;
    IIdentityRegistry public immutable identityRegistry;

    uint256 private _nextNftId = 1;
    mapping(uint256 => address) private _owners;
    mapping(uint256 => AssetRecord) private _assets;
    mapping(bytes32 => uint256) private _idByAssetId;
    mapping(uint256 => uint256[]) private _components;
    mapping(uint256 => uint256) private _componentIndex;

    constructor(address roleRegistryAddress, address identityRegistryAddress) {
        require(roleRegistryAddress != address(0), "role registry is zero");
        require(identityRegistryAddress != address(0), "identity registry is zero");
        roleRegistry = IRoleRegistry(roleRegistryAddress);
        identityRegistry = IIdentityRegistry(identityRegistryAddress);
    }

    /// Every state-changing path checks wallet revocation before role checks.
    modifier activeWallet() {
        require(identityRegistry.isActiveWallet(msg.sender), "wallet inactive");
        _;
    }

    /// State and hierarchy management use the same ALLOW roles as registering
    /// an asset. ENGINEER AUTH transfer remains backend-only until the frozen
    /// interface can carry and verify a grant reference.
    modifier assetWriter() {
        require(
            _hasRole(msg.sender, IRoleRegistry.Role.ADMIN) ||
                _hasRole(msg.sender, IRoleRegistry.Role.MANAGER) ||
                _hasRole(msg.sender, IRoleRegistry.Role.ENGINEER) ||
                _hasRole(msg.sender, IRoleRegistry.Role.ISSUER),
            "asset writer role required"
        );
        _;
    }

    function mintAsset(string calldata assetId, address owner)
        external
        override
        activeWallet
        assetWriter
        returns (uint256 nftId)
    {
        require(bytes(assetId).length > 0 && bytes(assetId).length <= MAX_ASSET_ID_LENGTH, "invalid asset id");
        _requireActiveRecipient(owner);
        bytes32 key = keccak256(bytes(assetId));
        if (_idByAssetId[key] != 0) revert AssetAlreadyExists(assetId);

        nftId = _nextNftId++;
        _idByAssetId[key] = nftId;
        _owners[nftId] = owner;
        _assets[nftId] = AssetRecord({
            assetId: assetId,
            custodian: owner,
            parent: 0,
            state: AssetState.ACTIVE,
            mintedAt: uint64(block.timestamp)
        });
        emit AssetMinted(nftId, assetId, owner);
    }

    function transferAsset(uint256 nftId, address newOwner) external override activeWallet {
        require(
            _hasRole(msg.sender, IRoleRegistry.Role.ADMIN) ||
                _hasRole(msg.sender, IRoleRegistry.Role.MANAGER),
            "transfer role required"
        );
        AssetRecord storage asset = _existing(nftId);
        if (asset.state == AssetState.DECOMMISSIONED) revert AssetDecommissioned(nftId);
        if (asset.parent != 0) revert ComponentIsAttached(nftId);
        _requireActiveRecipient(newOwner);
        address previousOwner = ownerOfAsset(nftId);
        require(previousOwner != newOwner, "owner unchanged");
        _owners[nftId] = newOwner;
        asset.custodian = newOwner;
        emit AssetTransferred(nftId, previousOwner, newOwner);
    }

    function changeAssetState(uint256 nftId, string calldata newState)
        external
        override
        activeWallet
        assetWriter
    {
        AssetRecord storage asset = _existing(nftId);
        AssetState next = _parseState(newState);
        AssetState previous = asset.state;
        if (previous == next || previous == AssetState.DECOMMISSIONED) {
            revert InvalidStateTransition(nftId, previous, next);
        }
        asset.state = next;
        emit AssetStateChanged(nftId, _stateName(previous), newState);
    }

    function attachComponent(uint256 parentNftId, uint256 componentNftId)
        external
        override
        activeWallet
        assetWriter
    {
        if (parentNftId == componentNftId) revert SelfAttachment(parentNftId);
        AssetRecord storage parent = _existing(parentNftId);
        AssetRecord storage component = _existing(componentNftId);
        if (parent.state == AssetState.DECOMMISSIONED || component.state == AssetState.DECOMMISSIONED) {
            revert AssetDecommissioned(parent.state == AssetState.DECOMMISSIONED ? parentNftId : componentNftId);
        }
        if (component.parent != 0) revert AlreadyAttached(componentNftId, component.parent);

        for (uint256 current = parent.parent; current != 0; current = _assets[current].parent) {
            if (current == componentNftId) revert CyclicHierarchy(parentNftId, componentNftId);
        }

        component.parent = parentNftId;
        _components[parentNftId].push(componentNftId);
        _componentIndex[componentNftId] = _components[parentNftId].length;
        emit ComponentAttached(parentNftId, componentNftId);
    }

    function removeComponent(uint256 parentNftId, uint256 componentNftId)
        external
        override
        activeWallet
        assetWriter
    {
        _existing(parentNftId);
        AssetRecord storage component = _existing(componentNftId);
        if (component.parent != parentNftId) revert NotAttached(parentNftId, componentNftId);

        uint256[] storage children = _components[parentNftId];
        uint256 index = _componentIndex[componentNftId] - 1;
        uint256 last = children[children.length - 1];
        children[index] = last;
        _componentIndex[last] = index + 1;
        children.pop();
        delete _componentIndex[componentNftId];
        component.parent = 0;
        emit ComponentRemoved(parentNftId, componentNftId);
    }

    function parentOf(uint256 nftId) external view override returns (uint256) {
        return _existing(nftId).parent;
    }

    function componentsOf(uint256 nftId) external view override returns (uint256[] memory) {
        _existing(nftId);
        return _components[nftId];
    }

    function ownerOfAsset(uint256 nftId) public view override returns (address) {
        _existing(nftId);
        return _owners[nftId];
    }

    function custodianOf(uint256 nftId) external view override returns (address) {
        return _existing(nftId).custodian;
    }

    /// Optional read helpers used by an EVM adapter to reconcile chain-issued
    /// token ids and authoritative state without changing IAssetRegistry.
    function nftIdOf(string calldata assetId) external view returns (uint256) {
        return _idByAssetId[keccak256(bytes(assetId))];
    }

    function exists(uint256 nftId) external view returns (bool) {
        return _assets[nftId].state != AssetState.NONE;
    }

    function stateOf(uint256 nftId) external view returns (string memory) {
        return _stateName(_existing(nftId).state);
    }

    function getAsset(uint256 nftId) external view returns (AssetRecord memory) {
        return _existing(nftId);
    }

    function totalMinted() external view returns (uint256) {
        return _nextNftId - 1;
    }

    function _hasRole(address account, IRoleRegistry.Role role) internal view returns (bool) {
        return roleRegistry.hasRole(account, role);
    }

    function _existing(uint256 nftId) internal view returns (AssetRecord storage asset) {
        asset = _assets[nftId];
        if (asset.state == AssetState.NONE) revert AssetNotFound(nftId);
    }

    function _requireActiveRecipient(address account) internal view {
        if (account == address(0) || !identityRegistry.isActiveWallet(account)) {
            revert InvalidRecipient(account);
        }
    }

    function _parseState(string calldata state) internal pure returns (AssetState) {
        bytes32 value = keccak256(bytes(state));
        if (value == keccak256("ACTIVE")) return AssetState.ACTIVE;
        if (value == keccak256("IN_MAINTENANCE")) return AssetState.IN_MAINTENANCE;
        if (value == keccak256("DECOMMISSIONED")) return AssetState.DECOMMISSIONED;
        revert UnknownState(state);
    }

    function _stateName(AssetState state) internal pure returns (string memory) {
        if (state == AssetState.ACTIVE) return "ACTIVE";
        if (state == AssetState.IN_MAINTENANCE) return "IN_MAINTENANCE";
        if (state == AssetState.DECOMMISSIONED) return "DECOMMISSIONED";
        return "NONE";
    }
}
