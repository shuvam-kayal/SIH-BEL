// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";
import { IIdentityRegistry } from "./IIdentityRegistry.sol";
import { BelAccess } from "./BelAccess.sol";
import { BelRoles } from "./BelRoles.sol";

/// @notice Persistent identities (DIDs) and their device-bound wallets.
///
/// Wallet lifecycle: NONE -> PENDING -> ACTIVE -> REVOKED (terminal).
/// A revoked address can never be re-registered; a replacement wallet is a
/// new address linked to the same DID (ADR-003, ADR-020).
///
/// `createIdentity(wallet, did)` creates the identity if the DID is new and
/// always registers `wallet` as a PENDING wallet of that DID. Calling it
/// with an existing DID is how a replacement wallet is linked
/// (WALLET_REGISTER). Only public data is stored: DID, address, status,
/// timestamps and a non-sensitive revocation reason.
contract IdentityRegistry is IIdentityRegistry, BelAccess {
    enum WalletStatus {
        NONE,
        PENDING,
        ACTIVE,
        REVOKED
    }

    struct WalletRecord {
        bytes32 identityKey;
        WalletStatus status;
        uint64 registeredAt;
        uint64 activatedAt;
        uint64 revokedAt;
        string revokedReason;
    }

    error InvalidWallet();
    error InvalidDid();
    error InvalidReason();
    error WalletAlreadyRegistered(address wallet);
    error WalletNotFound(address wallet);
    error InvalidWalletStatus(address wallet, WalletStatus status);

    uint256 public constant MAX_DID_LENGTH = 128;
    uint256 public constant MAX_REASON_LENGTH = 256;

    mapping(address => WalletRecord) private _wallets;
    mapping(bytes32 => string) private _dids;
    mapping(bytes32 => address[]) private _walletsOfIdentity;

    /// @param bootstrapAdminWallet first ADMIN wallet; created ACTIVE so the
    /// system can onboard everyone else. RoleRegistry grants it ADMIN.
    constructor(address bootstrapAdminWallet, string memory bootstrapAdminDid) {
        _register(bootstrapAdminWallet, bootstrapAdminDid);
        WalletRecord storage w = _wallets[bootstrapAdminWallet];
        w.status = WalletStatus.ACTIVE;
        w.activatedAt = uint64(block.timestamp);
        emit WalletActivated(bootstrapAdminWallet, bootstrapAdminDid);
    }

    // ---------------------------------------------------------------- writes

    /// IDENTITY_CREATE (also WALLET_REGISTER for a replacement wallet).
    function createIdentity(address wallet, string calldata did)
        external
        onlyRoles(BelRoles.CREATE_EMPLOYEE)
    {
        _register(wallet, did);
        _audit("IDENTITY", did, "IDENTITY_CREATE");
    }

    /// WALLET_ACTIVATE. Only a PENDING wallet can be activated.
    function activateWallet(address wallet) external onlyRoles(BelRoles.ACTIVATE_WALLET) {
        WalletRecord storage w = _wallets[wallet];
        if (w.status == WalletStatus.NONE) revert WalletNotFound(wallet);
        if (w.status != WalletStatus.PENDING) revert InvalidWalletStatus(wallet, w.status);
        w.status = WalletStatus.ACTIVE;
        w.activatedAt = uint64(block.timestamp);
        string memory did = _dids[w.identityKey];
        emit WalletActivated(wallet, did);
        _audit("WALLET", Strings.toHexString(wallet), "WALLET_ACTIVATE");
    }

    /// WALLET_REVOKE. PENDING or ACTIVE -> REVOKED. The identity, its roles
    /// and its history are untouched.
    function revokeWallet(address wallet, string calldata reason)
        external
        onlyRoles(BelRoles.REVOKE_WALLET)
    {
        uint256 len = bytes(reason).length;
        if (len == 0 || len > MAX_REASON_LENGTH) revert InvalidReason();
        WalletRecord storage w = _wallets[wallet];
        if (w.status == WalletStatus.NONE) revert WalletNotFound(wallet);
        if (w.status == WalletStatus.REVOKED) revert InvalidWalletStatus(wallet, w.status);
        w.status = WalletStatus.REVOKED;
        w.revokedAt = uint64(block.timestamp);
        w.revokedReason = reason;
        emit WalletRevoked(wallet, reason);
        _audit("WALLET", Strings.toHexString(wallet), "WALLET_REVOKE");
    }

    // ----------------------------------------------------------------- views

    function isActiveWallet(address wallet) external view returns (bool) {
        return _wallets[wallet].status == WalletStatus.ACTIVE;
    }

    /// @return The DID behind `wallet`, or "" if the wallet is unknown.
    /// Revoked wallets still resolve, so history stays attributable.
    function identityOf(address wallet) external view returns (string memory) {
        return _dids[_wallets[wallet].identityKey];
    }

    function walletStatus(address wallet) external view returns (WalletStatus) {
        return _wallets[wallet].status;
    }

    function getWallet(address wallet) external view returns (WalletRecord memory) {
        return _wallets[wallet];
    }

    /// @return Every wallet ever linked to `did`, in registration order.
    function walletsOf(string calldata did) external view returns (address[] memory) {
        return _walletsOfIdentity[keccak256(bytes(did))];
    }

    function identityExists(string calldata did) external view returns (bool) {
        return _walletsOfIdentity[keccak256(bytes(did))].length != 0;
    }

    // -------------------------------------------------------------- internal

    function _register(address wallet, string memory did) private {
        if (wallet == address(0)) revert InvalidWallet();
        uint256 len = bytes(did).length;
        if (len == 0 || len > MAX_DID_LENGTH) revert InvalidDid();
        if (_wallets[wallet].status != WalletStatus.NONE) revert WalletAlreadyRegistered(wallet);

        bytes32 key = keccak256(bytes(did));
        if (_walletsOfIdentity[key].length == 0) _dids[key] = did;
        _walletsOfIdentity[key].push(wallet);
        _wallets[wallet] = WalletRecord({
            identityKey: key,
            status: WalletStatus.PENDING,
            registeredAt: uint64(block.timestamp),
            activatedAt: 0,
            revokedAt: 0,
            revokedReason: ""
        });
        emit IdentityCreated(wallet, did);
    }

    function _isActive(address wallet) internal view override returns (bool) {
        return _wallets[wallet].status == WalletStatus.ACTIVE;
    }
}
