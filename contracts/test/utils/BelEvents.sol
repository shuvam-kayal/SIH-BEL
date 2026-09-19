// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IRoleRegistry } from "../../src/IRoleRegistry.sol";

/// Mirrors of the interface events so tests can `vm.expectEmit` them
/// (solc 0.8.19 cannot emit `Interface.Event` directly). Signatures must stay
/// identical to src/I*.sol or the expectations silently stop matching.
abstract contract BelEvents {
    event IdentityCreated(address indexed wallet, string did);
    event WalletActivated(address indexed wallet, string did);
    event WalletRevoked(address indexed wallet, string reason);
    event RoleAssigned(address indexed identity, IRoleRegistry.Role role);
    event RoleRevoked(address indexed identity, IRoleRegistry.Role role);
    event AssetMinted(uint256 indexed nftId, string assetId, address indexed owner);
    event AssetTransferred(uint256 indexed nftId, address indexed from, address indexed to);
    event AssetStateChanged(uint256 indexed nftId, string previousState, string newState);
    event ComponentAttached(uint256 indexed parentNftId, uint256 indexed componentNftId);
    event ComponentRemoved(uint256 indexed parentNftId, uint256 indexed componentNftId);
    event JobCreated(string jobId, uint256 indexed assetNftId, address indexed createdBy);
    event JobAssigned(string jobId, address indexed technician);
    event JobStarted(string jobId, address indexed technician);
    event JobCompleted(string jobId, bytes32 evidenceHash);
    event JobApproved(string jobId, address indexed verifier);
    event JobRejected(string jobId, address indexed verifier, string reason);
}
