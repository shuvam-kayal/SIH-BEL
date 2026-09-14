// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Asset identity as an NFT, plus custody, lifecycle state and
/// the component hierarchy (docs/DATA_MODEL.md: Asset, Component).
/// Per SYSTEM_SPEC.md, only identifiers/hashes live on-chain — no
/// classified descriptions, drawings or documents.
///
/// Every function maps to a frozen transaction type in
/// docs/CONTRACT_SPEC.md. Don't add functions here without updating
/// that document first.
interface IAssetRegistry {
    /// ASSET_MINT
    event AssetMinted(uint256 indexed nftId, string assetId, address indexed owner);
    /// ASSET_TRANSFER
    event AssetTransferred(uint256 indexed nftId, address indexed from, address indexed to);
    /// ASSET_STATE_CHANGE
    event AssetStateChanged(uint256 indexed nftId, string previousState, string newState);
    /// COMPONENT_ATTACH
    event ComponentAttached(uint256 indexed parentNftId, uint256 indexed componentNftId);
    /// COMPONENT_REMOVE
    event ComponentRemoved(uint256 indexed parentNftId, uint256 indexed componentNftId);

    function mintAsset(string calldata assetId, address owner) external returns (uint256 nftId);

    function transferAsset(uint256 nftId, address newOwner) external;

    /// @param newState must be one of shared/enums ASSET_STATUSES.
    function changeAssetState(uint256 nftId, string calldata newState) external;

    /// @notice Attaches a component asset to a parent assembly. Both are
    /// assets in their own right; the hierarchy is the parent link in
    /// docs/DATA_MODEL.md's Asset.parentAssetId.
    function attachComponent(uint256 parentNftId, uint256 componentNftId) external;

    function removeComponent(uint256 parentNftId, uint256 componentNftId) external;

    /// @return The parent assembly's token id, or 0 when the asset is
    /// standalone.
    function parentOf(uint256 nftId) external view returns (uint256);

    function componentsOf(uint256 nftId) external view returns (uint256[] memory);

    function ownerOfAsset(uint256 nftId) external view returns (address);

    function custodianOf(uint256 nftId) external view returns (address);
}
