// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Persistent employee identity and the device-bound wallets
/// attached to it. Per SYSTEM_SPEC.md, the identity outlives any wallet:
/// revoking a wallet must not destroy role assignments or history.
///
/// Every function maps to a frozen transaction type in
/// docs/CONTRACT_SPEC.md.
interface IIdentityRegistry {
    /// IDENTITY_CREATE
    event IdentityCreated(address indexed wallet, string did);
    /// WALLET_ACTIVATE
    event WalletActivated(address indexed wallet, string did);
    /// WALLET_REVOKE
    event WalletRevoked(address indexed wallet, string reason);

    function createIdentity(address wallet, string calldata did) external;

    function activateWallet(address wallet) external;

    /// @param reason recorded for the audit trail; keep it
    /// non-sensitive, it is written on-chain.
    function revokeWallet(address wallet, string calldata reason) external;

    /// @notice Used by every other contract's modifiers — a revoked
    /// wallet must not transact regardless of the role it holds.
    function isActiveWallet(address wallet) external view returns (bool);

    /// @return The persistent identity (DID) behind a wallet address.
    function identityOf(address wallet) external view returns (string memory);
}
