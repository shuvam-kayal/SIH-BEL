// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { IAssetRegistry } from "./IAssetRegistry.sol";
import { BelAccess } from "./BelAccess.sol";
import { BelRoles } from "./BelRoles.sol";

/// @notice Asset identity as an ERC-721 token (ADR-004), plus custody,
/// lifecycle state and the component hierarchy.
///
/// Token ids start at 1; 0 means "no parent" in `parentOf`.
///
/// Standard ERC-721 approvals and transfers are disabled: an owner moving
/// the token directly would bypass RBAC_MATRIX.md's "Transfer asset" row.
/// All ownership changes go through `transferAsset`. Read-side ERC-721
/// (`ownerOf`, `balanceOf`, `supportsInterface`, `Transfer` events) still
/// works for wallets and indexers.
///
/// Only the off-chain `assetId` reference and public addresses are stored.
/// Asset type, descriptions and documents stay off-chain (ADR-005).
///
/// Lifecycle: ACTIVE <-> IN_MAINTENANCE; either -> DECOMMISSIONED (terminal).
contract AssetRegistry is IAssetRegistry, ERC721, BelAccess {
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

    error InvalidAssetId();
    error InvalidRecipient(address account);
    error AssetAlreadyExists(string assetId);
    error AssetNotFound(uint256 nftId);
    error AssetIdNotFound(string assetId);
    error UnknownState(string state);
    error InvalidStateTransition(uint256 nftId, AssetState from, AssetState to);
    error AssetDecommissioned(uint256 nftId);
    error SelfAttachment(uint256 nftId);
    error AlreadyAttached(uint256 componentNftId, uint256 currentParent);
    error NotAttached(uint256 parentNftId, uint256 componentNftId);
    error CyclicHierarchy(uint256 parentNftId, uint256 componentNftId);
    error ComponentIsAttached(uint256 nftId);
    error DirectTransferDisabled();
    error TransferNotAuthorized(address actor, uint256 nftId);

    uint256 public constant MAX_ASSET_ID_LENGTH = 128;

    uint256 private _nextId = 1;
    mapping(uint256 => AssetRecord) private _assets;
    mapping(bytes32 => uint256) private _idByAssetId;
    mapping(uint256 => uint256[]) private _components;
    mapping(uint256 => uint256) private _componentIndex; // 1-based index in parent's array
    struct TransferGrant { uint64 expiresAt; bool active; }
    mapping(uint256 => mapping(address => TransferGrant)) private _transferGrants;

    constructor() ERC721("BEL Industrial Asset", "BELA") { }

    // ---------------------------------------------------------------- writes

    /// ASSET_MINT. Owner and custodian are both `owner` at mint.
    function mintAsset(string calldata assetId, address owner)
        external
        onlyRoles(BelRoles.REGISTER_ASSET)
        returns (uint256 nftId)
    {
        uint256 len = bytes(assetId).length;
        if (len == 0 || len > MAX_ASSET_ID_LENGTH) revert InvalidAssetId();
        _requireActiveRecipient(owner);
        bytes32 key = keccak256(bytes(assetId));
        if (_idByAssetId[key] != 0) revert AssetAlreadyExists(assetId);

        nftId = _nextId++;
        _idByAssetId[key] = nftId;
        _assets[nftId] = AssetRecord({
            assetId: assetId,
            custodian: owner,
            parent: 0,
            state: AssetState.ACTIVE,
            mintedAt: uint64(block.timestamp)
        });
        _mint(owner, nftId);
        emit AssetMinted(nftId, assetId, owner);
        _audit("ASSET", assetId, "ASSET_MINT");
    }

    /// ASSET_TRANSFER. Ownership and custody move together
    /// (CONTRACT_SPEC.md "Asset transfer semantics"). ENGINEER callers must
    /// also hold an active, resource-scoped grant registered by an ADMIN.
    function transferAsset(uint256 nftId, address newOwner)
        external
    {
        _checkTransferAccess(msg.sender, nftId);
        AssetRecord storage a = _existing(nftId);
        if (a.state == AssetState.DECOMMISSIONED) revert AssetDecommissioned(nftId);
        if (a.parent != 0) revert ComponentIsAttached(nftId);
        _requireActiveRecipient(newOwner);
        address from = ownerOf(nftId);
        if (from == newOwner) revert InvalidRecipient(newOwner);

        _transfer(from, newOwner, nftId);
        a.custodian = newOwner;
        emit AssetTransferred(nftId, from, newOwner);
        _audit("ASSET", a.assetId, "ASSET_TRANSFER");
    }

    function setTransferGrant(uint256 nftId, address actor, uint64 expiresAt, bool active, string calldata grantId)
        external
        onlyRoles(BelRoles.MANAGE_ROLES)
    {
        _existing(nftId);
        if (actor == address(0)) revert ZeroAddress();
        _transferGrants[nftId][actor] = TransferGrant({ expiresAt: expiresAt, active: active });
        emit TransferGrantSet(nftId, actor, expiresAt, active, grantId);
        _audit("GRANT", grantId, active ? "GRANT_CREATE" : "GRANT_REVOKE");
    }

    function _checkTransferAccess(address caller, uint256 nftId) internal view {
        if (_hasAnyRole(caller, BelRoles.ENGINEER)) {
            _checkRoles(caller, BelRoles.ENGINEER);
            if (!_hasActiveTransferGrant(nftId, caller)) revert TransferNotAuthorized(caller, nftId);
        } else {
            _checkRoles(caller, BelRoles.TRANSFER_ASSET);
        }
    }

    function _hasActiveTransferGrant(uint256 nftId, address actor) internal view returns (bool) {
        TransferGrant memory grant = _transferGrants[nftId][actor];
        return grant.active && (grant.expiresAt == 0 || grant.expiresAt > block.timestamp);
    }

    /// ASSET_STATE_CHANGE. `newState` is one of shared/enums ASSET_STATUSES.
    function changeAssetState(uint256 nftId, string calldata newState)
        external
        onlyRoles(BelRoles.MANAGE_ASSET)
    {
        AssetRecord storage a = _existing(nftId);
        AssetState from = a.state;
        AssetState to = _parseState(newState);
        if (from == to || from == AssetState.DECOMMISSIONED) {
            revert InvalidStateTransition(nftId, from, to);
        }
        a.state = to;
        emit AssetStateChanged(nftId, _stateName(from), newState);
        _audit("ASSET", a.assetId, "ASSET_STATE_CHANGE");
    }

    /// COMPONENT_ATTACH
    function attachComponent(uint256 parentNftId, uint256 componentNftId)
        external
        onlyRoles(BelRoles.MANAGE_ASSET)
    {
        if (parentNftId == componentNftId) revert SelfAttachment(parentNftId);
        AssetRecord storage parent = _existing(parentNftId);
        AssetRecord storage comp = _existing(componentNftId);
        if (parent.state == AssetState.DECOMMISSIONED) revert AssetDecommissioned(parentNftId);
        if (comp.state == AssetState.DECOMMISSIONED) revert AssetDecommissioned(componentNftId);
        if (comp.parent != 0) revert AlreadyAttached(componentNftId, comp.parent);

        // Reject cycles: the component must not be an ancestor of the parent.
        for (uint256 cur = parent.parent; cur != 0; cur = _assets[cur].parent) {
            if (cur == componentNftId) revert CyclicHierarchy(parentNftId, componentNftId);
        }

        comp.parent = parentNftId;
        _components[parentNftId].push(componentNftId);
        _componentIndex[componentNftId] = _components[parentNftId].length;
        emit ComponentAttached(parentNftId, componentNftId);
        _audit("ASSET", comp.assetId, "COMPONENT_ATTACH");
    }

    /// COMPONENT_REMOVE
    function removeComponent(uint256 parentNftId, uint256 componentNftId)
        external
        onlyRoles(BelRoles.MANAGE_ASSET)
    {
        _existing(parentNftId);
        AssetRecord storage comp = _existing(componentNftId);
        if (comp.parent != parentNftId) revert NotAttached(parentNftId, componentNftId);

        uint256[] storage list = _components[parentNftId];
        uint256 idx = _componentIndex[componentNftId] - 1;
        uint256 last = list[list.length - 1];
        list[idx] = last;
        _componentIndex[last] = idx + 1;
        list.pop();
        delete _componentIndex[componentNftId];
        comp.parent = 0;

        emit ComponentRemoved(parentNftId, componentNftId);
        _audit("ASSET", comp.assetId, "COMPONENT_REMOVE");
    }

    // ----------------------------------------------------------------- views

    function parentOf(uint256 nftId) external view returns (uint256) {
        return _existing(nftId).parent;
    }

    function componentsOf(uint256 nftId) external view returns (uint256[] memory) {
        _existing(nftId);
        return _components[nftId];
    }

    function ownerOfAsset(uint256 nftId) external view returns (address) {
        _existing(nftId);
        return ownerOf(nftId);
    }

    function custodianOf(uint256 nftId) external view returns (address) {
        return _existing(nftId).custodian;
    }

    /// @return The token id for an off-chain assetId, or 0 if never minted.
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
        return _nextId - 1;
    }

    // ----------------------------------------- ERC-721 direct paths disabled

    function approve(address, uint256) public pure override {
        revert DirectTransferDisabled();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert DirectTransferDisabled();
    }

    function transferFrom(address, address, uint256) public pure override {
        revert DirectTransferDisabled();
    }

    function safeTransferFrom(address, address, uint256) public pure override {
        revert DirectTransferDisabled();
    }

    function safeTransferFrom(address, address, uint256, bytes memory) public pure override {
        revert DirectTransferDisabled();
    }

    // -------------------------------------------------------------- internal

    function _existing(uint256 nftId) private view returns (AssetRecord storage a) {
        a = _assets[nftId];
        if (a.state == AssetState.NONE) revert AssetNotFound(nftId);
    }

    /// Owners/custodians must be ACTIVE wallets so a token is never sent to an
    /// unknown or revoked key. The owning identity is still resolvable later
    /// via IdentityRegistry.identityOf(ownerOf(nftId)) even after revocation.
    function _requireActiveRecipient(address account) private view {
        if (account == address(0) || !identityRegistry.isActiveWallet(account)) {
            revert InvalidRecipient(account);
        }
    }

    function _parseState(string calldata s) private pure returns (AssetState) {
        bytes32 h = keccak256(bytes(s));
        if (h == keccak256("ACTIVE")) return AssetState.ACTIVE;
        if (h == keccak256("IN_MAINTENANCE")) return AssetState.IN_MAINTENANCE;
        if (h == keccak256("DECOMMISSIONED")) return AssetState.DECOMMISSIONED;
        revert UnknownState(s);
    }

    function _stateName(AssetState s) private pure returns (string memory) {
        if (s == AssetState.ACTIVE) return "ACTIVE";
        if (s == AssetState.IN_MAINTENANCE) return "IN_MAINTENANCE";
        if (s == AssetState.DECOMMISSIONED) return "DECOMMISSIONED";
        return "";
    }
}
